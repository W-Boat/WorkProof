# 机构基础包核对

源码 `65928198acb9cd17bd8fdee7967405889f6d82be` 的[机构任务 41619242790](https://github.com/W-Boat/WorkProof/actions/runs/41619242790)三项成功。artifact `13223237778` 已下载到 `E:/work/WorkProof-Delivery/institution-server-6592819.zip`，大小 222,518,579 字节。

ZIP SHA256 为 `d3a3dccadf4e01da1efed60f2d1aa140b5a224b7a44db3404ef602d4de8440ad`，与 GitHub 元数据一致；包内清单的全部 26 项摘要已核对，包括镜像。镜像 ID 为 `sha256:12e16dc97aca2e6d8bb35eda9d1fef87a378315a2b5871347dac9903b66ff879`。源码、任务、Linux amd64 平台、控制工具和未捆绑数据库/缓存依赖的摘要记录均一致，CI 私有门控及 fixture 未进入包。

相较较早 V3/V4 包，新增纯标准库 AI 记录校验和固定引擎注册表，不含 Torch、模型或 AI 准备工具。默认 AI 关闭，目录和持久任务仍需分别明确准备。可选 AI 的验收与交付范围见[专项记录](INSTITUTION-AI-ACCEPTANCE-635e15e.md)，不可把该基础包当作已包含检测模型的一键安装包。

完整只读检查见[包记录](evidence/institution-6592819/package-inspection.json)。本地仅下载和核对归档，没有加载镜像或启动部署；商业许可和真实平台验收缺口保持原记录。部署说明见[服务器说明](INSTITUTION-SERVER.md)。
