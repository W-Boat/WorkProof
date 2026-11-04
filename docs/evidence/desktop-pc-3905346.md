# Windows PC工作台交付核对

源码 `3905346ecde5202e73e578dc5bb8eb2e23c74eee` 的[界面专项41875984092](https://github.com/W-Boat/WorkProof/actions/runs/41875984092)日志显示 Chromium、Firefox、WebKit 共30项通过，21.0秒。导航切换、宿主选择保持、页面焦点、连接撤销、错误恢复及窄窗布局均执行。该专项使用模拟IPC，不等同真实Office验收。

报告产物13346244583已下载并匹配SHA256 `d0c8f53cffc8fdd6f0c073ecb6a7ad8c5343461b33a4085316895e610e81073e`。实际查看了PC创作工作区截图，固定左侧导航、独立内容区及底部状态栏可见；截图SHA256 `e0755703aaee9e7a64dc6a8827282357c4dd41b595d2eee1085372a0e536e168`，其中数量与连接为合成数据。完整日志SHA256 `f525dc8b61e59d79c1eeae8ddecdbcec8863a8767d4002aff4e8361c00cdb2c7`。

[Windows配套任务41875984358](https://github.com/W-Boat/WorkProof/actions/runs/41875984358)产物13346409723已下载，40,987,244字节，外层SHA256 `5df8312774f848998ce932afbae01d91f8577013edd7633d9cc78859f6f8043e`。内层 `E:/work/WorkProof-Delivery/WorkProof-PC-3905346.zip` 的SHA256为 `b0c74625e98f2a8d908eca04e0ba249ce23877067d2c4f6cb850b639c39a70cf`；2,424项文件摘要和实际文件集合全部匹配，桌面x64及Office x86/x64 PE架构、Wasm资源版本和摘要均核对。

归档解压至独立的 `E:/work/WorkProof-Delivery/WorkProof-PC-3905346/` 后，已实际启动其中的桌面程序。进程22700的路径匹配新目录，且同一进程监听127.0.0.1:43127。未覆盖旧安装、替换已注册DLL或关闭Office。启动证明不扩大为所有按钮、真实宿主或完整Windows原生交互已验收。

记录时API部分任务仍显示in_progress且无活动步骤，因此不将产物存在或完成日志扩大为整个工作流终态成功。原生Linux新版导航验收脚本另在27c7b98修订，全平台流水线41876311646仍需单独核对。当前未作整项目完成或商用许可全部通过声明。
