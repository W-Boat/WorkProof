#Requires -Version 5.1
<#
.SYNOPSIS
    Registers the WorkProof PowerPoint add-in for the current user (no administrator rights).
.DESCRIPTION
    Accepts the native add-in (WorkProofPowerPoint.dll, no runtime dependency). Copies the payload to a stable per-user directory,
    clears the Mark-of-the-Web from the copied files, and writes only WorkProof's own HKCU COM
    and PowerPoint Add-ins entries. -Remove deletes exactly those entries again.
#>
[CmdletBinding()]
param(
    [string]$RuntimeRoot,
    [string]$InstallDir,
    [string]$PowerPointPath,
    [switch]$Remove,
    [switch]$RemoveFiles,
    [switch]$NoCopy,
    # Isolated Actions registry fixture; never usable for a real installation.
    [string]$RegistryFixture
)
$ErrorActionPreference = 'Stop'

$ProgId = 'WorkProof.PowerPointNative.Connect'
$Clsid = '{6EC055C4-2EB0-49EB-80C9-30C6DA38EB86}'
$TaskPaneProgId = 'WorkProof.PowerPointNative.TaskPane'
$TaskPaneClsid = '{6EC055C4-2EB0-49EB-80C9-30C6DA38EB87}'
$Marker = '.workproof-native'
$AddInNames = @('WorkProofPowerPoint.dll')
$OptionalFiles = @('workproof-desktop.exe', 'workproof.vsix', 'LICENSE', 'BUILD-INFO.json', 'README-WORD.md', 'Install PowerPoint.cmd', 'Open PowerPoint WorkProof.cmd', 'Remove PowerPoint add-in.cmd', 'open-native-powerpoint.ps1', 'install-native-powerpoint.ps1')

function Get-PeArchitecture([string]$Path) {
    $stream = [IO.File]::OpenRead($Path)
    try {
        $reader = New-Object IO.BinaryReader($stream)
        if ($reader.ReadUInt16() -ne 0x5A4D) { throw 'PowerPoint 可执行文件缺少 DOS 签名。' }
        $stream.Position = 0x3C
        $offset = $reader.ReadInt32()
        if ($offset -lt 64 -or $offset + 6 -gt $stream.Length) { throw 'PowerPoint 可执行文件的 PE 头无效。' }
        $stream.Position = $offset
        if ($reader.ReadUInt32() -ne 0x4550) { throw 'PowerPoint 可执行文件的 PE 签名无效。' }
        switch ($reader.ReadUInt16()) {
            0x14C { return [Microsoft.Win32.RegistryView]::Registry32 }
            0x8664 { return [Microsoft.Win32.RegistryView]::Registry64 }
            default { throw '本加载项只支持 x86 或 x64 的 PowerPoint。' }
        }
    } finally { $stream.Dispose() }
}

function Get-AddInArchitecture([string]$Path) {
    $stream = [IO.File]::OpenRead($Path)
    try {
        $reader = New-Object IO.BinaryReader($stream)
        if ($reader.ReadUInt16() -ne 0x5A4D) { throw '加载项 DLL 缺少 DOS 签名。' }
        $stream.Position = 0x3C
        $offset = $reader.ReadInt32()
        $stream.Position = $offset
        if ($reader.ReadUInt32() -ne 0x4550) { throw '加载项 DLL 的 PE 签名无效。' }
        switch ($reader.ReadUInt16()) {
            0x14C { return [Microsoft.Win32.RegistryView]::Registry32 }
            0x8664 { return [Microsoft.Win32.RegistryView]::Registry64 }
            default { throw '加载项 DLL 的架构无法识别。' }
        }
    } finally { $stream.Dispose() }
}

function Test-ManagedAssembly([string]$Path) {
    try {
        $null = [Reflection.AssemblyName]::GetAssemblyName($Path)
        return $true
    } catch {
        return $false
    }
}

function Find-PowerPoint {
    $candidates = @()
    foreach ($hive in @([Microsoft.Win32.RegistryHive]::LocalMachine, [Microsoft.Win32.RegistryHive]::CurrentUser)) {
        foreach ($registryView in @([Microsoft.Win32.RegistryView]::Registry64, [Microsoft.Win32.RegistryView]::Registry32)) {
            $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey($hive, $registryView)
            try {
                $key = $base.OpenSubKey('Software\Microsoft\Windows\CurrentVersion\App Paths\POWERPNT.EXE')
                if ($key) { try { $candidates += [string]$key.GetValue('') } finally { $key.Dispose() } }
            } finally { $base.Dispose() }
        }
    }
    return $candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -First 1
}

