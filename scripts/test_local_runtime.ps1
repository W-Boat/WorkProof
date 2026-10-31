#Requires -Version 7.4
param()
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'local/runtime-common.ps1')
$fixture = Join-Path $env:RUNNER_TEMP ('WorkProof runtime fixture ' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force (Join-Path $fixture 'state'),(Join-Path $fixture 'logs') | Out-Null
& (Join-Path $PSScriptRoot 'local/prepare-local-https.ps1') -RuntimeRoot $fixture
$tls = Get-Content (Join-Path $fixture 'state/tls/https.json') -Raw | ConvertFrom-Json
$leaf = [System.Security.Cryptography.X509Certificates.X509Certificate2]::CreateFromPemFile((Join-Path $fixture 'state/tls/localhost.crt'),(Join-Path $fixture 'state/tls/localhost.key'))
try {
    if ($leaf.GetCertHashString([System.Security.Cryptography.HashAlgorithmName]::SHA256) -ne $tls.certificateSha256) { throw 'Generated certificate fingerprint mismatch' }
    if (-not $leaf.HasPrivateKey -or -not $leaf.MatchesHostname('localhost',$false,$false)) { throw 'Invalid localhost certificate/key or SAN' }
    $store = [System.Security.Cryptography.X509Certificates.X509Store]::new('Root','CurrentUser')
    try {
        $store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadOnly)
        if (@($store.Certificates | Where-Object {$_.Thumbprint -eq $leaf.Thumbprint}).Count) { throw 'Preparation must not modify OS certificate trust' }
    } finally { $store.Dispose() }
} finally { $leaf.Dispose() }
foreach ($file in Get-ChildItem (Join-Path $PSScriptRoot 'local') -Filter '*.ps1') {
    $tokens=$null; $parseErrors=$null
    [void][System.Management.Automation.Language.Parser]::ParseFile($file.FullName,[ref]$tokens,[ref]$parseErrors)
    if ($parseErrors.Count) {throw "PowerShell parse failure: $($file.Name): $parseErrors"}
}
$portFinder=[System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback,0)
$portFinder.Start();$port=$portFinder.LocalEndpoint.Port;$portFinder.Stop()
$listenerFile=Join-Path $fixture 'listener child.ps1'
@'
param([int]$Port)
$listener=[System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback,$Port)
$listener.Start()
while ($true) {Start-Sleep -Milliseconds 200}
'@ | Set-Content -LiteralPath $listenerFile
$wrapperFile=Join-Path $fixture 'wrapper parent.ps1'
@'
param([string]$Child,[int]$Port)
$start=[System.Diagnostics.ProcessStartInfo]::new()
$start.FileName=(Get-Process -Id $PID).Path
$start.UseShellExecute=$false;$start.CreateNoWindow=$true
foreach ($value in @('-NoProfile','-File',$Child,'-Port',"$Port")) {$start.ArgumentList.Add($value)}
$process=[System.Diagnostics.Process]::Start($start)
$process.WaitForExit()
'@ | Set-Content -LiteralPath $wrapperFile
$savedRecord=$null
try {
    [void](Start-RuntimeProcess $fixture 'fixture' (Get-Process -Id $PID).Path @('-NoProfile','-File',$wrapperFile,'-Child',$listenerFile,'-Port',"$port"))
    $file=Join-Path $fixture 'state/fixture-process.json'
    $savedRecord=Get-Content $file -Raw
    Wait-RuntimePort $fixture 'fixture' $port 30
    $tree=@(Get-RuntimeProcessTree $fixture 'fixture')
    if ($tree.Count -lt 2) {throw 'Expected verified parent/child process ownership'}
    $corrupt=$savedRecord | ConvertFrom-Json
    $corrupt.id=$PID
    $corrupt | ConvertTo-Json | Set-Content $file
    $refused=$false
    try {[void](Assert-RuntimePort $fixture 'fixture' $port)} catch {$refused=$true}
    if (-not $refused) {throw 'Foreign/reused PID was incorrectly accepted'}
    Stop-RuntimeProcess $fixture 'fixture'
    if (-not (Get-Process -Id $tree[0].Id -ErrorAction SilentlyContinue)) {throw 'Corrupt record stopped the actual service'}
    $savedRecord | Set-Content $file
    Stop-RuntimeProcess $fixture 'fixture'
    Start-Sleep -Milliseconds 500
    if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) {throw 'Owned child listener remained after stopping the tree'}
    Write-Output 'PASS: PowerShell syntax, paths containing spaces, native child ownership, PID reuse refusal, and stopping only the verified tree.'
} finally {
    if ($savedRecord) {
        $savedRecord | Set-Content (Join-Path $fixture 'state/fixture-process.json')
        Stop-RuntimeProcess $fixture 'fixture'
    }
}
