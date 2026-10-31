param([Parameter(Mandatory=$true)][string]$Executable)
$ErrorActionPreference = 'Stop'
$binary = (Resolve-Path -LiteralPath $Executable).Path
$stateDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ('workproof-perf-' + [guid]::NewGuid().ToString('N'))
$previousData = $env:WORKPROOF_DATA_DIR
$previousHeadless = $env:WORKPROOF_HEADLESS
$env:WORKPROOF_DATA_DIR = $stateDirectory
$env:WORKPROOF_HEADLESS = '1'
$collector = $null
try {
    $collector = Start-Process -FilePath $binary -PassThru -WindowStyle Hidden
    $connectionFile = Join-Path $stateDirectory 'connection.json'
    for ($attempt = 0; $attempt -lt 100; $attempt++) {
        if ($collector.HasExited) { throw 'Collector exited before readiness' }
        if (Test-Path -LiteralPath $connectionFile) { break }
        Start-Sleep -Milliseconds 100
    }
    $connection = Get-Content -LiteralPath $connectionFile -Raw | ConvertFrom-Json
    $headers = @{ Authorization = 'Bearer ' + $connection.token }
    $origin = 'http://127.0.0.1:' + $connection.port
    $cpuStart = (Get-Process -Id $collector.Id).CPU
    $idleClock = [System.Diagnostics.Stopwatch]::StartNew()
    Start-Sleep -Seconds 3
    $idleClock.Stop()
    $rootProcess = Get-Process -Id $collector.Id
    $cpuOneCore = ($rootProcess.CPU - $cpuStart) / $idleClock.Elapsed.TotalSeconds * 100
    $session = Invoke-RestMethod -Uri "$origin/v1/sessions" -Method Post -Headers $headers -ContentType 'application/json' -Body (@{ file_name='synthetic-load.txt'; started_at=[DateTime]::UtcNow.ToString('o'); source='ci-performance-fixture'; demo=$true } | ConvertTo-Json)
    $sequence = 0
    $latencies = [System.Collections.Generic.List[double]]::new()
    for ($batchIndex = 0; $batchIndex -lt 32; $batchIndex++) {
        $events = @()
        for ($item = 0; $item -lt 128; $item++) {
            $events += @{ seq=$sequence; elapsed_ms=$sequence*10; kind=$(if ($sequence -eq 0) {'start'} else {'edit'}); inserted=1; deleted=0; chars=$sequence; checkpoint='' }
            $sequence++
        }
        $payload = @{ events=$events } | ConvertTo-Json -Depth 5 -Compress
        $clock = [System.Diagnostics.Stopwatch]::StartNew()
        $response = Invoke-RestMethod -Uri "$origin/v1/sessions/$($session.session_id)/events" -Method Post -Headers $headers -ContentType 'application/json' -Body $payload
        $clock.Stop()
        if ($response.next_seq -ne $sequence) { throw 'Incorrect committed sequence' }
        $latencies.Add($clock.Elapsed.TotalMilliseconds)
    }
    $tree = @(Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -eq $collector.Id -or $_.ParentProcessId -eq $collector.Id })
    $workingSet = 0L
    foreach ($entry in $tree) {
        $workingSet += (Get-Process -Id $entry.ProcessId -ErrorAction SilentlyContinue).WorkingSet64
    }
    $sorted = @($latencies | Sort-Object)
    $result = [ordered]@{
        environment='GitHub Actions Windows runner; headless tray, no status webview'
        synthetic_events=$sequence
        root_and_direct_children_working_set_mb=[Math]::Round($workingSet/1MB,2)
        idle_cpu_percent_of_one_core=[Math]::Round($cpuOneCore,3)
        batch_128_http_p50_ms=[Math]::Round($sorted[15],3)
        batch_128_http_p95_ms=[Math]::Round($sorted[30],3)
        note='HTTP latency includes PowerShell client overhead and SQLite durable commit; not editor callback latency. Snapshot includes direct children only.'
    }
    $result | ConvertTo-Json | Set-Content -LiteralPath 'performance-windows.json' -Encoding utf8
    $result | ConvertTo-Json
} finally {
    if ($collector -and -not $collector.HasExited) { Stop-Process -Id $collector.Id; $collector.WaitForExit() }
    $env:WORKPROOF_DATA_DIR = $previousData
    $env:WORKPROOF_HEADLESS = $previousHeadless
    $resolvedTarget = [System.IO.Path]::GetFullPath($stateDirectory)
    $resolvedTemp = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
    if ($resolvedTarget.StartsWith($resolvedTemp,[StringComparison]::OrdinalIgnoreCase) -and ([System.IO.Path]::GetFileName($resolvedTarget)).StartsWith('workproof-perf-') -and (Test-Path -LiteralPath $resolvedTarget)) {
        Remove-Item -LiteralPath $resolvedTarget -Recurse -Force
    }
}
