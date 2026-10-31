#Requires -Version 7.4
param([Parameter(Mandatory=$true)][string]$RuntimeRoot, [switch]$AsJson)
. (Join-Path $PSScriptRoot 'runtime-common.ps1')
$root = [System.IO.Path]::GetFullPath($RuntimeRoot)
$rows = foreach ($name in @('mysql','cache','institution','ui')) {
    $process = Get-OwnedRuntimeProcess $root $name
    $tree = @(Get-RuntimeProcessTree $root $name)
    [pscustomobject]@{service=$name; running=[bool]$process; processIds=@($tree | ForEach-Object {$_.Id})}
}
$healthy = $false
$gatewayOwned = $false
foreach ($name in @('ui','institution')) {
    try { $gatewayOwned = Assert-RuntimePort $root $name 18081 } catch { continue }
    if ($gatewayOwned) { break }
}
if ($gatewayOwned -and @($rows | Where-Object { $_.service -in @('mysql','cache','institution') -and $_.running }).Count -eq 3) {
    try { $healthy = (Invoke-RestMethod 'http://127.0.0.1:18081/api/health' -TimeoutSec 5).code -eq 200 } catch {}
}
$result = @{url='http://127.0.0.1:18081/login'; healthy=$healthy; services=@($rows)}
if ($AsJson) { $result | ConvertTo-Json -Depth 5 } else {
    $rows | Format-Table service,running,processIds
    Write-Output "Institution health: $healthy"
    Write-Output $result.url
}
if (-not $healthy) { exit 1 }
