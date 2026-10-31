Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:WorkProofWordId = '9ebd5d58-80c3-4868-8dd5-c3f3c53d7942'
$script:WordDeveloperKey = 'Software\Microsoft\Office\16.0\Wef\Developer'

function Assert-WordManifest([string]$Xml) {
    if ([System.Text.Encoding]::UTF8.GetByteCount($Xml) -gt 65536) { throw 'Manifest exceeds local installation size limit' }
    $settings = [System.Xml.XmlReaderSettings]::new()
    $settings.DtdProcessing = [System.Xml.DtdProcessing]::Prohibit
    $settings.XmlResolver = $null
    $reader = [System.Xml.XmlReader]::Create([System.IO.StringReader]::new($Xml),$settings)
    try {
        $document = [System.Xml.XmlDocument]::new()
        $document.XmlResolver = $null
        $document.Load($reader)
    } finally { $reader.Dispose() }
    $ns = [System.Xml.XmlNamespaceManager]::new($document.NameTable)
    $ns.AddNamespace('o','http://schemas.microsoft.com/office/appforoffice/1.1')
    $app = $document.SelectSingleNode('/o:OfficeApp',$ns)
    $ids = $document.SelectNodes('/o:OfficeApp/o:Id',$ns)
    $locations = $document.SelectNodes('/o:OfficeApp/o:DefaultSettings/o:SourceLocation',$ns)
    $hosts = $document.SelectNodes('/o:OfficeApp/o:Hosts/o:Host',$ns)
    $permissions = $document.SelectNodes('/o:OfficeApp/o:Permissions',$ns)
    if (-not $app -or $app.GetAttribute('type','http://www.w3.org/2001/XMLSchema-instance') -ne 'TaskPaneApp' -or $ids.Count -ne 1 -or $ids[0].InnerText -ne $script:WorkProofWordId -or $locations.Count -ne 1 -or $locations[0].GetAttribute('DefaultValue') -ne 'https://localhost:18443/office/index.html' -or $hosts.Count -ne 1 -or $hosts[0].GetAttribute('Name') -ne 'Document' -or $permissions.Count -ne 1 -or $permissions[0].InnerText -ne 'ReadWriteDocument') {
        throw 'Expected the WorkProof localhost Word task-pane manifest'
    }
}

function Set-WordRegistration([string]$ManifestPath, [string]$RegistrySubKey = $script:WordDeveloperKey, [switch]$Remove) {
    $expected = [System.IO.Path]::GetFullPath($ManifestPath)
    $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser,[Microsoft.Win32.RegistryView]::Default)
    try {
        $key = if ($Remove) { $base.OpenSubKey($RegistrySubKey,$true) } else { $base.CreateSubKey($RegistrySubKey,$true) }
        if (-not $key) { return }
        try {
            $current = $key.GetValue($script:WorkProofWordId,$null)
            if ($null -ne $current -and -not [string]::Equals([string]$current,$expected,[StringComparison]::OrdinalIgnoreCase)) {
                throw 'The WorkProof add-in ID already points to another installation. It was not overwritten or removed.'
            }
            if ($Remove) { $key.DeleteValue($script:WorkProofWordId,$false) }
            else { $key.SetValue($script:WorkProofWordId,$expected,[Microsoft.Win32.RegistryValueKind]::String) }
        } finally { $key.Dispose() }
    } finally { $base.Dispose() }
}
