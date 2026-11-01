#Requires -Version 5.1
<#
.SYNOPSIS
    Fails unless the built Word add-in exposes the fixed COM identity, the ribbon markup,
    the embedded picture and the task pane type. No Office installation is required.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Assembly
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$path = (Resolve-Path -LiteralPath $Assembly).Path
$loaded = [Reflection.Assembly]::LoadFrom($path)
$version = $loaded.GetName().Version.ToString()
if ($loaded.GetName().Name -ne 'WorkProof.WordNative') { throw "Unexpected assembly name: $($loaded.GetName().Name)" }
if ($version -ne '1.0.0.0') { throw "Unexpected assembly version: $version; the installer writes this value into the registry" }

$type = $loaded.GetType('WorkProof.WordNative.Connect', $true)
if ($type.GUID.ToString() -ne '5f628c20-62bb-4da6-94df-36bd599a9301') { throw "Wrong COM class GUID: $($type.GUID)" }
$interfaces = @($type.GetInterfaces() | ForEach-Object { $_.Name })
foreach ($name in @('IDTExtensibility2', 'IRibbonExtensibility')) {
    if ($interfaces -notcontains $name) { throw "Connect does not implement $name" }
}
$progIds = @($type.GetCustomAttributes([Runtime.InteropServices.ProgIdAttribute], $false))
if ($progIds.Count -ne 1 -or $progIds[0].Value -ne 'WorkProof.WordNative.Connect') { throw 'Missing or wrong ProgId attribute' }

$instance = [Activator]::CreateInstance($type)
$markup = $type.GetMethod('GetCustomUI').Invoke($instance, @('Microsoft.Word.Document'))
foreach ($token in @("id='workproofTab'", "onAction='OpenRecorder'", "getImage='GetRibbonImage'", "onLoad='RibbonLoad'")) {
    if (-not $markup.Contains($token)) { throw "Ribbon markup is missing $token" }
}
try { $xml = [xml]$markup } catch { throw 'Ribbon markup is not well-formed XML' }
if ($xml.customUI.ribbon.tabs.tab.id -ne 'workproofTab') { throw 'Ribbon tab id is wrong' }
if ([string]::IsNullOrWhiteSpace([string]$xml.customUI.ribbon.tabs.tab.group.button.label)) { throw 'Ribbon button has no label' }
if ($xml.customUI.ribbon.tabs.tab.group.button.getImage -ne 'GetRibbonImage') { throw 'Ribbon button does not request the embedded picture' }
if ($xml.customUI.ribbon.tabs.tab.group.button.onAction -ne 'OpenRecorder') { throw 'Ribbon button does not call OpenRecorder' }

$image = $type.GetMethod('GetRibbonImage').Invoke($instance, @([object]$null))
if ($null -eq $image) { throw 'Embedded ribbon picture is missing from the assembly' }

$recorder = $loaded.GetType('WorkProof.WordNative.Recorder', $false)
if ($null -eq $recorder) { throw 'Recorder type is missing' }
if (-not $recorder.IsSubclassOf([System.Windows.Forms.Form])) { throw 'Recorder is not a WinForms task pane window' }

Write-Output "PASS: fixed COM identity, ribbon markup, embedded picture and pane type verified for WorkProof.WordNative $version"
