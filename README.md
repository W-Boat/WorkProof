# WorkProof · 开源证人

> 全阶段扩展进行中，优先 Word/WPS。Windows 开发包已提供 Fluent 桌面工作区、内置 Word/Markdown 编辑器、离线 DOCX 转换、过程回看与证书导出，以及 Word/PowerPoint 原生加载项。编辑器及三浏览器验证见 [编辑器说明](docs/DESKTOP-EDITOR.md)，完整进度见 [全阶段验收](docs/ALL-STAGES.md)。机构服务器使用 scaffold-master 底座，入口见 [机构部署](docs/INSTITUTION-SERVER.md)。下方 VS Code 流程继续适用于便携包。

一个本地优先的创作过程记录与核验 MVP：主动开启采集、保存统计事件、导出签名证据，并在浏览器中核验作品与记录的一致性。

**它不证明“100% 人类创作”，不提供 AI 使用比例，也不认证签名者的现实身份。**

商业使用与再分发条件见 [许可证核验报告](docs/COMMERCIAL-LICENSE-AUDIT.md)。本项目根目录 MIT 不覆盖所有第三方依赖；Blender 扩展分发选择 GPL-3.0-or-later 并附完整源码和条款，原 MIT 授权保留。WPS 工具条款及数据库驱动等需按报告处理。

## 下载与运行

编译与完整自动化测试在本仓库 Actions 完成；本机运行 Actions 的预构建产物进行验收，不在本地构建。机构后台运行入口及启停脚本见 [本地运行](docs/LOCAL-RUNTIME.md)。

先在成功的 [GitHub Actions](https://github.com/W-Boat/WorkProof/actions) 任务中选择需要的产物。下载通常需要登录 GitHub；开发包尚未进行商业代码签名。

- **只想安装 Windows 桌面版**：选择 `workproof-windows-x64`，解压后运行其中 `bundle/nsis` 下的安装程序。安装后从开始菜单打开 WorkProof；无需安装 Node 或 Rust。优先使用安装器，以便保留同一构建的内嵌网页与安装资源。
- **需要 Word / PowerPoint 原生加载项**：选择原生 Office 工作流的 `workproof-native-word-windows-dev` 完整包，按包内说明安装匹配架构的插件。普通桌面窗口打开不等于 Office 插件已注册；WPS 的安装和许可限制见[Office 说明](docs/OFFICE-SERVER.md)。
- **使用 VS Code 或独立核验站点**：同时领取 `workproof-web-and-extension`，它包含静态核验站点、VS Code `.vsix`、文档和依赖锁文件。

下面是 VS Code 配对与独立核验流程；使用桌面内置编辑器时，可直接从应用创建文档，不必先安装 VS Code 插件。

相关产物内容：

- `workproof-windows-x64`：Windows 托盘程序与命令行核验器。
- `workproof-web-and-extension`：静态核验站点、VS Code `.vsix`、文档与依赖锁文件。

1. 安装并启动 Windows 桌面版。系统需有 WebView2 Runtime；使用便携开发包时，应保持包内资源目录完整，不要只复制一个 EXE。
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

- 宿主统计采集保存有限的变更统计和指纹；内置编辑器会在本机 `editor.sqlite` 保存正文、历史版本及编辑动作，便于继续写作与过程回看。具体字段和自动保存范围见 [编辑与记录](docs/DESKTOP-EDITOR.md)。
- 记录范围限定于用户开启的文档和编辑区；内置编辑器中的复制、粘贴、输入法及文本事务会进入本机动作历史。
- 文件内容会在本机临时读取，用于统计字符量和计算最终文件摘要。
- 记录的文件名、时间、统计量和文件指纹仍可能透露信息；交付前应理解这些字段。
- 本地签名密钥与数据库保存在 `%LOCALAPPDATA%\WorkProof`，Windows 目录权限限定为当前用户。管理员或控制本机的人仍可能访问或替换它们。
- 哈希链和签名可以发现相对于签名清单的改动；用户控制采集端时仍可伪造输入或重新签发一份记录。
- 默认时间来自本机；已接入的第三方时间戳需配置相应服务并通过核验，具体证据范围在结果中显示。记录跨度包含停顿与间隔。
- 内置编辑器记录编辑区内的键盘和命令事件；宿主插件按各自公开 API 采集。不同宿主可观察的动作范围见适配文档。
- 页面无分析脚本、外部字体或文件上传。GitHub 源码链接仅在点击时访问外部站点。
- 演示文件明确标为合成演示；演示私钥是公开测试值，不能用于真实记录。

## 当前范围

桌面端提供内置编辑器、应用连接与内嵌核验页。采集适配覆盖 VS Code、Word/WPS、PowerPoint、Photoshop 和 Blender，不同平台、宿主版本与分发方式的实际验收范围见 [全阶段验收](docs/ALL-STAGES.md)。

证据能力包括 SQLite WAL 持久化、BLAKE3 链、Ed25519 签名、Rust/Wasm 核验、Merkle 选择性披露、图片 C2PA 与第三方时间戳接入。机构后台提供权限、归档和辅助评估。生产身份、公共分享域名、代码签名及宿主正式分发需要部署方的配置和凭据。

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
