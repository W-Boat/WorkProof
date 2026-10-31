#Requires -Version 7.4
param([Parameter(Mandatory=$true)][string]$RuntimeRoot)
. (Join-Path $PSScriptRoot 'runtime-common.ps1')
$root = [System.IO.Path]::GetFullPath($RuntimeRoot)
$state = Join-Path $root 'state'
if (-not (Test-Path $state)) { Write-Output 'No local runtime has been initialized.'; exit 0 }
$lock = [System.IO.File]::Open((Join-Path $state 'runtime.lock'),'OpenOrCreate','ReadWrite','None')
try {
    foreach ($name in @('ui','institution','cache')) { Stop-RuntimeProcess $root $name }
    if (Get-OwnedRuntimeProcess $root 'mysql') {
        [void](Assert-RuntimePort $root 'mysql' 33307)
        $config = Get-Content (Join-Path $state 'credentials.json') -Raw | ConvertFrom-Json
        $mysql = Get-OwnedRuntimeProcess $root 'mysql'
        $admin = Join-Path (Split-Path $mysql.Path) 'mysqladmin.exe'
        # Clean InnoDB shutdown. Never force-kill a database if shutdown fails.
        [void](Invoke-RuntimeInput $admin @('--protocol=TCP','--host=127.0.0.1','--port=33307','--user=root','shutdown') '' @{MYSQL_PWD=$config.rootPassword})
        $deadline = [DateTime]::UtcNow.AddSeconds(30)
        while (Get-OwnedRuntimeProcess $root 'mysql') {
            if ([DateTime]::UtcNow -gt $deadline) { throw 'MySQL shutdown is still pending. No database process was killed.' }
            Start-Sleep -Milliseconds 250
        }
    }
    Write-Output 'WorkProof institution services stopped. Database and account files were retained.'
} finally { $lock.Dispose() }