function Set-Values([Microsoft.Win32.RegistryKey]$Registry, [string]$Path, [hashtable]$Values) {
    $key = $Registry.CreateSubKey($Path)
    try {
        foreach ($name in $Values.Keys) {
            $key.SetValue($name, [string]$Values[$name], [Microsoft.Win32.RegistryValueKind]::String)
        }
    } finally { $key.Dispose() }
}

# ---------------------------------------------------------------- source and mode
if (-not $RuntimeRoot) {
    if ($PSScriptRoot -and (Test-Path -LiteralPath $PSScriptRoot -PathType Container)) {
        $RuntimeRoot = $PSScriptRoot
    } else {
        throw '请把 -RuntimeRoot 指向解压后的工作包目录。'
    }
}
$source = [IO.Path]::GetFullPath($RuntimeRoot)
$addInName = $null
foreach ($name in $AddInNames) {
    if (Test-Path -LiteralPath (Join-Path $source $name) -PathType Leaf) { $addInName = $name; break }
}
if (-not $Remove) {
    if (-not $addInName) { throw '工作包缺少 WorkProofPowerPoint.dll（或旧的 WorkProof.PowerPointNative.dll），请重新解压完整压缩包。' }
    if (-not (Test-Path -LiteralPath (Join-Path $source 'workproof-engine.exe') -PathType Leaf)) {
        throw '工作包缺少 workproof-engine.exe；没有记录引擎无法导出证书。'
    }
}

if ($RegistryFixture) {
    if ($env:GITHUB_ACTIONS -ne 'true' -or $RegistryFixture -notmatch '^Software\\WorkProofNativePowerPointCI\\[A-Za-z0-9-]+$') {
        throw 'Registry fixture 只用于隔离的 Actions 验证，不能用于真实安装。'
    }
    $prefix = $RegistryFixture + '\'
    $view = [Microsoft.Win32.RegistryView]::Registry64
    $NoCopy = $true
    $installDir = $source
} else {
    $prefix = ''
    if (-not $NoCopy) {
        if (-not $InstallDir) { $InstallDir = Join-Path $env:LOCALAPPDATA 'WorkProof\powerpoint-native' }
        $installDir = [IO.Path]::GetFullPath($InstallDir)
        if (-not $installDir) { throw '无法确定安装目录。' }
    } else {
        $installDir = $source
    }
    if (-not $PowerPointPath) { $PowerPointPath = Find-PowerPoint }
    if ($PowerPointPath -and (Test-Path -LiteralPath $PowerPointPath -PathType Leaf)) {
        $view = Get-PeArchitecture ([IO.Path]::GetFullPath($PowerPointPath))
    } else {
        $view = [Microsoft.Win32.RegistryView]::Registry64
        Write-Warning '没有找到 PowerPoint，仍按 64 位注册。安装后请确认 PowerPoint 能加载此加载项。'
    }
}

$registry = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, $view)
$classKey = $prefix + 'Software\Classes\CLSID\' + $Clsid
$progKey = $prefix + 'Software\Classes\' + $ProgId
$addinKey = $prefix + 'Software\Microsoft\Office\PowerPoint\Addins\' + $ProgId
$taskPaneClassKey = $prefix + 'Software\Classes\CLSID\' + $TaskPaneClsid
$taskPaneProgKey = $prefix + 'Software\Classes\' + $TaskPaneProgId
$shortcutPath = Join-Path ([Environment]::GetFolderPath('Programs')) 'WorkProof PowerPoint.lnk'

