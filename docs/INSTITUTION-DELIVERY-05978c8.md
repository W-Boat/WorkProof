# 机构服务器交付核对：05978c8

本包已下载并核对，未在本机加载镜像或启动服务。

- 源码：`05978c82bde88d6703a12925dae0753f07167655`。
- [Actions 42744314279](https://github.com/W-Boat/WorkProof/actions/runs/42744314279)：三个任务全部成功。
- [Linux amd64 服务器归档](https://github.com/W-Boat/WorkProof/actions/runs/42744314279/artifacts/13730194509)：223371402 字节。
- 整体 SHA-256：`6f921fcbf9bc6752aafe01e4b02c71fff576a5d02509f39f1f6fa86e8fea7ada`，与 GitHub artifact digest 一致。
- 镜像 ID：`sha256:432b37002b7ea5927047fcb85c436491b17fe51af38090fc552a264e2b2c8764`。
- 包内清单所列 29 个文件逐项摘要一致；BUILD-INFO 中源码、任务和平台一致，包含 13 项服务器检查记录。

本包在此前 53a07ec 包的基础上提供 `compose.receipts.yaml`、`receipt_keys.py` 和 `RECEIPTS.md`。已实际验收：原生及浏览器回执核验、机构页面签发、独立公钥核验、真实只读外部密钥挂载、权限退化拒绝、重启身份保持、密钥加密备份与新目录恢复、使用恢复密钥的真实 HTTP 签发，以及恢复写入中断后的私有残留和重试不覆盖。

默认不生成机构密钥、不启用签发，不包含任何生产密钥。普通部署备份仍不收录外部签发密钥，完整部署恢复与外部签发身份的联合恢复、备份协调器集成、生产密钥托管/轮换/吊销、普通角色回执菜单授权仍未完成。此验收使用隔离测试项目及合成密钥，不证明官方客户端来源、作者身份或真人创作。

该归档是 Linux amd64 Docker 服务器包，不是 Windows 桌面安装包。数据库及缓存镜像需另行准备，不能与不同源码的可选 AI 镜像混用。使用说明见[机构入门](INSTITUTION-START-HERE.md)及[回执说明](INSTITUTION-RECEIPTS.md)。
