Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Resolve-RuntimeProgram([string]$Program) {
    if ([System.IO.Path]::IsPathRooted($Program)) {
        return (Resolve-Path -LiteralPath $Program -ErrorAction Stop).Path
    }
    return (Get-Command $Program -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
}

function Get-OwnedRuntimeProcess([string]$Root, [string]$Name) {
    $file = Join-Path $Root "state/$Name-process.json"
    if (-not (Test-Path -LiteralPath $file)) { return $null }
    $record = Get-Content -LiteralPath $file -Raw | ConvertFrom-Json
    $process = Get-Process -Id $record.id -ErrorAction SilentlyContinue
    if (-not $process) { return $null }
    # PowerShell 7.5 may deserialize ISO dates as DateTime objects. Converting
    # them back through culture-dependent strings loses subsecond precision.
    $started = if ($record.started -is [DateTime]) { $record.started.ToUniversalTime() }
        elseif ($record.started -is [DateTimeOffset]) { $record.started.UtcDateTime }
        else { [DateTimeOffset]::Parse($record.started, [Globalization.CultureInfo]::InvariantCulture).UtcDateTime }
    # PID reuse must never authorize stopping another application.
    if ([Math]::Abs(($process.StartTime.ToUniversalTime() - $started).TotalMilliseconds) -gt 100) { return $null }
    $expected = Resolve-RuntimeProgram $record.program
    if (-not [string]::Equals($process.Path, $expected, [StringComparison]::OrdinalIgnoreCase)) { return $null }
    return $process
}

function Assert-RuntimePort([string]$Root, [string]$Name, [int]$Port) {
    $listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
    if ($listeners.Count -eq 0) { return $false }
    $owned = Get-OwnedRuntimeProcess $Root $Name
    $allowed = if ($owned) { @($owned.Id) } else { @() }
    if ($owned -and @($listeners | Where-Object { $_.OwningProcess -ne $owned.Id }).Count) {
        $allowed = @(Get-RuntimeProcessTree $Root $Name | ForEach-Object { $_.Id })
    }
    if (-not $owned -or @($listeners | Where-Object { $_.OwningProcess -notin $allowed -or $_.LocalAddress -ne '127.0.0.1' }).Count) {
        throw "Port $Port is occupied by a process outside this WorkProof runtime ($Name). No process was stopped."
    }
    return $true
}

function Get-RuntimeProcessTree([string]$Root, [string]$Name) {
    $owned = Get-OwnedRuntimeProcess $Root $Name
    if (-not $owned) { return @() }
    $tree = @([pscustomobject]@{Id=$owned.Id; Depth=0; Started=$owned.StartTime.ToUniversalTime(); Path=$owned.Path})
    $snapshot = @(Get-CimInstance Win32_Process)
    for ($depth = 1; $depth -le 16; $depth++) {
        $parents = @($tree | Where-Object { $_.Depth -eq ($depth - 1) })
        if (-not $parents.Count) { break }
        foreach ($parent in $parents) {
            foreach ($child in $snapshot | Where-Object { $_.ParentProcessId -eq $parent.Id }) {
                if ($null -eq $child.CreationDate -or $child.CreationDate.ToUniversalTime() -lt $parent.Started) { continue }
                if ($child.ProcessId -in $tree.Id) { continue }
                $tree += [pscustomobject]@{Id=[int]$child.ProcessId; Depth=$depth; Started=$child.CreationDate.ToUniversalTime(); Path=$child.ExecutablePath}
            }
        }
    }
    return $tree
}

function Stop-RuntimeProcess([string]$Root, [string]$Name) {
    $tree = @(Get-RuntimeProcessTree $Root $Name | Sort-Object Depth -Descending)
    foreach ($entry in $tree) {
        $process = Get-Process -Id $entry.Id -ErrorAction SilentlyContinue
        if (-not $process) { continue }
        # Revalidate each captured process before using its handle.
        if ([Math]::Abs(($process.StartTime.ToUniversalTime() - $entry.Started).TotalMilliseconds) -gt 100 -or $process.Path -ne $entry.Path) {
            throw "Process identity changed while stopping $Name; refusing to stop it."
        }
        Stop-Process -InputObject $process -ErrorAction Stop
    }
}

function Start-RuntimeProcess([string]$Root, [string]$Name, [string]$Program, [string[]]$Arguments, [hashtable]$Environment = @{}) {
    $executable = Resolve-RuntimeProgram $Program
    # ArgumentList on Start-Process is joined by PowerShell. Quote every value
    # with the Windows CommandLineToArgvW convention so paths may contain spaces.
    $quoted = foreach ($argument in $Arguments) {
        '"' + ([regex]::Replace(([regex]::Replace($argument, '(\\*)"', '$1$1\"')), '(\\+)$', '$1$1')) + '"'
    }
    $process = Start-Process -FilePath $executable -ArgumentList $quoted -WorkingDirectory $Root -WindowStyle Hidden -Environment $Environment -RedirectStandardOutput (Join-Path $Root "logs/$Name.out.log") -RedirectStandardError (Join-Path $Root "logs/$Name.err.log") -PassThru
    $record = @{ id = $process.Id; program = $executable; started = $process.StartTime.ToUniversalTime().ToString('o') }
    $record | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $Root "state/$Name-process.json") -Encoding utf8
    return $process
}

function Wait-RuntimePort([string]$Root, [string]$Name, [int]$Port, [int]$TimeoutSeconds = 90) {
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        if (-not (Get-OwnedRuntimeProcess $Root $Name)) { throw "$Name exited before becoming ready. See $Root/logs/$Name.err.log" }
        if (Assert-RuntimePort $Root $Name $Port) { return }
        Start-Sleep -Milliseconds 250
    }
    throw "$Name did not become ready on port $Port. See $Root/logs"
}

function Invoke-RuntimeInput([string]$Program, [string[]]$Arguments, [string]$InputText, [hashtable]$Environment = @{}) {
    $start = [System.Diagnostics.ProcessStartInfo]::new()
    $start.FileName = Resolve-RuntimeProgram $Program
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    foreach ($argument in $Arguments) { $start.ArgumentList.Add($argument) }
    foreach ($entry in $Environment.GetEnumerator()) { $start.Environment[$entry.Key] = $entry.Value }
    $start.RedirectStandardInput = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $start.StandardInputEncoding = [System.Text.UTF8Encoding]::new($false)
    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $start
    [void]$process.Start()
    $process.StandardInput.Write($InputText)
    $process.StandardInput.Close()
    $outputTask = $process.StandardOutput.ReadToEndAsync()
    $errorTask = $process.StandardError.ReadToEndAsync()
    if (-not $process.WaitForExit(120000)) {
        $process.Kill()
        throw "Runtime command timed out: $Program"
    }
    if ($process.ExitCode -ne 0) { throw "Runtime command failed: $Program (exit $($process.ExitCode)). Credentials are not included in this message." }
    return $outputTask.GetAwaiter().GetResult()
}
