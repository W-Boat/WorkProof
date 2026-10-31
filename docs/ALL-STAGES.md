# 全阶段实施与验收

用户交付要求：点击即用，按原规划覆盖所有阶段；本地只编辑源码，GitHub Actions 编译验证。

## 交付结构

1. 桌面记录：Rust/Axum/SQLite/BLAKE3/Ed25519，系统托盘、安装器、按需状态窗、自动连接。
2. 核验展示：原 Next.js/Wasm 独立核验工作台，离线资源随安装器提供。
3. 宿主：VS Code、Word、WPS、Photoshop UXP、Blender，按实际 API 能力采集，统一协议；不能观测的动作必须披露为缺失。
4. 互操作：Merkle 选择性披露、外部时间戳、C2PA 自定义断言；不将这些能力描述为人类身份证明或零知识证明。
5. 机构后台：基于 `services/institution` 的 Spring Boot + Vue 底座实现证书索引、批量核验、机构权限和审计；与本地守护进程独立部署。

## 已完成的前一阶段

VS Code 单文件记录、签名导出、独立 CLI/Wasm 核验、证书图像、过程曲线、远程测试；提交 9a953a8 对应的两条 CI 全通过。

## 当前进行中

优先顺序已按用户要求调整为 Word → WPS，机构后台部署目标为服务器。ImageGen 图标、带核验资源和插件的 Windows 安装器、VS Code 自动连接已经通过远程构建验证。

Blender 原生插件及 v2 签名统计指标通过真实 Blender CI 录制、保存、导出和篡改检测。视口旋转、完整对象/修改器参数树仍未采集。

Word/WPS 共用采集与交付件导出代码、桌面来源审批及会话隔离已经加入；类型检查与模拟宿主浏览器测试通过，真实 Word/WPS 安装与交互验收尚未完成。服务器 HTTPS Word 清单、资源及双监听通过 [Actions 41186723953](https://github.com/W-Boat/WorkProof/actions/runs/41186723953)，本机也已验证。Word 本地安装/撤销与隔离注册表安全检查通过 [Windows Actions 41187531600](https://github.com/W-Boat/WorkProof/actions/runs/41187531600)。当前已检测到本机 Word 16.0.20430.20182，但尚未完成宿主内加载；localhost 证书信任变更已请求用户确认，未导入。WPS 原生功能区入口与独立验证包正在验证；正式 publish 安装页受上游模板许可和真实宿主验收限制，尚未交付。

机构后台已在本机隔离目录运行。单 JAR 封装 Vue/Office、随机密码初始化、真实 MySQL/Valkey 登录与鉴权、Windows 父子进程归属及启停控制已通过 [Actions 41185301362](https://github.com/W-Boat/WorkProof/actions/runs/41185301362)。本机使用相同 JAR 和 Garnet 已验证原账号登录、深链接、API 拒绝、令牌登出，以及 MySQL 正常关闭后重启，详见 [本地运行](LOCAL-RUNTIME.md)。全新 Windows 的运行时引导安装、宿主 HTTPS 信任与生产机构业务仍未完成，不能据此宣称整个产品已点击即用。

Windows CI 测得关闭状态窗时工作集约 16.2 MB，3 秒空闲 CPU 采样为 0%，128 事件持久化批次 p95 为 17.589 ms。其范围不包括 Office/WPS，不代表编辑器回调性能或所有用户机器。

## 尚需完成

- 安装器从全新 Windows 用户环境到首次证书的交互验收。
- Word/WPS/Photoshop/Blender 的真实插件与对应宿主验证。
- TSA/C2PA 的证据生成、浏览器核验、信任策略与测试向量。
- 基于上游统一组件和权限能力的 WorkProof 机构业务模块。
- 性能采样：进程树内存、CPU、空闲写盘、宿主回调 p95、大文件核验、队列压力与恢复。

每项以真实实现、测试与可交付包验收，不以文档、合成数据或预留接口代替完成。

## 外部依赖

宿主软件由用户合法安装，平台可能要求确认插件加载权限。TSA 运营方、机构签名与商业代码签名需要对应凭据；未配置时必须明确显示状态，不能生成伪权威凭据。

机构底座源：wbr664393425-lgtm/scaffold-master，导入版本 577079e9a347555fadddd3865fc0bbcdb00d9fb4，保留 MIT 许可及第三方声明。上游要求使用 mysql skill 检查真实数据库；本会话无该技能，未操作用户既有或生产数据库。本地仅在明确创建的独立 `workproof_local` 复用已知上游 SQL 初始化，并对其进行运行验收；CI 使用独立 `workproof_ci`。后续业务 schema 设计先参照源码和已知结构，在隔离 CI 验证，不把本地空库初始化规则用于已有生产数据。
