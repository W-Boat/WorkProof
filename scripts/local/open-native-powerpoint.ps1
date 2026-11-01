#Requires -Version 5.1
$ErrorActionPreference='Stop'
$base=[Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser,[Microsoft.Win32.RegistryView]::Registry64)
try {
    $key=$base.OpenSubKey('Software\Classes\CLSID\{6EC055C4-2EB0-49EB-80C9-30C6DA38EB86}\InprocServer32')
    if(-not $key){throw '请先双击 Install PowerPoint.cmd 安装 WorkProof。'}
    try {$dll=[string]$key.GetValue('')}finally{$key.Dispose()}
}finally{$base.Dispose()}
if(-not [IO.Path]::IsPathRooted($dll) -or [IO.Path]::GetFileName($dll) -ne 'WorkProofPowerPoint.dll'){throw '未找到对应的原生加载项安装，请重新安装。'}
$directory=Split-Path -Parent $dll
$executable=Join-Path $directory 'workproof-desktop.exe'
if(-not(Test-Path -LiteralPath $executable -PathType Leaf)){throw '安装目录缺少桌面程序，请重新安装完整工作包。'}
$existing=Get-Process -Name workproof-desktop -ErrorAction SilentlyContinue
if($existing){Write-Output 'WorkProof 已在运行，请从任务栏或系统托盘打开。';return}
Start-Process -FilePath $executable -WorkingDirectory $directory -WindowStyle Normal
