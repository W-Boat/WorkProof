#Requires -Version 7.4
param([Parameter(Mandatory=$true)][string]$RuntimeRoot,[switch]$NoBrowser)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'runtime-common.ps1')
$root=[System.IO.Path]::GetFullPath($RuntimeRoot)
if (-not (Test-Path -LiteralPath $root)) {throw 'Runtime directory does not exist; download the CI artifacts and portable runtime packages first.'}
$owner=(& whoami).Trim()
& icacls $root /inheritance:r /grant:r "${owner}:(OI)(CI)F" | Out-Null
if ($LASTEXITCODE -ne 0) {throw 'Could not restrict local runtime permissions'}
$state=Join-Path $root 'state'
New-Item -ItemType Directory -Force $state,(Join-Path $root 'temp'),(Join-Path $root 'logs') | Out-Null
$lock=[System.IO.File]::Open((Join-Path $state 'runtime.lock'),'OpenOrCreate','ReadWrite','None')
try {
$configFile=Join-Path $state 'credentials.json'
if (-not (Test-Path -LiteralPath $configFile)) {
    $config=[ordered]@{}
    foreach ($key in @('dbPassword','rootPassword','redisPassword','jwtSecret','adminPassword')) {
        $config[$key]=[Convert]::ToHexString([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(24)).ToLower()
    }
    $config | ConvertTo-Json | Set-Content -LiteralPath $configFile -Encoding utf8
}
$localConfig=Get-Content -LiteralPath $configFile -Raw | ConvertFrom-Json
foreach ($key in @('dbPassword','rootPassword','redisPassword','jwtSecret','adminPassword')) {
    if ($localConfig.$key -notmatch '^[0-9a-f]{48}$') {throw "Invalid generated credential field: $key; existing accounts were not changed"}
}
$mysqlDirectory=(Get-ChildItem (Join-Path $root 'mysql') -Directory | Select-Object -First 1).FullName
$mysqlServer=Join-Path $mysqlDirectory 'bin/mysqld.exe'
$mysqlClient=Join-Path $mysqlDirectory 'bin/mysql.exe'
$jar=(Get-ChildItem (Join-Path $root 'institution') -Recurse -Filter 'scaffold-admin-*.jar' | Select-Object -First 1).FullName
$ui=Join-Path $root 'institution/scaffold-vue/dist'
if (-not $jar -or -not (Test-Path $mysqlServer)) {throw 'Prebuilt runtime files are incomplete'}
$archive=[System.IO.Compression.ZipFile]::OpenRead($jar)
try {
    $embeddedUi=$null -ne $archive.GetEntry('BOOT-INF/classes/static/index.html')
    $embeddedHasher=$null -ne $archive.GetEntry('BOOT-INF/classes/com/scaffold/admin/util/LocalPasswordHasher.class')
} finally {$archive.Dispose()}
if (-not $embeddedUi -and -not (Test-Path (Join-Path $ui 'index.html'))) {throw 'Prebuilt UI is missing'}
$backendPort=if ($embeddedUi) {18081} else {18080}
$java=if (Test-Path (Join-Path $root 'java/bin/java.exe')) {Join-Path $root 'java/bin/java.exe'} else {Resolve-RuntimeProgram 'java'}
$sourceRoot=[System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$schemaRoot=if (Test-Path (Join-Path $root 'sql/V1__init_schema.sql')) {Join-Path $root 'sql'} else {Join-Path $sourceRoot 'services/institution/scaffold-system/sql'}
function Invoke-ProgramInput([string]$Program,[string[]]$Arguments,[string]$InputText,[hashtable]$Environment) {
    return Invoke-RuntimeInput $Program $Arguments $InputText $Environment
}
function Port-Role([int]$Port) {
    if ($Port -eq 33307) {return 'mysql'}
    if ($Port -eq 36379) {return 'cache'}
    if ($Port -eq $backendPort) {return 'institution'}
    return 'ui'
}
function Wait-Port([int]$Port) {Wait-RuntimePort $root (Port-Role $Port) $Port}
function Port-IsListening([int]$Port) {
    return Assert-RuntimePort $root (Port-Role $Port) $Port
}
function Start-Owned([string]$Name,[string]$Program,[string[]]$Arguments,[hashtable]$Environment=@{}) {
    if (-not (Get-OwnedRuntimeProcess $root $Name)) {[void](Start-RuntimeProcess $root $Name $Program $Arguments $Environment)}
}
# Refuse foreign listeners before touching local database/configuration files.
foreach ($port in @(33307,36379,$backendPort,18081) | Select-Object -Unique) {[void](Port-IsListening $port)}
$data=Join-Path $root 'mysql-data'
if (-not (Test-Path (Join-Path $data 'mysql'))) {
    if ((Test-Path $data) -and (Get-ChildItem $data -Force | Select-Object -First 1)) {throw 'Existing unrecognized MySQL data directory; refusing to overwrite'}
    [void](Invoke-RuntimeInput $mysqlServer @('--initialize-insecure',"--basedir=$mysqlDirectory","--datadir=$data",('--tmpdir='+(Join-Path $root 'temp'))) '')
}
$initFile=Join-Path $state 'mysql-start.sql'
@"
ALTER USER 'root'@'localhost' IDENTIFIED BY '$($localConfig.rootPassword)';
CREATE DATABASE IF NOT EXISTS workproof_local CHARACTER SET utf8mb4;
CREATE USER IF NOT EXISTS 'workproof_local'@'127.0.0.1' IDENTIFIED BY '$($localConfig.dbPassword)';
GRANT ALL PRIVILEGES ON workproof_local.* TO 'workproof_local'@'127.0.0.1';
"@ | Set-Content -LiteralPath $initFile -Encoding ascii
if (-not (Port-IsListening 33307)) {
    Start-Owned 'mysql' $mysqlServer @("--basedir=$mysqlDirectory","--datadir=$data",'--bind-address=127.0.0.1','--port=33307','--mysqlx=OFF','--max-connections=30','--innodb-buffer-pool-size=128M','--performance-schema=OFF',"--init-file=$initFile",('--tmpdir='+(Join-Path $root 'temp')))
    Wait-Port 33307
}
$mysqlArgs=@('--protocol=TCP','--host=127.0.0.1','--port=33307','--user=workproof_local','--database=workproof_local','--default-character-set=utf8mb4','--batch','--skip-column-names')
$dbEnvironment=@{MYSQL_PWD=$localConfig.dbPassword}
$tables=Invoke-ProgramInput $mysqlClient $mysqlArgs 'SHOW TABLES;' $dbEnvironment
if ([string]::IsNullOrWhiteSpace($tables)) {
    if ($embeddedHasher) {
        $hash=Invoke-RuntimeInput $java @('-Dloader.main=com.scaffold.admin.util.LocalPasswordHasher','-cp',$jar,'org.springframework.boot.loader.launch.PropertiesLauncher') $localConfig.adminPassword
    } else {
        $hash=Invoke-ProgramInput 'node' @((Join-Path $PSScriptRoot 'hash-password.cjs')) (@{password=$localConfig.adminPassword}|ConvertTo-Json) @{WORKPROOF_BCRYPT_JS=(Join-Path $root 'bcryptjs/index.js')}
    }
    if ($hash.Trim() -notmatch '^\$2[aby]\$\d{2}\$[A-Za-z0-9./]{53}$') {throw 'Invalid generated password hash'}
    $schema=Get-Content (Join-Path $schemaRoot 'V1__init_schema.sql') -Raw
    $seed=Get-Content (Join-Path $schemaRoot 'V2__seed_data.sql') -Raw
    $seed=[regex]::Replace($seed,'\$2[aby]\$\d{2}\$[A-Za-z0-9./]{53}',[System.Text.RegularExpressions.MatchEvaluator]{param($match) $hash.Trim()})
    [void](Invoke-ProgramInput $mysqlClient $mysqlArgs ($schema+"`n"+$seed+"`nUPDATE sys_user SET status=0 WHERE username<>'admin'; UPDATE sys_user SET nickname='WorkProof 本地管理员' WHERE username='admin';") $dbEnvironment)
    $tables=Invoke-ProgramInput $mysqlClient $mysqlArgs 'SHOW TABLES;' $dbEnvironment
}
$knownSchema=Get-Content (Join-Path $schemaRoot 'V1__init_schema.sql') -Raw
$expectedTables=@([regex]::Matches($knownSchema,'(?im)CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?(\w+)`?') | ForEach-Object {$_.Groups[1].Value})
$actualTables=@($tables -split '\r?\n' | ForEach-Object {$_.Trim()} | Where-Object {$_})
if (-not $expectedTables.Count -or @($expectedTables | Where-Object {$_ -notin $actualTables}).Count) {
    throw 'Existing local schema is incomplete or unrecognized. Data was retained; automatic re-import/reset is disabled.'
}
$acl=Join-Path $state 'garnet.acl'
('user default on >'+$localConfig.redisPassword+' ~* +@all') | Set-Content -LiteralPath $acl -Encoding ascii
if (-not (Port-IsListening 36379)) {
    Start-Owned 'cache' (Join-Path $root 'garnet/net10.0/GarnetServer.exe') @('--bind','127.0.0.1','--port','36379','--memory','32m','--index','4m','--page','1m','--no-obj','--auth','ACL','--acl-file',$acl) @{DOTNET_ROOT=(Join-Path $root 'dotnet')}
    Wait-Port 36379
}
if (-not (Port-IsListening $backendPort)) {
    $environment=@{DB_HOST='127.0.0.1';DB_PORT='33307';DB_NAME='workproof_local';DB_USERNAME='workproof_local';DB_PASSWORD=$localConfig.dbPassword;REDIS_HOST='127.0.0.1';REDIS_PORT='36379';REDIS_PASSWORD=$localConfig.redisPassword;JWT_SECRET=$localConfig.jwtSecret}
    Start-Owned 'institution' $java @(('-Djava.io.tmpdir='+(Join-Path $root 'temp')),'-Xms96m','-Xmx384m','-jar',$jar,'--server.address=127.0.0.1',"--server.port=$backendPort") $environment
    Wait-Port $backendPort
}
if (-not $embeddedUi -and -not (Port-IsListening 18081)) {
    Start-Owned 'ui' 'python' @((Join-Path $PSScriptRoot 'serve-ui.py'),'--directory',$ui,'--port','18081')
    Wait-Port 18081
}
$response=Invoke-RestMethod 'http://127.0.0.1:18081/api/health'
if ($response.code -ne 200) {throw 'Institution health check failed'}
Write-Output 'Local institution workspace is available at http://127.0.0.1:18081'
Write-Output "Generated local admin credentials are stored privately in $configFile"
if (-not $NoBrowser) {Start-Process 'http://127.0.0.1:18081'}
} finally {$lock.Dispose()}
