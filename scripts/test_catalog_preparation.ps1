#Requires -Version 7.4
$ErrorActionPreference='Stop'
if ($env:GITHUB_ACTIONS -ne 'true') {throw 'Only run in isolated Actions fixtures.'}
# Control-flow test doubles for native process/database boundaries. Real V3 SQL is
# independently exercised against MySQL by test_institution_runtime.py.
$fixture=Join-Path $env:RUNNER_TEMP ('catalog preparation '+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force $fixture | Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'local/prepare-catalog.ps1') -Destination $fixture
@'
function Assert-RuntimePort($Root,$Name,$Port) {return $Port -eq 33307}
function Get-OwnedRuntimeProcess($Root,$Name) {return $null}
function Invoke-RuntimeInput([string]$Program,[string[]]$Arguments,[string]$InputText,[hashtable]$Environment) {
    if ($Environment.MYSQL_PWD -ne ('a'*48)) {throw 'Credential must be passed only in environment'}
    if ($Arguments -match '--password') {throw 'Password must not be an argument'}
    if ($Program.EndsWith('mysqldump.exe')) {
        if ($global:catalogFixtureFailDump) {throw 'Fixture backup failure'}
        $target=($Arguments | Where-Object {$_ -like '--result-file=*'}).Substring(14)
        'Fixture private SQL backup' | Set-Content -LiteralPath $target
        $global:catalogFixtureCalls.Add('backup');return ''
    }
    if ($InputText -match 'CREATE TABLE') {
        if ($global:catalogFixtureCalls.Count -ne 1 -or $global:catalogFixtureCalls[0] -ne 'backup') {throw 'Migration ran before backup'}
        $global:catalogFixtureCalls.Add('migration');$global:catalogFixtureTable=$true;return ''
    }
    if ($InputText -match 'information_schema.tables') {if ($global:catalogFixtureTable) {return '1'} else {return '0'}}
    if ($InputText -match 'information_schema.columns') {return '15'}
    if ($InputText -match 'sys_menu') {if ($global:catalogFixtureTable) {return '4'} else {return '0'}}
    throw 'Unexpected fixture query'
}
'@ | Set-Content -LiteralPath (Join-Path $fixture 'runtime-common.ps1')
foreach ($scenario in @('normal','backup-failure','unknown-existing-table')) {
    $runtime=Join-Path $fixture $scenario
    New-Item -ItemType Directory -Force (Join-Path $runtime 'state'),(Join-Path $runtime 'sql'),(Join-Path $runtime 'native'),(Join-Path $runtime 'mysql/mysql-fixture/bin') | Out-Null
    @{dbPassword=('a'*48)} | ConvertTo-Json | Set-Content (Join-Path $runtime 'state/credentials.json')
    Copy-Item (Join-Path $PSScriptRoot '../services/institution/scaffold-system/sql/V3__workproof_certificate_catalog.sql') (Join-Path $runtime 'sql/')
    'Fixture only' | Set-Content (Join-Path $runtime 'native/workproof-inspector.exe')
    $global:catalogFixtureCalls=[Collections.Generic.List[string]]::new()
    $global:catalogFixtureTable=$scenario -eq 'unknown-existing-table'
    $global:catalogFixtureFailDump=$scenario -eq 'backup-failure'
    if ($scenario -eq 'unknown-existing-table') {
        $refused=$false;try {& (Join-Path $fixture 'prepare-catalog.ps1') -RuntimeRoot $runtime -Apply} catch {$refused=$true}
        if (-not $refused -or $global:catalogFixtureCalls.Count) {throw 'Unknown table was not refused before writes'}
        continue
    }
    & (Join-Path $fixture 'prepare-catalog.ps1') -RuntimeRoot $runtime
    if ($global:catalogFixtureCalls.Count -or (Test-Path (Join-Path $runtime 'state/catalog.json'))) {throw 'Plan mutated state'}
    if ($scenario -eq 'backup-failure') {
        $refused=$false;try {& (Join-Path $fixture 'prepare-catalog.ps1') -RuntimeRoot $runtime -Apply} catch {$refused=$true}
        if (-not $refused -or $global:catalogFixtureCalls.Contains('migration') -or (Test-Path (Join-Path $runtime 'state/catalog.json'))) {throw 'Failed backup enabled catalog or migrated'}
        continue
    }
    & (Join-Path $fixture 'prepare-catalog.ps1') -RuntimeRoot $runtime -Apply
    $receipt=Get-Content (Join-Path $runtime 'state/catalog.json') -Raw | ConvertFrom-Json
    if (-not $receipt.enabled -or $receipt.status -ne 'prepared' -or $receipt.backupSha256 -ne (Get-FileHash $receipt.backupFile).Hash.ToLowerInvariant()) {throw 'Invalid backup receipt'}
    & (Join-Path $fixture 'prepare-catalog.ps1') -RuntimeRoot $runtime -Apply
    if ($global:catalogFixtureCalls.Count -ne 2) {throw 'Repeat preparation changed database'}
}
Write-Output 'PASS: plan writes no DB, backup precedes migration, backup failure/unknown table refuse, receipt integrity and repeat preparation.'
