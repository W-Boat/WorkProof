# WorkProof · 开源证人

> 全阶段扩展进行中，优先 Word/WPS，机构端目标为服务器。当前源码新增了带内置核验资源的 Windows 安装器、原生 Blender 适配及 v2 统计指标、Word/WPS 采集适配和桌面审批连接。真实 Blender 测试已通过；Word/WPS 目前通过适配层模拟测试，尚未完成真实宿主部署验收。完整进度见 [全阶段验收](docs/ALL-STAGES.md)，服务器入口见 [Office 服务器接入](docs/OFFICE-SERVER.md)。下方保留 v0.1 便携版的已验证操作流程。

一个本地优先的创作过程记录与核验 MVP：主动开启采集、保存统计事件、导出签名证据，并在浏览器中核验作品与记录的一致性。

**它不证明“100% 人类创作”，不提供 AI 使用比例，也不认证签名者的现实身份。**

商业使用与再分发条件见 [许可证核验报告](docs/COMMERCIAL-LICENSE-AUDIT.md)。本项目根目录 MIT 不覆盖所有第三方依赖；Blender 扩展分发选择 GPL-3.0-or-later 并附完整源码和条款，原 MIT 授权保留。WPS 工具条款及数据库驱动等需按报告处理。

## 下载与运行

编译与完整自动化测试在本仓库 Actions 完成；本机运行 Actions 的预构建产物进行验收，不在本地构建。机构后台运行入口及启停脚本见 [本地运行](docs/LOCAL-RUNTIME.md)。

成功运行后下载两个产物：

- `workproof-windows-x64`：Windows 托盘程序与命令行核验器。
- `workproof-web-and-extension`：静态核验站点、VS Code `.vsix`、文档与依赖锁文件。

1. 解压 Windows 产物，启动 `workproof-desktop.exe`。系统需有 WebView2 Runtime。该原型未进行商业代码签名。
2. VS Code → Extensions → Install from VSIX，安装产物中的扩展。
3. 命令面板运行 **WorkProof: 配对本地引擎**。令牌保存在 VS Code SecretStorage，不出现在证书中。
4. 打开本地文件，运行 **WorkProof: 记录当前文件**，明确同意后才开始采集。
5. 正常编辑。可用状态栏暂停 / 继续；恢复后会标注采集缺口。
6. 运行 **WorkProof: 导出过程证书**，将最终作品和 `.wproof` 一起交付。
7. 运行 `workproof-engine.exe serve-web "静态站点目录"`（该目录中应有 `index.html`），访问 `http://127.0.0.1:4173`。不需要安装 Node、Rust 或 Python，也不涉及编译。该服务器只在本机提供静态资源，没有上传接口。不能直接双击 HTML，因为 Wasm/Worker 需要 HTTP 源。
8. 载入两份文件，查看核验结果和过程图谱，保存证书 PNG 或打印为 PDF。

也可使用独立命令行：

```text
workproof-engine.exe verify essay.md essay.md.wproof
```

退出码 0 表示文件、记录链和签名一致，2 表示核验未通过。它不表示人类身份已获认证。

## 隐私与信任边界

- 不录屏，不监控其他窗口，不保存原文、剪贴板或终端输出。
- 文件内容会在本机临时读取，用于统计字符量和计算最终文件摘要。
- 记录的文件名、时间、统计量和文件指纹仍可能透露信息；交付前应理解这些字段。
- 本地签名密钥与数据库保存在 `%LOCALAPPDATA%\WorkProof`，Windows 目录权限限定为当前用户。管理员或控制本机的人仍可能访问或替换它们。
- 哈希链和签名可以发现相对于签名清单的改动；用户控制采集端时仍可伪造输入或重新签发一份记录。
- 无第三方时间戳。墙钟是本机声明；记录跨度不是持续劳动时长。
- 采集原生编辑事件，不采集物理按键时长，不推断粘贴、AI 来源或“人类概率”。
- 页面无分析脚本、外部字体或文件上传。GitHub 源码链接仅在点击时访问外部站点。
- 演示文件明确标为合成演示；演示私钥是公开测试值，不能用于真实记录。

## 当前范围

Windows 托盘、本地 VS Code 文件、单文件会话、SQLite WAL 持久化、BLAKE3 链、Ed25519 签名、Rust/Wasm 核验、PNG/PDF 展示导出。

暂不支持：多文档统一证明、Remote SSH / WSL / Web VS Code、Word/WPS/Adobe/Blender、C2PA、第三方时间戳、机构身份、自动 AI 比例判断。

插件每秒将有限队列写入工作区状态；突然断电可能丢失最后未持久化的统计事件。重启恢复后默认暂停并追加缺口，不能解释为完整覆盖。超出 2048 条离线排队后自动暂停，恢复时标记缺口。

## 项目结构

```text
crates/proof       共享协议、签名核验、Wasm 导出、测试向量
crates/engine      Axum 本机 API、SQLite、独立核验 CLI
apps/desktop      Tauri v2 托盘壳
apps/extension    VS Code 主动采集插件
apps/verifier     Next.js 静态站点与 Worker
scripts           CI 集成测试
tests             Playwright 浏览器测试
docs              协议与设计说明
```

## 验证

Actions 在 Linux 上执行协议测试、真实 HTTP/SQLite 恢复测试、Wasm 构建、TypeScript 检查、静态站点和插件打包，以及 Chromium 文件替换/记录篡改/导出/移动端测试。在 Windows 上编译托盘与引擎并执行集成测试。

资源预算尚需真实用户机器测量，不宣称已达到 15–30 MB 或固定的毫秒级核验耗时。CI 成功也不代表已完成所有 Windows 托盘、安装器和编辑器交互的人工验收。
