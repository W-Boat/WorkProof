# WorkProof 商业使用许可核验

实际CPU归档已验证35包/188许可原文，tokenizers0.23.3 wheel缺许可仍单列。已核PyPI发行源码的Apache原文作为版本级补充；源码发布tag与sdist的Cargo/pyproject不同，不能据此推定整个wheel血缘或二进制依赖授权已完整。requirements固定tokenizers0.23.3避免补充材料与版本漂移。

AI运行时新增[实际安装许可原文归档](AI-RUNTIME-NOTICES.md)，来源于具体CI环境的 distribution RECORD，逐文件保留原文与SHA并明列缺失。不覆盖二进制内嵌组件、系统库或模型训练数据，不能以归档存在宣称全部商业使用放行。中英文MPU卡片均只声明Apache-2.0，基础模型精确血缘未由配置相对路径证明。

2026-11-01 C2PA独立工具增量：c2pa0.91.7精确锁定，独立Cargo.lock，不加入守护进程依赖图。[专项41288148673](https://github.com/W-Boat/WorkProof/actions/runs/41288148673)采集333个解析包（含开发与可选目标，比实际链接集合更广）的许可声明及正文。SDK自身发布包缺根LICENSE，已按归档VCS提交保留双许可证；其他缺失文本逐项补充，见 [证据说明](licenses/c2pa-supplemental/README.md)。三个上游仅在README授权Apache/MIT任选的包保留作者原授权、Cargo作者字段并选择Apache-2.0标准正文，未伪造上游文件；r-efi选择MIT分支。该依赖集合的声明包含MIT/Apache、BSD、Zlib、Unicode等不同条件，不能称为全MIT。模型权重和新增AI检测引擎尚未接入或商业放行，必须按[AI辅助阶段](AI-ASSESSMENT.md)分别审核代码、权重和数据条款。本增量不解除下面对整个产品分发的既有约束。

2026-11-01 时间戳浏览器增量：新增固定版本PKI.js3.3.3、asn1js3.0.6、bytestreamjs2.0.1（BSD-3-Clause），以及@noble/hashes1.4.0、pvtsutils1.3.6、pvutils1.2.0（MIT）。已核对npm锁定包的SHA-512 integrity并提取实际包内许可，见 [证据记录](licenses/timestamp-npm-notices/evidence.json) 及同目录完整版权/许可文本。上述许可支持含商业场景的使用与分发，须遵守保留版权、许可及BSD不背书条件；这不改变下文对整个产品分发尚有约束的判断。此增量不把OpenSSL可执行程序打包进产品。

核验日期：2026-10-31。源码基线：`0f8d08b7c6b52a4817ebc65cdabca58fe56ac939`；另包含工作区中尚未发布的 WPS 发布流程、本地启动脚本。后台二进制证据来自 [Actions 41181460797](https://github.com/W-Boat/WorkProof/actions/runs/41181460797)，对应 `a9365f7`。本文讨论软件版权许可；没有替权利人授予额外权利。

**结论：WorkProof 可以走商业产品路线，公开 MIT 源码也可以收费。不能把全部依赖称为 MIT、无条件免费或任意闭源可分发。现有证据不足以给整个安装包作无条件商业分发放行。** WPS 工具条款冲突、Blender 插件分发条款、第三方许可随包交付，以及未来闭源后台的 JDBC 许可，需要按下文处理。

## 核验范围与证据等级

| 范围 | 覆盖数量 | 方法与边界 |
|---|---:|---|
| 两份 npm 锁文件 | 410 条安装路径记录 | 含开发、可选和不同平台包，不等于 410 个运行时组件；读取锁定版本的许可字段 |
| Cargo.lock | 452 个注册表包 | 按确切版本查询 crates.io；包括所有锁定目标和特性，不等于 Windows 实际链接集合 |
| 后台构建产物 | 89 个内嵌 JAR | 读取内嵌 POM、父 POM、LICENSE/NOTICE；含 4 个脚手架自有模块 |
| 原规划候选组件 | 见单独清单 | 记录核验时版本；候选版本不等于项目已安装版本 |
| 本地运行/发布工具 | 单独人工核对 | MySQL、Garnet、JDK、.NET、bcryptjs、WPS、Office.js、WebView2 等 |

机器记录：[dependency-inventory.json](licenses/dependency-inventory.json)、[候选组件](licenses/proposed-components.json)、[特殊 npm 包内许可证原文](licenses/npm-special-evidence.json)、[JAR 内许可与声明](licenses/maven-notices/)。Cargo 缓存保存版本级注册表声明。注册表声明、文本识别与完整法律核准有区别；自定义条款必须看原文，不能只看 npm 标签。POM 的多个许可证条目也不能自动解释成任意任选。

本次只读取文件和已构建产物、查询官方来源，没有在本地编译、安装依赖或重建应用。Actions 的证据工作流只下载既有后台产物并重新采集元数据；绿色结果仅代表元数据收集完整，不代表商业发布已被法律批准。

## 已使用的主要项目

| 项目 | 许可依据 | 商业使用结论及条件 |
|---|---|---|
| WorkProof 自有代码 | 根目录 MIT | 可商用、收费、修改；分发保留版权与许可。根 MIT 不替代第三方条款 |
| wbr664393425-lgtm/scaffold-master | [导入提交 MIT 原文](https://github.com/wbr664393425-lgtm/scaffold-master/blob/577079e9a347555fadddd3865fc0bbcdb00d9fb4/LICENSE) | 可商业二次开发；已保留上游 LICENSE。其依赖另算 |
| Tauri v2 | MIT OR Apache-2.0 | 可商用，可按其中一种许可合规使用；系统 WebView 和安装组件另算 |
| Axum / Tokio / rusqlite / Serde | MIT 或 MIT/Apache 双许可，见锁定版本清单 | 可商用，保留对应版权、许可与必要 NOTICE |
| SQLite | [公有领域声明](https://sqlite.org/copyright.html) | 原始交付库可商业使用、修改、分发；不要把其构建工具的许可与库本身混淆 |
| BLAKE3 / Ed25519-dalek | BLAKE3 多许可可选；Ed25519-dalek BSD-3-Clause | 可商用；按实际版本选用许可并保留声明 |
| Next.js / React / Tailwind / Radix / Motion / shadcn/ui | MIT | 核心库可商用；Next 的图像处理、CSS 工具等传递依赖另有许可 |
| Lucide React | ISC | 可商用；保留许可和版权 |
| Vue / Vue Router / Vite | MIT | 可商用；Vite 工具依赖也纳入 npm 清单 |
| GSAP 3.15.0 | [Standard No Charge 自定义许可](https://gsap.com/community/standard-license/) | 当前 WorkProof 后台界面动画符合其一般允许用途的判断；商用无需付费。禁止特定竞争性无代码动画构建用途；不是 MIT，也不是无用途限制的开源许可 |
| Spring Boot / Spring Framework / Spring Security / Spring Data / Tomcat | Apache-2.0 | 可商用；保留许可、适用 NOTICE、修改说明 |
| MyBatis Plus / Knife4j / Jackson / JJWT / HikariCP / Netty | 主要为 Apache-2.0，见具体 JAR | 可商用；MyBatis 内嵌第三方许可不可只按顶层 Apache 处理 |
| Lettuce / redis-authx-core | MIT | 可商用。Redis 客户端许可不等于 Redis 服务器许可 |
| AspectJ Weaver 1.9.25.1 | 包内明确标注 `EPL-2.0 AND BSD-3-Clause AND Apache-1.1` | 可商用，但须保留组合许可、提供 EPL 覆盖代码的源码获取方式；修改覆盖代码的分发须遵守 EPL |
| Logback 1.5.32 | EPL-2.0 / LGPL-2.1 双许可 | 可商用；须依据上游双许可安排选择并履行对应条件，不应写成 MIT |
| Jakarta API 系列 | 按模块为 Apache、EDL、EPL 或带 Classpath 例外的 GPL 等 | 可商用；不要用一个统一许可替代各模块条款 |
| bcryptjs 3.0.3 | 包内 BSD-3-Clause | 可商用；这是 BSD，不是根据名称推测的 MIT |
| Microsoft Garnet 2.2.5 | [该版本 MIT](https://github.com/microsoft/garnet/blob/v2.2.5/LICENSE) | 本地缓存可商用；保留 MIT 及其所附第三方声明 |
| .NET Runtime | MIT 为主及发行包第三方声明 | 可商用；分发时保留运行时自带许可、通知 |
| PowerShell 便携运行时 | [PowerShell MIT](https://github.com/PowerShell/PowerShell/blob/master/LICENSE.txt) 及发行包第三方声明 | 可商用，保留发行包许可/通知；仅供本地控制脚本使用，不属于守护进程常驻依赖 |

## 必须区分使用场景的组件

### MySQL 与 JDBC

本地 MySQL Community 为 8.4.13；JAR 中实际驱动为 `mysql-connector-j-9.7.0.jar`，其包内 LICENSE 已归档。

* **企业内部或自有服务器运行**：GPL 本身允许商业使用；单纯运行服务不等于向客户分发二进制。
* **随安装器或交付包发送 MySQL Community**：需履行该 GPL 发行版的许可、对应源码等分发义务。不能只附 WorkProof MIT。
* **分发含 Connector/J 的后台 JAR**：驱动为 GPLv2 加 [Universal FOSS Exception](https://oss.oracle.com/licenses/universal-foss-exception/)。该例外针对以合格自由/开源许可证提供完整对应源码的 Other FOSS，并非任意闭源软件例外。当前 MIT 开源路线可按其条件安排合规；必须保证实际交付版本与对应源码、通知匹配。
* **未来闭源销售后台**：不能沿用“MIT 可以商用，所以 JDBC 也随便用”的判断。需取得适当商业许可，或评估替换驱动/数据库后重新核验。数据库走网络协议与把 JDBC 驱动链接进交付 JAR 是不同问题。

### Redis

[官方版本许可表](https://redis.io/legal/licenses/)区分：7.2 及以前 BSD-3-Clause；7.4 系列 RSALv2/SSPLv1；8 起可选 RSALv2、SSPLv1、AGPLv3。后两种 source-available 许可不能称为 OSI 开源许可，AGPL 是开源许可。收费业务并非一概禁止，但托管 Redis 功能、修改后提供网络服务、分发等场景各有条件。

当前 Windows 本地运行的是 **Garnet，不是 Redis 服务器**。服务器部署不要使用未标明版本和许可选择的 `redis:latest`。可评估 [Valkey BSD-3-Clause](https://github.com/valkey-io/valkey/blob/8.0/COPYING) 或继续 Garnet；替代品的命令兼容和性能仍需验证。本次没有更换正在运行的服务。

### Blender 与插件

[Blender 官方许可页](https://www.blender.org/about/license/)允许商业使用，也说明已发布的 Python 插件须按 GPL 合规许可分享。[Extensions 平台条款](https://extensions.blender.org/terms-of-service/)要求上传的 add-on 完全符合 GPLv3 或更高版本；附带图片等资产还有额外要求。

WorkProof Blender 0.2.1 分发包的 manifest 已选择 `SPDX:GPL-3.0-or-later`，归档同时附带完整 Python 源码、GPLv3 正文、原 MIT 声明及授权说明。原自有源码保留 MIT 选项，Blender 扩展分发选择 GPL，不据 MIT 选项声称可任意闭源发布。包内不包含 Office.js、WPS SDK 或其他专有组件；打包脚本校验许可与原始通知。通过本地网络连接的独立 Rust 引擎应单独评估边界，不能仅因协议通信就把整个产品一概改成 GPL。

项目根 MIT 授权未撤销，Blender 扩展明确选择 GPL 分发；这不等于已提交或通过 Extensions 平台审核。可收费提供插件、支持或服务；收费并不取消接收者依据 GPL 享有的权利。

### npm / Rust 的弱 copyleft 传递依赖

* `@img/sharp-libvips-* 1.3.4` 等记录涉及 **LGPL-3.0-or-later**；部分 Sharp 平台包还明确为 Apache AND LGPL 等组合。商用允许，但若分发这些库，需按实际包处理对应源码、许可证、用户替换/重新链接和调试修改版本的权利。当前静态网页导出不等于已向用户发送 Sharp 服务器原生库；需对最终产物判定，不能因开发锁文件存在就断言整站必须开源。
* Lightning CSS 及平台包为 **MPL-2.0**；Rust 锁文件的 `cssparser`、`cssparser-macros`、`dtoa-short`、`option-ext`、`selectors` 也为 MPL-2.0。依据 [Mozilla 官方 FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/)，MPL 是文件级 copyleft，可与专有代码组合；分发覆盖代码时须使对应源码和修改可获取，不要求所有独立业务代码自动开源。
* `caniuse-lite` 为 **CC-BY-4.0**：涉及再分发的数据需署名并注明许可、适用修改。
* 部分打包工具为 Artistic-2.0、BlueOak、BSD、Unicode 等许可；均不能从产品根 MIT 自动覆盖。机器清单记录了确切版本。

## 不属于普通开源许可的宿主与工具

| 项目 | 核验结果 | 对 WorkProof 的处理 |
|---|---|---|
| wpsjs 2.2.3 | npm 元数据为 ISC，发布包 LICENSE 却为金山自定义条款：允许范围含不修改、不得单独销售等限制 | 按包内实际文本保守处理，不能按 ISC 放行。当前 Office 验证包只包含 WorkProof 自有入口，不运行该 CLI、不分发其模板；生成页面、模板及依赖的再分发权限仍待确认。不把工具本身当 MIT 交付给用户 |
| Office.js | [微软专有 API Library 条款](https://github.com/OfficeDev/office-js/blob/release/LICENSE.md)，非 MIT；`@types/office-js` 的 MIT 不覆盖运行库 | 商业 Office 互操作加载项可按其条件开发与分发；仅在 Word 路径从官方 CDN 加载，WPS 用自己的 API，不能把 Office.js 改作通用 WPS SDK |
| VS Code | 开源源码与微软发行二进制许可不同 | 交付自有 VSIX，不把微软编辑器当 MIT 再分发 |
| `@vscode/vsce-sign` 及平台包 | 包内 Microsoft VSCE-SIGN 软件条款；限制与指定微软产品/服务配合开发测试，禁止把工具提供给第三方 | 属开发打包依赖。当前 `vsce --no-dependencies` 不应把它装进 VSIX；正式产物仍需确认不含该工具。商业开发不等于获得工具再分发权 |
| WebView2 Runtime / Bootstrapper | 微软运行时再分发条款，非 Tauri 的 MIT | [官方分发说明](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution)允许规定方式部署；安装器采用其 Bootstrapper，需保留适用通知并按运行时条件交付 |
| Word / WPS / Photoshop / Adobe UXP | 宿主软件与 SDK/开发者协议分别适用，不能因 API 可访问就说宿主开源免费 | 用户自备合法宿主授权；交付自有适配器。Adobe 官方支持[独立及企业插件分发](https://developer.adobe.com/uxp/)，具体 SDK、示例代码和上架条款在选定版本后再核验 |
| 当前 Oracle JDK 17.0.12 | [Oracle FAQ](https://www.oracle.com/java/technologies/javase/jdk-faqs.html)将 17.0.12 及以前列为 NFTC，可按条件商业生产使用；17.0.13 起许可不同 | 不把“Java 17”笼统标记永久免费。CI 已用 Temurin；正式部署优先 [Temurin GPLv2 + Classpath Exception](https://adoptium.net/docs/faq)，保留发行包通知。本次没有替换用户本机 JDK |
| Docker Engine / Docker Desktop | 引擎开源许可与 Desktop 订阅条款不同 | 若提供容器部署，分别核验镜像组件。Desktop 在符合官方规定的大企业等场景需[付费订阅](https://docs.docker.com/desktop/setup/install/windows-install/)；当前本地运行未依赖 Docker Desktop |

WPS 实证来自官方 npm 发布包：`https://registry.npmjs.org/wpsjs/2.2.3` 指向的 tarball；完整包内文字、integrity 与元数据已存入 `npm-special-evidence.json`。这里只指出许可冲突，不把“不得单独销售”误写成“绝对禁止所有商业应用”。

## 原规划中尚未全部接入的候选项

以下是核心项目许可核验，不代表这些候选项的未来全部传递依赖和附带资源已经完成分发审查。版本级官方注册表链接见 `proposed-components.json`。

| 候选 | 核心许可 | 商业使用 |
|---|---|---|
| SQLx / Redb / rs_merkle | MIT / Apache-2.0 双许可 | 允许，保留选用许可与声明 |
| c2pa-rs | [MIT OR Apache-2.0](https://github.com/contentauth/c2pa-rs#license) | 核心库允许；其依赖、证书服务和信任服务条款另算 |
| Tremor `@tremor/react` / Apache ECharts | Apache-2.0 | 允许；只对应相应开源仓库内容 |
| React Flow `@xyflow/react` | MIT | 开源核心允许；Pro 订阅、专属示例和服务按另外条款 |
| Visx / `@react-pdf/renderer` | MIT | 允许；额外字体和资源必须另核 |
| Satori 0.63.2 | [MPL-2.0](https://github.com/vercel/satori/blob/main/LICENSE) | 允许；不是 MIT。涉及分发或修改覆盖文件时遵守 MPL 源码获取条件 |
| Lottie-web | MIT | 播放器允许商用；从素材网站下载的 Lottie 动画不自动获得同样授权 |
| Magic UI 开源仓库 | [MIT](https://github.com/magicuidesign/magicui/blob/main/LICENSE.md) | 开源组件允许；[Pro](https://pro.magicui.design/)是另外的商业许可，不能按 MIT 整包公开 |
| Aceternity UI | [官网许可](https://ui.aceternity.com/licence)为自定义许可，明确限制源码再分发、模板及市场转售等 | 不能把网站上所有免费/Pro 内容统称 MIT。未拿到具体拟用文件的明确宽松授权前，不直接拷入公开 MIT 仓库；当前核验页没有导入该库 |
| Office.js / WPS JS / Photoshop UXP / Blender bpy | 各自 SDK/宿主条款 | 不是统一的 TypeScript 开源许可；分别按上表处理 |

ImageGen 生成图标属于生成资产，不是开源项目依赖。本次不把模型服务的输出权利推断成某个第三方开源许可；图标素材未包含下载的付费 UI 或动画包。

## 发布前需要完成的具体事项

1. 将实际随 Windows 安装器、VSIX、网页、后台 JAR 和本地运行包交付的组件分别列清，附带各自版权、LICENSE/NOTICE 和必要的对应源码获取安排。当前归档证据不是所有产品包已附带通知的证明。
2. 验证 Blender 0.2.1 归档包含 GPL 条款、完整源码与原 MIT 声明；发布平台审核和其他组件的许可边界仍需分别核对。
3. WPS 发布模板及工具依赖按包内条款继续核验；需要额外权利时取得金山授权，或者改用许可明确的独立实现。未解决前不声明 WPS 发布包可无条件开源再分发。
4. 保持当前公开源码与交付后台版本一致；若改为闭源交付，先解决 Connector/J 和相关分发权利。生产缓存明确选用产品、版本与许可，不沿用未固定的 Redis 名称。
5. 后续依赖升级、加入 Pro 组件、嵌入字体/动画或更换 JDK/容器镜像时，更新本报告和实际产物许可清单。

因此，本次结论是“具备可商用路线，条件已识别并有证据”，不是“所有依赖无条件放行”。未改许可证、未购买商业授权、未对外发布产品。

### Photoshop UXP 当前开发包

`apps/photoshop` 为 WorkProof 自有 MIT 源码；构建仅打入已有锁文件内的 `@noble/hashes` 并保留其实际 LICENSE。`photoshop`/`uxp` 模块由用户合法宿主提供，不作为 MIT 库打入包。当前生成开发加载 ZIP，不伪装为 Adobe 签发 `.ccx` 或已通过 Marketplace 审核；正式插件 ID 与分发按 Adobe 开发流程及适用条款另行办理。未增加新的 npm/Cargo 依赖，不能据此把 Adobe 宿主或 SDK 权利统称为开源许可。
