#Requires -Version 5.1
# SPDX-License-Identifier: MIT
[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$application=$null
try {
    $application=[Runtime.InteropServices.Marshal]::GetActiveObject('InDesign.Application')
    [Console]::OutputEncoding=New-Object Text.UTF8Encoding($false)
    $source=$env:WORKPROOF_INDESIGN_SOURCE
    if(-not $source){$source=[IO.File]::ReadAllText((Join-Path $PSScriptRoot 'host.jsx'))}
    $source=$source -replace '^#target indesign\r?\n',''
    $raw=[string]$application.DoScript($source,1246973031)
    if([Text.Encoding]::UTF8.GetByteCount($raw) -gt 16777216){throw 'SNAPSHOT_LIMIT'}
    $value=$raw | ConvertFrom-Json
    if($value.error){throw 'INDESIGN_SNAPSHOT_UNAVAILABLE'}
    if($value.format -ne 'workproof-indesign-snapshot/1'){throw 'SNAPSHOT_FORMAT'}
    $payload=ConvertTo-Json -InputObject @($value.metrics,$value.stories,$value.layout) -Depth 16 -Compress
    $hasher=[Security.Cryptography.SHA256]::Create()
    try {
        $bytes=[Text.Encoding]::UTF8.GetBytes("workproof-indesign-layout-v1" + [char]0 + $payload)
        $digest=[BitConverter]::ToString($hasher.ComputeHash($bytes)).Replace('-','').ToLowerInvariant()
    } finally { $hasher.Dispose() }
    [ordered]@{
        format='workproof-indesign-observation/1'
        path=$value.path
        saved=$value.saved
        geometry_sha256=$digest
        metrics=$value.metrics
    } | ConvertTo-Json -Depth 4 -Compress
} finally {
    if($application -and [Runtime.InteropServices.Marshal]::IsComObject($application)){
        [void][Runtime.InteropServices.Marshal]::ReleaseComObject($application)
    }
}
