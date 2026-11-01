# Windows Word 原生入口

安装后在 Word 功能区直接出现 **WorkProof** 选项卡，用户不再查找网页侧载目录、共享文件夹目录或本机 HTTPS 证书。原 Office.js 入口保留用于网页版与跨平台场景；WPS 使用自己的适配，不把 COM 实现称为跨平台。

本机核对目标：Office Professional Plus 2021、Word 64 位、.NET Framework 4.8（32 位 Word 同一份 AnyCPU DLL 也可加载）。原生加载项是薄适配层：Word 对象留在宿主 UI 线程，记录与签名仍由 Rust 引擎完成。

## 安装与使用

1. 解压提供的 `workproof-native-word-windows-dev.zip`。
2. 右键“使用 PowerShell 运行” `install-native-word.ps1`，或执行：

   ```powershell
   pwsh -File .\install-native-word.ps1
   ```

   脚本把载荷复制到 `%LOCALAPPDATA%\WorkProof\word-native`，解除下载标记（带 Zone.Identifier 的 .NET 程序集不会被 Office 加载），再写入当前用户的 COM 与 Word Add-ins 注册项，完全不需要管理员权限。
3. 打开 WorkProof 桌面程序（开始菜单里的 **WorkProof**，或安装目录里的 `workproof-desktop.exe`）。桌面端在本机 43127 端口提供记录服务，并在 4173 提供本地核验页。
4. 保存要记录的文档，然后**关闭并重新打开 Word**。功能区出现 **WorkProof → 打开创作记录**。
5. 在侧边窗口点“开始记录”，桌面端会出现来源为 `word` 的连接请求，点允许。
6. 正常编辑；休息时暂停，继续时记录会标明未覆盖的时间段。
7. 点“导出作品和证书”，选择交付目录。导出会在该目录新建 `WorkProof-时间-随机` 子目录，复制当前文档，再用 `workproof-engine fingerprint` 计算精确字节摘要并签发 `.wproof`。导出后还会用 `workproof-engine verify` 独立复核一次，只有通过才提示可交付。
8. 把作品与同名 `.wproof` 一起交付；对方在核验页拖入两份文件即可离线核验。

## 卸载

```powershell
pwsh -File .\install-native-word.ps1 -Remove            # 只删注册项，保留文件
pwsh -File .\install-native-word.ps1 -Remove -RemoveFiles  # 同时删除本脚本创建的安装目录
```

卸载只删除 WorkProof 自己的 ProgId、CLSID 与 Word Add-ins 注册项，以及本脚本创建的安装目录（含 `.workproof-native` 标记）；不改动文档、其他加载项或 Office 设置。

## 记录内容与边界

- 采集的是字符数、段落数、相对时间、保存检查点，以及每次采样是否发现变化；**不发送正文、剪贴板、路径或文件名以外的文档内容**。
- 采样间隔 1.5 秒；同步读取全文校验只每 8 次采样（约 12 秒）或导出时执行一次，避免长文档被频繁全量读取。超过 800 万字符的文档拒绝记录。
- 采样可能合并相邻修改、遗漏发生在两次采样之间的同长度编辑，因此不能当作击键记录，也不能证明作者身份、原创性或真实劳动时长。
- 连接使用桌面端明确批准的 `word` 专用 native grant：不读取主令牌，不能签名任意本地文件，不能访问其他来源的会话，也不能调用 `seal`。
- 浏览器核验的结论是“文件与证书匹配、记录链完整、签名有效、签名者身份未经认证、无外部时间凭据”。图片或 PDF 只是展示入口，真正复核仍需作品与 `.wproof`。
- 桌面端未运行时，侧边窗口会直接提示连不上 `127.0.0.1:43127`，不会假装已记录。
- 关闭侧边窗口或退出 Word 即停止记录；桌面端已被撤销的连接、过期的批准都不会被自动补写。

## 故障排查

| 现象 | 处理 |
|---|---|
| 功能区没有 WorkProof | 先确认已运行安装脚本；保存并完全退出 Word 后重开；在“文件 → 选项 → 加载项 → 管理：COM 加载项”确认 WorkProof 已勾选 |
| 侧边窗口提示连不上 43127 | 先启动 WorkProof 桌面程序；若改过端口，用环境变量 `WORKPROOF_ENGINE_PORT` 指定 |
| 提示“桌面端版本过旧” | 安装与加载项同一批次的 `workproof-desktop.exe`，旧桌面端不接受 `word` 来源 |
| 提示“请先保存这份文档” | 未保存的文档没有可绑定文件，先另存为再开始 |
| 导出后本地核验不通过 | 不要交付该证书，重新导出；导出期间文档被再次保存会主动中止 |

## 构建与验证位置

本地只编辑源码；DLL、Rust 引擎与桌面程序全部由 GitHub Actions 的 `Native Word add-in and matching Windows collector` 工作流构建，CI 内完成：

- `cargo test`（含 `word` 来源的 native grant 归属与隔离单元测试）与 `fingerprint` 的 BLAKE3 固定向量。
- 真实引擎进程上的完整链路：native 配对批准 → 建会话 → start/edit/pause/gap/resume 事件 → `fingerprint` 摘要 → save 检查点 → 导出 → 独立 `verify` 通过；篡改作品后 `verify` 必须失败；`photoshop` 会话、master `status`、`seal`、带 Origin 的请求与 `wps` 来源必须全部被拒绝。
- 加载项反射校验：固定 CLSID、`IDTExtensibility2` 与 `IRibbonExtensibility`、功能区 XML 可解析且含 `workproofTab`/`OpenRecorder`/`GetRibbonImage`、内嵌图标可取到 IPictureDisp、侧边窗口类型继承 `Form`。
- 隔离注册表夹具内安装 → 校验 `LoadBehavior=3`、`InprocServer32=mscoree.dll`、`RuntimeVersion`、`CodeBase` → 卸载后确认注册项全部清除。

这些验证**不包含**真实 Word 宿主加载、真实用户文档的完整交互，也不证明任意 Office 版本、机构策略或禁用加载项环境下都能加载。真实宿主验收需要在装有 Word 的机器上人工完成。

## 相关源码

- `apps/word-native/Connect.cs`：COM 连接点、功能区 XML、内嵌图标。
- `apps/word-native/Recorder.cs`：侧边窗口、采样、配对、导出与本地核验。
- `apps/word-native/AssemblyInfo.cs`、`WorkProof.WordNative.csproj`：固定程序集版本 1.0.0.0（安装脚本写入同名注册项）。
- `scripts/local/install-native-word.ps1`：安装、校验、卸载。
- `scripts/test_word_native.cjs`、`scripts/test_word_native_dll.ps1`、`scripts/stage_word_native.ps1`：CI 验证与打包。
