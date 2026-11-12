# Windows 桌面交付：2026-11-12

最新已在用户机器安装并打开的版本来自 `4d25f8e7aa04f7072f18bb1884334a6374f046d6`，替换了先前的 `126a289`。历次升级均通过应用自带退出操作关闭旧版。这是开发版，不能把本次 Windows 安装结果扩展为所有平台、宿主版本均已验收。

## 本次交付

- Word、PowerPoint、WPS、VS Code、Photoshop、Blender 使用同一组深绿与浅绿插件图标，覆盖应用入口、连接申请及外部文档列表。六张透明 PNG 通过内置 ImageGen 分别生成，原图及完整提示词保存在 [品牌资源](../assets/brand/adapters/generation-v1.json)。打包时生成 128px WebP，每张限制在 32KiB 内。
- Windows 后台收到新的插件连接申请时发送系统通知。点击通知后显示来源与允许、拒绝操作；不会因为点击通知就同意连接。系统通知权限被关闭或通知接口失败时，改为打开确认对话框。通知的实际横幅呈现仍受 Windows 通知设置影响，本次尚未完成真实宿主请求与通知点击的整条人工验收。
- 客户端内嵌核验页可离线查看 PNG、JPEG、DOCX、PPTX 元数据。元数据可以修改，只作为辅助线索，不代替文件指纹、记录链和签名核验；目前没有在这个入口增加 PDF 元数据解析。
- 安装包附带新 Word / PowerPoint 原生加载项，功能区可返回真正的品牌位图。加载项的安装、注册与实际 Office 内显示仍须分别检查，不能仅凭文件打包就称宿主已经升级。

## 已核对的证据

