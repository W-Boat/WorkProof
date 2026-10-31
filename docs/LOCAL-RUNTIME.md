# WorkProof 本地机构后台

本机入口：[http://127.0.0.1:18081/login](http://127.0.0.1:18081/login)。这是机构后台，不是桌面记录引擎；本地记录引擎的端口仍为 43127，停止机构后台不会停止记录。

## 运行方式

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

## 许可与验证

运行时和 SDK 各自适用许可，见 [商业许可报告](COMMERCIAL-LICENSE-AUDIT.md)。启动器包带 WorkProof 与上游脚手架 MIT；这不替代 MySQL/JDBC、运行时和其他组件的分发义务。

所有编译和自动化测试在 Actions：真实构建 JAR+MySQL+Valkey 测试覆盖页面/资源/深链接、API 未登录拒绝、随机密码初始化与登录、缓存令牌登出失效；Windows 测试覆盖空格路径、父子进程归属、陈旧 PID 拒绝和进程树停止。Valkey CI 不替代 Windows Garnet 实机兼容验收。启动按钮本身也不等于所有宿主软件已经验收。
