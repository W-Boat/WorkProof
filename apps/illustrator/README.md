# Illustrator 原生接入：只读采样阶段

Windows 开发版已接入桌面“应用连接 → Adobe Illustrator”。在 Illustrator 打开已保存的本地 `.ai`，再在 WorkProof 选择同一份文件。客户端定期采样几何与保存版本，文档切换会暂停。完成后在 Illustrator 保存，再导出证书并与原作品一起交付。

`read-snapshot.ps1` 也可作为独立的 Windows PowerShell 5.1 开发探针。采样附着在正在运行的 Illustrator 上。

桥接返回本机文档路径、保存状态、对象和路径点计数，以及几何 SHA-256。对象 UUID、组内关系、边界、透明度及路径锚点和控制柄仅用于在本机计算摘要。即使外框与对象数量不变，路径控制柄变化也能改变摘要。文件路径仅供后续客户端绑定会话使用。

上限为 4096 个对象、8192 个路径点，调用之间检查 100 ms 预算。遇到不支持的对象属性、未保存文件或文档切换会返回错误。填充、效果和完整动作观察仍待接入，局部未隐藏数量不代表合成可见对象数。

[曲线采样专项](https://github.com/W-Boat/WorkProof/actions/runs/43585173901) 已检查路径控制柄变化、异常输入及 PowerShell 脚本解析。证书集成另有真实 Rust 签名测试和桌面模拟交互测试。实际 Illustrator COM、采样耗时与文档切换仍需在 Windows 宿主验收。

当前选用原生桥接，是因为 [Adobe 2026 年路线图](https://blog.developer.adobe.com/en/publish/2026/09/investing-in-the-future-of-creative-cloud-extensibility-uxp-comes-to-our-flagship-applications)将 Illustrator UXP 插件公开测试列为 2027 年春季；不能照搬 Photoshop UXP 模块就称已支持 Illustrator。[Adobe 官方脚本入口](https://helpx.adobe.com/illustrator/using/automation-scripts.html)说明了脚本与自动化环境。

自有代码 MIT，不捆绑 Adobe 软件、SDK 头文件、授权证书或商业资源。此路径目前只针对 Windows；macOS 与未来 UXP 迁移仍待接入。
