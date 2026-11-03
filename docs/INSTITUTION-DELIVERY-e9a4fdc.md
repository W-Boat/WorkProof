# V3/V4 服务器包核对

源码 `e9a4fdc53ff60e5ec5b80c6b21715efddad7a21f` 的[机构 Actions 41585722953](https://github.com/W-Boat/WorkProof/actions/runs/41585722953)三任务全部通过。artifact `13208097545` 已下载至 `E:/work/WorkProof-Delivery/institution-server-e9a4fdc.zip`，大小 222,487,179 字节。

ZIP SHA256 为 `58f8c2b3dc7c1c2a01089678c14727c89f294f1207a52402967ddbbe6dfc8f21`，与 GitHub 元数据一致。内部摘要清单的 24 个文件全部核对，包括镜像归档；版本、任务编号、准备与恢复工具清单均一致。镜像 ID 为 `sha256:f366fe00367f3945e07f5628e711c6483b1bac23fb097e9b7f4429c84c3e3f11`。

BUILD-INFO 包含未捆绑的 MySQL、Valkey 版本、镜像 ID 和仓库摘要。包内包含 V3/V4 显式准备工具、成功记录校验及备份恢复工具；归档验收记录包含目录和批量功能。CI 专用 override、门控目录和私有 jobs-fixture.json 未进入交付包。完整只读检查输出见[记录](evidence/institution-e9a4fdc/package-inspection.json)。没有加载镜像、启动服务器或改动用户数据库。

默认仍为 V1/V2 新部署，目录和批量任务分别经过显式准备后才启用，AI 关闭。实际验收包括单容器运行中任务被强杀后的停止备份、新项目自动恢复及原草稿显式提交；不覆盖主机断电、数据库故障、所有平台或原孤立文件过期时钟。安装与恢复见[服务器说明](INSTITUTION-SERVER.md)。本包是独立交付物，不替换任何正在运行的旧部署，也不解除既有商业许可缺口。
