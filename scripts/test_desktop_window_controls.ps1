# Actions-only native Windows UIA acceptance; never controls an existing app.
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$Executable)
$ErrorActionPreference='Stop'
if($env:GITHUB_ACTIONS -ne 'true' -or -not $IsWindows){throw 'Native window acceptance is restricted to Windows Actions'}
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class WorkProofWindowProbe {
 [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hwnd);
 [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr hwnd);
 [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hwnd);
 [DllImport("user32.dll",EntryPoint="GetWindowLongW")] public static extern int GetWindowLong(IntPtr hwnd,int index);
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hwnd,int command);
}
'@
function Await-State([scriptblock]$Action){
    $deadline=[DateTime]::UtcNow.AddSeconds(30)
    do{if(& $Action){return};Start-Sleep -Milliseconds 250}while([DateTime]::UtcNow -lt $deadline)
    throw 'Native window condition did not complete within thirty seconds'
}
$directory=Join-Path $env:RUNNER_TEMP ('workproof-window-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $directory | Out-Null
$start=New-Object Diagnostics.ProcessStartInfo
$start.FileName=(Resolve-Path -LiteralPath $Executable).Path
$start.UseShellExecute=$false
$start.Environment['WORKPROOF_DATA_DIR']=$directory
[void]$start.Environment.Remove('WORKPROOF_HEADLESS')
$owned=[Diagnostics.Process]::Start($start)
try{
    Await-State {$owned.Refresh();-not $owned.HasExited -and $owned.MainWindowHandle -ne [IntPtr]::Zero}
    $window=$owned.MainWindowHandle
    # Native caption style must be absent, independent of web content labels.
    if(([WorkProofWindowProbe]::GetWindowLong($window,-16) -band 0x00C00000) -ne 0){throw 'System titlebar is still enabled'}
    $root=[Windows.Automation.AutomationElement]::FromHandle($window)
    function Invoke-WindowButton([string]$Name){
        $script:button=$null
        Await-State {
            $condition=New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::NameProperty,$Name)
            $script:button=$root.FindFirst([Windows.Automation.TreeScope]::Descendants,$condition)
            $null -ne $script:button
        }
        $pattern=$script:button.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern)
        $pattern.Invoke()
    }
    Invoke-WindowButton '最小化窗口'
    Await-State {[WorkProofWindowProbe]::IsIconic($window)}
    [void][WorkProofWindowProbe]::ShowWindow($window,9)
    Await-State {-not [WorkProofWindowProbe]::IsIconic($window)}
    Invoke-WindowButton '最大化或还原窗口'
    Await-State {[WorkProofWindowProbe]::IsZoomed($window)}
    Invoke-WindowButton '最大化或还原窗口'
    Await-State {-not [WorkProofWindowProbe]::IsZoomed($window)}
    Await-State {Get-NetTCPConnection -State Listen -LocalPort 43127 -ErrorAction SilentlyContinue | Where-Object {$_.OwningProcess -eq $owned.Id}}
    Invoke-WindowButton '关闭窗口并保留后台记录'
    Await-State {-not [WorkProofWindowProbe]::IsWindow($window)}
    $owned.Refresh();if($owned.HasExited){throw 'Closing the workbench stopped the tray collector'}
    if(-not(Get-NetTCPConnection -State Listen -LocalPort 43127 -ErrorAction SilentlyContinue | Where-Object {$_.OwningProcess -eq $owned.Id})){throw 'Collector listener stopped when workbench closed'}
    @{source_commit=$env:GITHUB_SHA;scope='Real Windows UIA and native window state; no Office host acceptance';caption_hidden=$true;minimized=$true;maximized_and_restored=$true;close_retained_collector=$true} | ConvertTo-Json | Set-Content -LiteralPath 'test-desktop-window-controls.json' -Encoding utf8
    Write-Output 'PASS real Windows internal controls: hidden system caption, minimize, maximize/restore, close retains tray collector'
}finally{
    # Only terminate the process created by this test; never stop Office or a
    # pre-existing WorkProof. Keep isolated state in RUNNER_TEMP for diagnosis.
    if(-not $owned.HasExited){$owned.Kill();[void]$owned.WaitForExit(10000)}
    $owned.Dispose()
}
