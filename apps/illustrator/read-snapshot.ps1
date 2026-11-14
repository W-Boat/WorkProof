#Requires -Version 5.1
# SPDX-License-Identifier: MIT
# Read-only development probe. Never launches Illustrator or starts recording.
[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$application=$null
try {
    $application=[Runtime.InteropServices.Marshal]::GetActiveObject('Illustrator.Application')
    [Console]::OutputEncoding=New-Object Text.UTF8Encoding($false)
    $source=$env:WORKPROOF_ILLUSTRATOR_SOURCE
    if(-not $source){$source=[IO.File]::ReadAllText((Join-Path $PSScriptRoot 'host.jsx'))}
    $source=$source -replace '^#target illustrator\r?\n',''
    $raw=[string]$application.DoJavaScript($source)
    if([Text.Encoding]::UTF8.GetByteCount($raw) -gt 4194304){throw 'Snapshot exceeds local bridge limit'}
    $value=$raw | ConvertFrom-Json
    if($value.error){throw ('Illustrator snapshot: '+$value.error)}
    if($value.format -ne 'workproof-illustrator-snapshot/1'){throw 'Unexpected snapshot format'}
    # Keep object UUIDs, coordinates and group structure inside this native process.
    $rows=[object[]]@($value.objects)
    $payload=ConvertTo-Json -InputObject $rows -Depth 16 -Compress
    $hasher=[Security.Cryptography.SHA256]::Create()
    try {
        $inputBytes=[Text.Encoding]::UTF8.GetBytes("workproof-illustrator-geometry-v1" + [char]0 + $payload)
        $digest=[BitConverter]::ToString($hasher.ComputeHash($inputBytes)).Replace('-','').ToLowerInvariant()
    } finally { $hasher.Dispose() }
    [ordered]@{
        format='workproof-illustrator-observation/1'
        path=$value.path
        saved=$value.saved
        metrics=$value.metrics
        geometry_sha256=$digest
    } | ConvertTo-Json -Depth 4 -Compress
} finally {
    if($application -and [Runtime.InteropServices.Marshal]::IsComObject($application)){
        [void][Runtime.InteropServices.Marshal]::ReleaseComObject($application)
    }
}
