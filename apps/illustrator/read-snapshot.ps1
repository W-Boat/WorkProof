#Requires -Version 5.1
# SPDX-License-Identifier: MIT
# Read-only development probe. Never launches Illustrator or starts recording.
[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$application=$null
try {
    $application=[Runtime.InteropServices.Marshal]::GetActiveObject('Illustrator.Application')
    $script=Join-Path $PSScriptRoot 'host.jsx'
    if(-not (Test-Path -LiteralPath $script -PathType Leaf)){throw 'Missing snapshot script'}
    $raw=[string]$application.DoJavaScriptFile($script)
    if([Text.Encoding]::UTF8.GetByteCount($raw) -gt 1048576){throw 'Snapshot exceeds local bridge limit'}
    $value=$raw | ConvertFrom-Json
    if($value.error){throw ('Illustrator snapshot: '+$value.error)}
    if($value.format -ne 'workproof-illustrator-snapshot/1'){throw 'Unexpected snapshot format'}
    $raw
} finally {
    if($application -and [Runtime.InteropServices.Marshal]::IsComObject($application)){
        [void][Runtime.InteropServices.Marshal]::ReleaseComObject($application)
    }
}
