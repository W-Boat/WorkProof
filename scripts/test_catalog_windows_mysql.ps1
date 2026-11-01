#Requires -Version 7.4
param([Parameter(Mandatory=$true)][string]$MysqlDirectory)
$ErrorActionPreference='Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or -not $IsWindows) {throw 'Only run in the isolated Windows Actions environment.'}
. (Join-Path $PSScriptRoot 'local/runtime-common.ps1')
$root=Join-Path $env:RUNNER_TEMP ('WorkProof real catalog '+[Guid]::NewGuid().ToString('N'))
foreach ($directory in @('state','logs','sql','native','mysql','temp')) {New-Item -ItemType Directory -Force (Join-Path $root $directory) | Out-Null}
# Copy native binaries; no build, global installation, service registration or user DB.
Copy-Item -LiteralPath $MysqlDirectory -Destination (Join-Path $root 'mysql') -Recurse
$mysqlRoot=Join-Path $root ("mysql/"+(Split-Path $MysqlDirectory -Leaf))
$server=Join-Path $mysqlRoot 'bin/mysqld.exe';$client=Join-Path $mysqlRoot 'bin/mysql.exe';$dump=Join-Path $mysqlRoot 'bin/mysqldump.exe'
$password=[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(24)).ToLowerInvariant()
@{dbPassword=$password} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $root 'state/credentials.json')
Copy-Item (Join-Path $PSScriptRoot '../services/institution/scaffold-system/sql/V3__workproof_certificate_catalog.sql') (Join-Path $root 'sql/')
# Preparation checks presence only; cryptographic helper execution is covered by institution CI.
'Not executed: native verifier placeholder for migration-only acceptance' | Set-Content (Join-Path $root 'native/workproof-inspector.exe')
$data=Join-Path $root 'mysql-data'
[void](Invoke-RuntimeInput $server @('--initialize-insecure',"--basedir=$mysqlRoot","--datadir=$data") '')
$base=@('--protocol=TCP','--host=127.0.0.1','--port=33307','--user=root','--default-character-set=utf8mb4','--batch','--skip-column-names')
function RootQuery([string]$Sql) {return (Invoke-RuntimeInput $client $base $Sql).Trim()}
$started=$false
try {
    if (Get-NetTCPConnection -LocalPort 33307 -State Listen -ErrorAction SilentlyContinue) {throw 'Fixture port already occupied; refusing to touch it'}
    [void](Start-RuntimeProcess $root 'mysql' $server @("--basedir=$mysqlRoot","--datadir=$data",'--bind-address=127.0.0.1','--port=33307','--mysqlx=OFF','--innodb-buffer-pool-size=64M'))
    $started=$true;Wait-RuntimePort $root 'mysql' 33307
    [void](RootQuery "CREATE DATABASE workproof_local CHARACTER SET utf8mb4; CREATE DATABASE workproof_restore_ci CHARACTER SET utf8mb4; CREATE USER 'workproof_local'@'127.0.0.1' IDENTIFIED BY '$password'; GRANT ALL ON workproof_local.* TO 'workproof_local'@'127.0.0.1';")
    $schema=Get-Content (Join-Path $PSScriptRoot '../services/institution/scaffold-system/sql/V1__init_schema.sql') -Raw
    $seed=Get-Content (Join-Path $PSScriptRoot '../services/institution/scaffold-system/sql/V2__seed_data.sql') -Raw
    [void](RootQuery ("USE workproof_local;`n"+$schema+"`n"+$seed+"`nCREATE TABLE restore_probe(id INT PRIMARY KEY, payload BLOB, text_value VARCHAR(100)); INSERT INTO restore_probe VALUES(1,UNHEX('000AFF7F'),'中文证书,引号'),(2,NULL,'保留原数据');"))
    $accounts=RootQuery "SELECT SHA2(GROUP_CONCAT(CONCAT(id,':',username,':',password) ORDER BY id SEPARATOR '|'),256) FROM workproof_local.sys_user;"
    & (Join-Path $PSScriptRoot 'local/prepare-catalog.ps1') -RuntimeRoot $root
    if ((RootQuery "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='workproof_local' AND table_name='wp_certificate';") -ne '0') {throw 'Plan wrote database'}
    # A real missing executable must prevent migration, not just a mocked error.
    $disabledDump=$dump+'.disabled'
    if (-not [IO.Path]::GetFullPath($dump).StartsWith([IO.Path]::GetFullPath($root)+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) {throw 'Unsafe fixture target'}
    Move-Item -LiteralPath $dump -Destination $disabledDump
    try {
        $failed=$false;try {& (Join-Path $PSScriptRoot 'local/prepare-catalog.ps1') -RuntimeRoot $root -Apply} catch {$failed=$true}
        if (-not $failed -or (Test-Path (Join-Path $root 'state/catalog.json'))) {throw 'Backup failure did not refuse enablement'}
        if ((RootQuery "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='workproof_local' AND table_name='wp_certificate';") -ne '0') {throw 'Failed backup performed migration'}
    } finally {Move-Item -LiteralPath $disabledDump -Destination $dump}
    & (Join-Path $PSScriptRoot 'local/prepare-catalog.ps1') -RuntimeRoot $root -Apply
    $receipt=Get-Content (Join-Path $root 'state/catalog.json') -Raw | ConvertFrom-Json
    if (-not $receipt.enabled -or $receipt.backupSha256 -ne (Get-FileHash -LiteralPath $receipt.backupFile).Hash.ToLowerInvariant()) {throw 'Invalid real backup receipt'}
    if ($accounts -ne (RootQuery "SELECT SHA2(GROUP_CONCAT(CONCAT(id,':',username,':',password) ORDER BY id SEPARATOR '|'),256) FROM workproof_local.sys_user;")) {throw 'Existing accounts changed during migration'}
    if ((RootQuery 'SELECT COUNT(*) FROM workproof_local.wp_certificate;') -ne '0') {throw 'Unexpected certificate rows'}
    $backups=@(Get-ChildItem (Join-Path $root 'state/backups') -Filter '*.sql').Count
    & (Join-Path $PSScriptRoot 'local/prepare-catalog.ps1') -RuntimeRoot $root -Apply
    if (@(Get-ChildItem (Join-Path $root 'state/backups') -Filter '*.sql').Count -ne $backups) {throw 'Repeat preparation created another backup'}
    # Restore into a second database, never overwrite the original even in CI.
    [void](RootQuery ("USE workproof_restore_ci;`n"+(Get-Content -LiteralPath $receipt.backupFile -Raw)))
    if ($accounts -ne (RootQuery "SELECT SHA2(GROUP_CONCAT(CONCAT(id,':',username,':',password) ORDER BY id SEPARATOR '|'),256) FROM workproof_restore_ci.sys_user;")) {throw 'Restored accounts differ'}
    if ((RootQuery "SELECT COUNT(*) FROM workproof_restore_ci.restore_probe a JOIN workproof_local.restore_probe b ON a.id=b.id WHERE a.payload <=> b.payload AND BINARY a.text_value=BINARY b.text_value;") -ne '2') {throw 'Backup lost binary, NULL or Unicode data'}
    if ((RootQuery "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='workproof_restore_ci' AND table_name='wp_certificate';") -ne '0') {throw 'Backup unexpectedly includes post-migration table'}
    Write-Output 'PASS: real Windows MySQL plan, backup failure refusal, mysqldump, V3, original accounts, repeat preparation and isolated binary/NULL/Unicode restoration.'
} finally {
    if ($started) {
        [void](Invoke-RuntimeInput (Join-Path $mysqlRoot 'bin/mysqladmin.exe') @('--protocol=TCP','--host=127.0.0.1','--port=33307','--user=root','shutdown') '')
    }
    # Never upload this directory: it contains private SQL backup and CI-only credentials.
}
