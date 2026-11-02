# 桌面内的核验页

工作台的“在 WorkProof 内核验作品”打开独立的内嵌核验窗口，再次点击会恢复并聚焦现有窗口。页面复用随安装包提供的核验站点、Wasm 和组件，从本机随机回环端口加载，不依赖公网部署。工作台仍提供“在浏览器打开核验页”，供用户选择完整浏览器的分享、下载或打印体验。

内嵌窗口只能在该核验站点的精确回环来源内导航，不允许它打开额外窗口。所有桌面自定义命令同时检查调用窗口；核验窗口不能审批连接、启动宿主、安装插件、读取记录状态或调用原生文件签署/选择入口。没有给本机 HTTP 页面增加远程 IPC capability。导航回调依据 [Tauri WebviewWindowBuilder](https://docs.rs/tauri/2.12.5/tauri/webview/struct.WebviewWindowBuilder.html#method.on_navigation)。

新增导航和命令隔离测试交给 Actions，继续运行原有 Wasm 和真实浏览器核验。编译和纯策略测试不能替代实际系统 WebView 的交互验收；窗口打开、滚动、文件选择、下载、打印与关闭后资源释放仍需在支持平台检查。此修改不改变证书协议，也不代表全部平台已验证内嵌体验。

Linux 验收使用固定 `tauri-driver 2.1.0` 与系统 WebKitWebDriver，实际安装 DEB 后从工作台点击打开内嵌页，运行真实演示 Wasm，检查调用隔离、导航拒绝和窗口复用，并保存合成演示截图。驱动仅在 CI 安装，不进入用户安装包，不添加产品测试插件或 mock IPC。[首次实际验收 41498967934](https://github.com/W-Boat/WorkProof/actions/runs/41498967934) 已通过：测试脚本源码 `aadb613`，被安装应用来自 `7ee35ed` 的已成功 Linux 构建；两者版本分开记录，不能据此声称最新应用二进制已验收。该测试不覆盖系统文件选择、下载、打印或其他平台。方式依据 [Tauri 官方 WebDriver 说明](https://v2.tauri.app/develop/tests/webdriver/manual-setup/)。

本轮新增实际文件输入和窄窗验收：独立工作流改用 `e4583b5` 的已成功 Linux 安装包（[构建任务](https://github.com/W-Boat/WorkProof/actions/runs/41505275832/job/125485707115)），将同包合成作品及证书下载为 CI 临时目录中的真实文件，通过 WebDriver 的文件输入命令选择，再运行 Wasm；同时检查改动字节拒绝、重新选择原文件、480 像素窗口宽度与 PageDown 滚动。没有在页面注入 File/DataTransfer 或测试专用 IPC。新增检查尚待本次 Actions；WebDriver 文件输入不等于覆盖操作系统原生选文件对话框，下载/打印及其他平台也仍需验收。文件输入命令依据 [W3C WebDriver](https://www.w3.org/TR/webdriver2/#element-send-keys)。
