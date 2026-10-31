#Requires -Version 7.4
param([Parameter(Mandatory=$true)][string]$RuntimeRoot, [switch]$Remove, [switch]$Approved)
. (Join-Path $PSScriptRoot 'runtime-common.ps1')
. (Join-Path $PSScriptRoot 'word-registration.ps1')
$root = [System.IO.Path]::GetFullPath($RuntimeRoot)
$manifestPath = Join-Path $root 'office/manifest-word.xml'
if (-not $Remove) {
    if (-not (Assert-RuntimePort $root 'institution' 18443)) { throw 'Start the WorkProof localhost HTTPS service first' }
    try {
        # Uses normal OS certificate validation; no untrusted certificate bypass.
        $response = Invoke-WebRequest 'https://localhost:18443/office/manifest-word.xml' -TimeoutSec 15
    } catch { throw 'Word manifest could not be read through trusted HTTPS. Complete the explicit localhost certificate trust step first.' }
    Assert-WordManifest $response.Content
}
if (-not $Approved) {
    Add-Type -AssemblyName System.Windows.Forms
    $action = if ($Remove) {'撤销'} else {'安装'}
    $message = "$action WorkProof 本地 Word 开发加载项？`n`n只修改当前用户 HKCU\Software\Microsoft\Office\16.0\Wef\Developer 中的 WorkProof 项：`n$script:WorkProofWordId`n`n清单：$manifestPath`n不会清理 Office 缓存、更改其他加载项或关闭你的文档。这是本机开发验收安装，非机构集中部署。"
    if ([System.Windows.Forms.MessageBox]::Show($message,'WorkProof · Word 本地加载项','YesNo','Question') -ne 'Yes') { Write-Output 'Word add-in registration was not changed.'; return }
}
if (-not $Remove) {
    New-Item -ItemType Directory -Force (Split-Path $manifestPath) | Out-Null
    [System.IO.File]::WriteAllText($manifestPath,$response.Content,[System.Text.UTF8Encoding]::new($false))
}
Set-WordRegistration -ManifestPath $manifestPath -Remove:$Remove
@{id=$script:WorkProofWordId; manifest=$manifestPath; installed=(-not $Remove); changedUtc=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $root 'state/word-registration.json') -Encoding utf8
Write-Output $(if ($Remove) {'Removed only the WorkProof Word developer registration.'} else {'Registered WorkProof for the current user. In Word open Home > Add-ins > Advanced > Developer Add-ins. Save documents before restarting Word if it was already open.'})
