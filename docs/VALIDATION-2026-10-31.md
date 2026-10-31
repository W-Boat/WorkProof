# 2026-10-31 恢复开发验证记录

所有编译、打包与自动化测试均在 GitHub Actions；本机只下载并校验产物，进行现有运行目录的升级和运行验收。未导入 Windows 信任证书、未修改 Office 注册项、未部署生产环境。

## Word/WPS

提交 `31cdd72`：[独立 Office 验证](https://github.com/W-Boat/WorkProof/actions/runs/41205157421)通过。

- 8 项功能区测试：宿主别名、同源任务窗、复用/失效重建、拒绝非安全来源、拒绝凭据 URL、失败重试。
- 11 项模拟宿主浏览器测试：Word、三种 WPS API 形式、文字不进入请求、交付摘要、保存失败、空文件/非字节数据、路径变化、暂停后换文档、WPS 能力缺失时不加载微软运行库。
- 包含 Word HTTPS 清单、共享任务窗、WPS 自有原生入口；不包含条款未确认的 `wpsjs` 工具或上游安装模板。

模拟测试不替代真实 Word/WPS 加载与交付验收；正式 WPS publish 安装页仍未交付。

## 桌面、核心、网页与分发

提交 `134112f`：[完整工作流](https://github.com/W-Boat/WorkProof/actions/runs/41205418183)的 Linux 和 Windows 任务通过。覆盖 Rust、Wasm、VS Code、Office 模拟、真实 Blender、浏览器核验、NSIS、真实托盘与 Windows 采样。

Windows 关闭状态窗时，根进程及直接子进程工作集 16.34 MB；3 秒空闲 CPU 采样为 0%；4096 条合成事件、128 条每批的 HTTP 持久化 p50 8.948 ms、p95 13.717 ms。该值包含 PowerShell 客户端与 SQLite 开销，不是宿主回调延迟，也不覆盖完整后代进程树或所有用户机器。

Blender 扩展包附完整 Python 源码、GPLv3 正文、原 MIT 声明和分发说明；manifest 选择 GPL-3.0-or-later。原自有源码 MIT 授权保留。这不代表 Extensions 平台审核通过。

## Blender 视口采样

提交 `7099ad0`：[原生 Blender 工作流](https://github.com/W-Boat/WorkProof/actions/runs/41206049201)通过，实际宿主为 Blender 5.0.1。

采集可见区域的旋转、平移、缩放和透视模式变化，每秒采样；这些状态仅暂存在主线程内存，证书中只输出累计变化采样次数。新增/关闭区域只重建基线，暂停时不计数，恢复时重建基线。多个动作可能合并或被采样遗漏，不应解释成精确手势数量。

真实 Blender API 测试验证旋转和缩放、暂停缺口、无重复空闲计数、交付 `.blend` 绑定及统计篡改拒绝。证书中没有视口坐标。工厂场景 100 次同步空闲采样 p95 约 0.023 ms，仅代表该场景与采样函数，不是完整交互性能或所有版本验证。

## 机构后台与本机运行

提交 `134112f`：[机构验证](https://github.com/W-Boat/WorkProof/actions/runs/41205435537)的真实 JAR/MySQL/Valkey 集成和 Windows 控制器任务通过。

本机已校验归档摘要，在服务停止并持有运行锁时替换 JAR，保留旧包，账号文件不变。启动后验收 HTTP/HTTPS、Word/WPS 资源、未登录 API 401、原账号登录、路由权限与登出令牌失效。HTTPS 仅显式指定证书文件进行主机名/链校验，没有修改 Windows 信任库。后台入口为 `http://127.0.0.1:18081/login`，本机缓存运行时为 Garnet。

## 已校验的归档 SHA-256

| 产物 | SHA-256 |
|---|---|
| Office 包（41205157421） | `634557ee7e199b438a7f541402c38808cb0f9ef271506fc3de9eb3ff462ad590` |
| Web/扩展包（41205418183） | `e4b168a11106521c286a8bf81ba6649a502f8f764bc669844f44d570e223a956` |
| Windows 包（41205418183） | `b663f8bcc7ee173c2387d46e914f3eb8022e8b3ffa7ae07ba75794f9e1d9290b` |
| 机构包（41205435537） | `9e03f60dc78fb4ce6530afe882cba18452f4cafd99124c35d26eac5474180fd8` |
| Blender CI 外层归档（41206049201） | `41d9e2c87256c93c15beca2b962d12d3f9d01fbce61cdaac7a825556876723ff` |
| Blender 可安装内层 ZIP（7099ad0） | `64bc189f3de0fe2b3925e5008a0cea63601881068a105e909bec88a856635e79` |

## 尚未完成

真实 Word/WPS 宿主验收、WPS 正式安装发布、Photoshop UXP、完整演进结构、Merkle/TSA/C2PA、机构证书业务、全新 Windows 运行时引导和跨平台交付。详细范围以 [全阶段清单](ALL-STAGES.md)为准，不把本轮绿色 CI 视为整个产品完成或“100% 人类创作”认证。
