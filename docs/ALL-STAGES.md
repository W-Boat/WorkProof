# 全阶段实施与验收

## 当前范围索引（2026-11-10）

全阶段目标仍未完成。下文按开发时间保留历史，其中较早“未实现”“待验收”不能覆盖以下专题的后续证据，也不能把单平台或测试夹具成功扩展为所有环境可用。

- **品牌与桌面**：生成品牌资源已在桌面、站点和 Windows 图标中接入；Fluent 工作区、内置 Word/Markdown 编辑器、动作记录与导出见[编辑器](DESKTOP-EDITOR.md)和[长文压测](EDITOR-STRESS-RESULTS.md)。压测数据来自特定 CI 环境，不证明所有 Windows 输入法、复杂排版或低内存机器的性能。
- **宿主适配**：VS Code、Word/PowerPoint、WPS、Photoshop、Blender 均有对应源码和验收边界。Word/PPT 原生加载项与 Office.js/WPS 加载项是不同分发路径；WPS 工具许可和真实版本覆盖尚有缺口。见[Word 原生](WORD-NATIVE.md)、[Office 服务](OFFICE-SERVER.md)及 `apps/photoshop`、`apps/blender` 的宿主说明。不能以模拟 API 验收代替真实软件安装验收。
- **证据互操作**：PNG/JPEG/受限 PDF 的原生和浏览器 C2PA 路径已分项验收，见[C2PA](C2PA.md)；RFC 3161 手工及可选直接申请路径见[时间凭据](TIMESTAMPS.md)。独立信任根、公共服务鉴权/CORS、吊销和长期验证仍有边界，不提供自动公共身份认证。
- **机构底座与交付**：继续采用 scaffold-master 的权限、审计和统一 Vue 组件，通过受控原生进程复用 Rust 核验。最新已下载核对的 [05978c8 服务器包](INSTITUTION-DELIVERY-05978c8.md)包含回执、只读签发配置和独立密钥备份；默认不启用签发或 AI。旧可选 AI 环境不能视为已与此新版基础镜像配套。
- **签发身份**：独立密钥加密恢复、恢复后 HTTP 签发、重启保持、权限退化和中断保护已通过上述版本验收。新增明确创建身份的 `452114e` 与恢复部署中明确加载独立恢复身份的 `17c2e5f` 尚在 Actions；源签发密钥和数据库快照的绑定、联合恢复、普通角色授权入口、托管/轮换/吊销仍未完成。见[回执说明](INSTITUTION-RECEIPTS.md)。
- **辅助判断**：已有有限模型、元数据线索及独立中英文评估，不等于“大多数开源检测方法”已接入。见[校准结果](AI-CALIBRATION-RESULTS.md)、[LRR 评估](LRR-EVALUATION-RESULTS.md)。未通过评估的方法不进入默认判定，行为规则仍不能被称为已证明有效的真人识别标准。
- **正式发布缺口**：商业代码签名、公开分享部署、官方信任发布渠道、真实宿主全版本验收和生产签发身份需要独立配置、凭据或进一步开发。许可边界见[商业许可审查](COMMERCIAL-LICENSE-AUDIT.md)，来源证明边界见[信任模型](TRUST-MODEL.md)。

下一步首先完成当前签发身份两轮 Actions 并处理失败，再推进源身份与部署备份的关联及恢复；宿主正式分发、更多检测方法及误报评估仍保留在原目标中，不以本轮机构回执交付替代。

后续确认：`452114e` 的 42746441860 与 `17c2e5f` 的 42746801236 已全部成功，分别覆盖明确创建签发身份，以及真实部署恢复后显式加载独立恢复的合成身份并通过 HTTP 签发。v2 密钥包和部署备份摘要关联的 `d76b506` 仍在 42747308542 验收；源密钥连续性和原子联合备份尚未证明。

## 桌面编辑器交付更新（2026-11-06）