try {
    if ($Remove) {
        # Only WorkProof's own identifiers; files, documents and other add-ins are untouched here.
        foreach ($key in @($addinKey, $progKey, $classKey, $taskPaneProgKey, $taskPaneClassKey)) {
            $registry.DeleteSubKeyTree($key, $false)
        }
        if (-not $RegistryFixture -and (Test-Path -LiteralPath $shortcutPath -PathType Leaf)) {
            Remove-Item -LiteralPath $shortcutPath -Force
        }
        $removedFiles = $false
        if ($RemoveFiles -and -not $RegistryFixture) {
            $localAppData = [IO.Path]::GetFullPath($env:LOCALAPPDATA).TrimEnd('\') + '\'
            if ($installDir.StartsWith($localAppData, [StringComparison]::OrdinalIgnoreCase) -and
                (Test-Path -LiteralPath (Join-Path $installDir $Marker) -PathType Leaf)) {
                Remove-Item -LiteralPath $installDir -Recurse -Force
                $removedFiles = $true
            } else {
                Write-Warning '安装目录不是本脚本创建的目录，已保留文件。可手动删除。'
            }
        }
        Write-Output ('已移除当前用户的 WorkProof PowerPoint 加载项注册（' + $view + '）。' + $(if ($removedFiles) { '安装目录也已删除。' } else { '文件与文档均已保留。' }))
        return
    }

    # ------------------------------------------------------------- copy payload
    $copied = $false
    if (-not $NoCopy -and -not $RegistryFixture) {
        if ($installDir.TrimEnd('\') -ieq $source.TrimEnd('\')) {
            Write-Output '已在安装目录内运行，跳过复制。'
        } else {
            # Only our own binaries from a previous install are stopped; PowerPoint and other apps are untouched.
            foreach ($name in @('workproof-desktop.exe', 'workproof-engine.exe')) {
                Get-Process -Name ([IO.Path]::GetFileNameWithoutExtension($name)) -ErrorAction SilentlyContinue | ForEach-Object {
                    $path = $null
                    try { $path = $_.Path } catch { }
                    if ($path -and $path.StartsWith($installDir, [StringComparison]::OrdinalIgnoreCase)) {
                        try {
                            $_.Kill()
                            $null = $_.WaitForExit(5000)
                            Write-Output ('已停止旧版 ' + $name + '（PID ' + $_.Id + '），安装后请重新打开 WorkProof 桌面程序。')
                        } catch { }
                    }
                }
            }
            Start-Sleep -Milliseconds 400
            New-Item -ItemType Directory -Force -Path $installDir | Out-Null
            foreach ($name in ($AddInNames + @('workproof-engine.exe') + $OptionalFiles)) {
                $from = Join-Path $source $name
                if (Test-Path -LiteralPath $from -PathType Leaf) {
                    Copy-Item -LiteralPath $from -Destination (Join-Path $installDir $name) -Force
                }
            }
            foreach ($name in @('verifier', 'docs', 'third-party-notices')) {
                $from = Join-Path $source $name
                if (Test-Path -LiteralPath $from -PathType Container) {
                    Copy-Item -LiteralPath $from -Destination $installDir -Recurse -Force
                }
            }
            Set-Content -LiteralPath (Join-Path $installDir $Marker) -Value ('WorkProof PowerPoint add-in ' + (Get-Date).ToUniversalTime().ToString('o')) -Encoding ASCII
            # Files carrying the zone identifier are blocked from loading by Windows code integrity.
            Get-ChildItem -LiteralPath $installDir -Recurse -File | Unblock-File -ErrorAction SilentlyContinue
            $copied = $true
        }
    }

    $dll = $null
    foreach ($name in $AddInNames) {
        $candidate = Join-Path $installDir $name
        if (Test-Path -LiteralPath $candidate -PathType Leaf) { $dll = $candidate; break }
    }
    if (-not $dll) { throw '安装目录中缺少加载项 DLL。' }
    $engine = Join-Path $installDir 'workproof-engine.exe'
    if (-not (Test-Path -LiteralPath $engine -PathType Leaf)) { throw '安装目录中缺少 workproof-engine.exe。' }
    $addInView = Get-AddInArchitecture $dll
    if ($addInView -ne $view) {
        throw ('加载项 DLL 的架构（' + $addInView + '）与 PowerPoint（' + $view + '）不一致，请使用对应版本的工作包。')
    }

    # Native first: it has no runtime dependency at all. The managed build is still accepted.
    $managed = Test-ManagedAssembly $dll
    if ($managed) { throw 'PowerPoint requires the native WorkProofPowerPoint.dll package.' }
    Set-Values $registry $classKey @{ '' = $ProgId }
    $codeBase = $dll
    Set-Values $registry ($classKey + '\InprocServer32') @{ '' = $dll; 'ThreadingModel' = 'Apartment' }
    Set-Values $registry $taskPaneClassKey @{ '' = 'WorkProof PowerPoint task pane' }
    Set-Values $registry ($taskPaneClassKey + '\InprocServer32') @{ '' = $dll; 'ThreadingModel' = 'Apartment' }
    Set-Values $registry ($taskPaneClassKey + '\ProgId') @{ '' = $TaskPaneProgId }
    Set-Values $registry ($taskPaneClassKey + '\Control') @{}
    Set-Values $registry $taskPaneProgKey @{ '' = 'WorkProof PowerPoint task pane' }
    Set-Values $registry ($taskPaneProgKey + '\CLSID') @{ '' = $TaskPaneClsid }
    Set-Values $registry ($classKey + '\ProgId') @{ '' = $ProgId }
    Set-Values $registry $progKey @{ '' = 'WorkProof PowerPoint add-in' }
    Set-Values $registry ($progKey + '\CLSID') @{ '' = $Clsid }
    Set-Values $registry $addinKey @{ 'FriendlyName' = 'WorkProof 开源证人'; 'Description' = '在 PowerPoint 内记录创作过程，导出作品与 .wproof 证书'; 'CommandLineSafe' = '0' }
    $entry = $registry.CreateSubKey($addinKey)
    try { $entry.SetValue('LoadBehavior', 3, [Microsoft.Win32.RegistryValueKind]::DWord) } finally { $entry.Dispose() }

    # ---------------------------------------------------------------- verify
    $checkAddin = $registry.OpenSubKey($addinKey)
    if (-not $checkAddin) { throw '注册写入失败：PowerPoint Addins 项不存在。' }
    try { if ($checkAddin.GetValue('LoadBehavior') -ne 3) { throw '注册写入失败：LoadBehavior 不是 3。' } } finally { $checkAddin.Dispose() }
    $checkInproc = $registry.OpenSubKey($classKey + '\InprocServer32')
    if (-not $checkInproc) { throw '注册写入失败：InprocServer32 项不存在。' }
    try {
        $expectedServer = if ($managed) { 'mscoree.dll' } else { $dll }
        if ($checkInproc.GetValue('') -ne $expectedServer) { throw '注册写入失败：InprocServer32 指向不正确。' }
        if ($checkInproc.GetValue('ThreadingModel') -ne 'Apartment') { throw '注册写入失败：ThreadingModel 不是 Apartment。' }
        if ($managed -and $checkInproc.GetValue('CodeBase') -ne $codeBase) { throw '注册写入失败：CodeBase 与实际 DLL 路径不一致。' }
    } finally { $checkInproc.Dispose() }

    if (-not $managed) {
        $checkPane = $registry.OpenSubKey($taskPaneClassKey + '\InprocServer32')
        if (-not $checkPane) { throw 'Task pane registration is missing.' }
        try {
            if ($checkPane.GetValue('') -ne $dll -or $checkPane.GetValue('ThreadingModel') -ne 'Apartment') {
                throw 'Task pane registration does not match the installed native DLL.'
            }
        } finally { $checkPane.Dispose() }
    }

    # ------------------------------------------------------------- shortcut
    if (-not $RegistryFixture) {
        $desktop = Join-Path $installDir 'workproof-desktop.exe'
        if (Test-Path -LiteralPath $desktop -PathType Leaf) {
            try {
                $shell = New-Object -ComObject WScript.Shell
                $shortcut = $shell.CreateShortcut($shortcutPath)
                $shortcut.TargetPath = $desktop
                $shortcut.WorkingDirectory = $installDir
                $shortcut.IconLocation = $desktop + ',0'
                $shortcut.Description = 'WorkProof 开源证人'
                $shortcut.Save()
            } catch {
                Write-Warning '没能创建开始菜单快捷方式；可以手动运行安装目录里的 workproof-desktop.exe。'
            }
        }
    }

    $kind = if ($managed) { '托管（.NET Framework）' } else { '原生（无运行时依赖）' }
    $lines = @(
        ('已为当前用户注册 WorkProof PowerPoint 加载项（' + $view + '，' + $kind + '）。'),
        ('安装目录：' + $installDir),
        ('加载项：' + $dll),
        '下一步：',
        '1. 打开 WorkProof 桌面程序（开始菜单里的 WorkProof，或安装目录里的 workproof-desktop.exe）。',
        '2. 保存 PowerPoint 文档后重新打开 PowerPoint；功能区会多出“WorkProof”选项卡。',
        '3. 点“打开创作记录”，在桌面端允许来源 powerpoint 的连接。',
        '卸载：再次运行本脚本并加 -Remove（需要连文件一起删除时再加 -RemoveFiles）。'
    )
    if ($copied) { $lines += '提示：安装目录仅用于本用户，移动或删除其中的 DLL 会让加载项失效。' }
    if (-not $RegistryFixture -and (Get-Process POWERPNT -ErrorAction SilentlyContinue)) {
        $lines += 'PowerPoint 正在运行：请先保存文档，再关闭并重新打开 PowerPoint 以加载新加载项。本脚本没有关闭你的文档。'
    }
    $lines | ForEach-Object { Write-Output $_ }
} finally {
    $registry.Dispose()
}
