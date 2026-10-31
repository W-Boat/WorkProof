#Requires -Version 7.4
param([Parameter(Mandatory=$true)][string]$RuntimeRoot, [switch]$Remove, [switch]$Approved)
$ErrorActionPreference = 'Stop'
$directory = Join-Path ([System.IO.Path]::GetFullPath($RuntimeRoot)) 'state/tls'
$configuration = Get-Content (Join-Path $directory 'https.json') -Raw | ConvertFrom-Json
# Read the public certificate only; never import its private key into a store.
$certificate = [System.Security.Cryptography.X509Certificates.X509Certificate2]::CreateFromPem([System.IO.File]::ReadAllText((Join-Path $directory 'localhost.crt')))
try {
    $fingerprint = $certificate.GetCertHashString([System.Security.Cryptography.HashAlgorithmName]::SHA256)
    if ($fingerprint -ne $configuration.certificateSha256 -or $configuration.origin -ne 'https://localhost:18443') { throw 'Certificate does not match the reviewed localhost configuration' }
    $san = $certificate.Extensions | Where-Object {$_.Oid.Value -eq '2.5.29.17'}
    $constraints = $certificate.Extensions | Where-Object {$_.Oid.Value -eq '2.5.29.19'}
    $eku = $certificate.Extensions | Where-Object {$_.Oid.Value -eq '2.5.29.37'}
    # Exact DER permits only localhost and 127.0.0.1, no extra names/wildcards.
    if (-not $san -or [Convert]::ToHexString($san.RawData) -ne '301182096C6F63616C686F737487047F000001' -or -not $constraints -or $constraints.CertificateAuthority) { throw 'Only the exact localhost end-entity certificate may be trusted' }
    if (-not $eku -or @($eku.EnhancedKeyUsages).Count -ne 1 -or $eku.EnhancedKeyUsages[0].Value -ne '1.3.6.1.5.5.7.3.1') { throw 'Only a TLS server certificate is accepted' }
    if (($certificate.NotAfter - $certificate.NotBefore).TotalDays -gt 31) { throw 'Expected a short-lived local certificate' }
    if (-not $Remove -and ($certificate.NotBefore.ToUniversalTime() -gt [DateTime]::UtcNow -or $certificate.NotAfter.ToUniversalTime() -le [DateTime]::UtcNow)) { throw 'Certificate is not currently valid' }
    $verb = if ($Remove) {'移除信任'} else {'添加信任'}
    if (-not $Approved) {
        Add-Type -AssemblyName System.Windows.Forms
        $message = "即将为当前 Windows 用户$verb：`nlocalhost / 127.0.0.1 本地 HTTPS 证书`n`nSHA-256：$fingerprint`n有效期至：$($certificate.NotAfter.ToString('yyyy-MM-dd HH:mm:ss'))`n`n此操作会修改 CurrentUser\Root 证书信任，仅用于本机 Word 加载项验收。不会修改全计算机证书库，不会导入私钥。是否继续？"
        if ([System.Windows.Forms.MessageBox]::Show($message,'WorkProof · 本地证书信任','YesNo','Warning') -ne 'Yes') { Write-Output 'Certificate trust was not changed.'; return }
    }
    $store = [System.Security.Cryptography.X509Certificates.X509Store]::new('Root','CurrentUser')
    try {
        $store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
        if ($Remove) {
            foreach ($existing in $store.Certificates | Where-Object {$_.Thumbprint -eq $certificate.Thumbprint}) {
                if ($existing.GetCertHashString([System.Security.Cryptography.HashAlgorithmName]::SHA256) -ne $fingerprint) { throw 'Stored certificate fingerprint mismatch; removal refused' }
                $store.Remove($existing)
            }
        } else { $store.Add($certificate) }
        @{sha256=$fingerprint; thumbprint=$certificate.Thumbprint; trusted=(-not $Remove); changedUtc=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $directory 'trust-receipt.json') -Encoding utf8
        Write-Output $(if ($Remove) {'Removed this localhost certificate from CurrentUser Root.'} else {'Trusted this localhost certificate in CurrentUser Root; no private key was imported.'})
    } finally { $store.Dispose() }
} finally { $certificate.Dispose() }
