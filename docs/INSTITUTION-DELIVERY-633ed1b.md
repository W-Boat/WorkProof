# 机构基础服务器包：633ed1b

源码 `633ed1bd80402d4637c6fb3b10a7c89932530fba` 的[机构任务41856656733](https://github.com/W-Boat/WorkProof/actions/runs/41856656733)三任务全部成功。此版本包含私有临时输入与严格JSON报告解析，以及完成后优先展示结果和中文说明下载的机构页面；真实三模型页面回归见[验收记录](evidence/institution-real-ai-633ed1b/acceptance.md)。

基础包[artifact 13338497698](https://github.com/W-Boat/WorkProof/actions/runs/41856656733/artifacts/13338497698)已下载至 `E:/work/WorkProof-Delivery/institution-server-633ed1b.zip`，222,605,461字节。下载中断后仅在服务器确认精确206范围后续传，并重新计算整个文件摘要；最终SHA256为 `3793052022ce1bc1cf643426ebbd34352ff0e92847dda8e473fc661f7a0fe8e7`，与GitHub一致。

只读核对结果：包内26项文件摘要全部匹配，实际文件集合与清单精确一致，无重复/越界ZIP路径；`BUILD-INFO.json`的源码、任务和Linux amd64平台匹配，V3/V4准备、备份/恢复、AI运行时记录检查工具均存在。基础镜像记录为 `sha256:f6de16b596e73f92edd8a0ff127d99d0b53148e1ca1c5de480b5bb5ea2d462fd`；数据库与缓存镜像不在包内，其不可变ID和仓库摘要已记录。归档中的服务器验收记录包含明确V3/V4准备及新项目恢复范围。本地没有加载或运行镜像，也没有升级现有数据库或应用。

这是默认关闭AI的基础包，不含模型权重或部署秘密。先前 `cf1ab54` 的可选AI包要求自己的精确基础镜像，不能与此包混用。配套新版可选AI环境已用基础任务41856656733、完整产品源码633ed1b和三引擎选择显式发起[Actions 41861715138](https://github.com/W-Boat/WorkProof/actions/runs/41861715138)，目前仍在运行，不能视为已交付；工作流入口的分支提交498027d不改变其明确检出的产品源码633ed1b。

部署仍按[机构入门说明](INSTITUTION-START-HERE.md)和包内手册执行。此核对不证明全历史版本升级、生产服务器验收或全部商业授权；不要用新包的空库初始化操作处理已有数据库。
