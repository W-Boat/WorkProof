#Requires -Version 5.1
<#
.SYNOPSIS
    Registers the WorkProof Word add-in for the current user (no administrator rights).
.DESCRIPTION
    Accepts either the native add-in (WorkProofWord.dll, no runtime dependency) or the older
    managed one (WorkProof.WordNative.dll). Copies the payload to a stable per-user directory,
    clears the Mark-of-the-Web from the copied files, and writes only WorkProof's own HKCU COM
    and Word Add-ins entries. -Remove deletes exactly those entries again.
#>
[CmdletBinding()]
param(
    [string]$RuntimeRoot,
    [string]$InstallDir,
    [string]$WordPath,
    [switch]$Remove,
    [switch]$RemoveFiles,
    [switch]$NoCopy,
    # Isolated Actions registry fixture; never usable for a real installation.
    [string]$RegistryFixture,
    [ValidateSet('x86','x64')][string]$RegistryFixtureArchitecture = 'x64',
    [switch]$RegistryFixtureCopy
)
$ErrorActionPreference = 'Stop'

$ProgId = 'WorkProof.WordNative.Connect'
$Clsid = '{5F628C20-62BB-4DA6-94DF-36BD599A9301}'
$TaskPaneProgId = 'WorkProof.WordNative.TaskPane'
$TaskPaneClsid = '{41D77603-57A1-43C8-839E-BB5375A9D843}'
$Marker = '.workproof-native'
$AddInNames = @('WorkProofWord.x86.dll', 'WorkProofWord.dll', 'WorkProof.WordNative.dll')
$OptionalFiles = @('native-office-platform.ps1', 'workproof-desktop.exe', 'workproof.vsix', 'LICENSE', 'BUILD-INFO.json', 'README-WORD.md', 'install-native-word.ps1', 'Install Word.cmd', 'Open WorkProof.cmd', 'Remove Word add-in.cmd', 'open-native-word.ps1')
$OptionalFiles += @('desktop-office-setup.ps1','WorkProofPowerPoint.dll','WorkProofPowerPoint.x86.dll','install-native-powerpoint.ps1','open-native-powerpoint.ps1','Install PowerPoint.cmd','Open PowerPoint WorkProof.cmd','Remove PowerPoint add-in.cmd')

