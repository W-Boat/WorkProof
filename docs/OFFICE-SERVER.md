# Word/WPS 优先交付与服务器接入

机构端沿用导入的 Spring Boot + Vue 底座。CI 将 `apps/office` 的生产包放入机构 JAR 的 `/office/` 静态资源目录；后台管理仍使用既有认证与权限链。

服务运维人员需要提供真实机构域名和 HTTPS 配置，将 `WORKPROOF_PUBLIC_ORIGIN` 设为来源地址，例如 `https://workproof.example.edu`（示例，不能用于实际安装）。启动后通过 `/office/manifest-word.xml` 获取 Word 任务窗清单，再使用 Microsoft 365 集中部署或宿主允许的安装方式向用户分发。未配置有效 HTTPS 来源时，清单端点明确返回 503。

没有进行服务器登录或生产部署。本次只准备服务能力；部署手册、数据库初始化、初始管理员密码、备份和升级策略须完成后才能进行真实部署。不能以“已打包”代替“已部署”。

本地 Word 验收使用 `scripts/local/prepare-local-https.ps1 -RuntimeRoot <运行目录>` 准备仅含 localhost/127.0.0.1、有效期 30 天的自签名叶子证书和配置。不会自动导入 Windows 信任。新 JAR 可同时绑定 HTTP `127.0.0.1:18081`（后台）和 HTTPS `127.0.0.1:18443`（加载项）。停止并重启机构进程应用配置后，Word 清单为 `https://localhost:18443/office/manifest-word.xml`。私钥位于当前用户私有运行目录，不进入仓库、CI 产物或证书信任库。

`Trust localhost.cmd` 会先显示证书指纹、有效期和当前用户 Root 信任库的变更范围，用户确认后才导入公钥证书；`Remove localhost trust.cmd` 可移除同一证书。自动化代理不得以任务授权代替该证书信任确认。此流程仅用于本机验收，服务器仍需要真实域名和受信任证书。证书准备和 HTTPS 资源检查不等于 Word 已实际加载插件。

本机证书获准信任后，`Install Word add-in.cmd` 从受信任的本地 HTTPS 获取并核对 WorkProof Word 清单，再向当前用户 `Software\Microsoft\Office\16.0\Wef\Developer` 注册固定 WorkProof ID；`Remove Word add-in.cmd` 只撤销该 ID 且拒绝移除另一个目录的安装。不会清理全局缓存、启用调试器、更改全局策略或关闭现有 Word 文档。机制参照 [Microsoft Office 开发工具的 Windows 注册实现](https://github.com/OfficeDev/Office-Addin-Scripts/blob/master/packages/office-addin-dev-settings/src/dev-settings-windows.ts)，不是机构生产集中部署。进入 Word 的“开始 → 加载项 → 高级 → 开发人员加载项”选择 WorkProof；若 Word 已打开，保存文档后自行重新打开。宿主政策或具体版本仍可能限制侧载，不能据注册成功推断真实采集已成功。

普通用户从宿主中打开 WorkProof，首次连接在本机桌面窗口点击允许。来源网址必须显示完整，并与用户正在使用的机构加载项一致。此连接不会上传作品。Office 官方运行库依照 Microsoft 要求从官方 CDN 加载；断网时能否启动已安装的加载项依赖宿主缓存，不能承诺 Word 加载项完全离线启动。

WPS 推荐使用官方 publish 分发方式；`jsplugins.xml` 在部分新版本受限制，不能通过静默修改 OEM 配置宣称通用兼容。后续发布包使用官方发布工具和相应授权条款，不将上游工具代码归入本项目 MIT 授权。

### WPS 原生入口与独立验证包

`apps/office/wps/` 提供 WorkProof 自有的 `main.js`、`ribbon.xml` 和项目元数据。Office 构建将其放到 `/office/wps/`，由功能区按钮打开同一来源的 `/office/index.html?host=wps`。任务窗会复用，原生句柄失效时重建；宿主拒绝调用时显示可重试错误。入口不会读取查询参数指定的外部网址。接口依据 [WPS 任务窗格说明](https://open.wps.cn/documents/app-integration-dev/wps365/client/wpsoffice/jsapi/addin-api/TaskPane/task-pane-overview)；发布目录保留在线模式检查需要的 `index.html`。

共享采集器支持 `Application`、`wps` 根对象和 `WpsApplication()`，WPS 明确模式下接口缺失会直接报错，不加载微软运行库。保存未完成、文件路径变化、空文件或非字节字符串会取消导出；暂停后切换文档会拒绝续录，要求重新开启任务窗。文字只用于本机临时统计和摘要，不写入事件请求。

在 Actions 手动运行 **Word and WPS package validation**，填写实际 HTTPS 来源。该流程仅在 CI 类型检查、打包并运行模拟宿主测试，产物 `workproof-office-package` 包含共享页面、Word 清单和 WPS 原生入口。示例来源 `https://localhost:18443` 只适用于本机 HTTPS 验收；部署前需按真实来源重新生成 Word 清单。本包不含 WPS 官方安装页、不执行宿主安装，也不代表真实 WPS 验收通过。

`wpsjs@2.2.3` 包内许可与 npm 声明有冲突，生成模板的分发条件尚待确认，因此本工作流不安装该工具、不包含上游模板或其示例加载项。正式 publish 页面仍待许可确认和真实宿主验收。官方推荐发布流程及版本范围见 [WPS 加载项开发说明](https://open.wps.cn/documents/app-integration-dev/wps365/client/wpsoffice/wps-integration-mode/wps-addin-development/wps-addin-development-instructions)。不能以本入口包宣称所有 WPS 版本可点击安装。

性能结果 `41180459986`：Windows CI 的关闭状态窗托盘模式工作集约 16.2 MB，3 秒采样内未测到明显空闲 CPU，128 事件批次端到端 p95 17.589 ms（包括 PowerShell、HTTP 和 SQLite 持久化开销）。该结果不是 Office/WPS 宿主性能数据，也不能替代用户机器测量。

验证记录：HTTPS/HTTP 双监听、真实 Word XML 与资源、默认信任拒绝及 API 鉴权通过 [41186723953](https://github.com/W-Boat/WorkProof/actions/runs/41186723953)；Word 清单校验、只操作固定 ID 的安装/撤销、拒绝覆盖其他目录的安装和保留无关注册项通过 [41187531600](https://github.com/W-Boat/WorkProof/actions/runs/41187531600)。本机 HTTPS 已运行，公共清单已导出到私有运行目录 `office/manifest-word.xml`；证书 SHA-256 为 `A41F140979718BA6724112E0C617C6620E5165A0FB5E348E7112027D5DE59583`，有效至 2026-11-30。本机 Word 文件版本为 `16.0.20430.20182`，仍待明确证书信任确认与真实宿主操作；没有把注册表测试当作 Word 加载成功。
