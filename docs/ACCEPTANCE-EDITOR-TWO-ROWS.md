# 两层编辑栏与侧栏修复验收

## 交付内容

文档名称、撰写／过程／证书、Word／Markdown 和导出合并为一层。开始／插入／布局、当前工具和视图按钮合并为第二层，常规顶部约 90 像素。窄窗口允许横向查看工具，点击分类会展开折叠工具。折叠导航固定使用 44 像素按钮和居中的 20 像素图标。

普通消息在 6 秒后关闭，指针或键盘停留时暂停。错误提供关闭按钮并保留显示。消息位于右下角，保存重试不会被遮挡。关闭消息恢复此前焦点。需要确认的宿主连接请求独立保留。

浮动大纲、动作侧栏及背景遮罩从命令栏下方开始，保留顶部按钮可用。窗口尺寸改变时重新评估显式展开偏好；同尺寸下 Esc 收起状态继续保留。默认空间预算按整个窗口面积计算，为编辑画布预留至少 70%。

## Actions 证据

- 桌面源码：`0059dd03e2dd7c477ccd661794a3087e3fe6b4ef`。
- [三浏览器界面检查](https://github.com/W-Boat/WorkProof/actions/runs/42221813143)：144 项通过，覆盖 Chromium、Firefox、WebKit，包括 1919 × 1023 深色两层布局、图标边界、提示计时与暂停、保存失败重试、侧栏恢复、精简模式，以及编辑引擎按需加载。
- 上述界面运行使用提交 `8395fd8f540fb7554f7a874cb183e2e87c697b8d`。相对交付提交，仅增加 Linux 验收脚本和远程字体准备限制；桌面前端、UI、Tauri 与引擎源码相同。
- [网页与协议检查](https://github.com/W-Boat/WorkProof/actions/runs/42220220424/job/127900103687)：该 job 通过，100 项 Chromium 流程通过。此链接不表示整个跨平台 workflow 全部通过。
- [Windows 完整包](https://github.com/W-Boat/WorkProof/actions/runs/42220220448)：三个 job 全部通过，包括两种 Office 架构、真实采集引擎、打包核验页面与包内文件检查。

浏览器界面检查使用受限 IPC 夹具，真实本机存储与签名由 Rust 检查覆盖。Windows 包内 COM 探针及隔离注册检查不代替实际 Word／PowerPoint 人工操作。

## 包核对

Artifact `13504341607`，名称 `workproof-native-word-windows-dev`，来源为上述 Windows run。下载后在用户机器只读校验外层 SHA-256、包内全部 2526 个文件哈希、PE 架构和生成 Wasm 的来源，再解压到独立目录。没有本地构建、测试或依赖安装。

外层 SHA-256：`ff1c98325bc591ece26c255456869e6ac1e54f70dc52aaeeef971c796072cc7f`。

内部交付 ZIP SHA-256：`2f67618c545dcd7d20608d6a614a7642f86072f977203258b29b0a76b655858a`。

本机包：`E:/work/WorkProof-Delivery/WorkProof-PC-0059dd0.zip`。解压目录：`E:/work/WorkProof-Delivery/WorkProof-PC-0059dd0`。

截至本记录，旧版 `6e900d6` 仍在托盘运行，等待用户保存并退出后切换。包核对与远程测试不能表述为新版已在用户机器启动。
