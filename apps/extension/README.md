# WorkProof · 开源证人

主动记录当前本地文件的编辑统计，导出可独立核验的过程证书。不保存文字、不录屏、不提供 AI 比例。

先启动 WorkProof 桌面程序，打开已保存的本地文件，再在命令面板选择「WorkProof: 记录当前文件」。扩展会自动连接本机引擎；连接失败时，可用「WorkProof: 配对本地引擎」重新选择配对文件。完成后选择「WorkProof: 导出过程证书」，将当前作品和 `.wproof` 一起交付。

暂停后也可以直接导出。扩展会保存当前文件、将暂停期间标记为采集缺口，然后生成与文件内容绑定的证书；导出后仍保持暂停，不会自动恢复记录。上一步尚未完成时，重复点击会提示稍后重试，避免同时创建记录或在导出途中切换状态。

记录不证明人类身份或原创性。首版仅支持本地 VS Code 文件。见仓库 README 的隐私与信任边界。

## 安装包与验收

从 [已验收 VSIX](https://github.com/W-Boat/WorkProof/actions/runs/42990475206/artifacts/13840979089) 下载产物并解压，在 VS Code 扩展面板的菜单中选择“从 VSIX 安装”，选中 `workproof-vscode-0.1.0.vsix`。WorkProof 桌面程序另行安装。

该 VSIX 在隔离 Linux 用户环境的官方 VS Code 1.145.3 中安装，实际完成确认记录、修改文件、暂停、导出、Rust 独立核验及篡改拒绝。[Actions 验收](https://github.com/W-Boat/WorkProof/actions/runs/42990475206)使用真实宿主，报告随 VSIX 提供。下载后的 VSIX SHA-256 已与报告核对，为 `e06b964aa0e393002e974014ea18d6edf90666166fca341194dc597eed00b0bc`。这不覆盖 Windows/macOS 的真实宿主安装，也不表示扩展已发布到 Marketplace。