两层编辑栏修复的交付源码为 `0059dd0`。[三浏览器回归 42221813143](https://github.com/W-Boat/WorkProof/actions/runs/42221813143) 的 144 项界面检查通过，覆盖提示自动消失、保存重试、浮动侧栏不遮挡命令、窗口变化恢复偏好、宽屏布局与编辑引擎按需加载；该运行与交付包的桌面源码相同。[Windows 完整包 42220220448](https://github.com/W-Boat/WorkProof/actions/runs/42220220448) 三任务全部通过，产物 `13504341607` 已在本机核对外层摘要、全部 2526 个包内文件摘要及 Wasm 来源，再解压到 `E:/work/WorkProof-Delivery/WorkProof-PC-0059dd0`。用户确认退出旧版后，新版工作台已启动并响应，监听 43127 端口的进程与新版路径一致，当前桌面快捷方式及 Word/PPT 用户级注册已更新。[验收与哈希明细](ACCEPTANCE-EDITOR-TWO-ROWS.md)。后续 Linux 原生交互检查仍由完整回归运行，不能用浏览器结果代替全部跨平台验收。

以下段落保留此前桌面交付记录。

后续源码 `6e900d6` 的[桌面回归 42157555162](https://github.com/W-Boat/WorkProof/actions/runs/42157555162)已通过 126 项三浏览器测试、18 项引擎测试和 5 项动作合并测试。覆盖整窗 70% 编辑画布布局、精简模式及恢复、外部应用记录统一列表与分页、字体与链接编辑、图标说明和内嵌主题同步。[Windows 完整便携包 42157555155](https://github.com/W-Boat/WorkProof/actions/runs/42157555155)三任务成功。产物 `13475568695` 外层 SHA256 为 `771ffd31dc52baf693898c71eb663429222b83c21cf68a2b7a2a7854ba72105f`，内层包为 `eafde8077e5490ba1dcbeab74a3ef859283e709c14da9b80428e6d0dee15a424`，全部 2526 项文件摘要已核对。本机包位于 `E:/work/WorkProof-Delivery/WorkProof-PC-6e900d6`，桌面快捷方式和 Word/PPT 用户级加载项注册已更新，用户确认退出旧版后，新版工作台已从该目录启动并正常响应，127.0.0.1:43127 监听进程与新版主进程一致。

后续 `57d50c6` 对收起导航栏的图标居中增加样式与位置检查，[三浏览器回归 42158955972](https://github.com/W-Boat/WorkProof/actions/runs/42158955972)已通过；该后续样式未包含在上述 `6e900d6` 安装包。Linux 原生核验页演示按钮激活仍待新验收，`264588e` 增加布局就绪、原生键盘交互与有界失败诊断，由[完整回归 42158434821](https://github.com/W-Boat/WorkProof/actions/runs/42158434821)验证。

Windows 应用源码 `0e3b3cb` 的 [完整便携包 42087118637](https://github.com/W-Boat/WorkProof/actions/runs/42087118637) 三任务成功。GitHub 产物 `13445035738` 外层 SHA256 为 `a4fc0750f5bb778d0baccd9140c417c3969d0564d7e09b5a75e2e490dc681366`，内层包 SHA256 为 `3b71f248b5cfc882dcb187658a06fa7075361c8c79639a690d762878df3b47f4`。本机已核对全部 2526 项文件摘要、Word/PPT 32/64 位 DLL 与 Wasm 来源，解压于 `E:/work/WorkProof-Delivery/WorkProof-PC-0e3b3cb`。桌面“WorkProof 新编辑器”入口及 Word/PPT 用户级注册已更新，实际工作台窗口启动并响应。真实宿主中的新版侧栏、主题与 DPI 仍待验收。

该应用代码的 [三浏览器回归 42088521084](https://github.com/W-Boat/WorkProof/actions/runs/42088521084) 72 项通过，测试提交 `504d84d` 修正测试夹具的 DOM 名称遮蔽，应用代码与 `0e3b3cb` 一致。覆盖 Word/Markdown 切换、源码保存、Word 富文本真实往返、自动/手动折叠、减少动态效果与动作流程展示。Rust 编辑器 6 项及动作合并 5 项通过。内置编辑器正文和原始动作保存在本机，导出证书仅包含对应摘要与统计。详见[编辑器能力与格式限制](DESKTOP-EDITOR.md)。

Linux 原生验收此前仍使用旧就绪文字和独立窗口入口，已在 `46b1513` 更新为当前 Fluent 工作区与内嵌核验页流程，并保留独立窗口的篡改、文件选择、导航及命令隔离检查。[完整回归 42088686622](https://github.com/W-Boat/WorkProof/actions/runs/42088686622)六任务全部通过，包含协议/网页、资源准备、Windows、Linux 和 macOS ARM/Intel 桌面包。Linux 已覆盖实际安装包与原生 WebView 流程，其余平台仍按各任务的实际自动化范围和宿主人工验收范围区分。当前桌面证据覆盖范围以本节为准，下方保留历史阶段记录。

本机对实际打开的 `0e3b3cb` 工作台做了 5.02 秒只读进程采样，7 个进程的私有内存合计 262.00 MiB，工作集相加为 462.41 MiB（含共享页重复计算），CPU 累计增量 0.0469 秒；Rust 主进程私有内存为 6.88 MiB。该记录覆盖当前打开界面的会话，后台收起、录制、大文档与最坏场景尚需分别采样。

## 当前状态（2026-11-03）

最新服务器 e9a4fdc ZIP 已下载核对，外层 GitHub 摘要和包内 24 个文件摘要均一致，包含 V3/V4 准备与恢复工具、外部依赖镜像来源和验收记录；未本地运行镜像或替换旧部署。详见[交付核对](INSTITUTION-DELIVERY-e9a4fdc.md)。这替代下方旧“既有下载包未升级”的状态，旧包仍保留为独立历史交付。

最新 V4 源码 `e9a4fdc` 的[机构 Actions 41585722953](https://github.com/W-Boat/WorkProof/actions/runs/41585722953)三任务全部通过，含实际已提交 running 任务的受控单容器强杀→停止备份→新项目自动恢复完成，原草稿仍需手动提交；同时通过 4 项任务记录/归档检查。此结果替代下方旧“正在运行”记录，不覆盖主机断电、数据库故障、所有强杀时机或原孤立文件过期时钟。既有下载包未因此升级，仍需新的归档核对。

V4 首次[机构任务 41584947048](https://github.com/W-Boat/WorkProof/actions/runs/41584947048)在 lifecycle 失败。审查确认覆盖拒绝测试误把响应体业务码 409 当作 HTTP 状态，已按共享异常处理契约修正为 HTTP 400/业务 409；不将这一发现当作全部失败原因。源码 `e9a4fdc` 的[修正版 41585722953](https://github.com/W-Boat/WorkProof/actions/runs/41585722953)正在实际部署验收，同时新增已提交 running 任务的受控单容器强杀、停止备份与新项目自动恢复检查。下方旧“正在运行”是历史记录，当前仍不得称 V4 通过。

V3 显式目录准备 `843fd8e` 的[机构 Actions 41583908029](https://github.com/W-Boat/WorkProof/actions/runs/41583908029)三任务全部通过，含真实目录 API、启用目录后的备份/新部署恢复及 4 项记录/加密归档测试。V4 批量任务源码 `6b7f7e9` 已接通显式准备、真实任务、草稿保留、`.proof`/`.tmp` 备份和恢复后显式提交，正在由[机构 Actions 41584947048](https://github.com/W-Boat/WorkProof/actions/runs/41584947048)验证。V4 尚不能称为通过；运行中任务强杀后的整套备份恢复、孤立文件原始过期时钟仍未证明。

打包补强 `fb70de6` 的[机构 Actions 41582489993](https://github.com/W-Boat/WorkProof/actions/runs/41582489993)已全部通过，替代下方当时“正在运行”的状态。已实际下载核对的服务器归档仍为 588e1b3，详见[交付核对](INSTITUTION-DELIVERY-588e1b3.md)；不能用后续代码更新冒充该归档已经升级。

`50a00c5` 的[机构 Actions](https://github.com/W-Boat/WorkProof/actions/runs/41567780644)三任务全部成功，实际服务器、停服加密备份及镜像内 9 项恢复暂存检查通过。归档认证和提取只向全新私有目录写入，不执行 SQL。随后新增完整新项目恢复及隔离验收，覆盖私有卷、空数据库导入、保持停止、显式启动登录、逐行比较及运行镜像固定。Git 推送已恢复，源码 `588e1b3` 的[机构 Actions 41581718623](https://github.com/W-Boat/WorkProof/actions/runs/41581718623)三任务全部成功，完整新项目恢复已在随机 Linux amd64 Docker/V1/V2 范围通过，不扩大为生产恢复、全部故障或跨版本升级。后续打包增量的[机构 Actions 41582489993](https://github.com/W-Boat/WorkProof/actions/runs/41582489993)正在运行。此前 verify-services 拒绝记录仍保留，不凭后续成功断言所有故障路径稳健。详见[服务器部署与恢复范围](INSTITUTION-SERVER.md)。

独立校准的[真实模型运行 41564917019](https://github.com/W-Boat/WorkProof/actions/runs/41564917019)三任务全部成功。留出集人工误报：中文 MPU 12/188、英文 MPU 10/191、Desklib 英文 10/191；AI 漏报分别为 2/192、15/192、27/192，详见[原报告与限制](AI-CALIBRATION-RESULTS.md)。每模型每批预先固定 384 份记录，先冻结阈值再评估，不将第一轮查看过的样本冒充留出集，也不自动启用生产阈值。这仍只覆盖监督分类方法及有限来源，不代表所有 AI 方法接入完成。

`50a00c5` 的[完整桌面与网页 Actions 41567780689](https://github.com/W-Boat/WorkProof/actions/runs/41567780689)五任务全部成功。实际 Linux 安装包的内嵌网页完成最新结果定位/焦点/清空流程及真实文件核验；原生选择器、下载/打印和其他平台 UI 实测仍未覆盖，详见[易用性证据](USABILITY.md)。

用户页流程 `5fe2c4e` 的[网页专项](https://github.com/W-Boat/WorkProof/actions/runs/41563038383)已通过，52 项浏览器用例全部成功，含结果定位/错误与清空焦点、多文件拖放、核验取消、主题、手机布局及真实 Wasm。源码 ba9c6e1 后的旧按钮断言与全页 alert 定位已修正；本次为网页专项，桌面任务跳过，不代表新版桌面安装包已验收。机构 `9361ae5` 的[真实模型网页](https://github.com/W-Boat/WorkProof/actions/runs/41561757332)和[常规回归](https://github.com/W-Boat/WorkProof/actions/runs/41561755724)全部通过，含 Desklib 单分数说明及原报告保留两值。下文待验收语句为当时状态，以本段为准。

首轮真实中英文基准 `50b4463` 的[三模型 Actions](https://github.com/W-Boat/WorkProof/actions/runs/41507079186)全部完成：每配置 192 份、完成 189 份；人工误报中文 MPU 13/93、英文 MPU 35/95、Desklib 31/95。固定上游规则、未独立校准，不能单独用于判定学术不端，完整分母/区间/范围见[实测报告](AI-BENCHMARK-RESULTS.md)。这只完成第一轮有限样本评估，不代表多类独立方法、现代模型全面覆盖或真实作业误报校准完成。

内嵌 Linux [扩展验收 41508432610](https://github.com/W-Boat/WorkProof/actions/runs/41508432610)通过实际文件输入、改动拒绝、原文件重选、480 像素窄窗与键盘滚动；应用源码 e4583b5，测试源码 3eab125，仍不覆盖操作系统原生选文件对话框、下载、打印和其他平台。结果自动定位与“查看核验结果”流程 ba9c6e1 已提交，待新网页回归。

本轮 UI 与来源线索：JPEG EXIF/注释/简单 XMP 的本机读取已通过 `46e43f0` 的 [48 项浏览器回归](https://github.com/W-Boat/WorkProof/actions/runs/41500803947)；中文属性卡片 `2bf862d` 的 [网页回归](https://github.com/W-Boat/WorkProof/actions/runs/41501143636)及特殊字段名补强 `d04efcf` 的 [回归](https://github.com/W-Boat/WorkProof/actions/runs/41501648469)也已通过。随后折叠范围说明导致旧测试匹配两个 summary，已在 `482ee1c` 用明确入口名称修正，新增 PNG/JPEG IPTC 来源自述识别已通过 482ee1c 的网页回归 41504396050（49 项浏览器用例）。Linux 实际安装的内嵌 WebView [验收](https://github.com/W-Boat/WorkProof/actions/runs/41498967934)通过打开、真实 Wasm、调用隔离、导航拒绝和窗口复用；系统文件选择/下载/打印及其他平台仍未据此验收。

Desklib 英文分类器、独立 sigmoid 类型与机构选择已经通过[真实模型及 Java](https://github.com/W-Boat/WorkProof/actions/runs/41502727303)、[常规机构](https://github.com/W-Boat/WorkProof/actions/runs/41502727546)与[显式三模型网页](https://github.com/W-Boat/WorkProof/actions/runs/41503104263)验收，未据此称作独立统计方法或证明检测效果。DetectRL-X 首轮有限中英文实测已经完成，结果与限制见本页开头；完整许可及原始语料权利仍待核查，独立校准、扩大人工样本、混合/改写和真实作业领域评估尚未完成。

用户最新优先顺序：先收住当前已提交的服务器原生导出验收，随后重点优化用户 UI、功能和网页内嵌体验，再推进多种 AI 检测方法、文件指纹/来源线索与中英文误报评估。交互继续以流程清晰、逻辑明确、文案普通人能懂为验收标准；桌面端、核验页与管理端优先复用已有组件和能力。未完成的完整备份恢复、宿主适配、证据互通与发布准备仍保留，不因此缩小总目标。AI 辅助判断与证书密码学核验事实分别呈现。

以下历史记录中的“待实现”“正在构建”只描述当时状态；当前交付范围先以本节及对应专项说明为准。全部阶段仍在进行，不以局部 Actions 通过宣称整项目标完成。

- 桌面与网页核验：`1e540ca` 的[四平台构建及协议/网页流程](https://github.com/W-Boat/WorkProof/actions/runs/41448127361)已通过；`65d4a0d` 的[网页复验](https://github.com/W-Boat/WorkProof/actions/runs/41450271607)覆盖取消后迟到的旧 Worker 结果与错误不能污染新结果。普通证书、结构补充与 C2PA 浏览器 Wasm 已随同版本工作包提供。公开身份信任、撤销与长期验证仍不因此完成。
- Word / PowerPoint：`ab27ccb` 的[完整工作包](https://github.com/W-Boat/WorkProof/actions/runs/41480934601)已通过，下载归档的 2,421 个文件摘要及四份 DLL 的实际 PE 位数已核对。复制安装、文件占用保护和包内网页核验均已通过；支持范围为 64 位 Windows 上的 x86 / x64 Office。COM / OLE 探针及隔离注册不是所有真实 Office 版本验收。本机现用 DLL 未因此替换，详见[位数与验收范围](OFFICE-BITNESS.md)。
- VS Code：`ab27ccb` 的[协议与网页运行](https://github.com/W-Boat/WorkProof/actions/runs/41480963186)全部通过，含 43 项浏览器测试；`60752a7` 的[真实宿主运行](https://github.com/W-Boat/WorkProof/actions/runs/41491273659)也已通过。在官方 Linux stable 1.144.0 中实际安装 VSIX，经真实界面记录、暂停、导出，再由 Rust 核验并拒绝篡改；证据归档摘要已核对。该结论不扩大为 Windows/macOS 或所有历史版本验收。
- Blender / Photoshop：已增加显式选择的匿名结构补充文件、认证检查点和浏览器关系图。Blender 有真实宿主 CI；Photoshop 控制器与真实引擎的测试仍使用模拟 Adobe API。结构快照不包含完整参数树、所有编辑过程或完整几何体，也不等于代码 AST。详见[结构补充](EVOLUTION.md)及各适配器说明。
- WPS：自有功能区与共用任务窗入口已存在，正式点击安装发布尚未完成。替代候选 `wpsjs-rpc-sdk@1.1.31` 的精确官方发布包也缺完整许可/版权材料，尚未引入；不能只凭 ISC 元数据放行。详见[服务与发布说明](OFFICE-SERVER.md)。
- 机构服务器：`7a3e2df` 的[真实容器验收](https://github.com/W-Boat/WorkProof/actions/runs/41490325377)全部通过，222 MB 部署包已下载，12 个包内文件摘要、镜像配置摘要/源码标签/平台/UID 均匹配。覆盖随机账号、默认密码拒绝、真实核验、重启保留、非空库拒绝、秘密不进入日志；首次部署仅需 Docker 与 Compose，不在用户机器编译。目标为 Linux amd64 容器，未登录生产服务器；catalog/jobs/AI 默认关闭，V3/V4、完整备份恢复和正式启用仍待交付。详见[服务器手册](INSTITUTION-SERVER.md)。
- 加密与归档：`3b6630d` 的[容器验收](https://github.com/W-Boat/WorkProof/actions/runs/41492650775)全部通过。已验证认证后才解析归档、受限文件清单、权限和篡改拒绝；模块不执行 mysqldump、不恢复数据库，不能据此宣称完整备份或恢复已完成。实际备份编排尚未落盘。
- AI 辅助与本机状态：现有辅助模型能力保留；更多检测方法、近期中英文误报评估、元数据/水印线索仍需继续推进。用户本机 V4 未迁移，不用 CI 数据库验证替代本机迁移。

性能数字仅代表对应 CI 的测量范围；全部依赖商业分发审查仍未完成。用户约束保持不变：本机只编辑与检查源码/归档，构建和自动测试交给 GitHub Actions；不因新包生成而覆盖正在使用的宿主 DLL。

最新桌面增量：已加入图片内嵌证书的本地文件选择与显式 CA 核验入口。`794e7d0` 的 [Windows 专项 41390430072](https://github.com/W-Boat/WorkProof/actions/runs/41390430072) 已通过，真实 PNG/JPEG 完整及选择性证据报告已用于桌面解析兼容检查。四平台总流程正在修正文案断言后复验，真实点击流程与图片签署向导仍待完成。详见 [图片核验入口](IMAGE-VERIFICATION.md)。

最新跨平台复验：C2PA `6411293` 的 [专项 41386033416](https://github.com/W-Boat/WorkProof/actions/runs/41386033416) 四平台任务全部通过，macOS 真实信任校验失败已定位为合成 CA 配置重复扩展并修复。三种 Windows/macOS 开发包的归档及各 639 个文件摘要已核对。此结果覆盖独立图片工具，不覆盖 PDF、网页解析、桌面向导或公共身份信任，亦不表示全部阶段完成。

2026-11-02 最新交付：Word/PPT 原生安装包源码 `6ac8c59` 的 [Actions 41336231808](https://github.com/W-Boat/WorkProof/actions/runs/41336231808) 两任务全部通过；下载归档与包内 972 个文件摘要一致，已在本机 Office 全部退出后安装并重新启动桌面端。该包包含暂停后导出、暂停后开始另一份记录、PPT 原生另存为及无模态成功提示。安装成功不替代这些新交互的真实宿主验收。许可清单 638 包，仍有 2 个已安装 npm 依赖缺完整许可文本，以及 106 个本次平台未安装的锁文件条目；不宣称全部商用审查通过。详见 [最新交付证据](DELIVERY-2026-11-02.md)。

C2PA 增量：`3a87738` 的 [跨平台专项 41384413851](https://github.com/W-Boat/WorkProof/actions/runs/41384413851) Windows x64 实际 PNG、基线/渐进 JPEG 签署及核验任务已成功并产生开发包；macOS ARM/Intel 构建与解析器测试通过，但真实显式 CA 核验失败，继续修复，不列为可交付支持。PDF、浏览器解析和桌面向导仍未完成。

以下为历史验收记录，涉及“正在构建”“尚未替换”的状态以本页最新交付及其证据为准。

2026-11-02 当前验收更新：本机 Word 2021 x64 已实际加载 C++ 原生 WorkProof 功能区、开始/暂停/继续、导出作品及证书，并通过独立 Rust 校验，见 [Word原生入口](WORD-NATIVE.md)。受控进程专项41328452618已通过，但新DLL尚未替换运行中的Word。机构持久批量专项41328284766全部通过，真实JAR重启恢复/关页继续/权限及清理已验收，见[持久任务](INSTITUTION-JOBS.md)；用户本机V4未迁移，Windows队列未启用。Word双击安装/打开/卸载入口新增01724d1，完整包正在Actions验证。

这些组件完成不代表全部阶段结束：WPS真实宿主安装、其他软件正式交付、PDF及网页/桌面证据互操作、多种不同AI方法与近期误报评估、跨平台性能/许可及全新电脑安装仍需补齐。以下旧阶段描述保留为历史，不覆盖最新证据。

本轮增量：旧英文 GPT-2 已替换为固定英文 MPU v3，中英文真实模型与机构网页通过；辅助记录保留固定版本并可独立下载。DOCX 本机元数据通过浏览器专项 41298445736；效果评估工具仅指标契约通过，近期真实质量数据仍缺。多数开源方法、实际Office宿主、机构持久任务与原六阶段余项仍未完成。

用户交付要求：点击即用，按原规划覆盖所有阶段；本地只编辑源码，GitHub Actions 编译验证。

## 用户追加后的六个推进阶段

2026-11-01 用户明确追加“接入目前大多数开源AI检测引擎，并在元数据和文件中寻找AI指纹，作为辅助判断”。该要求加入长期目标，不替换原范围。

1. 证据互操作：TSA服务、C2PA封装与独立核验、可信策略与浏览器入口。
2. Word/WPS优先交付：真实软件安装、记录、暂停、导出与首次使用。
3. 其他创作软件：VS Code验收、Photoshop/Blender完整演进和正式安装方式。
4. 机构服务器：部署向导、持久批量任务、权限审计及备份恢复。
5. AI辅助判断（新增）：开源多引擎适配、文件元数据/生成工具标记/水印/签名来源线索，中文与误报验证，详见[实施要求](AI-ASSESSMENT.md)。
6. 整体验收与发布准备：全新电脑端到端、清晰UI、性能与许可、平台分发。

开源检测引擎须逐项记录支持状态和代码/模型权重许可，不以候选清单或模拟API冒充已接入；辅助分析不改变原证书签名事实，不输出未经依据的“AI百分比”或“100%人类”结论。Word/WPS优先级保持不变。

## 交付结构

1. 桌面记录：Rust/Axum/SQLite/BLAKE3/Ed25519，系统托盘、安装器、按需状态窗、自动连接。
2. 核验展示：原 Next.js/Wasm 独立核验工作台，离线资源随安装器提供。
3. 宿主：VS Code、Word、WPS、Photoshop UXP、Blender，按实际 API 能力采集，统一协议；不能观测的动作必须披露为缺失。
4. 互操作：Merkle 选择性披露、外部时间戳、C2PA 自定义断言；不将这些能力描述为人类身份证明或零知识证明。
5. 机构后台：基于 `services/institution` 的 Spring Boot + Vue 底座实现证书索引、批量核验、机构权限和审计；与本地守护进程独立部署。
6. AI辅助分析：可选的独立分析模块，多引擎统计、元数据与可核验水印/来源证据分别展示，按需运行，不挤入轻量守护进程。

## 已完成的前一阶段

VS Code 单文件记录、签名导出、独立 CLI/Wasm 核验、证书图像、过程曲线、远程测试；提交 9a953a8 对应的两条 CI 全通过。

## 当前进行中

C2PA独立PNG工具已通过[真实专项41288148673](https://github.com/W-Boat/WorkProof/actions/runs/41288148673)，含无损恢复原PNG与WorkProof绑定、显式CA、部分证据、篡改拒绝及离线运行；Windows/macOS工具、JPEG/PDF、浏览器/桌面操作入口与公共信任策略仍未完成，见[C2PA](C2PA.md)。此前时间凭据Worker版本386cc41的[完整四平台41285854361](https://github.com/W-Boat/WorkProof/actions/runs/41285854361)已全部通过，本机4173启动仍受执行审查限制，以[本地运行](LOCAL-RUNTIME.md)最新记录为准。

外部时间戳增加可选Rust/OpenSSL RFC3161请求与核验工具，绑定原签名字节且不改证书；真实合成TSA交换步骤已通过[Actions 41281504351](https://github.com/W-Boat/WorkProof/actions/runs/41281504351)，该原生版本五任务已全部通过。浏览器SHA256/SigningCertificateV2时间戳核验和显式CA选择已通过专项41283260447并部署本机4173，完整四平台41283260007也已全部通过；公共信任策略、撤销与长期验证、TSA自动请求与C2PA仍未完成，详见[时间凭据](TIMESTAMPS.md)。

机构摘要索引、分页、详情、CSV、页面内批量处理与部门范围已通过真实集成：[列表与查询 41276900621](https://github.com/W-Boat/WorkProof/actions/runs/41276900621)、[批量与部门 41278566617](https://github.com/W-Boat/WorkProof/actions/runs/41278566617)、[取消与重开 41278937068](https://github.com/W-Boat/WorkProof/actions/runs/41278937068)。新部署须显式执行V3并开启配置；本机已完成私有全库备份、V3迁移与启用，原账号保留；页面关闭后继续运行的服务器持久任务仍未实现。以下较早阶段描述保留为历史上下文，以此段与机构证书说明为最新业务状态。

机构工作台已增加“检查一份证书”：明确同意后发送证书原字节，Java 受控调用共享 Rust 一次性检查器；作品、身份和实际时间不在检查范围内。真实权限、审计、鼠标/键盘确认、完整/部分/修改后结果与手机布局已通过[机构 Actions 41274810400](https://github.com/W-Boat/WorkProof/actions/runs/41274810400)。简明步骤与按实际结果说明失败原因通过[完整 Actions 41274280942](https://github.com/W-Boat/WorkProof/actions/runs/41274280942) 五任务；证书索引与批量业务仍未完成，详见[内容预检](INSTITUTION-CERTIFICATES.md)。

优先顺序已按用户要求调整为 Word → WPS，机构后台部署目标为服务器。ImageGen 图标、带核验资源和插件的 Windows 安装器、VS Code 自动连接已经通过远程构建验证。

Blender 原生插件及 v2 签名统计指标通过真实 Blender CI 录制、保存、导出和篡改检测。视口旋转、平移、缩放和透视切换的低频变化计数已加入，旋转/缩放、暂停与篡改拒绝通过 [真实 Blender 5.0.1 CI](https://github.com/W-Boat/WorkProof/actions/runs/41206049201)；不保存视口坐标，不能视为精确手势轨迹。完整对象/修改器参数树仍未采集。

Word/WPS 共用采集与交付件导出代码、桌面来源审批及会话隔离已经加入；类型检查与模拟宿主浏览器测试通过，真实 Word/WPS 安装与交互验收尚未完成。服务器 HTTPS Word 清单、资源及双监听通过 [Actions 41186723953](https://github.com/W-Boat/WorkProof/actions/runs/41186723953)，本机也已验证。Word 本地安装/撤销与隔离注册表安全检查通过 [Windows Actions 41187531600](https://github.com/W-Boat/WorkProof/actions/runs/41187531600)。当前已检测到本机 Word 16.0.20430.20182，但尚未完成宿主内加载；localhost 证书信任变更已请求用户确认，未导入。WPS 原生功能区入口与独立验证包通过 [Actions 41205157421](https://github.com/W-Boat/WorkProof/actions/runs/41205157421) 的 8 项功能区与 11 项浏览器模拟测试；正式 publish 安装页受上游模板许可和真实宿主验收限制，尚未交付。

机构后台已在本机隔离目录运行。单 JAR 封装 Vue/Office、随机密码初始化、真实 MySQL/Valkey 登录与鉴权、Windows 父子进程归属及启停控制已通过 [Actions 41185301362](https://github.com/W-Boat/WorkProof/actions/runs/41185301362)。本机使用相同 JAR 和 Garnet 已验证原账号登录、深链接、API 拒绝、令牌登出，以及 MySQL 正常关闭后重启，详见 [本地运行](LOCAL-RUNTIME.md)。全新 Windows 的运行时引导安装、宿主 HTTPS 信任与生产机构业务仍未完成，不能据此宣称整个产品已点击即用。

Windows CI 测得关闭状态窗时工作集约 16.2 MB，3 秒空闲 CPU 采样为 0%，128 事件持久化批次 p95 为 17.589 ms。其范围不包括 Office/WPS，不代表编辑器回调性能或所有用户机器。

## 尚需完成

- 安装器从全新 Windows 用户环境到首次证书的交互验收。
- Word/WPS/Photoshop/Blender 的真实插件与对应宿主验证。
- TSA/C2PA 的证据生成、浏览器核验、信任策略与测试向量。
- 基于上游统一组件和权限能力的 WorkProof 机构业务模块。
- 性能采样：进程树内存、CPU、空闲写盘、宿主回调 p95、大文件核验、队列压力与恢复。

每项以真实实现、测试与可交付包验收，不以文档、合成数据或预留接口代替完成。

## 外部依赖

宿主软件由用户合法安装，平台可能要求确认插件加载权限。TSA 运营方、机构签名与商业代码签名需要对应凭据；未配置时必须明确显示状态，不能生成伪权威凭据。

机构底座源：wbr664393425-lgtm/scaffold-master，导入版本 577079e9a347555fadddd3865fc0bbcdb00d9fb4，保留 MIT 许可及第三方声明。上游要求使用 mysql skill 检查真实数据库；本会话无该技能，未操作用户既有或生产数据库。本地仅在明确创建的独立 `workproof_local` 复用已知上游 SQL 初始化，并对其进行运行验收；CI 使用独立 `workproof_ci`。后续业务 schema 设计先参照源码和已知结构，在隔离 CI 验证，不把本地空库初始化规则用于已有生产数据。

恢复开发后完整桌面/网页/核心、原生 Blender、机构单 JAR 均已通过相应 Actions；本机已升级并恢复后台，逐项证据与归档摘要见 [本轮验证记录](VALIDATION-2026-10-31.md)。没有导入 localhost 信任证书，真实 Word/WPS 验收仍未完成。

协议 v3 与选择性披露已实现并通过原生 Rust、独立 JavaScript、CLI 和真实浏览器验证：签发时签名 Merkle 根，网页/CLI 可保留原签名导出部分事件，核验明确区分完整链与所选归属；旧版 v1/v2 继续核验。编码及隐私边界见 [v3 协议](PROTOCOL-V3.md)，[完整 Actions 41217399215](https://github.com/W-Boat/WorkProof/actions/runs/41217399215) 两平台任务通过；完整证据见 [2026-11-01 验证记录](VALIDATION-2026-11-01.md)。

核验页与机构管理端已按用户要求统一珍珠玻璃设计系统，直接共享管理端样式源和组件契约；两端重新构建通过，本机核验页 4173、后台 18081 已更新。框架复用边界与页面验证见 [浏览器设计](BROWSER-DESIGN.md) 和 [最新验证记录](VALIDATION-2026-11-01.md)。

Photoshop UXP 自有开发适配已加入：图层/组/可见统计、生产动作列表、主线程合并、PSD 副本与 v3 绑定、桌面审批的原生会话授权。`d07f971` 已通过 [Linux/Windows Actions](https://github.com/W-Boat/WorkProof/actions/runs/41222699360)；不将模拟 Adobe API 或开发 ZIP 视为真实宿主与正式 `.ccx` 验收。Windows 实机、macOS 安全传输、超大文件及正式分发仍在长期范围内，见 [Photoshop 接入](PHOTOSHOP.md)。

核验页已实现三步引导、大字号证书、保留原始字节的签名文件分享、SHA-256 签名指纹与接收方指纹核对。完整与部分证据的分享明确区分公开范围；没有宣称自签名认证作者身份，没有将 localhost 冒充公网分享链接。`0a53020` 已通过 [Linux/Windows Actions 41224054908](https://github.com/W-Boat/WorkProof/actions/runs/41224054908)，25 项浏览器测试通过，本机4173已更新，功能边界见 [证书分享](CERTIFICATE-SHARING.md)。

桌面已加入 Word/WPS/Photoshop 的逐次授权连接列表与单独撤销；Office 收到授权失效时暂停并提示重新加载、重新批准和新记录，不跨授权拼接未提交事件。`15f7342` 通过 [完整两平台 Actions](https://github.com/W-Boat/WorkProof/actions/runs/41225883860) 和 [机构 Actions](https://github.com/W-Boat/WorkProof/actions/runs/41225883861)，27 项浏览器测试通过；本机机构 JAR/Office 与独立核验站均已更新，原账号保留。真实宿主和首次安装范围仍未完成，详见 [连接管理](ADAPTER-CONNECTIONS.md)。

`c5a830a` 进一步完成简明桌面/Office 流程、操作互斥、跨平台状态目录与浏览器/VS Code 入口，新增 Linux DEB、Mac ARM/Intel 开发版 `.app`。当前 [完整 Actions 41269692613](https://github.com/W-Boat/WorkProof/actions/runs/41269692613) 五项任务均通过，28 浏览器用例通过；[机构 Actions 41269163840](https://github.com/W-Boat/WorkProof/actions/runs/41269163840) 两任务通过（该源码与 c5 的产品代码相同，差异仅测试断言）。本机机构与核验入口已更新，各平台包已校验并归档。默认目录的解析对照不替代全新用户端到端安装；Apple 签名/公证、真实宿主和首次运行仍未完成。说明见 [平台交付](DESKTOP-PLATFORMS.md) 与 [易用性](USABILITY.md)。

2026-11-01 按用户要求把 Windows Word 主入口从网页侧载改为**原生 COM 加载项**：安装后功能区直接出现 WorkProof 选项卡，不再需要共享文件夹目录或本机 HTTPS 信任。新增 `apps/word-native`（IDTExtensibility2 + IRibbonExtensibility、内嵌图标、WinForms 侧边窗口、1.5 秒采样与 8 次抽检全文校验、导出后本地独立核验）、引擎 `fingerprint FILE`（BLAKE3 流式、大小与修改时间复核）、桌面 `word` 专用 native grant 与作用域测试、按用户复制载荷并解除下载标记的安装/卸载脚本，以及自建 web/插件/引擎/桌面的 `word-native` 工作流。证据与真实宿主验收边界见 [Word 原生入口](WORD-NATIVE.md)；真实 Word 2021 加载仍需在装机后确认。
