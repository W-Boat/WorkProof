#Requires -Version 5.1
<# CI-only selection/registration checks. PE fixtures are real compiled probes, not Office installations. #>
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$Package,
    [Parameter(Mandatory=$true)][string]$X86WordProbe,
    [Parameter(Mandatory=$true)][string]$X64WordProbe,
    [Parameter(Mandatory=$true)][string]$X86PowerPointProbe,
    [Parameter(Mandatory=$true)][string]$X64PowerPointProbe
)
$ErrorActionPreference='Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or -not [Environment]::Is64BitOperatingSystem) { throw 'Isolated 64-bit Windows Actions fixture only' }
$packageRoot=(Resolve-Path -LiteralPath $Package).Path
$localScripts=Join-Path $PSScriptRoot 'local'
$checks=@()
function Expect-Rejected([scriptblock]$Action,[string]$ExpectedPattern) {
    $rejected=$false
    try { & $Action | Out-Null } catch {
        if ($_.Exception.Message -notmatch $ExpectedPattern) { throw ('Unexpected rejection: '+$_.Exception.Message) }
        $rejected=$true
    }
    if (-not $rejected) { throw 'Invalid host architecture or missing DLL was accepted' }
}
function Assert-FixtureAbsent([string]$Fixture,[Microsoft.Win32.RegistryView]$View) {
    $base=[Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser,$View)
    try {
        $key=$base.OpenSubKey($Fixture+'\Software\Classes')
        if ($key) { $key.Dispose();throw 'Preflight failure wrote a class registration' }
    } finally { $base.Dispose() }
}
function Clear-Fixture([string]$Fixture) {
    if ($Fixture -notmatch '^Software\\WorkProofNative(Word|PowerPoint)CI\\[A-Za-z0-9-]+$') { throw 'Refuse to clear a non-fixture registry path' }
    foreach ($view in @([Microsoft.Win32.RegistryView]::Registry32,[Microsoft.Win32.RegistryView]::Registry64)) {
        $base=[Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser,$view)
        try { $base.DeleteSubKeyTree($Fixture,$false) } finally { $base.Dispose() }
    }
}
$hosts=@(
    @{Name='Word';Installer='install-native-word.ps1';Open='open-native-word.ps1';PathParameter='WordPath';Dll='WorkProofWord';X86=$X86WordProbe;X64=$X64WordProbe},
    @{Name='PowerPoint';Installer='install-native-powerpoint.ps1';Open='open-native-powerpoint.ps1';PathParameter='PowerPointPath';Dll='WorkProofPowerPoint';X86=$X86PowerPointProbe;X64=$X64PowerPointProbe}
)
foreach ($hostSpec in $hosts) {
    foreach ($architecture in @('x86','x64')) {
        foreach ($mode in @('original','copy')) {
            $fixture='Software\WorkProofNative'+$hostSpec.Name+'CI\'+[guid]::NewGuid().ToString()
            $view=if ($architecture -eq 'x86') {[Microsoft.Win32.RegistryView]::Registry32} else {[Microsoft.Win32.RegistryView]::Registry64}
            $probe=(Resolve-Path -LiteralPath $hostSpec[$architecture.ToUpperInvariant()]).Path
            $opposite=if ($architecture -eq 'x86') {$hostSpec.X64} else {$hostSpec.X86}
            $arguments=@{RuntimeRoot=$packageRoot;RegistryFixture=$fixture;RegistryFixtureArchitecture=$architecture}
            $arguments[$hostSpec.PathParameter]=$probe
            $installedRoot=$packageRoot
            if ($mode -eq 'copy') {
                $installedRoot=Join-Path $env:RUNNER_TEMP ('workproof-office-copy-'+[guid]::NewGuid().ToString('N'))
                $arguments.RegistryFixtureCopy=$true
                $arguments.InstallDir=$installedRoot
            }
            $installer=Join-Path $localScripts $hostSpec.Installer
            $open=Join-Path $localScripts $hostSpec.Open
            try {
                if ($mode -eq 'copy') {
                    $invalidCopy=$arguments.Clone()
                    $invalidCopy.InstallDir=Join-Path $env:RUNNER_TEMP ('invalid-office-copy-'+[guid]::NewGuid().ToString('N'))
                    Expect-Rejected { & $installer @invalidCopy } '复制测试目录必须'
                    if (Test-Path -LiteralPath $invalidCopy.InstallDir) { throw 'Rejected copy target was created' }
                    Assert-FixtureAbsent $fixture $view
                }
                & $installer @arguments | Out-Null
                $inspection=& $open -OfficePath $probe -Inspect -RegistryFixture $fixture -RegistryFixtureArchitecture $architecture | ConvertFrom-Json
                $expectedDll=$hostSpec.Dll+$(if ($architecture -eq 'x86') {'.x86.dll'} else {'.dll'})
                if ($inspection.Architecture -ne $architecture -or [IO.Path]::GetFileName($inspection.Dll) -ne $expectedDll -or $inspection.RuntimeRoot -ne $installedRoot) { throw 'Read-only launcher selected the wrong native runtime' }
                if ($mode -eq 'copy') {
                    if (-not (Test-Path -LiteralPath (Join-Path $installedRoot '.workproof-native') -PathType Leaf)) { throw 'Copied installation is missing its ownership marker' }
                    $required=@($expectedDll,'workproof-engine.exe','workproof-desktop.exe','native-office-platform.ps1',$hostSpec.Open,$hostSpec.Installer,
                        'verifier/verify-worker.js','verifier/wasm/workproof_protocol_bg.wasm','verifier/c2pa/pkg/workproof_c2pa_wasm_bg.wasm')
                    foreach ($relative in $required) {
                        $original=Join-Path $packageRoot $relative
                        $copied=Join-Path $installedRoot $relative
                        if (-not (Test-Path -LiteralPath $copied -PathType Leaf) -or
                            (Get-FileHash -LiteralPath $original -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $copied -Algorithm SHA256).Hash) { throw ('Copied payload missing or changed: '+$relative) }
                    }
                    foreach ($file in (Get-ChildItem -LiteralPath $installedRoot -Recurse -File -Force)) {
                        $relative=$file.FullName.Substring($installedRoot.Length+1)
                        if ($relative -eq '.workproof-native') { continue }
                        $original=Join-Path $packageRoot $relative
                        if (-not (Test-Path -LiteralPath $original -PathType Leaf) -or
                            (Get-FileHash -LiteralPath $original -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash) { throw ('Installed file differs from delivered package: '+$relative) }
                    }
                    $copiedOpen=Join-Path $installedRoot $hostSpec.Open
                    $fromCopy=& $copiedOpen -OfficePath $probe -Inspect -RegistryFixture $fixture -RegistryFixtureArchitecture $architecture | ConvertFrom-Json
                    if ($fromCopy.Dll -ne $inspection.Dll -or $fromCopy.RuntimeRoot -ne $installedRoot -or
                        $fromCopy.Executable -ne (Join-Path $installedRoot 'workproof-desktop.exe')) { throw 'Copied launch entry resolves outside installed runtime' }
                }
                $mismatch=$arguments.Clone();$mismatch[$hostSpec.PathParameter]=$opposite
                Expect-Rejected { & $installer @mismatch } '位数.*不一致'
                # Rejected attempts must preserve the previously valid registration.
                $again=& $open -OfficePath $probe -Inspect -RegistryFixture $fixture -RegistryFixtureArchitecture $architecture | ConvertFrom-Json
                if ($again.Dll -ne $inspection.Dll) { throw 'Rejected architecture attempt changed the installed DLL' }
                Expect-Rejected { & $open -OfficePath $opposite -Inspect -RegistryFixture $fixture -RegistryFixtureArchitecture $architecture } '位数.*不一致'
                & $installer @arguments -Remove | Out-Null
                Expect-Rejected { & $open -OfficePath $probe -Inspect -RegistryFixture $fixture -RegistryFixtureArchitecture $architecture } '没有找到.*加载项'
                $checks+=($hostSpec.Name+' '+$architecture+' '+$mode+': native PE selection, installed payload and launcher, mismatch refusal, preserved registration and removal')
            } finally {
                Clear-Fixture $fixture
                if ($mode -eq 'copy' -and (Test-Path -LiteralPath $installedRoot -PathType Container)) {
                    $tempPrefix=[IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd('\')+'\'
                    $resolvedCopy=[IO.Path]::GetFullPath($installedRoot)
                    if (-not $resolvedCopy.StartsWith($tempPrefix,[StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($resolvedCopy) -notmatch '^workproof-office-copy-[a-f0-9]{32}$') { throw 'Refuse to remove a non-fixture copy directory' }
                    Remove-Item -LiteralPath $resolvedCopy -Recurse -Force
                }
            }
        }
    }
}
# Missing x86 payload must fail before registry writes; no fabricated PE or CLR probe is used.
$tempRoot=[IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd('\')+'\'
$partial=[IO.Path]::GetFullPath((Join-Path $tempRoot ('workproof-office-no-x86-'+[guid]::NewGuid().ToString('N'))))
if (-not $partial.StartsWith($tempRoot,[StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected partial-package fixture path' }
New-Item -ItemType Directory -Path $partial | Out-Null
try {
    foreach ($file in @('WorkProofWord.dll','WorkProofPowerPoint.dll','workproof-engine.exe')) { Copy-Item -LiteralPath (Join-Path $packageRoot $file) -Destination $partial }
    foreach ($hostSpec in $hosts) {
        $fixture='Software\WorkProofNative'+$hostSpec.Name+'CI\'+[guid]::NewGuid().ToString()
        $arguments=@{RuntimeRoot=$partial;RegistryFixture=$fixture;RegistryFixtureArchitecture='x86'}
        $arguments[$hostSpec.PathParameter]=$hostSpec.X86
        try {
            $installer=Join-Path $localScripts $hostSpec.Installer
            Expect-Rejected { & $installer @arguments } '工作包缺少.*32'
            Assert-FixtureAbsent $fixture ([Microsoft.Win32.RegistryView]::Registry32)
            $checks+=($hostSpec.Name+': missing x86 DLL rejected before registration')
        } finally { Clear-Fixture $fixture }
    }
} finally {
    $resolvedPartial=[IO.Path]::GetFullPath($partial)
    if (-not $resolvedPartial.StartsWith($tempRoot,[StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($resolvedPartial) -notlike 'workproof-office-no-x86-*') { throw 'Refuse to remove a non-fixture directory' }
    Remove-Item -LiteralPath $resolvedPartial -Recurse -Force
}
@{scope='Real PE files and Windows registry API in isolated prefixes; no real Office host or WOW64 redirection claim';checks=$checks} | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath 'test-office-bitness-results.json' -Encoding utf8
Write-Output ('PASS: '+$checks.Count+' Office architecture selection and registration checks')
