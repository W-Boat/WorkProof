# 2026-11-01：协议 v3 与浏览器统一体验

## 浏览器外部时间凭据

源码 `245dddc` [专项Actions 41283260447](https://github.com/W-Boat/WorkProof/actions/runs/41283260447) 通过协议、原生TSA交换、Web构建和29项浏览器检查；专项仅运行共享协议/网页job，桌面打包明确skipped，普通push的完整四平台工作流仍保留。原生TSA源码3dd2113的[完整41281504351](https://github.com/W-Boat/WorkProof/actions/runs/41281504351)五任务全部通过。

浏览器以OpenSSL真实合成CA/响应为交叉向量，确认正确凭据显示服务时间、错CA/nonce/其他证书/签名字节改动均拒绝，换文件清除确认和旧结果，无外部请求，390px无横向溢出。已人工查看手机截图。新增库精确锁定、实际tarball integrity与许可文本已核对；[许可证据41282185063](https://github.com/W-Boat/WorkProof/actions/runs/41282185063)成功，其Maven来源仍为旧基线JAR，不能据此宣称最新JAR已重新清点。

已校验网页归档 SHA-256 `d1ff0f13d23fd029a1a1c873095bcaeefb38f06628e6053fff73a4144d7b76cb`、截图报告 `127acf5a71a33a2e29d7c54764a1cb8e27e7dd001d35ddb6a7a2284e652204d0`。本机4173已使用新静态目录 `E:/work/workproof-browser-245dddc`，静态服务CLI仍为经原归档复核的3bc7511；首页及公开许可文件HTTP200。未升级机构JAR、修改数据库/账号/信任，也未将演示TSA向量作为用户凭据存入目录。全部构建/完整测试在Actions，本机只运行校验产物。

## 本机证书管理启用与真实备份恢复

[Windows原生 41280596255](https://github.com/W-Boat/WorkProof/actions/runs/41280596255) 使用固定摘要MySQL8.4.13原生服务/客户端，验证只读方案、实际缺失dump时拒绝、真实备份/V3/去重执行、第二个库恢复及全部账号逐行/二进制/NULL/中文比较。[机构6306b53验证41280475459](https://github.com/W-Boat/WorkProof/actions/runs/41280475459) 两任务通过。

已校验机构归档 `d639f508b45bb804ab3c7a3253a06d55b428b5f81f946394b80d85f217e91c79` 和启动包 `abd2d03367a86ae2de48affe2f0723285e648b03539dacc5c1ce677f4e692fe7`。本机原服务处于停止状态，先正常启动，查看方案确认无表/菜单冲突，然后升级JAR，运行准备工具全库备份后V3，启动启用目录。原账号文件SHA保持，实际登录/菜单/就绪/空目录/签名检查/篡改拒绝/登出/双端口健康均通过，用户目录未插入演示条目。SQL备份只在私有运行目录，未上传。所有构建与完整测试在Actions；本机操作是预构建产物运行、备份和迁移验收。

## 最新增量：清晰步骤、失败说明与机构内容检查

产品代码 `3bc7511`，机构测试修订 `7d3ed37`；[完整 Actions 41274280942](https://github.com/W-Boat/WorkProof/actions/runs/41274280942) 五任务与[机构 Actions 41274810400](https://github.com/W-Boat/WorkProof/actions/runs/41274810400) 两任务全部通过。完整验证覆盖 23 项协议测试、28 项浏览器检查、四个平台的真实原生检查器与桌面包。机构验证覆盖真实 Vue → Java → Rust、原 Blob 摘要/长度、鼠标/键盘同意和撤回、完整/部分/修改后结果、低权限 403、无证书内容审计及手机布局。

机构弹窗用选择文件、确认发送范围、查看结果分组；未选文件或未同意时说明下一步。独立核验页按实际结果呈现说明，失败项不会继续声称内容一致。部分过程、未检查作品及未经确认的身份/时间仍明确呈现，内容预检不替代证书索引或批量业务。

已下载并与 GitHub 归档摘要逐一核对：

| 归档 | SHA-256 |
|---|---|
| 3bc7511 网页与插件 | `4b584adf25232af6bb48d67e11e41a99d6eec36a2eb186399f543f2cc2f34fc6` |
| 3bc7511 Windows | `2fb4c778293599223a9550c011e94ae95157d7c05d8730da18c5198fc6fe0fe5` |
| 3bc7511 浏览器报告 | `c859bb9d75f1e7db980572926e4a1869e574a873a274ee27be5fc9f099d2807a` |
| 7d3ed37 机构 | `7746a7b0949d786c96891737e35346e0236e9e9e572d7f68dc8ae6d93a8fe47c` |

桌面/手机截图已查看。本机只运行经校验的预构建产物：4173 已更新到 `E:/work/workproof-browser-3bc7511`；机构原目录加入检查工具并更新 JAR，升级备份为 `state/previous/scaffold-admin-pre-7d3ed37.jar`。账号文件未变，原账号登录/登出、真实 Windows 检查器正常/修改证书、双端口健康均复核；数据库、缓存未停止，没有修改证书信任或 Office 注册项。全部构建与完整测试在 Actions。

下文为此前阶段的历史验收记录。

源码交付提交 `6c59057`，分支 `codex/workproof-mvp`。全程未在本地构建；本机只运行经摘要校验的 Actions 产物。

## 证据能力

`workproof/3` 在原事件链外增加签名 Merkle 根。网页与 CLI 可不读取私钥、不重新签名地导出所选事件，保留原清单与签名。部分证据始终标明范围，`chain_valid=false`，不冒充完整链核验；图片与打印同样保留声明。

Rust 测试覆盖非二次幂树、每个叶子位置、100,000 条树深度、披露上限、篡改/缺失/额外路径、重复与乱序、强制边界、文件替换、会话变化与协议降级。独立 JavaScript 实现交叉核对编码、树形、Ed25519、CLI 和历史 v2 冻结签名。协议细节见 [v3](PROTOCOL-V3.md)。

前两轮完整验证：[cd7fe40](https://github.com/W-Boat/WorkProof/actions/runs/41210339331)、[5129222](https://github.com/W-Boat/WorkProof/actions/runs/41210854844) 均通过。最终交付以以下 `6c59057` 的工作流为准。

## 浏览器重构与复用

按用户确认，核验页与管理端统一体验。独立核验页直接导入管理端六层设计 CSS；React 对管理端 Button、Panel、PageHeader、Tag、TextInput、EmptyState 契约做薄适配。Vue SFC 没有直接跨框架运行，也没有复制另一套主题。

核验页拆分文件选择、证书、核验明细、披露与时间轴。浅/深色使用相同主题令牌，外观偏好格式与管理端一致。管理端登录、侧栏仍用原 Vue 组件，接入已生成的 WorkProof 品牌资产。未修改认证、授权、表结构或用户数据。

过程指标缺失时留空，不补为零；部分证据不展示连贯过程曲线。界面与数据边界见 [浏览器设计说明](BROWSER-DESIGN.md)。

## Actions 结果

| 工作流 | 结果与范围 |
|---|---|
| [41217399215](https://github.com/W-Boat/WorkProof/actions/runs/41217399215) | Linux/Windows 全通过：21 项协议单测、引擎/配对、独立 Merkle/签名交叉验证、真实 Blender 5.0.1、Word/WPS 模拟、浏览器 Worker/Wasm、主题/响应式/焦点、NSIS 与托盘 |
| [41217399226](https://github.com/W-Boat/WorkProof/actions/runs/41217399226) | 机构 Vue/Java 构建、真实 JAR+MySQL+Valkey 集成与 Windows 控制器全通过 |

浏览器截图已检查桌面浅色、桌面深色、手机深色与导出部分证据 PNG；没有水平溢出。核验通过、失败、旧版、部分披露、选择错误、下载再核验与 Escape 焦点恢复均有回归覆盖。

本次 Windows CI 根进程及直接子进程工作集约 16.31 MB，3 秒空闲 CPU 采样为 0%，4096 条合成事件按 128 条每批持久化的 HTTP p50 6.856 ms、p95 11.692 ms。该范围不覆盖完整后代树或宿主回调，不能外推到所有机器。

## 本机运行验收

- 核验工作台：`http://127.0.0.1:4173`。从已校验的 Windows 包运行独立 `serve-web`，资源是同提交的静态导出，未进行本地编译。只读服务不提供上传端点。
- 机构管理：`http://127.0.0.1:18081/login`。升级 JAR 前持有运行锁并校验进程树，只停止自身 Java 进程；MySQL/Garnet 持续运行。上一包保留为私有目录 `state/previous/scaffold-admin-134112f.jar`。
- 原账号文件保持不变，原密码登录、认证路由与登出失效已重新核对；新品牌 JS/PNG 确实由新 JAR 提供。
- 本机预构建 CLI 已对完整 v3 与部分证据分别核验，确认正确的 `scope`、`merkle_valid` 与 `chain_valid`；静态站点的 Wasm 内容类型正确。

没有自动打开浏览器、运行安装器、启动 43127 采集器、修改 Windows 信任或 Office 注册项。登录页与核验页是两个本机入口；视觉和控件系统已统一，不把两个端口描述为同一个登录会话或自动共享浏览器存储。

## 归档摘要

| 已下载校验产物 | SHA-256 |
|---|---|
| `workproof-web-and-extension` | `8231dea8b08331b704c365a9c41b58a8734538c9790c12f7381376d93c7ee7c6` |
| `verification-report` | `a7de2fde71c4110585d10694f7add73d2c23c9b414267b2f45b0805771385c23` |
| `workproof-windows-x64` | `7128a0d21030888dd56e485cd1e3b307833adc8ec251492a1729224f17aa2cc3` |
| `institution-baseline` | `fd7a755872b5e7f643a23743accffc96d0c24054331a6efa66dd146a966f8882` |
| 从 Windows 包提取的 NSIS 安装器 | `d2f09b027bbadd0eb69fe5b0fe4dc04ee4b419751a92ff6cc47b2b12d1330ea1` |

长目标仍未完成：真实 Word/WPS 验收、正式 WPS publish、Photoshop UXP、完整演进结构、TSA/C2PA、机构证书业务、首次运行向导及跨平台交付继续保留原范围，见 [全阶段清单](ALL-STAGES.md)。

## 大字号证书与签名分享

最新代码 `0a53020` 的 [Actions 41224054908](https://github.com/W-Boat/WorkProof/actions/runs/41224054908) Linux 与 Windows 任务均成功；协议、插件、真实 Blender、网页、原生授权隔离、桌面托盘和 NSIS 构建均通过，25 项浏览器测试全部通过。

新增用例以 Node SHA-256 独立对照浏览器指纹，检查有效签名遇到错误指纹时失败、正确指纹通过、文件分享回退保留原始字节、部分披露沿用原签名指纹、手机作品名/说明字号及无横向溢出。首轮 `41223532239` 的一项断言因同时选中 Next 路由播报 alert 而失败，已收紧选择器；被新排版替代的 `41223897996` 取消，不计为通过。

已检查 Actions 的浅色桌面、手机及 1440×960 部分证书导出图。页面明确图片仅展示，分享的 `.wproof` 需和作品原文件一起独立核验，指纹须经可信渠道取得；未认证作者身份，未生成公网托管链接。

| 本轮下载校验产物 | SHA-256 |
|---|---|
| `workproof-web-and-extension` | `948711106551743108eb0c6732345c9b1970fd55ad5b870d4c7a92cb97c176fc` |
| `verification-report` | `09661c012b2970134a821255ce3d3df5f77fcaba06748b5763fdae9dd6eb94c2` |
| `workproof-windows-x64` | `5824952b85bae2bc47a334cb8b88162705693d7d7126d35b6ef84c73b6005e75` |
| 从本轮 Windows 包提取的 NSIS 安装器 | `c7583a4ebaf67b87de7bdb5f193f63cf69f44c4e4cacb703d7faa9cff7041577` |

Windows 产物已提取至 `E:/work/workproof-delivery-0a53020`，未运行安装器。本轮无状态窗采样工作集 16.24 MB、空闲 CPU 为单核 0%、128 条持久化 HTTP 批次 p95 20.769 ms；只统计根及直接子进程，含客户端和 SQLite 落盘，不代表宿主编辑回调或所有机器。

本机 4173 已指向 `E:/work/workproof-browser-0a53020/verifier`，HTTP 首页与新版核验 Worker 均正常。只读静态服务继续复用已验证 `6c59057` 二进制，进程记录与日志仍位于 `E:/work/workproof-browser-6c59057`。切换时仅停止该记录验证归属的进程；机构 Java/MySQL/Garnet 未重启、账号未更改。未运行本地构建或自动化测试，未启动采集器、安装器或修改信任。

Photoshop 最终控制器代码 `d07f971` 的 [完整 Actions 41222699360](https://github.com/W-Boat/WorkProof/actions/runs/41222699360) 两平台均通过；其中 Adobe API 为模拟，真实宿主、正式 CCX 与 macOS 传输仍待验证。

## 插件授权连接管理与 Office 恢复

代码 `15f7342` 的 [完整 Actions 41225883860](https://github.com/W-Boat/WorkProof/actions/runs/41225883860) Linux/Windows 均通过，[机构 Actions 41225883861](https://github.com/W-Boat/WorkProof/actions/runs/41225883861) 的 scaffold 与 windows-launchers 均通过。27 项浏览器测试成功。被新 Office 修复替代的 `4886166` 主流程 `41225446513` 已取消，不计完整通过；其机构 `41225446343` 成功。

真实 Rust/Axum/SQLite 集成检查撤销后的 Word 旧令牌无法创建、追加和导出，其他 WPS 授权继续有效，Photoshop 原生令牌撤销后被拒，SQLite 事件数量不减少、原有证书仍可由 CLI 核验。桌面控件测试模拟 Tauri IPC，Office 测试模拟宿主 API；不能作为实际桌面 WebView 或真实 Word/WPS/Photoshop 验收。Windows 另外验证了二进制构建、真实无窗口托盘启动和 NSIS 构建。

本轮采样：无状态窗工作集 16.38 MB、3 秒空闲 CPU 为单核 0%、128 事件持久化 HTTP 批次 p95 20.259 ms。仅根及直接子进程与合成负载，包含客户端开销，不代表宿主回调。

| 已下载校验产物 | SHA-256 |
|---|---|
| `workproof-windows-x64` | `2c745055d7b97c7c25e85757f8de83b7e2bb25eb49fae54e05b39491e2623f7e` |
| `workproof-web-and-extension` | `9a8d512398b7c96f54c15818fd516ea7ff9e9944d5f32ec9b7a488ba6e5941b1` |
| `verification-report` | `335ae8b5dd98dc742a1fca73eb510617e2020c1358aa757781f782227571c618` |
| `institution-baseline` | `bbe669cefed1eeaccc2174e5b30a3d659cdef95a17d656b529c8057c59ec1635` |
| 提取的 NSIS 安装器 | `a4799f472caab87ef431ebff7ddb8d8119f2c96a7ab4f4c9d77ad95a330db3d2` |

交付目录 `E:/work/workproof-delivery-15f7342`。本机机构 JAR 已通过运行锁、进程归属校验与文件替换升级，旧 JAR 保留在私有 `state/previous/scaffold-admin-pre-15f7342.jar`。只重启 Java，MySQL/Garnet 保持运行；账号文件 SHA-256 未变，原密码登录、权限路由、登出失效已复核，服务器提供的 Office JS 包含新的授权失效处理。

独立核验站也已切换至 `E:/work/workproof-browser-15f7342` 的本轮预构建 CLI 和静态资源，HTTP 200，指纹 Worker 正常；旧静态进程停止，新归属记录与日志在新目录。没有本地构建，没有执行安装器、启动采集器、修改系统信任或 Office 注册项。长期目标继续保留未完成阶段。

## 简明流程、操作互斥与原生平台交付

最终 `c5a830a` 的 [Actions 41269692613](https://github.com/W-Boat/WorkProof/actions/runs/41269692613) 五项任务均成功：协议/网页、Windows、Ubuntu 22.04 x64、macOS 15 ARM、macOS 15 Intel。28 项浏览器测试通过，包含实际界面位置检查、软件选择、延迟接口下重复点击、文档切换和授权失效。测试未放宽安全条件：上一轮 `bcbaa4f` 的唯一失败是仍匹配旧文案，已同步断言；不将其记为通过。`ac1af3f`/`53a8989` 的被替代主流程取消。

Linux 安装真实 DEB 后在虚拟显示环境启动，Mac 启动 `.app` 内二进制，Windows 验证托盘及 NSIS。三种语言在各平台对照同一目录规则，平台命令检查仅证明参数和失败处理，不代表已操作真实浏览器/VS Code。独立只读解包确认离线页面、Wasm、VSIX 在 Unix 包中，Mac Mach-O 架构及可执行权限正确。新 Mac 包仍未取得 Apple 签名/公证。

| 当前已校验下载包 | SHA-256 |
|---|---|
| `workproof-web-and-extension` | `9a455c1841060cc5de2b8f58168086d057f84a02caba24f7491167d630fdae72` |
| `verification-report` | `1c0a21a4f7a7d3048e6c57321d9227d61591dfe69560dbcf96a48c5757f174fe` |
| `workproof-windows-x64` | `ebb9289f54228fee6d782b94e76560d3b1738218029c7d71967ebba26f10e73f` |
| `workproof-linux-x64` | `50828a1655679309adc98ad1d7965d3ce1bdaac2206e5192bb41632d822fe8b7` |
| `workproof-macos-arm64` | `b1750de80837b1e7c198092b555f557caf6262e9f48e82b0ff8d21287225d062` |
| `workproof-macos-x64` | `3de15f63d847ba8c3210791052fcc0c0aec9dff71ad4d0e0506cfa98678b5a46` |
| `institution-baseline`（bcbaa4f） | `326bc4ff4e6ab5f4b243097756a468125144e8b56c94ee71983f7a7d2ff4be46` |

交付目录 `E:/work/workproof-delivery-c5a830a` 按系统分开，Windows 安装器 SHA-256 为 `2ca34a9e03c1217077a2c32bfc98f79d8f4118a6e6d4ea15bb656077f634008e`。Linux DEB 为 5,665,520 字节，Mac ARM tar 为 6,921,022 字节、Intel tar 为 7,081,905 字节；这是具体包大小，不是所有系统的通用承诺。Windows 本轮工作集 16.30 MB、3 秒空闲单核 CPU 0%、128 事件 HTTP 批次 p95 11.915 ms；仍只覆盖根及直接子进程与合成负载。

本机机构 JAR 升级为 `bcbaa4f`，旧 JAR 备份 `state/previous/scaffold-admin-pre-bcbaa4f.jar`；持锁、校验归属后只重启 Java，原账号文件 hash 未变，原密码登录/routes/logout 重新通过。独立站为 `E:/work/workproof-browser-c5a830a`，HTTP 200，证书指纹 Worker 和简明 Office 页均正常。全部使用 CI 预构建文件，没有本地构建、执行安装器、启动采集器或修改系统信任。真实宿主、全新用户默认目录自动发现/首次安装及剩余全部阶段继续保留。
