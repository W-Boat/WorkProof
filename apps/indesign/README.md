# InDesign 记录开发版

在 Windows 打开 InDesign 中已经保存的本地 .indd 文件，再在 WorkProof 的应用连接页选择 InDesign 并选择同一文件。记录期间切换作品会暂停。完成后在 InDesign 保存，再从 WorkProof 导出证书并与原作品一同交付。

适配器通过正在运行的 InDesign 读取文本与页面对象的位置、尺寸及旋转角度。Windows 桥接进程在本机计算摘要，证书保存变化摘要和 BLAKE3 文件指纹。正文和本机绝对路径留在本机。单次采样最多处理 1024 页、4096 个版面对象及 100 万个宿主计数的字符。字体、颜色、链接文件内容及每个操作的顺序仍需要扩展。

自动检查覆盖同字数文本变化、旋转变化、保存状态、签名及文件改动拒绝。实际 Windows COM 连接及采样性能需要在安装了 InDesign 的 Windows 上验收。

[Adobe InDesign Document API](https://developer.adobe.com/indesign/uxp/dom/api/d/document/) · [Adobe 脚本语言常量](https://developer.adobe.com/indesign/uxp/dom/api/s/script-language/)
