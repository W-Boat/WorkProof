# Word/WPS 优先交付与服务器接入

机构端沿用导入的 Spring Boot + Vue 底座。CI 将 `apps/office` 的生产包放入机构 JAR 的 `/office/` 静态资源目录；后台管理仍使用既有认证与权限链。

服务运维人员需要提供真实机构域名和 HTTPS 配置，将 `WORKPROOF_PUBLIC_ORIGIN` 设为来源地址，例如 `https://workproof.example.edu`（示例，不能用于实际安装）。启动后通过 `/office/manifest-word.xml` 获取 Word 任务窗清单，再使用 Microsoft 365 集中部署或宿主允许的安装方式向用户分发。未配置有效 HTTPS 来源时，清单端点明确返回 503。

没有进行服务器登录或生产部署。本次只准备服务能力；部署手册、数据库初始化、初始管理员密码、备份和升级策略须完成后才能进行真实部署。不能以“已打包”代替“已部署”。

本地 Word 验收使用 `scripts/local/prepare-local-https.ps1 -RuntimeRoot <运行目录>` 准备仅含 localhost/127.0.0.1、有效期 30 天的自签名叶子证书和配置。不会自动导入 Windows 信任。新 JAR 可同时绑定 HTTP `127.0.0.1:18081`（后台）和 HTTPS `127.0.0.1:18443`（加载项）。停止并重启机构进程应用配置后，Word 清单为 `https://localhost:18443/office/manifest-word.xml`。私钥位于当前用户私有运行目录，不进入仓库、CI 产物或证书信任库。

`Trust localhost.cmd` 会先显示证书指纹、有效期和当前用户 Root 信任库的变更范围，用户确认后才导入公钥证书；`Remove localhost trust.cmd` 可移除同一证书。自动化代理不得以任务授权代替该证书信任确认。此流程仅用于本机验收，服务器仍需要真实域名和受信任证书。证书准备和 HTTPS 资源检查不等于 Word 已实际加载插件。

本机证书获准信任后，`Install Word add-in.cmd` 从受信任的本地 HTTPS 获取并核对 WorkProof Word 清单，再向当前用户 `Software\Microsoft\Office\16.0\Wef\Developer` 注册固定 WorkProof ID；`Remove Word add-in.cmd` 只撤销该 ID 且拒绝移除另一个目录的安装。不会清理全局缓存、启用调试器、更改全局策略或关闭现有 Word 文档。机制参照 [Microsoft Office 开发工具的 Windows 注册实现](https://github.com/OfficeDev/Office-Addin-Scripts/blob/master/packages/office-addin-dev-settings/src/dev-settings-windows.ts)，不是机构生产集中部署。进入 Word 的“开始 → 加载项 → 高级 → 开发人员加载项”选择 WorkProof；若 Word 已打开，保存文档后自行重新打开。宿主政策或具体版本仍可能限制侧载，不能据注册成功推断真实采集已成功。

普通用户从宿主中打开 WorkProof，首次连接在本机桌面窗口点击允许。来源网址必须显示完整，并与用户正在使用的机构加载项一致。此连接不会上传作品。Office 官方运行库依照 Microsoft 要求从官方 CDN 加载；断网时能否启动已安装的加载项依赖宿主缓存，不能承诺 Word 加载项完全离线启动。

WPS 推荐使用官方 publish 分发方式；`jsplugins.xml` 在部分新版本受限制，不能通过静默修改 OEM 配置宣称通用兼容。后续发布包使用官方发布工具和相应授权条款，不将上游工具代码归入本项目 MIT 授权。

性能结果 `41180459986`：Windows CI 的关闭状态窗托盘模式工作集约 16.2 MB，3 秒采样内未测到明显空闲 CPU，128 事件批次端到端 p95 17.589 ms（包括 PowerShell、HTTP 和 SQLite 持久化开销）。该结果不是 Office/WPS 宿主性能数据，也不能替代用户机器测量。
