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
    [string]$Verifier,
    [string]$Vsix,
    [string]$Docs,
    [string]$Notices,
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
if ($PowerPointAddIn) {
    Copy-Required $PowerPointAddIn (Join-Path $Package 'WorkProofPowerPoint.dll')
    Copy-Required (Join-Path $PSScriptRoot 'local/install-native-powerpoint.ps1') (Join-Path $Package 'install-native-powerpoint.ps1')
}

if ($Desktop) { Copy-Required $Desktop (Join-Path $Package 'workproof-desktop.exe') }
if ($Vsix) { Copy-Required $Vsix (Join-Path $Package 'workproof.vsix') }
if ($Verifier) {
    if (-not (Test-Path -LiteralPath (Join-Path $Verifier 'index.html') -PathType Leaf)) { throw 'The verifier build has no index.html' }
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
}
[IO.File]::WriteAllText((Join-Path $Package 'BUILD-INFO.json'), ($provenance | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'local/install-native-word.ps1') -Destination $Package -Force
foreach ($entry in @('Install Word.cmd','Open WorkProof.cmd','Remove Word add-in.cmd','open-native-word.ps1')) {
    Copy-Required (Join-Path $PSScriptRoot ('local/'+$entry)) (Join-Path $Package $entry)
}
$licence = Join-Path (Split-Path -Parent $PSScriptRoot) 'LICENSE'
if (Test-Path -LiteralPath $licence -PathType Leaf) { Copy-Item -LiteralPath $licence -Destination $Package -Force }

$lines = Get-ChildItem -LiteralPath $Package -Recurse -File |
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
    Compress-Archive -Path (Join-Path $Package '*') -DestinationPath $Zip -CompressionLevel Optimal
    $zipHash = (Get-FileHash -LiteralPath $Zip -Algorithm SHA256).Hash
    Write-Output "Packed $Zip"
    Write-Output "SHA256 $($zipHash.ToLowerInvariant())"
}

Write-Output "Staged $($lines.Count) files in $Package"
