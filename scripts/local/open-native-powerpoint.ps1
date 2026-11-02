#Requires -Version 5.1
param([string]$OfficePath,[switch]$Inspect,[string]$RegistryFixture,[ValidateSet('x86','x64')][string]$RegistryFixtureArchitecture='x64')
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'native-office-platform.ps1')
$prefix=''
if ($RegistryFixture) {
    if ($env:GITHUB_ACTIONS -ne 'true' -or -not $Inspect -or $RegistryFixture -notmatch '^Software\\WorkProofNativePowerPointCI\\[A-Za-z0-9-]+$') { throw '注册测试只允许在隔离的 Actions 只读检查中使用。' }
    $prefix=$RegistryFixture+'\'
    $view=if ($RegistryFixtureArchitecture -eq 'x86') {[Microsoft.Win32.RegistryView]::Registry32} else {[Microsoft.Win32.RegistryView]::Registry64}
    if ($OfficePath -and (Get-WorkProofOfficeView $OfficePath) -ne $view) { throw '隔离宿主 PE 的位数与测试指定视图不一致。' }
} else {
    if ($PSBoundParameters.ContainsKey('RegistryFixtureArchitecture')) { throw '测试位数参数不能用于真实启动。' }
    if (-not $OfficePath) { $OfficePath=Find-WorkProofOffice 'PowerPoint' }
    if ($OfficePath) { $view=Get-WorkProofOfficeView $OfficePath }
    else {
        $registrations=@()
        foreach ($candidateView in @([Microsoft.Win32.RegistryView]::Registry32,[Microsoft.Win32.RegistryView]::Registry64)) {
            $candidate=Get-WorkProofNativeRegistration 'PowerPoint' $candidateView ''
            if ($candidate) { $registrations+=$candidate }
        }
        if ($registrations.Count -ne 1) { throw '没有找到 PowerPoint，或存在多种位数的安装。请打开一次 PowerPoint 后重新安装 WorkProof。' }
        $view=$registrations[0].View
    }
}
$registration=Get-WorkProofNativeRegistration 'PowerPoint' $view $prefix
if (-not $registration) { throw '没有找到与当前 PowerPoint 位数一致的原生加载项，请重新运行 Install PowerPoint.cmd。' }
$dll=$registration.Dll
$directory=Split-Path -Parent $dll
$executable=Join-Path $directory 'workproof-desktop.exe'
if (-not(Test-Path -LiteralPath $executable -PathType Leaf)) { throw '安装目录缺少桌面程序，请重新安装完整工作包。' }
if ($Inspect) {
    [pscustomobject]@{Dll=$dll;RuntimeRoot=$directory;Executable=$executable;Architecture=$(if ($view -eq [Microsoft.Win32.RegistryView]::Registry32) {'x86'} else {'x64'})} | ConvertTo-Json -Compress
    return
}
$existing=Get-Process -Name workproof-desktop -ErrorAction SilentlyContinue
if ($existing) { Write-Output 'WorkProof 已在运行，请从任务栏或系统托盘打开。';return }
Start-Process -FilePath $executable -WorkingDirectory $directory -WindowStyle Normal
