# 核对 Windows 安装包的构建来源

本次 Windows 安装包通过构建来源证明检查，安装包、Sigstore bundle 和验证报告一同提供。证明绑定安装包的 SHA-256、构建仓库、工作流及源提交，由 GitHub Actions 的短期身份生成。[Windows 产物](https://github.com/W-Boat/WorkProof/actions/runs/43002254823/artifacts/13846564957) · [GitHub 构建证明说明](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations)

此包源提交为 `3d73a588e979115442853719bbbabf580bbc6034`，构建编号为 575。外层 ZIP 的 SHA-256 为 `8d1d8b023e3fcd6f2b780d7960ae1f27eaf071effb8240e000aee663e498a248`。其中安装程序的 SHA-256 为 `e13bca860c78c39915f0393c97837e03d2f08c6ebf44d4243e973b82590bedaa`，本机下载后已核对外层摘要、证明中的安装包摘要和源提交。独立的签名验证、篡改安装包和错误提交拒绝检查由 [Windows 任务](https://github.com/W-Boat/WorkProof/actions/runs/43002254823/job/130462130336)完成。此任务成功不代表同次完整运行全部成功：其网页测试遇到隐藏面板测量问题，测试选择已在后续提交修正。

下载通过验收的 Windows 产物后，取出 `*-setup.exe` 和 `BUILD-PROVENANCE.sigstore.json`。从你信任的项目发布记录中核对完整的 40 位源提交，使用已安装的 GitHub CLI 执行下面命令，将占位路径和提交替换为实际值。

```powershell
gh attestation verify "C:/Downloads/WorkProof_0.1.0_x64-setup.exe" --bundle "C:/Downloads/BUILD-PROVENANCE.sigstore.json" --repo W-Boat/WorkProof --signer-workflow W-Boat/WorkProof/.github/workflows/verify.yml --source-ref refs/heads/codex/workproof-mvp --source-digest FULL_40_CHARACTER_COMMIT --deny-self-hosted-runners
```

该命令把可信仓库、工作流、分支和提交作为明确的验证条件。以后改用正式发布分支时，应通过项目可信渠道更新预期分支和提交。使用磁盘 bundle 时，CLI 按签发时的仓库名称验证；需要核对当前仓库身份时，可省去 `--bundle`，由 CLI 从 GitHub 查询。验证过程与联网、可信根要求见 [GitHub CLI 手册](https://cli.github.com/manual/gh_attestation_verify)。

构建任务会验证原始安装包，并检查篡改安装包、错误源提交均被拒绝，成功验证的 JSON 报告随包提供。随包的报告方便追溯，接收方仍应对实际收到的安装包重新运行验证。

当前 Windows 安装包仍需独立的商业代码签名配置，才能在系统安装提示中显示经过平台验证的发布者。GitHub 构建证明也不会把 `.wproof` 中的“官方客户端来源”“采集真实性”或“作者身份”自动升级为已认证。作品证据和机构接收回执继续分别核验，详见[信任模型](TRUST-MODEL.md)。
