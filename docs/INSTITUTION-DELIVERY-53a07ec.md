# 机构服务交付核对：53a07ec

2026-11-10 完成下载与归档核对；未在本机加载镜像或启动服务。

- 源码：`53a07ece07a79bbf4f991e1c5e8db6899674bf52`。
- [Actions 42573868092](https://github.com/W-Boat/WorkProof/actions/runs/42573868092)：三个任务全部成功。
- [Linux amd64 服务器归档](https://github.com/W-Boat/WorkProof/actions/runs/42573868092/artifacts/13655060891)：223347891 字节。
- 归档 SHA-256：`5e7c7c9a9eae4fce58ac01a19641a2ba7f803b1168df36923aca1c27e3885861`，与 GitHub artifact digest 一致。
- 镜像 ID：`sha256:49c99da5f15699e1e3938b9b53de9c67ec2e7454cfe30deb0c6ba63f83604743`。
- 本机核对包内 `SHA256SUMS.txt` 所列 27 个文件，逐项摘要一致；BUILD-INFO 的源码、任务和平台一致，含 `RECEIPTS.md`，附实际服务器 13 项检查结果。

本次增量实际验证：机构页面选择证书、同意发送、下载接收回执、独立 Rust 公钥核验；窄屏布局、重新选择后清空结果、取消后迟到响应隔离；镜像内断网非 root 工具签发和核验；独立只读应用使用临时内存密钥显式启用 HTTP 签发，拒绝未登录、未同意、无效证书及错配公钥。默认应用仍关闭签发。原有初始化、镜像、备份、恢复和权限检查亦在本次任务内通过。

这是 Linux amd64 Docker 服务器包，不是 Windows 桌面安装包。MySQL 和 Valkey 镜像不包含在归档中，依赖身份见 BUILD-INFO。使用方式见[机构入门](INSTITUTION-START-HERE.md)和[回执说明](INSTITUTION-RECEIPTS.md)。

未完成范围：生产签发密钥启用向导、密钥托管和轮换、吊销、普通角色的回执菜单授权入口、回执索引，以及官方客户端远程证明。回执仅证明持有指定密钥的服务接收了该证书，不能证明作者身份或真人创作。测试使用隔离数据库与合成密钥，不代表生产环境已部署或所有平台已经人工验收。
