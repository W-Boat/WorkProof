# 2026-11-01：协议 v3 与浏览器统一体验

源码交付提交 `6c59057`，分支 `codex/workproof-mvp`。全程未在本地构建；本机只运行经摘要校验的 Actions 产物。

## 证据能力

`workproof/3` 在原事件链外增加签名 Merkle 根。网页与 CLI 可不读取私钥、不重新签名地导出所选事件，保留原清单与签名。部分证据始终标明范围，`chain_valid=false`，不冒充完整链核验；图片与打印同样保留声明。

Rust 测试覆盖非二次幂树、每个叶子位置、100,000 条树深度、披露上限、篡改/缺失/额外路径、重复与乱序、强制边界、文件替换、会话变化与协议降级。独立 JavaScript 实现交叉核对编码、树形、Ed25519、CLI 和历史 v2 冻结签名。协议细节见 [v3](PROTOCOL-V3.md)。

前两轮完整验证：[cd7fe40](https://github.com/W-Boat/WorkProof/actions/runs/41210339331)、[5129222](https://github.com/W-Boat/WorkProof/actions/runs/41210854844) 均通过。最终交付以以下 `6c59057` 的工作流为准。

## 浏览器重构与复用

按用户确认，核验页与管理端统一体验。独立核验页直接导入管理端六层设计 CSS；React 对管理端 Button、Panel、PageHeader、Tag、TextInput、EmptyState 契约做薄适配。Vue SFC 没有直接跨框架运行，也没有复制另一套主题。

核验页拆分文件选择、证书、核验明细、披露与时间轴。浅/深色使用相同主题令牌，外观偏好格式与管理端一致。管理端登录、侧栏仍用原 Vue 组件，接入已生成的 WorkProof 品牌资产。未修改认证、授权、表结构或用户数据。

过程指标缺失时留空，不补为零；部分证据不展示连贯过程曲线。界面与数据边界见 [浏览器设计说明](BROWSER-DESIGN.md)。

## Actions 结果

| 工作流 | 结果与范围 |
|---|---|
| [41217399215](https://github.com/W-Boat/WorkProof/actions/runs/41217399215) | Linux/Windows 全通过：21 项协议单测、引擎/配对、独立 Merkle/签名交叉验证、真实 Blender 5.0.1、Word/WPS 模拟、浏览器 Worker/Wasm、主题/响应式/焦点、NSIS 与托盘 |
| [41217399226](https://github.com/W-Boat/WorkProof/actions/runs/41217399226) | 机构 Vue/Java 构建、真实 JAR+MySQL+Valkey 集成与 Windows 控制器全通过 |

浏览器截图已检查桌面浅色、桌面深色、手机深色与导出部分证据 PNG；没有水平溢出。核验通过、失败、旧版、部分披露、选择错误、下载再核验与 Escape 焦点恢复均有回归覆盖。

本次 Windows CI 根进程及直接子进程工作集约 16.31 MB，3 秒空闲 CPU 采样为 0%，4096 条合成事件按 128 条每批持久化的 HTTP p50 6.856 ms、p95 11.692 ms。该范围不覆盖完整后代树或宿主回调，不能外推到所有机器。

## 本机运行验收

- 核验工作台：`http://127.0.0.1:4173`。从已校验的 Windows 包运行独立 `serve-web`，资源是同提交的静态导出，未进行本地编译。只读服务不提供上传端点。
- 机构管理：`http://127.0.0.1:18081/login`。升级 JAR 前持有运行锁并校验进程树，只停止自身 Java 进程；MySQL/Garnet 持续运行。上一包保留为私有目录 `state/previous/scaffold-admin-134112f.jar`。
- 原账号文件保持不变，原密码登录、认证路由与登出失效已重新核对；新品牌 JS/PNG 确实由新 JAR 提供。
- 本机预构建 CLI 已对完整 v3 与部分证据分别核验，确认正确的 `scope`、`merkle_valid` 与 `chain_valid`；静态站点的 Wasm 内容类型正确。

没有自动打开浏览器、运行安装器、启动 43127 采集器、修改 Windows 信任或 Office 注册项。登录页与核验页是两个本机入口；视觉和控件系统已统一，不把两个端口描述为同一个登录会话或自动共享浏览器存储。

## 归档摘要

| 已下载校验产物 | SHA-256 |
|---|---|
| `workproof-web-and-extension` | `8231dea8b08331b704c365a9c41b58a8734538c9790c12f7381376d93c7ee7c6` |
| `verification-report` | `a7de2fde71c4110585d10694f7add73d2c23c9b414267b2f45b0805771385c23` |
| `workproof-windows-x64` | `7128a0d21030888dd56e485cd1e3b307833adc8ec251492a1729224f17aa2cc3` |
| `institution-baseline` | `fd7a755872b5e7f643a23743accffc96d0c24054331a6efa66dd146a966f8882` |
| 从 Windows 包提取的 NSIS 安装器 | `d2f09b027bbadd0eb69fe5b0fe4dc04ee4b419751a92ff6cc47b2b12d1330ea1` |

长目标仍未完成：真实 Word/WPS 验收、正式 WPS publish、Photoshop UXP、完整演进结构、TSA/C2PA、机构证书业务、首次运行向导及跨平台交付继续保留原范围，见 [全阶段清单](ALL-STAGES.md)。
