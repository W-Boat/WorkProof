# 全阶段实施与验收

用户交付要求：点击即用，按原规划覆盖所有阶段；本地只编辑源码，GitHub Actions 编译验证。

## 交付结构

1. 桌面记录：Rust/Axum/SQLite/BLAKE3/Ed25519，系统托盘、安装器、按需状态窗、自动连接。
2. 核验展示：原 Next.js/Wasm 独立核验工作台，离线资源随安装器提供。
3. 宿主：VS Code、Word、WPS、Photoshop UXP、Blender，按实际 API 能力采集，统一协议；不能观测的动作必须披露为缺失。
4. 互操作：Merkle 选择性披露、外部时间戳、C2PA 自定义断言；不将这些能力描述为人类身份证明或零知识证明。
5. 机构后台：基于 `services/institution` 的 Spring Boot + Vue 底座实现证书索引、批量核验、机构权限和审计；与本地守护进程独立部署。

## 已完成的前一阶段

VS Code 单文件记录、签名导出、独立 CLI/Wasm 核验、证书图像、过程曲线、远程测试；提交 9a953a8 对应的两条 CI 全通过。

## 当前进行中

外部时间戳增加可选Rust/OpenSSL RFC3161请求与核验工具，绑定原签名字节且不改证书；真实合成TSA交换步骤已通过[Actions 41281504351](https://github.com/W-Boat/WorkProof/actions/runs/41281504351)，全平台构建仍待终态。浏览器时间戳核验、信任策略产品化、TSA自动请求与C2PA仍未完成，详见[时间凭据](TIMESTAMPS.md)。

机构摘要索引、分页、详情、CSV、页面内批量处理与部门范围已通过真实集成：[列表与查询 41276900621](https://github.com/W-Boat/WorkProof/actions/runs/41276900621)、[批量与部门 41278566617](https://github.com/W-Boat/WorkProof/actions/runs/41278566617)、[取消与重开 41278937068](https://github.com/W-Boat/WorkProof/actions/runs/41278937068)。须显式执行V3并开启配置，本机尚未迁移；页面关闭后继续运行的服务器持久任务仍未实现。以下较早阶段描述保留为历史上下文，以此段与机构证书说明为最新业务状态。

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
