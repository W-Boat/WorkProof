# 机构服务器交付核对：efe611a

本包已下载并完整核对，未在本机加载镜像、启动服务或替换现有部署。

- 源码：`efe611a723b7e251bf05a9d62575e2ea00a22060`。
- [Actions 42862853571](https://github.com/W-Boat/WorkProof/actions/runs/42862853571)：三个任务全部成功。
- [Linux amd64 服务器归档](https://github.com/W-Boat/WorkProof/actions/runs/42862853571/artifacts/13785294992)：223370319 字节。
- 整体 SHA-256：`441c5f229b3f725422b0cf40eb6e7fc2d43e43a14e00e881746753539004fbdb`，与 GitHub artifact digest 一致。
- 镜像 ID：`sha256:fa3430b3ca1968d18fd173704933fcd08ed824101c16440880bcc0e2f3528270`。
- 清单的 29 个文件逐项摘要一致，ZIP 文件集合准确匹配清单、清单本身和根目录服务器报告，没有重名或不安全路径。
- BUILD-INFO 的源码、运行编号与平台一致；镜像配置字节摘要、源码标签、Linux amd64 和服务 UID/GID 10001 均已检查。包内密钥工具与对应源码文件字节一致。
- 原始 [BUILD-INFO](evidence/institution-efe611a/BUILD-INFO.json)、[14 项服务器检查](evidence/institution-efe611a/server-results.json)、[文件摘要清单](evidence/institution-efe611a/SHA256SUMS.txt)及[本次核对记录](evidence/institution-efe611a/verification-receipt.json)已归档；后者是本地核对记录，不是机构签名回执或官方发布签名。

本包包含 [868cfa0](INSTITUTION-DELIVERY-868cfa0.md) 已交付的明确创建签发身份、独立密钥加密备份、部署摘要及所选文件关联，以及备份时核对独立预期公钥。

本轮新增的实际验收先用源项目独立 HTTP 签发容器中的指定合成身份签发回执，再停止该容器，完成正常部署备份，并把同一源私钥的独立加密包关联到部署备份摘要。部署恢复、原账号登录后，默认服务仍关闭签发；新的独立签发容器明确挂载另一个目录中恢复出的密钥。旧、新回执都通过原公钥核验，重启后的回执也通过核验。测试公钥在备份之前独立保留，不从恢复密钥包自行声明中取得；外部私钥未进入普通部署快照或公开附件。

该结果只覆盖本次 Linux amd64、固定镜像和合成身份的流程，不证明生产身份来源或所有故障恢复。普通备份仍不包含外部签发密钥，原子联合备份、正式签发身份托管、轮换、吊销以及普通角色的真实授权验收仍未完成。接收回执不认证官方客户端、作者身份或真人创作。

这是 Docker 服务器包，不是 Windows 桌面安装器。MySQL 与 Valkey 镜像未捆绑，须按 BUILD-INFO 独立准备；旧可选 AI 镜像未与此版本完成配套验收。使用[机构入门](INSTITUTION-START-HERE.md)和[回执说明](INSTITUTION-RECEIPTS.md)，保持同版工具与镜像，默认不启用签发或 AI。
