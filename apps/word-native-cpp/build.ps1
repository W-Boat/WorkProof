#Requires -Version 5.1
<#
.SYNOPSIS
    Builds the native Word add-in (no common language runtime involved) and its COM probe.
.DESCRIPTION
    Requires an MSVC x64 environment on PATH; CI provides it through ilammy/msvc-dev-cmd.
    Nothing here needs Office, the .NET Framework or NuGet.
#>
[CmdletBinding()]
param(
    [string]$OutDir = (Join-Path $PSScriptRoot 'out'),
    [switch]$SkipProbe
)
$ErrorActionPreference = 'Stop'
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
$libraries = @('winhttp.lib', 'shell32.lib', 'ole32.lib', 'oleaut32.lib', 'user32.lib', 'gdi32.lib', 'comctl32.lib', 'advapi32.lib', 'uuid.lib')

$sources = @('dllmain.cpp', 'connect.cpp', 'pane.cpp', 'engine.cpp', 'ribbon.cpp', 'trace.cpp') |
    ForEach-Object { Join-Path $source $_ }
$dll = Join-Path $OutDir 'WorkProofWord.dll'
foreach ($file in $sources) {
    & cl @common "/Fo$objectDir\" /c $file
    if ($LASTEXITCODE -ne 0) { throw "compile failed: $file" }
}
$objects = $sources | ForEach-Object { Join-Path $objectDir ((Split-Path $_ -Leaf) -replace '\.cpp$', '.obj') }
& link /nologo /DLL /GUARD:CF "/OUT:$dll" "/DEF:$(Join-Path $source 'WorkProofWord.def')" @objects @libraries
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $dll)) { throw 'link failed for WorkProofWord.dll' }
Write-Output "Built $dll"

if (-not $SkipProbe) {
    $probe = Join-Path $OutDir 'test_addin.exe'
    & cl @common (Join-Path $source 'test_addin.cpp') "/Fo$probeDir\" "/Fe$probe" 'oleaut32.lib' 'ole32.lib' 'user32.lib'
    if ($LASTEXITCODE -ne 0) { throw 'compile failed: test_addin.cpp' }
    & $probe $dll
    if ($LASTEXITCODE -ne 0) { throw 'the COM probe rejected the built add-in' }
    $processProbe = Join-Path $OutDir 'test_process.exe'
    & cl @common (Join-Path $source 'test_process.cpp') "/Fo$probeDir\" "/Fe$processProbe"
    if ($LASTEXITCODE -ne 0) { throw 'compile failed: test_process.cpp' }
    & $processProbe
    if ($LASTEXITCODE -ne 0) { throw 'controlled process limits failed' }
}

Get-ChildItem -LiteralPath $OutDir -File | ForEach-Object {
    $hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    Write-Output ("{0}  {1}" -f $hash, $_.Name)
}
