# 机构证书业务：内容预检

## 进行中的证书摘要索引（待 Actions 验收）

新增 `V3__workproof_certificate_catalog.sql`，经管理员核对结构和备份后显式执行；默认 `WORKPROOF_CATALOG_ENABLED=false`，不自动迁移用户数据库。启用后支持检查并保存摘要、分页检索、详情及 CSV 导出。只保存通过检查的文件名、指纹、原字节 SHA-256、范围、操作数、提交账号和提交时部门；不保存作品、原证书或过程正文。保存时间是服务器接收时间。相同账号重复提交相同字节返回原条目；原签名相同的完整/部分文件有不同条目。

新增权限 `workproof:certificate:list/add/export`，沿用 inspect；迁移登记菜单但不向普通角色授权。查询/详情/导出统一按提交账号与提交时部门执行底座 ALL/SELF/DEPT/子部门/自定义数据范围，越权编号与不存在条目使用同样错误。导出最多 5000 条，超过须缩小范围；CSV 复用公共编码并保护公式文本。列表字段 `ownerUserId` 提交者、`deptId` 提交时部门、`fileName` 声明文件名、`certificateId` 签名指纹、`proofHash` 本次文件摘要、`scope` 检查范围、`checkedAt` 保存时间；三个真实性边界始终 false。

此增量尚未验收或部署本机；下文描述前一已验收的独立内容预检。真正批量任务尚未实现。

当前已实现机构工作台里的“检查一份证书”：选择 `.wproof`、明确同意发送、查看结果。复用管理端的权限按钮、表单弹窗、字段、勾选框、状态标签与统一 HTTP 客户端。只发送所选证书的原字节，不发送作品，不把证书转成 JavaScript 数字再重新编码。

这是证书入库前的真实密码学检查。证书索引入库、检索、批量任务与数据范围过滤仍在后续阶段；没有用预检结果替代这些功能。本阶段不创建业务表，也不修改本机已有表结构。

## 检查范围

Rust 的 `workproof-inspector` 是一次性工具，只读 stdin、输出有界 JSON；不启动采集端口、不打开作品、不读取私钥或 SQLite。它复用现有 v1/v2/v3 与部分证据核验算法，不在 Java 中重写算法。

证书清单中声明的作品指纹只用于检查证书内部的一致性。返回值始终为 `artifact_checked=false`、`identity_verified=false`、`time_verified=false`，不提供容易误解的 `file_match=true`。完整记录与本次分享的部分记录分别显示；部分证据不声称完整链通过。

Java 使用受控进程参数而非 shell，不向子进程继承数据库密码或 JWT 等服务环境，限制同时两份检查、证书 32 MiB、结果 16 KiB、原生检查 15 秒。子进程异常、超时、版本不符或错误声称检查了作品时拒绝返回成功结果。应用关闭时结束自己的子进程。15 秒限制针对原生处理；HTTP 上传时间还应按服务器和反向代理配置限制。

文件名限制用于避免误把旧采集引擎当检查工具，并非对可执行文件的身份认证。管理员须使用经过摘要核对的可信构建产物。新 `workproof-engine` 对未知命令直接退出，不再误启动记录服务。

## 管理员配置

配置 `WORKPROOF_VERIFIER_EXECUTABLE` 为 `workproof-inspector` 或 `workproof-inspector.exe` 的绝对路径。工具按服务器的操作系统和架构选择；不能在 Linux 配置 Windows 文件。Unix 解压后需要保留或恢复执行权限。未配置时后台其他功能照常启动，检查按钮显示准备状态，不伪装成已检查。

本机 Windows 运行目录可放置 `native/workproof-inspector.exe`，现有 `start-windows.ps1` 会向机构进程传入该路径。原有未准备该文件的运行目录不会自动安装或下载程序。

权限码为 `workproof:certificate:inspect`。超级管理员按底座原规则可用；其他角色需通过已有菜单/按钮权限管理配置，接口不会向所有登录用户默认开放。预检不查询已存证书，因此此阶段没有可被绕过的证书列表数据范围；后续索引必须使用底座数据权限。

## API 与字段

| 接口 | 用途 |
|---|---|
| `GET /api/workproof/certificates/capabilities` | 已配置状态、文件上限、并发上限与可读提示；不返回可执行路径 |
| `POST /api/workproof/certificates/inspect` | `Content-Type: application/json`，body 为原始证书字节；返回统一 `R` 结构 |

接口成功表示检查已完成，证书是否一致由 `certificate_valid` 决定；不能仅凭外层 `code=200` 判断证书通过。

| 字段 | 中文含义 |
|---|---|
| `protocol` | 结果格式 `workproof-inspection/1` |
| `certificate_valid` | 证书内部内容一致，不代表作品、作者或时间被确认 |
| `artifact_checked` | 是否读取作品；此接口始终为 false |
| `identity_verified` / `time_verified` | 作者身份 / 实际时间是否确认；均为 false |
| `signature_valid` | 签名是否一致 |
| `chain_valid` | 完整记录链是否一致；部分证据为 false |
| `merkle_valid` | 记录集合/所选记录归属是否一致；旧版为 null |
| `scope` | `full` 全部、`selective` 部分、`unknown` 无法识别 |
| `disclosed_events` / `total_events` | 本次提交 / 清单声明的记录数量 |
| `manifest` | 有界的签名清单；格式无效时不回显用户任意大字段 |
| `certificateId` | SHA-256(签名字节)，与网页分享指纹一致；不代表披露范围相同 |
| `errors` | 内部原因码；普通界面使用可读说明 |

原生工具还输出公开签名供 Java 计算指纹，Java 响应移除此字段；不返回记录数组。无权限返回 403，未登录 401，容量满 429，未配置/工具失效 503，原生超时 504。过大请求按业务错误拒绝；网络层还应设置上传上限。

## 审计与验证

复用 `@OperLog`，新增可复用 `recordParams=false` 开关。此接口只记录谁、何时、执行了哪项操作及操作是否完成，不复制证书字段或正文到操作日志；操作完成不等于证书一致。业务索引的入库和复核结论需要后续单独记录。

已通过 [完整验证 41274280942](https://github.com/W-Boat/WorkProof/actions/runs/41274280942) 与 [机构验证 41274810400](https://github.com/W-Boat/WorkProof/actions/runs/41274810400)：Rust 内容预检/旧版/部分证据/篡改/大小边界；Java 误配置、结果契约、大小与超时；真实 JAR/MySQL/原生 Rust 链路、低权限拒绝、无证书内容审计；真实 Vue 弹窗的鼠标/键盘同意发送、原 Blob 摘要与长度、部分范围、错误状态与手机布局。MySQL 技能当前不可用，测试只使用原已知 SQL 初始化的隔离 `workproof_ci`，不操作用户现有库。
