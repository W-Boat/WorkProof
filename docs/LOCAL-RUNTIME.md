# WorkProof 本地机构后台

本机入口：[http://127.0.0.1:18081/login](http://127.0.0.1:18081/login)。这是机构后台，不是桌面记录引擎；本地记录引擎的端口仍为 43127，停止机构后台不会停止记录。

2026-11-01 最新本机资源：机构 JAR 来自 `7d3ed37` 的成功 Actions，增加简明证书检查弹窗、共享 Rust 内容预检、权限与隐私审计；Windows 检查工具来自 `3bc7511` 的成功构建，放在运行目录 `native/workproof-inspector.exe`。原账号文件保持不变，已复核登录、登出、真实内容检查和修改后拒绝。独立核验入口 [http://127.0.0.1:4173/](http://127.0.0.1:4173/) 使用 `E:/work/workproof-browser-3bc7511` 的预构建 CLI 和静态资源，其进程记录与日志均在该目录；旧 `c5a830a` 静态服务已停止。桌面新安装包尚未执行，当前未启动 43127 采集器；localhost Root 信任仍未变更。

## 运行方式

证书管理准备入口（当前本机尚未执行）：更新同一版本的 JAR、启动包及原生检查工具后，先正常启动本目录服务，打开 `Certificate catalog plan.cmd` 查看方案，再按需要打开 `Prepare certificate catalog.cmd`。后者只操作已核对归属的 `workproof_local`，停止自己的 Java 服务但保留数据库，先用 mysqldump 完整备份，再执行包内V3并生成 `state/catalog.json`。完成后点击 Start、重新登录。普通 Start 不会自动迁移；只有准备记录和包内迁移摘要匹配时才传入启用配置。

[机构 Actions 41279970799](https://github.com/W-Boat/WorkProof/actions/runs/41279970799) 已通过Windows准备流程fixture和真实MySQL业务回归，下载的启动包SHA-256为 `2491b966f2b335f10e82c801c782f1c90e6a6f53f99883d8e798992b47059c8d`，两个入口/准备脚本/V3均已只读核对。流程fixture模拟了原生命令边界，尚不能证明完整Windows原生MySQL备份/恢复链路已验收。

原生验收增量使用独立 `Windows catalog backup and restore` Actions，下载[MySQL官方 Windows 8.4.13 ZIP](https://dev.mysql.com/downloads/mysql/8.4.html)，固定 SHA-256 `e9cd98b1d23f122987b1afca26ad942efec5891481103d48ae3cde237fa3ea54`。隔离CI运行真实服务、mysqldump、迁移及另库恢复，覆盖二进制/NULL/中文和原账号；该轮尚待通过，不在本机执行。

备份在私有 `state/backups`，包含数据库敏感内容，不能上传公共仓库；`catalog-preparation.json` 表示未完成或需人工检查的操作。MySQL DDL不能整体回滚，失败时保留备份和记录，不自动删表或重放。已有不明证书表/菜单冲突会拒绝；恢复须先核对现场及备份，不能直接对已有数据重跑初始化SQL。此工具固定用于本地Windows运行目录，不是通用生产服务器迁移器。备份失败时可能已停止Java，可检查日志后恢复原版本；工具不会把停止误报为已启用。

从 GitHub Actions 的 `Institution backend baseline` 下载：

* `institution-baseline`：已构建 JAR（内含 Vue 界面、Office 资源），无需本机 Maven、Node、Python 或重新构建。
* `workproof-local-launchers`：四个 Windows 点击入口、PowerShell 脚本和首次初始化 SQL。

把前者解压到运行目录的 `institution/`，后者解压到运行目录根。**当前包仍需准备 Java 17、MySQL 和 Garnet/.NET 便携运行时，尚非全新 Windows 的完整离线安装器。** 本会话已经准备的目录为 `E:\work\workproof-local`；后续运行时下载/安装步骤仍需集成为首次启动向导，不能以启动脚本存在就宣称任意电脑点击即用。

| 点击入口 | 行为 |
|---|---|
| `Start.cmd` | 在本机回环地址启动服务；首次生成随机账号与密钥，初始化自己目录内的空库；就绪后打开后台 |
| `Status.cmd` | 显示进程和 HTTP 健康状态，不显示密码 |
| `Stop.cmd` | 停止本运行目录拥有的进程树；MySQL 通过 mysqladmin 正常关闭；保留数据和账号 |
| `Show account.cmd` | 在本机弹窗查看生成的 admin 密码，不写入终端或日志 |
| `Trust localhost.cmd` | 对已准备的 localhost 证书显示明确确认，再修改当前用户 Root 信任库；不导入私钥 |
| `Remove localhost trust.cmd` | 经确认移除同一 localhost 证书，保留其他信任项 |
| `Install Word add-in.cmd` | 经确认注册本地 Word 开发加载项，要求 HTTPS 已受信任；不关闭现有文档 |
| `Remove Word add-in.cmd` | 只撤销属于本运行目录的 Word 开发加载项注册 |

脚本使用 PowerShell 7.4+；优先使用运行目录 `powershell/pwsh.exe`，否则使用已安装的 `pwsh.exe`。不改系统执行策略，不注册全局服务。脚本命令示例：

```powershell
./scripts/local/start-windows.ps1 -RuntimeRoot E:/work/workproof-local -NoBrowser
./scripts/local/status-windows.ps1 -RuntimeRoot E:/work/workproof-local -AsJson
./scripts/local/stop-windows.ps1 -RuntimeRoot E:/work/workproof-local
```

## 运行目录

```text
institution/scaffold-system/scaffold-admin/target/scaffold-admin-*.jar
mysql/mysql-8.4.13-winx64/bin/mysqld.exe
garnet/net10.0/GarnetServer.exe
dotnet/                         # Garnet 所需便携 .NET 10
java/bin/java.exe               # 可选，优先于系统 Java
powershell/pwsh.exe             # 可选，优先于系统 PowerShell 7
sql/V1__init_schema.sql
sql/V2__seed_data.sql
native/workproof-inspector.exe  # 可选，机构证书内容检查工具
scripts/local/
state/                         # 当前用户私有账号、进程记录、启动锁
mysql-data/                    # 保留的本地数据，停止时不删除
logs/
temp/
```

旧 Actions 产物未内嵌 Vue/密码工具时，脚本保留 Python 网页代理和 Node/bcryptjs 初始化的兼容路径；新构建使用单 JAR，不再需要这两项。不能把新旧 JAR 同时放入 `institution/`。

## 本地隔离与故障处理

MySQL 为 `127.0.0.1:33307`，Garnet 为 `127.0.0.1:36379`，新 JAR 为 `127.0.0.1:18081`。旧包使用 18080 加 18081 代理。账号文件和运行目录限制为当前 Windows 用户访问；密码不通过命令行参数传入 MySQL 或 Java 工具。

启动/停止使用互斥文件锁。端口已被其他进程占用时停止启动并报告，不会结束其他应用。归属校验包括 PID、可执行路径、创建时间和父子进程链；兼容 Windows MySQL 包和 Java 启动器创建的子进程。陈旧记录和复用 PID 不授权停止进程。

首次仅导入本运行目录内识别为空的 `workproof_local`；不清空已有表，不重置已有账号、不连接外部数据库。若数据目录非空但结构不明，停止并保留现场。失败时查看 `logs/`，不要把账号文件或未经脱敏的完整日志上传到公开仓库。MySQL 正常关闭失败时，不强行杀库。

本地 HTTP 入口用于开发与验收。Word 安装仍需要受信任 HTTPS；这里没有自动导入证书或修改浏览器/Office 的信任配置。WPS、Word 真实宿主验收和生产机构权限业务仍见 [全阶段验收](ALL-STAGES.md)。

可选本地 HTTPS 准备脚本为 `prepare-local-https.ps1`；生成/复用 localhost 短期叶子证书后重启，JAR 同时提供 18081 HTTP 和 18443 HTTPS。证书信任另行明确确认，详见 [Word/WPS 接入](OFFICE-SERVER.md)。未信任前不绕过验证来宣称 Word 可用。证书到期时停止使用并显式更新，不静默替换已获信任的指纹。

本阶段证据：[Actions 41185301362](https://github.com/W-Boat/WorkProof/actions/runs/41185301362) 两个任务通过；本机从该次校验 SHA-256 的产物升级到单 JAR，已确认账号文件未变化、原管理员登录成功、未登录 API 返回 401、登出令牌失效，以及 MySQL 正常关闭后的完整重启。

## 许可与验证

运行时和 SDK 各自适用许可，见 [商业许可报告](COMMERCIAL-LICENSE-AUDIT.md)。启动器包带 WorkProof 与上游脚手架 MIT；这不替代 MySQL/JDBC、运行时和其他组件的分发义务。

所有编译和自动化测试在 Actions：真实构建 JAR+MySQL+Valkey 测试覆盖页面/资源/深链接、API 未登录拒绝、随机密码初始化与登录、缓存令牌登出失效；Windows 测试覆盖空格路径、父子进程归属、陈旧 PID 拒绝和进程树停止。Valkey CI 不替代 Windows Garnet 实机兼容验收。启动按钮本身也不等于所有宿主软件已经验收。

2026-10-31 恢复开发后，已从 [Actions 41205435537](https://github.com/W-Boat/WorkProof/actions/runs/41205435537) 升级至 `134112f` 的单 JAR（归档 SHA-256 `9e03f60dc78fb4ce6530afe882cba18452f4cafd99124c35d26eac5474180fd8`）。升级前确认进程停止并持有运行目录锁，保留上一 JAR；账号文件逐字节保持不变。本机重新启动后核对 HTTP/HTTPS、WPS 入口与 ribbon、原账号登录与令牌登出。HTTPS 请求仅为验收显式指定本机证书 CA 文件，不修改 Windows 信任。
