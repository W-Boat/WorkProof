#Requires -Version 7.4
param()
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true') { throw 'This test writes isolated fixture state; run it in GitHub Actions.' }
. (Join-Path $PSScriptRoot 'local/runtime-common.ps1')
. (Join-Path $PSScriptRoot 'local/word-registration.ps1')
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
$wordXml = @'
<OfficeApp xmlns="http://schemas.microsoft.com/office/appforoffice/1.1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="TaskPaneApp"><Id>9ebd5d58-80c3-4868-8dd5-c3f3c53d7942</Id><Hosts><Host Name="Document"/></Hosts><DefaultSettings><SourceLocation DefaultValue="https://localhost:18443/office/index.html"/></DefaultSettings><Permissions>ReadWriteDocument</Permissions></OfficeApp>
'@
Assert-WordManifest $wordXml
foreach ($invalid in @($wordXml.Replace('localhost:18443','foreign.invalid'),$wordXml.Replace('9ebd5d58','0ebd5d58'),$wordXml.Replace('Name="Document"','Name="Workbook"'),('<!DOCTYPE OfficeApp [<!ENTITY x SYSTEM "file:///unknown">]>'+$wordXml))) {
    $rejected=$false
    try { Assert-WordManifest $invalid } catch { $rejected=$true }
    if (-not $rejected) { throw 'Unsafe Word manifest was accepted' }
}
$testKey='Software\WorkProof\CI\'+[Guid]::NewGuid().ToString('N')
$manifestPath=Join-Path $fixture 'office/manifest-word.xml'
$registry=[Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser,[Microsoft.Win32.RegistryView]::Default)
try {
    $key=$registry.CreateSubKey($testKey,$true)
    try { $key.SetValue('unrelated-addin','retain-me') } finally { $key.Dispose() }
    Set-WordRegistration -ManifestPath $manifestPath -RegistrySubKey $testKey
    $key=$registry.OpenSubKey($testKey,$true)
    try {
        if ($key.GetValue($script:WorkProofWordId) -ne $manifestPath) { throw 'Local Word registration did not round-trip' }
        $key.SetValue($script:WorkProofWordId,'C:\foreign-installation\manifest.xml')
    } finally { $key.Dispose() }
    foreach ($remove in @($false,$true)) {
        $rejected=$false
        try { Set-WordRegistration -ManifestPath $manifestPath -RegistrySubKey $testKey -Remove:$remove } catch { $rejected=$true }
        if (-not $rejected) { throw 'A foreign registration was overwritten/removed' }
    }
    $key=$registry.OpenSubKey($testKey,$true)
    try { $key.SetValue($script:WorkProofWordId,$manifestPath) } finally { $key.Dispose() }
    Set-WordRegistration -ManifestPath $manifestPath -RegistrySubKey $testKey -Remove
    $key=$registry.OpenSubKey($testKey,$false)
    try {
        if ($null -ne $key.GetValue($script:WorkProofWordId,$null) -or $key.GetValue('unrelated-addin') -ne 'retain-me') { throw 'Word removal changed unrelated registration state' }
    } finally { $key.Dispose() }
    Write-Output 'PASS: strict Word manifest validation, isolated registry installation/removal, foreign install refusal and preservation of unrelated add-ins.'
} finally {
    if ($testKey -notmatch '^Software\\WorkProof\\CI\\[0-9a-f]{32}$') {throw 'Unsafe fixture cleanup path'}
    $registry.DeleteSubKeyTree($testKey,$false)
    $registry.Dispose()
}
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
