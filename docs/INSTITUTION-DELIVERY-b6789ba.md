# 机构服务器配套备份交付

Linux amd64 服务器包 `b6789ba311d273a9e6262ce9b6cbf4ff4f9cd540` 已完成三项 Actions 任务及 16 项真实机构服务器检查。[完整验收](https://github.com/W-Boat/WorkProof/actions/runs/42978944480) · [服务器包](https://github.com/W-Boat/WorkProof/actions/runs/42978944480/artifacts/13836653905)

本机归档为 `E:/work/WorkProof-Delivery/institution-server-b6789ba-actions.zip`，大小 223362721 字节，SHA-256 为 `9e7f02ab20646b99855b8d577a504672c6dd9fa90c772181be2e806d7dfee796`。包内 29 个清单文件的摘要、Docker 镜像配置、平台、源码标签及备份工具字节均已核对。镜像 ID 为 `sha256:ca2222964debe16a3ad6b4b06fb139f5fdc363e9952d3e96a2910a2f3620e06c`。

配套备份在同一次维护窗口内生成 `deployment.wproofbackup` 和 `receipt-key.wproofbackup`，两份加密文件通过校验后同时出现在新目录。测试使用真实 Docker 和合成身份，覆盖错误公钥拒绝、现有目标保护，以及恢复后用原公钥验证新旧 HTTP 回执。发布依赖目标文件系统支持 Linux 的 `renameat2(RENAME_NOREPLACE)`，管理员须在维护窗口内协调其他写入者。恢复后由管理员显式启用签发。[操作说明](INSTITUTION-SERVER.md)
