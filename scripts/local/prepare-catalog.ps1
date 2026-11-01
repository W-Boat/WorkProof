#Requires -Version 7.4
param([Parameter(Mandatory=$true)][string]$RuntimeRoot,[switch]$Apply)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'runtime-common.ps1')
$root=(Resolve-Path -LiteralPath $RuntimeRoot).Path
$state=Join-Path $root 'state'
$migration=Join-Path $root 'sql/V3__workproof_certificate_catalog.sql'
if (-not (Test-Path -LiteralPath $migration -PathType Leaf)) {throw '缺少 V3 文件，请先更新完整的 Actions 启动包。'}
$lock=[IO.File]::Open((Join-Path $state 'runtime.lock'),'OpenOrCreate','ReadWrite','None')
try {
    if (-not (Assert-RuntimePort $root 'mysql' 33307)) {throw '请先启动本运行目录的数据库，再查看准备方案。'}
    $config=Get-Content -LiteralPath (Join-Path $state 'credentials.json') -Raw | ConvertFrom-Json
    if ($config.dbPassword -notmatch '^[0-9a-f]{48}$') {throw '本地账号格式不符合预期，未修改数据。'}
    $mysqlRoot=(Get-ChildItem -LiteralPath (Join-Path $root 'mysql') -Directory | Select-Object -First 1).FullName
    $client=Join-Path $mysqlRoot 'bin/mysql.exe'
    $arguments=@('--protocol=TCP','--host=127.0.0.1','--port=33307','--user=workproof_local','--database=workproof_local','--default-character-set=utf8mb4','--batch','--skip-column-names')
    $environment=@{MYSQL_PWD=$config.dbPassword}
    function Query([string]$Sql) { return (Invoke-RuntimeInput $client $arguments $Sql $environment).Trim() }
    $digest=(Get-FileHash -LiteralPath $migration -Algorithm SHA256).Hash.ToLowerInvariant()
    $settings=Join-Path $state 'catalog.json'
    $exists=Query "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='wp_certificate';"
    if (Test-Path -LiteralPath $settings) {
        $previous=Get-Content -LiteralPath $settings -Raw | ConvertFrom-Json
        if ($previous.version -ne 1 -or $previous.migrationSha256 -ne $digest -or $exists -ne '1') {throw '已有准备记录与当前文件或数据库不一致，请保留现场并人工检查。'}
        Write-Output '本目录已有证书管理准备记录；未再次迁移或覆盖备份。'
        return
    }
    if ($exists -ne '0') {throw '已有证书表但没有本目录的准备记录，请人工核对；不会覆盖已有表。'}
    if ((Query 'SELECT COUNT(*) FROM sys_menu WHERE id BETWEEN 81000 AND 81003;') -ne '0') {throw '证书菜单编号已被占用，请人工核对；不会覆盖原菜单。'}
    Write-Output '准备方案：备份 workproof_local 全库；新增证书摘要表和四个菜单；普通角色不自动授权；生成启用记录。'
    Write-Output "迁移文件 SHA-256：$digest"
    Write-Output '不修改原账号、作品或证书信任。普通 Start 不会执行迁移。'
    if (-not $Apply) {Write-Output '当前仅查看方案，未写入数据库。确认需要执行时使用 Prepare certificate catalog.cmd。';return}
    $institution=Get-OwnedRuntimeProcess $root 'institution'
    foreach ($port in @(18081,18443)) {[void](Assert-RuntimePort $root 'institution' $port)}
    if (-not (Test-Path -LiteralPath (Join-Path $root 'native/workproof-inspector.exe'))) {throw '缺少证书检查工具，请先更新 Actions 原生工具。'}
    $pending=Join-Path $state 'catalog-preparation.json'
    if (Test-Path -LiteralPath $pending) {throw '存在未结束的准备记录，请核对备份和数据库，不会重复执行。'}
    if ($institution) {
        $javaProcesses=@(Get-RuntimeProcessTree $root 'institution' | ForEach-Object {Get-Process -Id $_.Id -ErrorAction Stop})
        Stop-RuntimeProcess $root 'institution'
        foreach ($process in $javaProcesses) {if (-not $process.WaitForExit(10000)) {throw '机构服务尚未停止，未进行备份或迁移。'}}
    }
    $owner=(& whoami).Trim()
    & icacls $root /inheritance:r /grant:r "${owner}:(OI)(CI)F" | Out-Null
    if ($LASTEXITCODE -ne 0) {throw '无法限制运行目录访问，未执行备份或迁移。'}
    $backupRoot=Join-Path $state 'backups'
    New-Item -ItemType Directory -Force $backupRoot | Out-Null
    $backup=Join-Path $backupRoot ('before-catalog-'+[DateTime]::UtcNow.ToString('yyyyMMddTHHmmss')+'-'+[Guid]::NewGuid().ToString('N')+'.sql')
    $dump=Join-Path $mysqlRoot 'bin/mysqldump.exe'
    [void](Invoke-RuntimeInput $dump @('--protocol=TCP','--host=127.0.0.1','--port=33307','--user=workproof_local','--single-transaction','--skip-lock-tables','--no-tablespaces','--column-statistics=0','--set-gtid-purged=OFF','--hex-blob',"--result-file=$backup",'workproof_local') '' $environment)
    if (-not (Test-Path -LiteralPath $backup) -or (Get-Item -LiteralPath $backup).Length -eq 0) {throw '备份未完成，未执行迁移。'}
    $receipt=@{version=1;enabled=$false;migrationSha256=$digest;backupFile=$backup;backupSha256=(Get-FileHash -LiteralPath $backup).Hash.ToLowerInvariant();startedAt=[DateTime]::UtcNow.ToString('o');status='applying'}
    $receipt | ConvertTo-Json | Set-Content -LiteralPath $pending -Encoding utf8
    [void](Query (Get-Content -LiteralPath $migration -Raw))
    if ((Query "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='wp_certificate';") -ne '15' -or (Query 'SELECT COUNT(*) FROM sys_menu WHERE id BETWEEN 81000 AND 81003;') -ne '4') {throw '迁移后检查未通过，保留备份和准备记录，请人工恢复；未启用证书列表。'}
    $receipt.enabled=$true;$receipt.status='prepared';$receipt.completedAt=[DateTime]::UtcNow.ToString('o')
    $receipt | ConvertTo-Json | Set-Content -LiteralPath $settings -Encoding utf8
    Remove-Item -LiteralPath $pending
    Write-Output '证书管理已准备好。原数据库备份保存在本目录 state/backups，请妥善保管。启动新版后台后重新登录即可查看菜单。'
} finally {$lock.Dispose()}
