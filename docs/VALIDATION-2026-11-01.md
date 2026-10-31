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

## 大字号证书与签名分享

最新代码 `0a53020` 的 [Actions 41224054908](https://github.com/W-Boat/WorkProof/actions/runs/41224054908) Linux 与 Windows 任务均成功；协议、插件、真实 Blender、网页、原生授权隔离、桌面托盘和 NSIS 构建均通过，25 项浏览器测试全部通过。

新增用例以 Node SHA-256 独立对照浏览器指纹，检查有效签名遇到错误指纹时失败、正确指纹通过、文件分享回退保留原始字节、部分披露沿用原签名指纹、手机作品名/说明字号及无横向溢出。首轮 `41223532239` 的一项断言因同时选中 Next 路由播报 alert 而失败，已收紧选择器；被新排版替代的 `41223897996` 取消，不计为通过。

已检查 Actions 的浅色桌面、手机及 1440×960 部分证书导出图。页面明确图片仅展示，分享的 `.wproof` 需和作品原文件一起独立核验，指纹须经可信渠道取得；未认证作者身份，未生成公网托管链接。

| 本轮下载校验产物 | SHA-256 |
|---|---|
| `workproof-web-and-extension` | `948711106551743108eb0c6732345c9b1970fd55ad5b870d4c7a92cb97c176fc` |
| `verification-report` | `09661c012b2970134a821255ce3d3df5f77fcaba06748b5763fdae9dd6eb94c2` |
| `workproof-windows-x64` | `5824952b85bae2bc47a334cb8b88162705693d7d7126d35b6ef84c73b6005e75` |
| 从本轮 Windows 包提取的 NSIS 安装器 | `c7583a4ebaf67b87de7bdb5f193f63cf69f44c4e4cacb703d7faa9cff7041577` |

Windows 产物已提取至 `E:/work/workproof-delivery-0a53020`，未运行安装器。本轮无状态窗采样工作集 16.24 MB、空闲 CPU 为单核 0%、128 条持久化 HTTP 批次 p95 20.769 ms；只统计根及直接子进程，含客户端和 SQLite 落盘，不代表宿主编辑回调或所有机器。

本机 4173 已指向 `E:/work/workproof-browser-0a53020/verifier`，HTTP 首页与新版核验 Worker 均正常。只读静态服务继续复用已验证 `6c59057` 二进制，进程记录与日志仍位于 `E:/work/workproof-browser-6c59057`。切换时仅停止该记录验证归属的进程；机构 Java/MySQL/Garnet 未重启、账号未更改。未运行本地构建或自动化测试，未启动采集器、安装器或修改信任。

Photoshop 最终控制器代码 `d07f971` 的 [完整 Actions 41222699360](https://github.com/W-Boat/WorkProof/actions/runs/41222699360) 两平台均通过；其中 Adobe API 为模拟，真实宿主、正式 CCX 与 macOS 传输仍待验证。
