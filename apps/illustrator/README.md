# Illustrator 原生接入：只读采样阶段

当前提供 Windows COM / ExtendScript 只读开发探针，不是完整记录插件或可安装正式版。先在合法安装的 Illustrator 中打开并保存本地文档，再用 Windows PowerShell 5.1 执行同目录 `read-snapshot.ps1`；脚本只附着已运行的 Illustrator，不启动软件，不保存或修改作品。

采样返回文档路径及对象 UUID、对象类型、组父级、边界、透明度和局部隐藏状态，供之后的本机记录桥接处理。路径和几何是私有桥接数据，不能直接当作公开事件发送；正式记录链应先摘要并仅披露选定的统计。探针不读取图层名称和正文。对象最多 4096 个，调用边界检查 100ms 预算，不承诺可以抢占宿主的同步调用。

缺少稳定 UUID、没有已保存文件、对象过多或采样期间文档切换都会拒绝返回正常快照。几何边界不能覆盖所有路径锚点、填充、效果和画笔变化；局部未隐藏也不等于最终合成可见。后续需补完整的受支持属性摘要、实际动作、授权、重连、暂停/缺口及证书导出。

源码 `1e14b12` 的 [Windows Actions 43580995215](https://github.com/W-Boat/WorkProof/actions/runs/43580995215) 已成功：生产 JSX 在模拟宿主运行，验证对象计数、等量几何变化、非法/重复 ID、无效值、容量及名称/正文不读取；PowerShell 仅解析，未执行 COM。真实 Illustrator 版本尚未验收，不把探针检查称为记录链已完成。

当前选用原生桥接，是因为 [Adobe 2026 年路线图](https://blog.developer.adobe.com/en/publish/2026/09/investing-in-the-future-of-creative-cloud-extensibility-uxp-comes-to-our-flagship-applications)将 Illustrator UXP 插件公开测试列为 2027 年春季；不能照搬 Photoshop UXP 模块就称已支持 Illustrator。[Adobe 官方脚本入口](https://helpx.adobe.com/illustrator/using/automation-scripts.html)说明了脚本与自动化环境。

自有代码 MIT，不捆绑 Adobe 软件、SDK 头文件、授权证书或商业资源。此路径目前只针对 Windows；macOS 与未来 UXP 迁移仍待接入。