function Get-PeArchitecture([string]$Path) {
    $stream = [IO.File]::OpenRead($Path)
    try {
        $reader = New-Object IO.BinaryReader($stream)
        if ($reader.ReadUInt16() -ne 0x5A4D) { throw 'Word 可执行文件缺少 DOS 签名。' }
        $stream.Position = 0x3C
        $offset = $reader.ReadInt32()
        if ($offset -lt 64 -or $offset + 6 -gt $stream.Length) { throw 'Word 可执行文件的 PE 头无效。' }
        $stream.Position = $offset
        if ($reader.ReadUInt32() -ne 0x4550) { throw 'Word 可执行文件的 PE 签名无效。' }
        switch ($reader.ReadUInt16()) {
            0x14C { return [Microsoft.Win32.RegistryView]::Registry32 }
            0x8664 { return [Microsoft.Win32.RegistryView]::Registry64 }
            default { throw '本加载项只支持 x86 或 x64 的 Word。' }
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

function Find-Word {
    $candidates = @()
    foreach ($hive in @([Microsoft.Win32.RegistryHive]::LocalMachine, [Microsoft.Win32.RegistryHive]::CurrentUser)) {
        foreach ($registryView in @([Microsoft.Win32.RegistryView]::Registry64, [Microsoft.Win32.RegistryView]::Registry32)) {
            $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey($hive, $registryView)
            try {
                $key = $base.OpenSubKey('Software\Microsoft\Windows\CurrentVersion\App Paths\WINWORD.EXE')
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
if ($PSBoundParameters.ContainsKey('RegistryFixtureArchitecture') -and -not $RegistryFixture) { throw '隔离测试的位数参数不能用于真实安装。' }
if ($RegistryFixtureCopy -and -not $RegistryFixture) { throw '复制测试只能用于隔离的 Actions 验证。' }
$source = [IO.Path]::GetFullPath($RuntimeRoot)
$addInName = $null
foreach ($name in $AddInNames) {
    if (Test-Path -LiteralPath (Join-Path $source $name) -PathType Leaf) { $addInName = $name; break }
}
if (-not $Remove) {
    if (-not $addInName) { throw '工作包缺少 WorkProofWord.dll（或旧的 WorkProof.WordNative.dll），请重新解压完整压缩包。' }
    if (-not (Test-Path -LiteralPath (Join-Path $source 'workproof-engine.exe') -PathType Leaf)) {
        throw '工作包缺少 workproof-engine.exe；没有记录引擎无法导出证书。'
    }
}

if ($RegistryFixture) {
    if ($env:GITHUB_ACTIONS -ne 'true' -or $RegistryFixture -notmatch '^Software\\WorkProofNativeWordCI\\[A-Za-z0-9-]+$') {
        throw 'Registry fixture 只用于隔离的 Actions 验证，不能用于真实安装。'
    }
    $prefix = $RegistryFixture + '\'
    $view = if ($RegistryFixtureArchitecture -eq 'x86') { [Microsoft.Win32.RegistryView]::Registry32 } else { [Microsoft.Win32.RegistryView]::Registry64 }
    if ($WordPath -and (Get-PeArchitecture ([IO.Path]::GetFullPath($WordPath))) -ne $view) { throw '隔离宿主 PE 的位数与测试指定视图不一致。' }
    if ($RegistryFixtureCopy) {
        if (-not $env:RUNNER_TEMP -or -not $InstallDir -or $NoCopy) { throw '复制测试需要独立的 Actions 临时安装目录。' }
        $fixtureTemp = [IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd('\') + '\'
        $installDir = [IO.Path]::GetFullPath($InstallDir)
        if (-not $installDir.StartsWith($fixtureTemp,[StringComparison]::OrdinalIgnoreCase) -or
            [IO.Path]::GetFileName($installDir) -notmatch '^workproof-office-copy-[a-f0-9]{32}$' -or
            $installDir.TrimEnd('\') -ieq $source.TrimEnd('\')) { throw '复制测试目录必须是独立的 Actions 临时目录。' }
    } else {
        $NoCopy = $true
        $installDir = $source
    }
} else {
    $prefix = ''
    if (-not $NoCopy) {
        if (-not $InstallDir) { $InstallDir = Join-Path $env:LOCALAPPDATA 'WorkProof\word-native' }
        $installDir = [IO.Path]::GetFullPath($InstallDir)
        if (-not $installDir) { throw '无法确定安装目录。' }
    } else {
        $installDir = $source
    }
    if (-not $WordPath) { $WordPath = Find-Word }
    if ($WordPath -and (Test-Path -LiteralPath $WordPath -PathType Leaf)) {
        $view = Get-PeArchitecture ([IO.Path]::GetFullPath($WordPath))
    } else {
        $view = [Microsoft.Win32.RegistryView]::Registry64
        Write-Warning '没有找到 Word，仍按 64 位注册。安装后请确认 Word 能加载此加载项。'
    }
}

# Select and validate before copying payload or writing registration.
if (-not $Remove) {
    $addInName = $null
    foreach ($name in $AddInNames) {
        $candidate = Join-Path $source $name
        if ((Test-Path -LiteralPath $candidate -PathType Leaf) -and (Get-AddInArchitecture $candidate) -eq $view) { $addInName = $name; break }
    }
    if (-not $addInName) {
        $bits = if ($view -eq [Microsoft.Win32.RegistryView]::Registry32) { '32' } else { '64' }
        throw ('工作包缺少与当前 Word 位数匹配的加载项（' + $bits + ' 位）。请重新下载包含该位数 DLL 的完整工作包。')
    }
}

$registry = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, $view)
$classKey = $prefix + 'Software\Classes\CLSID\' + $Clsid
$progKey = $prefix + 'Software\Classes\' + $ProgId
$addinKey = $prefix + 'Software\Microsoft\Office\Word\Addins\' + $ProgId
$taskPaneClassKey = $prefix + 'Software\Classes\CLSID\' + $TaskPaneClsid
$taskPaneProgKey = $prefix + 'Software\Classes\' + $TaskPaneProgId
$shortcutPath = Join-Path ([Environment]::GetFolderPath('Programs')) 'WorkProof.lnk'

try {
    if ($Remove) {
        # Only WorkProof's own identifiers; files, documents and other add-ins are untouched here.
        $removeViews = if ($RegistryFixture) { @($view) } else { @([Microsoft.Win32.RegistryView]::Registry32,[Microsoft.Win32.RegistryView]::Registry64) }
        foreach ($removeView in $removeViews) {
            $removeRegistry = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser,$removeView)
            try {
                foreach ($key in @($addinKey,$progKey,$classKey,$taskPaneProgKey,$taskPaneClassKey)) { $removeRegistry.DeleteSubKeyTree($key,$false) }
            } finally { $removeRegistry.Dispose() }
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
        Write-Output ('已移除当前用户的 WorkProof Word 加载项注册（' + $view + '）。' + $(if ($removedFiles) { '安装目录也已删除。' } else { '文件与文档均已保留。' }))
        return
    }

    # ------------------------------------------------------------- copy payload
    $copied = $false
    if (-not $NoCopy) {
        if ($installDir.TrimEnd('\') -ieq $source.TrimEnd('\')) {
            Write-Output '已在安装目录内运行，跳过复制。'
        } else {
            # Check every add-in we are about to copy before stopping the engine or changing files.
            # Open does not truncate or write; Office-loaded images normally deny this write access.
            foreach ($name in $AddInNames) {
                $from=Join-Path $source $name
                $existing=Join-Path $installDir $name
                if ((Test-Path -LiteralPath $from -PathType Leaf) -and (Test-Path -LiteralPath $existing -PathType Leaf)) {
                    try {
                        $probe=[IO.File]::Open($existing,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
                        $probe.Dispose()
                    } catch {
                        throw ('暂时无法更新加载项 '+$name+'。请先保存并退出 Word，再重新安装；若仍失败，请检查安装目录的写入权限。')
                    }
                }
            }
            # Only our own binaries from a previous install are stopped; Word and other apps are untouched.
            if (-not $RegistryFixture) {
                foreach ($name in @('workproof-desktop.exe', 'workproof-engine.exe')) {
                    Get-Process -Name ([IO.Path]::GetFileNameWithoutExtension($name)) -ErrorAction SilentlyContinue | ForEach-Object {
                        $path = $null
                        try { $path = $_.Path } catch { }
                        $installedBinary = [IO.Path]::GetFullPath((Join-Path $installDir $name))
                        if ($path -and [string]::Equals([IO.Path]::GetFullPath($path), $installedBinary, [StringComparison]::OrdinalIgnoreCase)) {
                            try {
                                $_.Kill()
                                $null = $_.WaitForExit(5000)
                                Write-Output ('已停止旧版 ' + $name + '（PID ' + $_.Id + '），安装后请重新打开 WorkProof 桌面程序。')
                            } catch { }
                        }
                    }
                }
                Start-Sleep -Milliseconds 400
            }
            New-Item -ItemType Directory -Force -Path $installDir | Out-Null
            foreach ($name in ($AddInNames + @('workproof-engine.exe') + $OptionalFiles)) {
                $from = Join-Path $source $name
                if (Test-Path -LiteralPath $from -PathType Leaf) {
                    Copy-Item -LiteralPath $from -Destination (Join-Path $installDir $name) -Force
                }
            }
            foreach ($name in @('verifier', 'docs', 'third-party-notices', 'c2pa')) {
                $from = Join-Path $source $name
                if (Test-Path -LiteralPath $from -PathType Container) {
                    Copy-Item -LiteralPath $from -Destination $installDir -Recurse -Force
                }
            }
            Set-Content -LiteralPath (Join-Path $installDir $Marker) -Value ('WorkProof Word add-in ' + (Get-Date).ToUniversalTime().ToString('o')) -Encoding ASCII
            # Files carrying the zone identifier are blocked from loading by Windows code integrity.
            Get-ChildItem -LiteralPath $installDir -Recurse -File | Unblock-File -ErrorAction SilentlyContinue
            $copied = $true
        }
    }

    $dll = Join-Path $installDir $addInName
    if (-not $dll) { throw '安装目录中缺少加载项 DLL。' }
    $engine = Join-Path $installDir 'workproof-engine.exe'
    if (-not (Test-Path -LiteralPath $engine -PathType Leaf)) { throw '安装目录中缺少 workproof-engine.exe。' }
    $addInView = Get-AddInArchitecture $dll
    if ($addInView -ne $view) {
        throw ('加载项 DLL 的架构（' + $addInView + '）与 Word（' + $view + '）不一致，请使用对应版本的工作包。')
    }

    # Native first: it has no runtime dependency at all. The managed build is still accepted.
    $managed = Test-ManagedAssembly $dll
    Set-Values $registry $classKey @{ '' = $ProgId }
    if ($managed) {
        $assembly = [Reflection.AssemblyName]::GetAssemblyName($dll)
        if ($assembly.Name -ne 'WorkProof.WordNative') { throw 'DLL 程序集标识不是 WorkProof.WordNative。' }
        $version = $assembly.Version.ToString()
        $codeBase = (New-Object Uri($dll)).AbsoluteUri
        $server = @{ 'Class' = $ProgId; 'Assembly' = $assembly.FullName; 'RuntimeVersion' = 'v4.0.30319'; 'CodeBase' = $codeBase }
        # Apartment keeps Office on the caller's STA; Both was observed to crash the CLR inside Word 2021.
        Set-Values $registry ($classKey + '\InprocServer32') (@{ '' = 'mscoree.dll'; 'ThreadingModel' = 'Apartment' } + $server)
        Set-Values $registry ($classKey + '\InprocServer32\' + $version) $server
    } else {
        $codeBase = $dll
        Set-Values $registry ($classKey + '\InprocServer32') @{ '' = $dll; 'ThreadingModel' = 'Apartment' }
    }
    # Only the native DLL implements the Office-hosted ActiveX task pane.
    if (-not $managed) {
        Set-Values $registry $taskPaneClassKey @{ '' = 'WorkProof Word task pane' }
        Set-Values $registry ($taskPaneClassKey + '\InprocServer32') @{ '' = $dll; 'ThreadingModel' = 'Apartment' }
        Set-Values $registry ($taskPaneClassKey + '\ProgId') @{ '' = $TaskPaneProgId }
        Set-Values $registry ($taskPaneClassKey + '\Control') @{}
        Set-Values $registry $taskPaneProgKey @{ '' = 'WorkProof Word task pane' }
        Set-Values $registry ($taskPaneProgKey + '\CLSID') @{ '' = $TaskPaneClsid }
    } else {
        # Avoid retaining a native control registration after switching to a managed package.
        foreach ($key in @($taskPaneProgKey, $taskPaneClassKey)) { $registry.DeleteSubKeyTree($key, $false) }
    }
    Set-Values $registry ($classKey + '\ProgId') @{ '' = $ProgId }
    Set-Values $registry $progKey @{ '' = 'WorkProof Word add-in' }
    Set-Values $registry ($progKey + '\CLSID') @{ '' = $Clsid }
    Set-Values $registry $addinKey @{ 'FriendlyName' = 'WorkProof 开源证人'; 'Description' = '在 Word 内记录创作过程，导出作品与 .wproof 证书'; 'CommandLineSafe' = '0' }
    $entry = $registry.CreateSubKey($addinKey)
    try { $entry.SetValue('LoadBehavior', 3, [Microsoft.Win32.RegistryValueKind]::DWord) } finally { $entry.Dispose() }

    # ---------------------------------------------------------------- verify
    $checkAddin = $registry.OpenSubKey($addinKey)
    if (-not $checkAddin) { throw '注册写入失败：Word Addins 项不存在。' }
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
        ('已为当前用户注册 WorkProof Word 加载项（' + $view + '，' + $kind + '）。'),
        ('安装目录：' + $installDir),
        ('加载项：' + $dll),
        '下一步：',
        '1. 打开 WorkProof 桌面程序（开始菜单里的 WorkProof，或安装目录里的 workproof-desktop.exe）。',
        '2. 保存 Word 文档后重新打开 Word；功能区会多出“WorkProof”选项卡。',
        '3. 点“打开创作记录”，在桌面端允许来源 word 的连接。',
        '卸载：再次运行本脚本并加 -Remove（需要连文件一起删除时再加 -RemoveFiles）。'
    )
    if ($copied) { $lines += '提示：安装目录仅用于本用户，移动或删除其中的 DLL 会让加载项失效。' }
    if (-not $RegistryFixture -and (Get-Process WINWORD -ErrorAction SilentlyContinue)) {
        $lines += 'Word 正在运行：请先保存文档，再关闭并重新打开 Word 以加载新加载项。本脚本没有关闭你的文档。'
    }
    $lines | ForEach-Object { Write-Output $_ }
} finally {
    $registry.Dispose()
}
