# 桌面平台与首次使用

最新开发包 `50a00c5` 已通过[完整 Actions 41567780689](https://github.com/W-Boat/WorkProof/actions/runs/41567780689)五任务。Windows 安装器已下载至 `E:/work/WorkProof-Delivery/WorkProof-Desktop-Windows-50a00c5-setup.exe`，大小 10,794,803 字节，SHA256 为 `d0459019c297a6909d53565b7b36f4d056f58415906f6cff6d0745c24c3266c0`。来源 artifact `13200328302` 的 ZIP 摘要 `4d19d901cce9efbd18e3b5f1f16ef1957e80e99878277d8efb5ca8fa78707e60` 与 GitHub 一致；包内桌面程序确认为 x64 PE。仅提取交付，未执行安装或替换当前软件。该版 Linux 内嵌网页真实结果流程已通过，范围见[易用性](USABILITY.md)；构建通过不代表 Windows 实机 UI 或全新电脑安装流程已完成。

## 三步使用

1. 打开 WorkProof，选择你用来创作的软件。
2. 按该软件的三步提示开始记录。Word/WPS/Photoshop 首次连接需回到这里核对并允许。
3. 完成后导出证书，与对应的作品原文件一起交付。接收方可用“检查作品和证书”重新核对。

默认展示 Word，随后是 WPS。选择其他软件后只显示它的步骤。VS Code 的安装按钮只在选中 VS Code 时显示；Word/WPS/Photoshop 尚未完成的安装入口会直接说明，不显示假安装成功。记录数量折叠在说明中，使用“已开始的记录”“已保存的操作”等普通语言。

## 平台交付

Windows 保留现有 NSIS 安装器。新增 Actions 任务在 Ubuntu 22.04 x64 构建 DEB，在 macOS 15 Apple Silicon 与 Intel 运行器分别构建 `.app` 并用 tar.gz 保留可执行权限。Linux 任务安装真实 DEB 后在虚拟显示环境启动，macOS 任务启动真实 app bundle 的二进制；只有各自任务成功后才将相应平台记为通过。

最终代码 `c5a830a` 已通过 [Actions 41269692613](https://github.com/W-Boat/WorkProof/actions/runs/41269692613) 的五项任务：协议/网页、Windows、Linux x64、Mac ARM、Mac Intel，28 项浏览器测试通过。没有 Apple 开发者签名或公证凭据，不能把开发版 macOS 包称为已公证正式发布。不同 Linux 桌面的托盘、默认浏览器、Wayland 和宿主插件仍需实机验收；不支持用一个 CI 运行器证明全部发行版、全部 macOS 版本或所有宿主。

本机交付目录为 `E:/work/workproof-delivery-c5a830a`，按 `Windows`、`Linux`、`macOS-AppleSilicon`、`macOS-Intel` 分开存放。独立检查确认 Unix 包含离线核验页、Wasm 和 VSIX，Mac 两种 Mach-O 架构正确、tar 保留可执行权限。未在 Windows 上安装或运行 Unix 包，也未在本机执行 Windows 安装器。

浏览器打开命令分别使用 Windows 的系统处理程序、macOS `open` 和 Linux `xdg-open`。接口只接收本机核验服务端口，不接收任意网址。某些系统工具会等待浏览器退出，WorkProof 不因此杀死浏览器；界面仅表示已向系统发出打开请求。找不到工具或快速返回失败会显示错误。

VS Code 优先查找 `code` 命令；Windows 支持常见的每用户/系统安装目录，macOS 支持系统或用户“应用程序”目录。调用时传递独立参数，不拼接 shell 命令。安装失败不会报告成功，超过一分钟会提示用户检查结果或手动安装 VSIX。不会安装或捆绑 VS Code 本体。

## 统一记录目录

| 平台 | 默认位置 |
|---|---|
| Windows | `%LOCALAPPDATA%/WorkProof`，缺失时使用用户目录下的 `AppData/Local/WorkProof` |
| macOS | `~/Library/Application Support/WorkProof` |
| Linux | `$XDG_DATA_HOME/WorkProof`，未设置有效绝对路径时用 `~/.local/share/WorkProof` |

Rust 引擎、VS Code 与 Blender 使用同一规则。`WORKPROOF_DATA_DIR` 可指定绝对路径；相对路径会被拒绝。找不到用户目录时明确失败，不再把私钥或记录写进当前工作目录。Unix 上记录目录权限保持为 0700。

旧版 Windows 默认位置不变。早期手动在其他位置保存的 Mac/Linux 数据不会被移动、覆盖或自动合并；需继续使用其绝对路径配置，或保留旧目录后明确迁移。不要删除旧记录。

验证由 Actions 对同一输入环境分别调用真实 Rust 路径解析、编译后的 TypeScript 和独立 Python 模块，覆盖空环境、覆盖路径、空格、相对路径、系统默认值及回退。桌面平台命令另有原生 Rust 单测；它们验证命令和失败处理，不等于自动操作真实浏览器或 VS Code。

平台配置依据：[Tauri 系统依赖](https://v2.tauri.app/start/prerequisites/)、[Tauri macOS bundle](https://v2.tauri.app/distribute/macos-application-bundle/)、[GitHub 运行器架构](https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/choose-the-runner-for-a-job)、[VS Code macOS 安装](https://code.visualstudio.com/docs/setup/mac)。未新增第三方 Rust/JavaScript/Python 库；Linux 使用系统 WebKitGTK，macOS 使用系统 WebView。
