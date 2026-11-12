# Windows 桌面交付：2026-11-12

本次已在用户机器安装并打开的版本来自 `df21dac6d09dba963dee6fb60ccf9fc4eab89858`。这是开发版，不能把本次 Windows 安装结果扩展为所有平台、宿主版本均已验收。

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

本次安装后的后续源码修复尚未装到用户机器：文件列表相同数据刷新时保留原按钮，避免刷新打断点击；工具栏测试等待实际布局动画结束；Linux 安装验收区分原生 Fluent 内嵌页与旧 iframe，并补充原生页面的篡改拒绝与有效证书操作隔离。这些改动分别通过后续 Actions 验证，不沿用旧运行的成功结论。

Windows 发布者身份需要正式代码签名凭据。GitHub 构建来源证明和品牌图标不能消除“未知发布者”，本次没有绕过系统警告或导入自签名根证书。

全阶段的宿主覆盖、机构服务、互操作及 AI 辅助判断继续以 [全阶段验收](ALL-STAGES.md) 为准，本次桌面交付不代表全项目完成。
