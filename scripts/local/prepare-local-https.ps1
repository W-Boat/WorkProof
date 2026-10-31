#Requires -Version 7.4
param([Parameter(Mandatory=$true)][string]$RuntimeRoot)
$ErrorActionPreference = 'Stop'
$root = [System.IO.Path]::GetFullPath($RuntimeRoot)
if (-not (Test-Path -LiteralPath $root)) { throw 'Initialize the local runtime directory first.' }
$owner = (& whoami).Trim()
& icacls $root /inheritance:r /grant:r "${owner}:(OI)(CI)F" | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not restrict runtime directory permissions' }
$directory = Join-Path $root 'state/tls'
New-Item -ItemType Directory -Force $directory | Out-Null
$certificateFile = Join-Path $directory 'localhost.crt'
$keyFile = Join-Path $directory 'localhost.key'
if ((Test-Path $certificateFile) -ne (Test-Path $keyFile)) { throw 'Incomplete existing TLS material. No key or certificate was overwritten.' }
if (-not (Test-Path $certificateFile)) {
    $rsa = [System.Security.Cryptography.RSA]::Create(2048)
    try {
        $request = [System.Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=localhost', $rsa, [System.Security.Cryptography.HashAlgorithmName]::SHA256, [System.Security.Cryptography.RSASignaturePadding]::Pkcs1)
        $san = [System.Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new()
        $san.AddDnsName('localhost'); $san.AddIpAddress([System.Net.IPAddress]::Loopback)
        $request.CertificateExtensions.Add($san.Build())
        $request.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($false,$false,0,$true))
        $request.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new([System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]'DigitalSignature,KeyEncipherment',$true))
        $oids = [System.Security.Cryptography.OidCollection]::new()
        [void]$oids.Add([System.Security.Cryptography.Oid]::new('1.3.6.1.5.5.7.3.1'))
        $request.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]::new($oids,$false))
        $created = $request.CreateSelfSigned([DateTimeOffset]::UtcNow.AddMinutes(-5),[DateTimeOffset]::UtcNow.AddDays(30))
        try {
            [System.IO.File]::WriteAllText($keyFile,$rsa.ExportPkcs8PrivateKeyPem(),[System.Text.UTF8Encoding]::new($false))
            [System.IO.File]::WriteAllText($certificateFile,$created.ExportCertificatePem(),[System.Text.UTF8Encoding]::new($false))
        } finally { $created.Dispose() }
    } finally { $rsa.Dispose() }
}
$certificate = [System.Security.Cryptography.X509Certificates.X509Certificate2]::CreateFromPemFile($certificateFile,$keyFile)
try {
    if ($certificate.NotAfter.ToUniversalTime() -le [DateTime]::UtcNow -or $certificate.NotBefore.ToUniversalTime() -gt [DateTime]::UtcNow) { throw 'Existing localhost certificate is not currently valid. It was retained for explicit renewal.' }
    $dns = $certificate.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::DnsName,$false)
    $constraints = $certificate.Extensions | Where-Object {$_.Oid.Value -eq '2.5.29.19'}
    if ($dns -ne 'localhost' -or -not $constraints -or $constraints.CertificateAuthority) { throw 'Expected a localhost end-entity certificate, not a certificate authority.' }
    $configuration = @{port=18443; origin='https://localhost:18443'; certificateSha256=$certificate.GetCertHashString([System.Security.Cryptography.HashAlgorithmName]::SHA256); expiresUtc=$certificate.NotAfter.ToUniversalTime().ToString('o')}
    $configuration | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $directory 'https.json') -Encoding utf8
    Write-Output 'Local HTTPS configuration prepared. Restart the institution process to serve https://localhost:18443/office/manifest-word.xml.'
    Write-Output ('Certificate SHA-256: ' + $configuration.certificateSha256)
    Write-Output 'No certificate was added to Windows trust stores. Word installation requires explicit trust approval.'
} finally { $certificate.Dispose() }
