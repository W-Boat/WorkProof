#Requires -Version 7.4
param([Parameter(Mandatory=$true)][string]$RuntimeRoot)
$ErrorActionPreference = 'Stop'
$file = Join-Path ([System.IO.Path]::GetFullPath($RuntimeRoot)) 'state/credentials.json'
if (-not (Test-Path -LiteralPath $file)) { throw 'Start WorkProof once to create your local administrator account.' }
$config = Get-Content -LiteralPath $file -Raw | ConvertFrom-Json
Add-Type -AssemblyName System.Windows.Forms
# Local interactive display only; never print passwords into a terminal/log.
[void][System.Windows.Forms.MessageBox]::Show("本地入口：http://127.0.0.1:18081/login`n账号：admin`n密码：$($config.adminPassword)`n`n这是当前 Windows 用户私有的本地账号，请勿分享截图。", 'WorkProof · 本地管理员', 'OK', 'Information')
