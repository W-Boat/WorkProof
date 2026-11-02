# 机构持久批量任务（新增源码，待 Actions 验收）

Windows 身份解析后续修正（待 CI）：提升权限的服务进程创建文件时，默认 owner 可能是 Administrators 组，因此不能用临时文件 owner 推断 Windows 服务用户。新增实现改用 JDK 17 `NTSystem` 原生读取当前用户 SID、域与名称，并解析对应个人主体，不依赖 `user.name` 或环境用户名。仅在原子创建成功的本次新空目录/文件上可将默认组 owner 设置为该服务用户，然后收紧并验证 ACL，之后才写入内容；任何既有或恢复路径仍禁止接管 owner。该方案依赖完整 JDK 的 `jdk.security.auth` 模块，缺失或身份解析失败时拒绝启用。[官方 API](https://docs.oracle.com/en/java/javase/17/docs/api/jdk.security.auth/com/sun/security/auth/module/NTSystem.html)。下述临时 owner 推断为前序实现，Windows 以后续结果为准。

跨平台权限新增源码：`PrivateJobSpool` 提供 Windows ACL 与 POSIX 私有权限后端，待新专项验证。Windows 仅允许文件系统分配给本进程新建文件的个人 owner，拒绝组 owner、其他主体的 ALLOW 授权、非服务 owner 与无法验证的权限提供器；不会取得其他 owner 所有权。既有目录需预先满足权限要求，不能通过启动隐式修复宽松权限。新空文件先收紧并验证，之后才写证书；恢复输入与锁文件也检查。OS 管理员及具有备份/所有权等系统特权的主体不在该 ACL 隔离模型内。父目录及卷必须由可信管理员配置，避免其他主体有权替换服务目录。Windows 全 JAR 队列生命周期仍未验收，不能仅凭权限探针将其标为可交付支持。

升级注意：旧实现创建的 `.queue.lock` 可能继承 0644 或 Windows 非私有 ACL，新实现会拒绝继续使用。需管理员在停止队列并完成备份后，将既有目录和锁文件按同一服务主体收紧；服务不会自动接管或修复既有宽松权限。原生探针的 other-owner 变更及所有 Windows reparse-point 类型尚未测量；Java `NOFOLLOW_LINKS` 与符号链接检测不等于完整文件系统隔离沙箱，也不承诺抵御有权修改祖先目录的并发攻击者。

最新验收：43d2434 的机构 Actions [41328284766](https://github.com/W-Boat/WorkProof/actions/runs/41328284766) 已全部通过。该配置实际调用 `test_institution_runtime.py`（含默认关闭时的新任务页面）及 `test_institution_jobs.py`（隔离V4、真实JAR/Rust、浏览器原字节上传与关闭重开、进程终止重启、owner隔离、幂等、取消、权限撤销与清理、后台审计无正文）。首次审计查询编码失败已经修正为utf8mb4。下方“待CI”是早期实现记录，以本段为当前组件验收状态；本机用户数据库仍未迁移V4，Windows持久队列与全部故障矩阵未完成。

原 `CertificateBatchDialog` 是页面内逐份发送，关闭页面会停止后续发送。本功能另建数据库持久任务和私有暂存目录，不能把原有浏览器队列的通过记录当作本功能验收。

## 准备

默认 `WORKPROOF_JOBS_ENABLED=false`。仅在管理员核对原 V3 结构及备份后显式执行 `services/institution/scaffold-system/sql/V4__workproof_certificate_jobs.sql`，再配置：

```text
WORKPROOF_CATALOG_ENABLED=true
WORKPROOF_JOBS_ENABLED=true
WORKPROOF_JOBS_SPOOL=/absolute/private/workproof-jobs
WORKPROOF_VERIFIER_EXECUTABLE=/absolute/workproof-inspector
```

V4 新增 `wp_certificate_job` 和 `wp_certificate_job_item`，不改原证书摘要表、账号或角色授权。准备检查核对所需字段及主键、owner/clientKey、spool token 唯一索引；不替代完整迁移/备份审计。现有 Windows V3 准备脚本不自动支持 V4，禁止以普通启动隐式迁移。

当前持久暂存目录要求支持 POSIX 私有权限（目录0700、文件0600）；不支持时拒绝启用，不冒称 Windows ACL 已验收。目录及数据库同时独占锁，只允许一个活跃队列实例。运行中丢失专用数据库锁则拒绝结果提交，随后释放失效连接重新获取锁并恢复 running 项；不是多节点高可用队列。原子改名与文件 force 降低崩溃窗口，但不承诺任意文件系统/机器断电下硬件级持久性。

## API

前缀 `/api/workproof/certificate-jobs`，均受原认证保护，统一 `R` 返回。能力/列表/详情需 `workproof:certificate:list`；写入/提交/取消需 `workproof:certificate:add`，新建还要求 list。后台每项执行前及提交结果时重新查询账号是否有效且仍有 add/list，不保存 JWT，不伪造 SecurityContext，也不使用默认 ALL 数据范围。

| 请求 | 用途 |
|---|---|
| GET /capabilities | ready/message/maxFiles/maxFileBytes/maxTotalBytes |
| POST / | JSON `{clientKey:UUID,consent:true,expectedItems:1..20}`，新建或幂等取得草稿 |
| PUT /{id}/items/{index} | octet-stream 原证书字节，index 从0开始；相同序号相同字节可重试，不同字节409 |
| POST /{id}/submit | 收齐 expectedItems 且序号连续后封存清单并排队 |
| GET / | 当前账号最近100个任务的数组 |
| GET /{id} | 读取自己的持久任务及子项 |
| DELETE /{id} | 持久取消请求，停止后续项并中断当前检查 |

任务严格 owner 隔离，包括 ALL 范围管理员不能读取另一 owner 的上传任务；越权与不存在均404。后台摘要写入原提交账号和提交时部门，已有证书列表继续使用原统一数据范围，不扩大部门权限。任务响应不返回暂存路径、原字节、正文或完整原生报告。

响应 Job 包含 id/state/expectedItems/totalItems/completedItems/cancelRequested/cleanupPending/totalBytes/createdAt/items；子项 index/state/catalogId/message/cleanupState。completedItems 仅指检查状态已结束，不表示临时文件已经删除，须同时查看 cleanupPending 与任务终态。

## 生命周期与故障

上传仅暂存草稿；未上传文件不可能在关页后继续。明确提交获接受后任务由服务器调度，关闭页面或注销不取消已经封存的工作。单任务最多20项、每项32MiB、合计64MiB；全实例最多8个非终态任务，每owner最多4个。暂存文件只用服务器UUID路径，无客户端文件名或任意路径。

任务 draft→queued→running→completed/partial/cancelled，删除失败显示 cleanup_failed 并持续重试。子项 queued/running→saved/failed/cancelled，原文件删除后 cleanupState=deleted。已完成检查的摘要和子项结果在同一数据库事务提交；原摘要 owner/proof 唯一约束保持重试幂等。重启重新领取残留 running，claim token 及数据库锁身份防止旧实例提交；检查可能至少运行一次，不承诺 exactly-once 执行。

取消不撤回已保存的摘要。取消运行项会中断该任务线程，原生检查 finally 结束受控子进程；未开始项取消并清理。重启后的取消标志仍有效。原件完成后立即删除；草稿1小时过期后取消清理；无数据库引用的UUID暂存文件超过1小时清理。元数据和任务摘要当前不自动到期删除，需机构制定保留政策；备份私有spool会包含待处理证书，应按敏感输入管理，数据库备份不包含原件。

调用统一 OperationLogRecorder 记录队列恢复、子项结束与任务结束，参数为[]，不复制输入或异常文本；后台审计随业务事务落盘。日志不可代替签名或人类创作认定。

## 隔离验收入口

本会话未提供 mysql 技能，源码仅根据已核对的 V3 SQL/mapper设计，不操作用户本机数据库。`scripts/test_institution_jobs.py` 强制 GITHUB_ACTIONS=true、DB_NAME=workproof_ci、DB_HOST=127.0.0.1；先只读核对数据库身份和 SHOW CREATE TABLE 原V3，再在隔离库显式执行V4两次、确认已有账号未改变。脚本自行启动18091专用JAR，使用单独临时spool和真实Rust检查器，重启实际JAR验证durable任务，检查owner隔离、上传幂等、期望项数、摘要去重、取消、停用账号后停止与原文件清理。

调用位置：现有机构 workflow 完成原 `scripts/test_institution_runtime.py` 初始化/回归后，保留同一隔离 MySQL/Valkey、原native及打包JAR，另执行 `python scripts/test_institution_jobs.py`。无需安装额外Python包。不向公开产物上传spool、账号、SQL备份或证书内容。测试仍待CI运行；计划覆盖不等于已通过。断电、磁盘满、删除故障、所有部门变动和Windows持久队列仍需后续专项，不能称整个机构阶段已完成。
