# 桌面内的核验页

## 2026-11-07 样式范围与检验单顺序

应用源码 `9f187b77105bda4525b17bc5e05e13e9a320e4b1` 将 Fluent 官方深浅色令牌限定在经过 `desktopAppearance` 校验的桌面内嵌页。独立网页保留原有管理端视觉样式；仅添加 `embedded=1`、页面自发消息或不受信任的父来源都不能启用 Fluent。主题样式只挂在 `.wp-stage.wp-fluent.wp-embedded` 上，不向独立网页注入 Fluent 自定义属性。现有共享 React 控件继续使用，未声称全部改写为 Fluent React 组件。

检验单位于编辑过程提醒之后、轨迹可视化之前，独立页和内嵌页均使用该顺序。异常数值、上下箭头及信息不足说明保留。

[Actions 42335149874](https://github.com/W-Boat/WorkProof/actions/runs/42335149874) 已通过 109 项 Chromium 检查，覆盖独立页面样式、可信父窗口的深浅色同步、内嵌 Fluent 主按钮颜色、伪造来源拒绝和检验单顺序。其截图及测试报告为 `verification-report` 产物 `13559346863`。这不代替操作系统级文件拖入、系统文件对话框或真实 Office 宿主验收。Windows 配套包由同源码 [42335138057](https://github.com/W-Boat/WorkProof/actions/runs/42335138057) 构建，本段记录时尚未完成本机切换。

以下保留较早阶段的原生窗口及权限验收记录。

桌面首页正在优先重做为统一的创作工作台，布局、交互及本次交付验收状态见[桌面工作台记录](DESKTOP-WORKBENCH.md)。首页重构保留这里的原生内嵌核验与权限隔离方案。

最新全量流程对本次构建的 Linux 安装包启用结果引导检查：成功与不匹配结果的焦点、“查看核验结果”入口，以及清空后回到作品选择。检查由 `WORKPROOF_EXPECT_RESULT_FLOW=1` 显式启用；使用旧 e4583b5 包的独立里程碑流程不冒充覆盖这项新界面。验收 JSON 单独记录 `result_flow_checked` 和对应检查项，新版原生结果待 Actions。

扩展验收已通过：[41508432610](https://github.com/W-Boat/WorkProof/actions/runs/41508432610)，实际应用 e4583b5、测试脚本 3eab125。实际文件输入、改动字节拒绝、原文件重选、窄窗布局与 PageDown 滚动均已检查；不代表操作系统选文件对话框、下载或打印已验收。下文“待本次 Actions”保留当时状态，以本段为准。

工作台的“在 WorkProof 内核验作品”打开独立的内嵌核验窗口，再次点击会恢复并聚焦现有窗口。页面复用随安装包提供的核验站点、Wasm 和组件，从本机随机回环端口加载，不依赖公网部署。工作台仍提供“在浏览器打开核验页”，供用户选择完整浏览器的分享、下载或打印体验。

内嵌窗口只能在该核验站点的精确回环来源内导航，不允许它打开额外窗口。所有桌面自定义命令同时检查调用窗口；核验窗口不能审批连接、启动宿主、安装插件、读取记录状态或调用原生文件签署/选择入口。没有给本机 HTTP 页面增加远程 IPC capability。导航回调依据 [Tauri WebviewWindowBuilder](https://docs.rs/tauri/2.12.5/tauri/webview/struct.WebviewWindowBuilder.html#method.on_navigation)。

新增导航和命令隔离测试交给 Actions，继续运行原有 Wasm 和真实浏览器核验。编译和纯策略测试不能替代实际系统 WebView 的交互验收；窗口打开、滚动、文件选择、下载、打印与关闭后资源释放仍需在支持平台检查。此修改不改变证书协议，也不代表全部平台已验证内嵌体验。

Linux 验收使用固定 `tauri-driver 2.1.0` 与系统 WebKitWebDriver，实际安装 DEB 后从工作台点击打开内嵌页，运行真实演示 Wasm，检查调用隔离、导航拒绝和窗口复用，并保存合成演示截图。驱动仅在 CI 安装，不进入用户安装包，不添加产品测试插件或 mock IPC。[首次实际验收 41498967934](https://github.com/W-Boat/WorkProof/actions/runs/41498967934) 已通过：测试脚本源码 `aadb613`，被安装应用来自 `7ee35ed` 的已成功 Linux 构建；两者版本分开记录，不能据此声称最新应用二进制已验收。该测试不覆盖系统文件选择、下载、打印或其他平台。方式依据 [Tauri 官方 WebDriver 说明](https://v2.tauri.app/develop/tests/webdriver/manual-setup/)。

本轮新增实际文件输入和窄窗验收：独立工作流改用 `e4583b5` 的已成功 Linux 安装包（[构建任务](https://github.com/W-Boat/WorkProof/actions/runs/41505275832/job/125485707115)），将同包合成作品及证书下载为 CI 临时目录中的真实文件，通过 WebDriver 的文件输入命令选择，再运行 Wasm；同时检查改动字节拒绝、重新选择原文件、480 像素窗口宽度与 PageDown 滚动。没有在页面注入 File/DataTransfer 或测试专用 IPC。新增检查尚待本次 Actions；WebDriver 文件输入不等于覆盖操作系统原生选文件对话框，下载/打印及其他平台也仍需验收。文件输入命令依据 [W3C WebDriver](https://www.w3.org/TR/webdriver2/#element-send-keys)。
