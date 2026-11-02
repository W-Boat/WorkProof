# 全阶段实施与验收

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
