# Illustrator 原生接入：只读采样阶段

当前提供 Windows COM / ExtendScript 只读开发探针，不是完整记录插件或可安装正式版。先在合法安装的 Illustrator 中打开并保存本地文档，再用 Windows PowerShell 5.1 执行同目录 `read-snapshot.ps1`；脚本只附着已运行的 Illustrator，不启动软件，不保存或修改作品。

桥接返回本机文档路径、保存状态、对象和路径点计数，以及几何 SHA-256。对象 UUID、组内关系、边界、透明度及路径锚点和控制柄仅用于在本机计算摘要。即使外框与对象数量不变，路径控制柄变化也能改变摘要。文件路径仅供后续客户端绑定会话使用。

上限为 4096 个对象、8192 个路径点，调用之间检查 100 ms 预算。遇到不支持的对象属性、未保存文件或文档切换会返回错误。填充、效果和完整动作观察仍待接入，局部未隐藏数量不代表合成可见对象数。

源码 `1e14b12` 的 [Windows Actions 43580995215](https://github.com/W-Boat/WorkProof/actions/runs/43580995215) 已成功：生产 JSX 在模拟宿主运行，验证对象计数、等量几何变化、非法/重复 ID、无效值、容量及名称/正文不读取；PowerShell 仅解析，未执行 COM。真实 Illustrator 版本尚未验收，不把探针检查称为记录链已完成。

当前选用原生桥接，是因为 [Adobe 2026 年路线图](https://blog.developer.adobe.com/en/publish/2026/09/investing-in-the-future-of-creative-cloud-extensibility-uxp-comes-to-our-flagship-applications)将 Illustrator UXP 插件公开测试列为 2027 年春季；不能照搬 Photoshop UXP 模块就称已支持 Illustrator。[Adobe 官方脚本入口](https://helpx.adobe.com/illustrator/using/automation-scripts.html)说明了脚本与自动化环境。

自有代码 MIT，不捆绑 Adobe 软件、SDK 头文件、授权证书或商业资源。此路径目前只针对 Windows；macOS 与未来 UXP 迁移仍待接入。
