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
        $fixture='Software\WorkProofNative'+$hostSpec.Name+'CI\'+[guid]::NewGuid().ToString()
        $view=if ($architecture -eq 'x86') {[Microsoft.Win32.RegistryView]::Registry32} else {[Microsoft.Win32.RegistryView]::Registry64}
        $probe=(Resolve-Path -LiteralPath $hostSpec[$architecture.ToUpperInvariant()]).Path
        $opposite=if ($architecture -eq 'x86') {$hostSpec.X64} else {$hostSpec.X86}
        $arguments=@{RuntimeRoot=$packageRoot;RegistryFixture=$fixture;RegistryFixtureArchitecture=$architecture}
        $arguments[$hostSpec.PathParameter]=$probe
        $installer=Join-Path $localScripts $hostSpec.Installer
        $open=Join-Path $localScripts $hostSpec.Open
        try {
            & $installer @arguments | Out-Null
            $inspection=& $open -OfficePath $probe -Inspect -RegistryFixture $fixture -RegistryFixtureArchitecture $architecture | ConvertFrom-Json
            $expectedDll=$hostSpec.Dll+$(if ($architecture -eq 'x86') {'.x86.dll'} else {'.dll'})
            if ($inspection.Architecture -ne $architecture -or [IO.Path]::GetFileName($inspection.Dll) -ne $expectedDll -or $inspection.RuntimeRoot -ne $packageRoot) { throw 'Read-only launcher selected the wrong native runtime' }
            $mismatch=$arguments.Clone();$mismatch[$hostSpec.PathParameter]=$opposite
            Expect-Rejected { & $installer @mismatch } '位数.*不一致'
            # Rejected attempts must preserve the previously valid registration.
            $again=& $open -OfficePath $probe -Inspect -RegistryFixture $fixture -RegistryFixtureArchitecture $architecture | ConvertFrom-Json
            if ($again.Dll -ne $inspection.Dll) { throw 'Rejected architecture attempt changed the installed DLL' }
            Expect-Rejected { & $open -OfficePath $opposite -Inspect -RegistryFixture $fixture -RegistryFixtureArchitecture $architecture } '位数.*不一致'
            & $installer @arguments -Remove | Out-Null
            Expect-Rejected { & $open -OfficePath $probe -Inspect -RegistryFixture $fixture -RegistryFixtureArchitecture $architecture } '没有找到.*加载项'
            $checks+=($hostSpec.Name+' '+$architecture+': native PE selection, inspect, mismatch refusal, preserved registration and removal')
        } finally { Clear-Fixture $fixture }
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