- [构建运行 43148825351](https://github.com/W-Boat/WorkProof/actions/runs/43148825351)：Windows 安装包、协议及网页、macOS Intel 和 ARM 任务成功。Linux 最后的窗口复用检查失败，整个运行没有全部通过。
- [Windows 安装包及构建证明](https://github.com/W-Boat/WorkProof/actions/runs/43148825351/artifacts/13913283466)：外层 ZIP SHA-256 为 `77065cf1ba4cca6d517a62581c0fb1e35d3bc9c0166037959f51aeb08ced5632`；安装程序 SHA-256 为 `b5f0a877ecacff246f58570b6ffd86c8b16704dcfd91b8d7ed348a5899614371`。下载后核对了摘要、证明中的源码提交和安装程序摘要。
- [原生加载项配套验证 43148825397](https://github.com/W-Boat/WorkProof/actions/runs/43148825397)：32 位、64 位与配套桌面检查成功，包括 COM 图片返回及实际 32×32 位图检查。
- [Windows Edge 界面检查](https://github.com/W-Boat/WorkProof/actions/runs/43150537079/job/130958372979)成功，包括六张图标解码、本地元数据扫描、通知激活后显式确认的模拟事件路径。它不能证明 Windows 实际通知已送达。

安装时通过托盘的“退出 WorkProof”正常关闭旧版，没有强制结束进程。新安装位于 `%LOCALAPPDATA%/Programs/WorkProof`，桌面快捷方式已指向该位置。本次读取安装后的文件并对比 Actions 中的桌面程序，差异仅为 Tauri 打包时保留标记从 `__TAURI_BUNDLE_TYPE_VAR_UNK` 变为 `__TAURI_BUNDLE_TYPE_VAR_NSS`；其他字节一致。已打开客户端并查看“应用连接”页，六个图标均正常显示。

## 后续验证与限制

本次安装后的后续源码修复尚未装到用户机器：`f54a576` 在文件列表相同数据刷新时保留原按钮，避免刷新打断点击；工具栏测试等待实际布局动画结束。[回归 43153438767](https://github.com/W-Boat/WorkProof/actions/runs/43153438767) 已全部成功，三浏览器共 216 项、Windows Edge 72 项，包括按下鼠标后触发相同数据刷新再松开，仍能打开原文档的用例。

`8321009` 的 Linux 安装验收区分原生 Fluent 内嵌页与旧 iframe，并补充原生页面的篡改拒绝与有效证书操作隔离，同时加强安装后桌面程序字节核对。[完整构建 43153932062](https://github.com/W-Boat/WorkProof/actions/runs/43153932062) 仍在验证，不能沿用旧运行的成功结论。

Windows 发布者身份需要正式代码签名凭据。GitHub 构建来源证明和品牌图标不能消除“未知发布者”，本次没有绕过系统警告或导入自签名根证书。

全阶段的宿主覆盖、机构服务、互操作及 AI 辅助判断继续以 [全阶段验收](ALL-STAGES.md) 为准，本次桌面交付不代表全项目完成。

## 后续更新：过程回放与完整加密报告

- 已安装并打开 `126a289` 的 Windows 安装包，来源为 [Actions 43224862935](https://github.com/W-Boat/WorkProof/actions/runs/43224862935)。Windows、协议及网页、资源任务成功。安装前退出 WorkProof，未强制终止进程；当时没有运行中的 Word 或 PowerPoint。
- 外层 ZIP SHA-256：`b3b8d626a5ae86d9d409f67103815547a962958fe8921c314c08f5db4d4c50ba`。安装程序 SHA-256：`0517b037e185fe27527493a8b5fc4e072f04039e10cb16edfc869aeae77e4a68`。核对构建证明中的仓库、源码、运行编号和安装程序摘要，并核对 CI 的证明验证结果。
- 安装后的主程序 SHA-256：`411ab9eab00d133af78ce235755f0854f86da23ffc0978ea42dbf0ba6faf30bf`。与同次构建原始程序逐字节比较，仅存在 Tauri 安装类型保留标记 `UNK` → `NSS` 的预期变化。离线 Wasm 构建信息为同一源码。
- 启动后窗口为“WorkProof · 创作工作台”，可见“记录服务已就绪”；只读状态查询显示原有 14 个会话、230 条事件仍在。桌面快捷方式指向 `%LOCALAPPDATA%/Programs/WorkProof/workproof-desktop.exe`。
- 内置编辑器的“过程”页新增[过程回放](PROCESS-REPLAY.md)。核验结果页新增[完整加密 HTML 报告](ENCRYPTED-REPORT.md)，含已披露的全部记录、检验单、十种图、已完成的元数据检查和原始证书；用户明确选择原作品另附。保存同时生成 MD5、SHA-256 及证书指纹关联清单。
- [界面检查 43224863095](https://github.com/W-Boat/WorkProof/actions/runs/43224863095) 的三浏览器 225 项和 Windows Edge 75 项通过。首次 Edge 运行有一项源码编辑器失败重试场景的工具栏展开等待超时；同源码重跑失败任务后 75 项全部通过，未据此声称已定位或修复该偶发时序问题。
- Windows CI 实际安装 NSIS 包、核对资源、检查报告精确字节和摘要、校验窗口与托盘；本机只完成已验证包安装、启动和只读状态确认，没有本机构建或本机测试，也没有代用户生成真实报告或修改文档。

## 后续更新：边距、外部打开方式和核验回放

`4d25f8e` 已在用户电脑安装并启动。新内容包括 Word 分页内框居中、默认用对应软件打开外部文件及三种可保存的打开偏好、“新增与删除”统计图的独立图例区域，以及客户端和随包独立核验网页的过程统计回放。部分披露证书只支持逐条浏览已披露动作，不播放连续时间轴；没有补造历史正文或隐藏记录。

- [界面验收 43237102575](https://github.com/W-Boat/WorkProof/actions/runs/43237102575)：Windows Edge 77 项、Linux 三浏览器 231 项成功。包含实际左右距离比较、外部打开与导入副本的区别及偏好保持、真实 Wasm 核验后回放、滑块、前后动作、播放暂停及实际 Fluent SVG。
- [完整构建 43237103020](https://github.com/W-Boat/WorkProof/actions/runs/43237103020)：交付时 Windows、网页及协议、资源、Linux 和 macOS ARM 任务已成功；macOS Intel 任务仍在运行，不将当时状态称为六项全通过。Windows 包包含实际 NSIS 安装与资源核对、窗口/托盘、报告保存、来源证明验证及错误来源/篡改拒绝。
- [前一界面版本的实图](evidence/desktop-layout-7f20af0/sources.json)已逐张检查，左右留白相同，图例在图形上方，回放控件有真正的 Fluent 图标。截图使用合成记录，来源明确为 `7f20af0`；后续 `4d25f8e` 保持布局，修正播放时钟并增加指令次数显示。
- Windows [交付包](https://github.com/W-Boat/WorkProof/actions/runs/43237103020/artifacts/13952349398)外层 SHA-256：`79fadf414d957687429dc970d0389a46f511773335de9da794ff86f28f91be48`。安装器 SHA-256：`9c23a3917f6a8663398ebf4f43934585ef0a075bcb79567b49d7cd8b070da40d`。已核对 GitHub 外层摘要、CI 验证的来源证明及源码/运行/安装器关联。
- 已安装主程序 SHA-256：`6077947fcaf469744c0d410d33ec320aa6eda3398956bad947bbd7e1e8c56e0a`；与本次原始二进制逐字节匹配，仅有 Tauri `UNK` → `NSS` 保留标记的预期差异。离线核验引擎构建信息同源。
- 安装前没有运行中的 Word/PowerPoint，旧版经托盘正常退出，没有强制结束进程；安装后窗口响应，记录服务返回原有 14 个会话、230 条事件。没有本机编译、自动化功能测试或创建测试文档。
