#Requires -Version 5.1
[CmdletBinding()]
param([ValidateSet('Word','PowerPoint')][string]$HostName,[switch]$Install)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false)
try {
    . (Join-Path $PSScriptRoot 'native-office-platform.ps1')
    $office=Find-WorkProofOffice $HostName
    if(-not $office){throw '未找到对应的 Microsoft Office 桌面软件。请先安装 Office，再重新检查。'}
    $view=Get-WorkProofOfficeView $office
    $registration=Get-WorkProofNativeRegistration $HostName $view ''
    if(-not $Install){
        @{installed=($null -ne $registration);host=$HostName;available=$true;restart_required=$false} | ConvertTo-Json -Compress
        exit 0
    }
    $processName=if($HostName -eq 'Word'){'WINWORD'}else{'POWERPNT'}
    if(Get-Process -Name $processName -ErrorAction SilentlyContinue){throw '请先保存并完全退出对应的 Office 软件，再点击安装。WorkProof 不会替你关闭文档。'}
    $build=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'BUILD-INFO.json') -Raw | ConvertFrom-Json
    if($build.source_commit -notmatch '^[a-f0-9]{40}$'){throw '安装包版本信息不完整，请重新下载完整配套包。'}
    $destination=Join-Path $env:LOCALAPPDATA ('WorkProof\desktop-office\'+$build.source_commit+'\'+$HostName)
    # Never let the legacy installer stop a desktop/collector process from this
    # destination. The new application continues running throughout installation.
    foreach($process in @(Get-Process -Name workproof-desktop,workproof-engine -ErrorAction SilentlyContinue)){
        $binary=$null;try{$binary=$process.Path}catch{}
        if($binary -and [string]::Equals([IO.Path]::GetDirectoryName($binary),$destination,[StringComparison]::OrdinalIgnoreCase)){
            throw '此版本的安装目录正在使用中。请使用已安装的加载项；如需修复，请退出该目录的 WorkProof 后重试。'
        }
    }
    $script=if($HostName -eq 'Word'){'install-native-word.ps1'}else{'install-native-powerpoint.ps1'}
    $parameters=@{RuntimeRoot=$PSScriptRoot;InstallDir=$destination}
    if($HostName -eq 'Word'){$parameters.WordPath=$office}else{$parameters.PowerPointPath=$office}
    & (Join-Path $PSScriptRoot $script) @parameters | Out-Null
    $registration=Get-WorkProofNativeRegistration $HostName $view ''
    if(-not $registration -or -not [string]::Equals([IO.Path]::GetDirectoryName($registration.Dll),$destination,[StringComparison]::OrdinalIgnoreCase)){
        throw '安装后未能确认加载项位置，请重新检查安装状态。'
    }
    @{installed=$true;host=$HostName;available=$true;restart_required=$true} | ConvertTo-Json -Compress
} catch {
    @{error=$_.Exception.Message} | ConvertTo-Json -Compress
    exit 1
}
