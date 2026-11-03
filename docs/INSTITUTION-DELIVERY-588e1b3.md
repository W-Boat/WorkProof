# 机构服务器交付包核对

源码 `588e1b3f03bd13d0fc399160da5e96753da1abe0` 的[机构任务 41581718623](https://github.com/W-Boat/WorkProof/actions/runs/41581718623)三任务全部成功。服务器 artifact `13205874093` 已下载至 `E:/work/WorkProof-Delivery/institution-server-588e1b3.zip`，大小 222,432,857 字节。

ZIP SHA256 为 `f39e83972964d93bb4ad6cb1ec7b6b16745852c817a7d37c7cea214effdb7773`，与 GitHub artifact 元数据一致。包内 SHA256SUMS 列出的 20 个文件逐一读取并核对，包括镜像归档；未加载镜像或启动任何服务。BUILD-INFO 的提交、任务编号及镜像 ID 与该次交付对应，镜像 ID 为 `sha256:669dbce1677a43cc7f6f4d4b7eb5a9ede55aa6b42c3ca67a7acf91243b70387c`。

包内包含 `restore_new.py`、`restore_snapshot.py`、`backup_coordinator.py` 和 Compose 模板。归档的 `test-institution-server-results.json` 明确记录完整新项目恢复、私有卷和 SQL 比较、保持停止、显式启动与原账号登录、错误口令及冲突拒绝、源部署不变；其他记录包含全新部署、真实 Rust 检查器、随机账号及非空库拒绝。

此包面向 Linux amd64 Docker 的 V1/V2 新部署，catalog、jobs、AI 默认关闭；不包含 MySQL/Valkey 镜像、机构凭据或用户数据。新主机需按[部署说明](INSTITUTION-SERVER.md)准备依赖。摘要核对证明归档对应性，不等于公共发布者签名、生产运维或全平台验收。

后续增加了工具齐全检查和依赖镜像来源记录，正由[任务 41582489993](https://github.com/W-Boat/WorkProof/actions/runs/41582489993)验证；本页只描述已下载核对的 588e1b3 包，不将后续源码冒充包内内容。
