# 核对 Windows 安装包的构建来源

Windows 完整构建新增 GitHub 构建来源证明，首次运行尚待验收。证明绑定安装包的 SHA-256、构建仓库、工作流及源提交，由 GitHub Actions 的短期身份生成，随 Windows 产物提供 Sigstore bundle。无需在 WorkProof 仓库或客户端保存签发私钥。实现依据为 [GitHub 构建证明说明](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations)。

下载通过验收的 Windows 产物后，取出 `*-setup.exe` 和 `BUILD-PROVENANCE.sigstore.json`。从你信任的项目发布记录中核对完整的 40 位源提交，使用已安装的 GitHub CLI 执行下面命令，将占位路径和提交替换为实际值。

```powershell
gh attestation verify "C:/Downloads/WorkProof_0.1.0_x64-setup.exe" --bundle "C:/Downloads/BUILD-PROVENANCE.sigstore.json" --repo W-Boat/WorkProof --signer-workflow W-Boat/WorkProof/.github/workflows/verify.yml --source-ref refs/heads/codex/workproof-mvp --source-digest FULL_40_CHARACTER_COMMIT --deny-self-hosted-runners
```

该命令把可信仓库、工作流、分支和提交作为明确的验证条件。以后改用正式发布分支时，应通过项目可信渠道更新预期分支和提交。使用磁盘 bundle 时，CLI 按签发时的仓库名称验证；需要核对当前仓库身份时，可省去 `--bundle`，由 CLI 从 GitHub 查询。验证过程与联网、可信根要求见 [GitHub CLI 手册](https://cli.github.com/manual/gh_attestation_verify)。

构建任务会验证原始安装包，并检查篡改安装包、错误源提交均被拒绝，成功验证的 JSON 报告随包提供。随包的报告方便追溯，接收方仍应对实际收到的安装包重新运行验证。

当前 Windows 安装包仍需独立的商业代码签名配置，才能在系统安装提示中显示经过平台验证的发布者。GitHub 构建证明也不会把 `.wproof` 中的“官方客户端来源”“采集真实性”或“作者身份”自动升级为已认证。作品证据和机构接收回执继续分别核验，详见[信任模型](TRUST-MODEL.md)。
