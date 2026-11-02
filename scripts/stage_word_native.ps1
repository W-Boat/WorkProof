#Requires -Version 5.1
<#
.SYNOPSIS
    Assembles the portable native Word kit from already-built artifacts and hashes every file.
    Builds nothing; CI copies the outputs of the normal build jobs here.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Package,
    [Parameter(Mandatory = $true)][string]$AddIn,
    [Parameter(Mandatory = $true)][string]$Engine,
    [string]$Desktop,
    [string]$PowerPointAddIn,
    [string]$AddInX86,
    [string]$PowerPointAddInX86,
    [string]$Verifier,
    [string]$Vsix,
    [string]$Docs,
    [string]$Notices,
    [string]$C2pa,
    [string]$Zip
)
$ErrorActionPreference = 'Stop'

function Copy-Required([string]$Source, [string]$Destination) {
    if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) { throw "Missing build output: $Source" }
    Copy-Item -LiteralPath $Source -Destination $Destination -Force
}
function Copy-Optional([string]$Source, [string]$Destination) {
    if (Test-Path -LiteralPath $Source -PathType Leaf) { Copy-Item -LiteralPath $Source -Destination $Destination -Force }
}

New-Item -ItemType Directory -Force -Path $Package | Out-Null
$Package = (Resolve-Path -LiteralPath $Package).Path

Copy-Required $AddIn (Join-Path $Package (Split-Path -Leaf $AddIn))
Copy-Required $Engine (Join-Path $Package 'workproof-engine.exe')
Copy-Required (Join-Path $PSScriptRoot 'local/native-office-platform.ps1') (Join-Path $Package 'native-office-platform.ps1')
if ($AddInX86) { Copy-Required $AddInX86 (Join-Path $Package 'WorkProofWord.x86.dll') }
if ($PowerPointAddInX86) { Copy-Required $PowerPointAddInX86 (Join-Path $Package 'WorkProofPowerPoint.x86.dll') }
if ($PowerPointAddIn) {
    Copy-Required $PowerPointAddIn (Join-Path $Package 'WorkProofPowerPoint.dll')
    Copy-Required (Join-Path $PSScriptRoot 'local/install-native-powerpoint.ps1') (Join-Path $Package 'install-native-powerpoint.ps1')
    foreach ($entry in @('Install PowerPoint.cmd','Open PowerPoint WorkProof.cmd','Remove PowerPoint add-in.cmd','open-native-powerpoint.ps1')) {
        Copy-Required (Join-Path $PSScriptRoot ('local/'+$entry)) (Join-Path $Package $entry)
    }

}

if ($Desktop) { Copy-Required $Desktop (Join-Path $Package 'workproof-desktop.exe') }
if ($C2pa) {
    if (-not (Test-Path -LiteralPath (Join-Path $C2pa 'workproof-c2pa.exe') -PathType Leaf)) { throw 'C2PA image checker is missing.' }
    Copy-Item -LiteralPath $C2pa -Destination (Join-Path $Package 'c2pa') -Recurse -Force
}
if ($Vsix) { Copy-Required $Vsix (Join-Path $Package 'workproof.vsix') }
if ($Verifier) {
    foreach ($entry in @('index.html','verify-worker.js','wasm/workproof_protocol.js','wasm/workproof_protocol_bg.wasm','wasm/BUILD-INFO.json','demo/essay.md','demo/essay.md.wproof','demo/structure-demo.wgraph','c2pa/client.mjs','c2pa/pkg/workproof_c2pa_wasm_bg.wasm','notices/graph/inventory.json')) {
        if (-not (Test-Path -LiteralPath (Join-Path $Verifier $entry) -PathType Leaf)) { throw "The verifier build is missing a required entry resource: $entry" }
    }
    Copy-Item -LiteralPath $Verifier -Destination (Join-Path $Package 'verifier') -Recurse -Force
}
if ($Docs) {
    $readme = Join-Path $Docs 'WORD-NATIVE.md'
    if (Test-Path -LiteralPath $readme -PathType Leaf) {
        Copy-Item -LiteralPath $readme -Destination (Join-Path $Package 'README-WORD.md') -Force
    }
}
if ($Notices) {
    if (-not (Test-Path -LiteralPath (Join-Path $Notices 'inventory.json') -PathType Leaf)) { throw 'Dependency notice inventory is missing.' }
    Copy-Item -LiteralPath $Notices -Destination (Join-Path $Package 'third-party-notices') -Recurse -Force
}
$provenance = [ordered]@{
    schema = 'workproof.package.v1'
    source_commit = $env:GITHUB_SHA
    build_run = $env:GITHUB_RUN_ID
    repository = $env:GITHUB_REPOSITORY
    notices = $(if ($Notices) { 'third-party-notices/inventory.json' } else { $null })
    windows_os = 'x64'
    word_dll_architectures = $(if ($AddInX86) { @('x86','x64') } else { @('x64') })
    powerpoint_dll_architectures = $(if ($PowerPointAddInX86) { @('x86','x64') } elseif ($PowerPointAddIn) { @('x64') } else { @() })
}
[IO.File]::WriteAllText((Join-Path $Package 'BUILD-INFO.json'), ($provenance | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'local/install-native-word.ps1') -Destination $Package -Force
foreach ($entry in @('Install Word.cmd','Open WorkProof.cmd','Remove Word add-in.cmd','open-native-word.ps1')) {
    Copy-Required (Join-Path $PSScriptRoot ('local/'+$entry)) (Join-Path $Package $entry)
}
$licence = Join-Path (Split-Path -Parent $PSScriptRoot) 'LICENSE'
if (Test-Path -LiteralPath $licence -PathType Leaf) { Copy-Item -LiteralPath $licence -Destination $Package -Force }

$lines = Get-ChildItem -LiteralPath $Package -Recurse -File -Force |
    Where-Object { $_.Name -ne 'SHA256SUMS.txt' } |
    Sort-Object FullName |
    ForEach-Object {
        $hash = Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256
        $relative = $_.FullName.Substring($Package.Length + 1).Replace('\', '/')
        $hash.Hash.ToLowerInvariant() + '  ' + $relative
    }
[IO.File]::WriteAllLines((Join-Path $Package 'SHA256SUMS.txt'), $lines, (New-Object Text.UTF8Encoding($false)))

if ($Zip) {
    $folder = Split-Path -Parent ([IO.Path]::GetFullPath($Zip))
    if ($folder) { New-Item -ItemType Directory -Force -Path $folder | Out-Null }
    if (Test-Path -LiteralPath $Zip) { Remove-Item -LiteralPath $Zip -Force }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::CreateFromDirectory($Package, [IO.Path]::GetFullPath($Zip), [IO.Compression.CompressionLevel]::Optimal, $false)
    $zipHash = (Get-FileHash -LiteralPath $Zip -Algorithm SHA256).Hash
    Write-Output "Packed $Zip"
    Write-Output "SHA256 $($zipHash.ToLowerInvariant())"
}

Write-Output "Staged $($lines.Count) files in $Package"
