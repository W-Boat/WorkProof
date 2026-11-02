#Requires -Version 5.1
# Read-only platform discovery shared by the native Office launch entries.
function Get-WorkProofOfficeView([string]$Path) {
    $stream = [IO.File]::OpenRead($Path)
    try {
        $reader = New-Object IO.BinaryReader($stream)
        if ($reader.ReadUInt16() -ne 0x5A4D) { throw 'Office 文件缺少有效的程序头。' }
        $stream.Position = 0x3C
        $offset = $reader.ReadInt32()
        if ($offset -lt 64 -or $offset + 6 -gt $stream.Length) { throw 'Office 文件的程序头无效。' }
        $stream.Position = $offset
        if ($reader.ReadUInt32() -ne 0x4550) { throw 'Office 文件的程序签名无效。' }
        switch ($reader.ReadUInt16()) {
            0x14C { return [Microsoft.Win32.RegistryView]::Registry32 }
            0x8664 { return [Microsoft.Win32.RegistryView]::Registry64 }
            default { throw '目前支持 32 位或 64 位 Office。' }
        }
    } finally { $stream.Dispose() }
}
function Find-WorkProofOffice([ValidateSet('Word','PowerPoint')][string]$HostName) {
    $exe = if ($HostName -eq 'Word') { 'WINWORD.EXE' } else { 'POWERPNT.EXE' }
    foreach ($hive in @([Microsoft.Win32.RegistryHive]::LocalMachine,[Microsoft.Win32.RegistryHive]::CurrentUser)) {
        foreach ($view in @([Microsoft.Win32.RegistryView]::Registry64,[Microsoft.Win32.RegistryView]::Registry32)) {
            $base=[Microsoft.Win32.RegistryKey]::OpenBaseKey($hive,$view)
            try {
                $key=$base.OpenSubKey('Software\Microsoft\Windows\CurrentVersion\App Paths\'+$exe)
                if ($key) {
                    try { $candidate=[string]$key.GetValue('') } finally { $key.Dispose() }
                    if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) { return [IO.Path]::GetFullPath($candidate) }
                }
            } finally { $base.Dispose() }
        }
    }
    return $null
}
function Get-WorkProofNativeRegistration([ValidateSet('Word','PowerPoint')][string]$HostName,[Microsoft.Win32.RegistryView]$View,[string]$Prefix) {
    $clsid=if ($HostName -eq 'Word') {'{5F628C20-62BB-4DA6-94DF-36BD599A9301}'} else {'{6EC055C4-2EB0-49EB-80C9-30C6DA38EB86}'}
    $base=[Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser,$View)
    try {
        $key=$base.OpenSubKey($Prefix+'Software\Classes\CLSID\'+$clsid+'\InprocServer32')
        if (-not $key) { return $null }
        try { $dll=[string]$key.GetValue('') } finally { $key.Dispose() }
    } finally { $base.Dispose() }
    try {
        $allowedNames=@(('WorkProof'+$HostName+'.dll'),('WorkProof'+$HostName+'.x86.dll'))
        if (-not [IO.Path]::IsPathRooted($dll) -or [IO.Path]::GetFileName($dll) -notin $allowedNames -or -not (Test-Path -LiteralPath $dll -PathType Leaf)) { return $null }
        if ((Get-WorkProofOfficeView $dll) -ne $View) { return $null }
    } catch { return $null }
    return [pscustomobject]@{Dll=$dll;View=$View}
}
