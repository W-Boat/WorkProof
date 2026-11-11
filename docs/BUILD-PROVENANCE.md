# 核对 Windows 安装包的构建来源

Windows 完整构建已通过来源证明验收，安装包、Sigstore bundle 和验证报告可一同下载。证明绑定安装包的 SHA-256、构建仓库、工作流及源提交，由 GitHub Actions 的短期身份生成。[Windows 产物](https://github.com/W-Boat/WorkProof/actions/runs/42953989821/artifacts/13827791569) · [来源证明](https://github.com/W-Boat/WorkProof/attestations/66124737) · [GitHub 构建证明说明](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations)

此包源提交为 `2e59be1c9003ef93450e0ac89074825470dc6d51`。外层 ZIP 的 SHA-256 为 `26562c24bcaa2e1978049bf9a3c54472ee1a3cd7fde38303d41264b3c7feaa19`。其中安装程序的 SHA-256 为 `ee083abff39c4a0453c29dc918b0585755c8b162b1b55acd6ff81ac9b38ca595`，下载后已与 Actions 验证通过的来源证明核对。改动安装包和指定错误提交的负例均在同一 Windows 任务中被拒绝。[Windows 验收](https://github.com/W-Boat/WorkProof/actions/runs/42953989821/job/130312038547)

下载通过验收的 Windows 产物后，取出 `*-setup.exe` 和 `BUILD-PROVENANCE.sigstore.json`。从你信任的项目发布记录中核对完整的 40 位源提交，使用已安装的 GitHub CLI 执行下面命令，将占位路径和提交替换为实际值。

```powershell
gh attestation verify "C:/Downloads/WorkProof_0.1.0_x64-setup.exe" --bundle "C:/Downloads/BUILD-PROVENANCE.sigstore.json" --repo W-Boat/WorkProof --signer-workflow W-Boat/WorkProof/.github/workflows/verify.yml --source-ref refs/heads/codex/workproof-mvp --source-digest FULL_40_CHARACTER_COMMIT --deny-self-hosted-runners
```

该命令把可信仓库、工作流、分支和提交作为明确的验证条件。以后改用正式发布分支时，应通过项目可信渠道更新预期分支和提交。使用磁盘 bundle 时，CLI 按签发时的仓库名称验证；需要核对当前仓库身份时，可省去 `--bundle`，由 CLI 从 GitHub 查询。验证过程与联网、可信根要求见 [GitHub CLI 手册](https://cli.github.com/manual/gh_attestation_verify)。

构建任务会验证原始安装包，并检查篡改安装包、错误源提交均被拒绝，成功验证的 JSON 报告随包提供。随包的报告方便追溯，接收方仍应对实际收到的安装包重新运行验证。

当前 Windows 安装包仍需独立的商业代码签名配置，才能在系统安装提示中显示经过平台验证的发布者。GitHub 构建证明也不会把 `.wproof` 中的“官方客户端来源”“采集真实性”或“作者身份”自动升级为已认证。作品证据和机构接收回执继续分别核验，详见[信任模型](TRUST-MODEL.md)。
