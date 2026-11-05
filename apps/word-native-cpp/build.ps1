#Requires -Version 5.1
<#
.SYNOPSIS
    Builds the native Word add-in (no common language runtime involved) and its COM probe.
.DESCRIPTION
    Requires a matching MSVC x86 or x64 environment on PATH; CI provides it through ilammy/msvc-dev-cmd.
    Nothing here needs Office, the .NET Framework or NuGet.
#>
[CmdletBinding()]
param(
    [string]$OutDir = (Join-Path $PSScriptRoot 'out'),
    [ValidateSet('x86','x64')][string]$Architecture = 'x64',
    [switch]$SkipProbe,
    [switch]$PowerPoint
)
$ErrorActionPreference = 'Stop'
if ($env:VSCMD_ARG_TGT_ARCH -ne $Architecture) {
    throw "MSVC target '$env:VSCMD_ARG_TGT_ARCH' does not match requested architecture '$Architecture'. Enter the matching MSVC environment first."
}
function Assert-PeArchitecture([string]$Path) {
    $stream = [IO.File]::OpenRead($Path)
    try {
        $reader = New-Object IO.BinaryReader($stream)
        if ($reader.ReadUInt16() -ne 0x5A4D -or $stream.Length -lt 64) { throw "Invalid PE output: $Path" }
        $stream.Position = 0x3C
        $offset = $reader.ReadInt32()
        if ($offset -lt 64 -or $offset + 6 -gt $stream.Length) { throw "Invalid PE offset: $Path" }
        $stream.Position = $offset
        if ($reader.ReadUInt32() -ne 0x4550) { throw "Invalid PE signature: $Path" }
        $expected = if ($Architecture -eq 'x86') { 0x14C } else { 0x8664 }
        if ($reader.ReadUInt16() -ne $expected) { throw "Output does not match requested $Architecture architecture: $Path" }
    } finally { $stream.Dispose() }
}
$source = Join-Path $PSScriptRoot 'src'
if (-not (Test-Path -LiteralPath (Join-Path $source 'connect.cpp'))) { throw 'src/connect.cpp is missing' }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$objectDir = Join-Path $OutDir 'obj'
$probeDir = Join-Path $OutDir 'obj-probe'
New-Item -ItemType Directory -Force -Path $objectDir | Out-Null
New-Item -ItemType Directory -Force -Path $probeDir | Out-Null

$common = @(
    '/nologo', '/std:c++17', '/EHsc', '/W4', '/O2', '/guard:cf', '/utf-8',
    '/DUNICODE', '/D_UNICODE', '/DWIN32_LEAN_AND_MEAN', '/MT', "/I$source"
)
if ($PowerPoint) { $common += '/DWORKPROOF_POWERPOINT' }
$libraries = @('winhttp.lib', 'shell32.lib', 'ole32.lib', 'oleaut32.lib', 'user32.lib', 'gdi32.lib', 'comctl32.lib', 'advapi32.lib', 'uuid.lib')

$sources = @('dllmain.cpp', 'connect.cpp', 'taskpane_control.cpp', 'pane.cpp', 'engine.cpp', 'ribbon.cpp', 'trace.cpp') |
    ForEach-Object { Join-Path $source $_ }
$dll = Join-Path $OutDir $(if ($PowerPoint) { 'WorkProofPowerPoint.dll' } else { 'WorkProofWord.dll' })
foreach ($file in $sources) {
    & cl @common "/Fo$objectDir\" /c $file
    if ($LASTEXITCODE -ne 0) { throw "compile failed: $file" }
}
$objects = $sources | ForEach-Object { Join-Path $objectDir ((Split-Path $_ -Leaf) -replace '\.cpp$', '.obj') }
& link /nologo /DLL /GUARD:CF "/OUT:$dll" "/DEF:$(Join-Path $source 'WorkProofWord.def')" @objects @libraries
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $dll)) { throw "link failed for $Architecture add-in: $dll" }
Assert-PeArchitecture $dll
Write-Output "Built $Architecture add-in: $dll"

if (-not $SkipProbe) {
    $actionProbe = Join-Path $OutDir 'test_action_metrics.exe'
    & cl @common (Join-Path $source 'test_action_metrics.cpp') "/Fo$probeDir\" "/Fe$actionProbe"
    if ($LASTEXITCODE -ne 0) { throw 'compile failed: test_action_metrics.cpp' }
    & $actionProbe
    if ($LASTEXITCODE -ne 0) { throw 'editor command classification failed' }
    $probe = Join-Path $OutDir 'test_addin.exe'
    & cl @common (Join-Path $source 'test_addin.cpp') "/Fo$probeDir\" "/Fe$probe" 'oleaut32.lib' 'ole32.lib' 'user32.lib' 'uuid.lib'
    if ($LASTEXITCODE -ne 0) { throw 'compile failed: test_addin.cpp' }
    Assert-PeArchitecture $probe
    & $probe $dll
    if ($LASTEXITCODE -ne 0) { throw "the $Architecture COM/ActiveX probe rejected the built add-in" }
}
if (-not $SkipProbe -and -not $PowerPoint) {
    $bindingProbe = Join-Path $OutDir 'test_document_binding.exe'
    & cl @common (Join-Path $source 'test_document_binding.cpp') "/Fo$probeDir\" "/Fe$bindingProbe" @libraries
    if ($LASTEXITCODE -ne 0) { throw 'compile failed: test_document_binding.cpp' }
    & $bindingProbe
    if ($LASTEXITCODE -ne 0) { throw 'document binding guards failed' }
    $snapshotProbe = Join-Path $OutDir 'test_snapshot.exe'
    & cl @common (Join-Path $source 'test_snapshot.cpp') "/Fo$probeDir\" "/Fe$snapshotProbe" @libraries
    if ($LASTEXITCODE -ne 0) { throw 'compile failed: test_snapshot.cpp' }
    & $snapshotProbe
    if ($LASTEXITCODE -ne 0) { throw 'document snapshot guards failed' }
    $processProbe = Join-Path $OutDir 'test_process.exe'
    & cl @common (Join-Path $source 'test_process.cpp') "/Fo$probeDir\" "/Fe$processProbe"
    if ($LASTEXITCODE -ne 0) { throw 'compile failed: test_process.cpp' }
    & $processProbe
    if ($LASTEXITCODE -ne 0) { throw 'controlled process limits failed' }
}

if (-not $SkipProbe -and $PowerPoint) {
    $snapshotProbe = Join-Path $OutDir 'test_powerpoint_snapshot.exe'
    & cl @common (Join-Path $source 'test_powerpoint_snapshot.cpp') "/Fo$probeDir\" "/Fe$snapshotProbe" @libraries
    if ($LASTEXITCODE -ne 0) { throw 'compile failed: test_powerpoint_snapshot.cpp' }
    & $snapshotProbe
    if ($LASTEXITCODE -ne 0) { throw 'PowerPoint snapshot guards failed' }
}

Get-ChildItem -LiteralPath $OutDir -File | ForEach-Object {
    $hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    Write-Output ("{0}  {1}" -f $hash, $_.Name)
}
