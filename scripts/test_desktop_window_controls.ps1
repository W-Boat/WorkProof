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
$script:phase='start'
function Await-State([scriptblock]$Action,[string]$Phase){
    $script:phase=$Phase;Write-Output ('Await native state: '+$Phase)
    $deadline=[DateTime]::UtcNow.AddSeconds(30)
    do{if(& $Action){return};Start-Sleep -Milliseconds 250}while([DateTime]::UtcNow -lt $deadline)
    throw ('Native window condition did not complete within thirty seconds: '+$Phase)
}
$directory=Join-Path $env:RUNNER_TEMP ('workproof-window-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $directory | Out-Null
$start=New-Object Diagnostics.ProcessStartInfo
$start.FileName=(Resolve-Path -LiteralPath $Executable).Path
$start.UseShellExecute=$false
$start.Environment['WORKPROOF_DATA_DIR']=$directory
# CI has no screen reader to activate WebView2's on-demand accessibility tree.
# Enable the documented automation mode only for this isolated child process;
# do not impose accessibility flags on the shipped app or the runner globally.
# https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/webview-features-flags
$start.Environment['WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS']='--force-renderer-accessibility=complete'
[void]$start.Environment.Remove('WORKPROOF_HEADLESS')
$owned=[Diagnostics.Process]::Start($start)
try{
    Await-State {$owned.Refresh();-not $owned.HasExited -and $owned.MainWindowHandle -ne [IntPtr]::Zero} 'initial visible window'
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
        } ('UIA button: '+$Name)
        $pattern=$script:button.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern)
        $pattern.Invoke()
    }
    Invoke-WindowButton '最小化窗口'
    Await-State {[WorkProofWindowProbe]::IsIconic($window)} 'minimized after internal button'
    [void][WorkProofWindowProbe]::ShowWindow($window,9)
    Await-State {-not [WorkProofWindowProbe]::IsIconic($window)} 'restored for next button'
    Invoke-WindowButton '最大化或还原窗口'
    Await-State {[WorkProofWindowProbe]::IsZoomed($window)} 'maximized after internal button'
    Invoke-WindowButton '最大化或还原窗口'
    Await-State {-not [WorkProofWindowProbe]::IsZoomed($window)} 'restored after internal button'
    Await-State {Get-NetTCPConnection -State Listen -LocalPort 43127 -ErrorAction SilentlyContinue | Where-Object {$_.OwningProcess -eq $owned.Id}} 'owned collector listener'
    Invoke-WindowButton '关闭窗口并保留后台记录'
    Await-State {-not [WorkProofWindowProbe]::IsWindow($window)} 'closed after internal button'
    $owned.Refresh();if($owned.HasExited){throw 'Closing the workbench stopped the tray collector'}
    if(-not(Get-NetTCPConnection -State Listen -LocalPort 43127 -ErrorAction SilentlyContinue | Where-Object {$_.OwningProcess -eq $owned.Id})){throw 'Collector listener stopped when workbench closed'}
    @{source_commit=$env:GITHUB_SHA;scope='Real Windows UIA and native window state; no Office host acceptance';caption_hidden=$true;minimized=$true;maximized_and_restored=$true;close_retained_collector=$true} | ConvertTo-Json | Set-Content -LiteralPath 'test-desktop-window-controls.json' -Encoding utf8
    Write-Output 'PASS real Windows internal controls: hidden system caption, minimize, maximize/restore, close retains tray collector'
}catch{
    $failure=$_
    $owned.Refresh()
    $diagnostic=@{phase=$script:phase;error=[string]$failure;source_commit=$env:GITHUB_SHA;exited=$owned.HasExited;scope='Only the isolated process created by this Actions test'}
    if(-not $owned.HasExited){
        $diagnostic.window_handle=[string]$owned.MainWindowHandle
        $diagnostic.window_title=$owned.MainWindowTitle
        $condition=New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ProcessIdProperty,$owned.Id)
        $windows=[Windows.Automation.AutomationElement]::RootElement.FindAll([Windows.Automation.TreeScope]::Children,$condition)
        $diagnostic.top_windows=@(foreach($entry in $windows){@{name=$entry.Current.Name;class=$entry.Current.ClassName;handle=$entry.Current.NativeWindowHandle}})
        if($null -ne $root){
            $elements=$root.FindAll([Windows.Automation.TreeScope]::Descendants,[Windows.Automation.Condition]::TrueCondition)
            $diagnostic.uia=@(for($i=0;$i -lt [Math]::Min(120,$elements.Count);$i++){@{name=$elements[$i].Current.Name;class=$elements[$i].Current.ClassName;type=$elements[$i].Current.ControlType.ProgrammaticName}})
        }
    }
    New-Item -ItemType Directory -Force test-results/native-window | Out-Null
    $diagnostic | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath test-results/native-window/failure.json -Encoding utf8
    throw $failure
}finally{
    # Only terminate the process created by this test; never stop Office or a
    # pre-existing WorkProof. Keep isolated state in RUNNER_TEMP for diagnosis.
    if(-not $owned.HasExited){$owned.Kill();[void]$owned.WaitForExit(10000)}
    $owned.Dispose()
}
