$ErrorActionPreference='Stop'
Set-Location -LiteralPath $PSScriptRoot
foreach ($arguments in @(@('compose','run','--rm','prepare'),@('compose','up','-d','database','cache'),@('compose','run','--rm','initialize'),@('compose','up','-d','app'))) {
    & docker @arguments
    if ($LASTEXITCODE -ne 0) { throw '准备未完成，请保留数据和凭据，检查上一步结果。不要重放初始化或删除数据卷。' }
}
Write-Output 'WorkProof 已启动，请检查 docker compose ps。账号仅在显式运行 account 时显示。'
