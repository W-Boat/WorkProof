# 桌面内的核验页

工作台的“在 WorkProof 内核验作品”打开独立的内嵌核验窗口，再次点击会恢复并聚焦现有窗口。页面复用随安装包提供的核验站点、Wasm 和组件，从本机随机回环端口加载，不依赖公网部署。工作台仍提供“在浏览器打开核验页”，供用户选择完整浏览器的分享、下载或打印体验。

内嵌窗口只能在该核验站点的精确回环来源内导航，不允许它打开额外窗口。所有桌面自定义命令同时检查调用窗口；核验窗口不能审批连接、启动宿主、安装插件、读取记录状态或调用原生文件签署/选择入口。没有给本机 HTTP 页面增加远程 IPC capability。导航回调依据 [Tauri WebviewWindowBuilder](https://docs.rs/tauri/2.12.5/tauri/webview/struct.WebviewWindowBuilder.html#method.on_navigation)。

新增导航和命令隔离测试交给 Actions，继续运行原有 Wasm 和真实浏览器核验。编译和纯策略测试不能替代实际系统 WebView 的交互验收；窗口打开、滚动、文件选择、下载、打印与关闭后资源释放仍需在支持平台检查。此修改不改变证书协议，也不代表全部平台已验证内嵌体验。

Linux 完整流程另使用固定 `tauri-driver 2.1.0` 与系统 WebKitWebDriver，实际安装 DEB 后从工作台点击打开内嵌页，运行真实演示 Wasm，检查调用隔离、导航拒绝和窗口复用，并保存合成演示截图。驱动仅在 CI 安装，不进入用户安装包，不添加产品测试插件或 mock IPC。首次结果尚待 Actions；该测试不覆盖系统文件选择、下载、打印或其他平台。方式依据 [Tauri 官方 WebDriver 说明](https://v2.tauri.app/develop/tests/webdriver/manual-setup/)。
