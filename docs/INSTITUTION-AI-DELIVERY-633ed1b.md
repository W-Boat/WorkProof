# 633ed1b 配套可选 AI 环境

[Actions 41861715138](https://github.com/W-Boat/WorkProof/actions/runs/41861715138) 的选择任务和三个单引擎任务均已成功。产品源码为 `633ed1bd80402d4637c6fb3b10a7c89932530fba`；工作流入口提交498027d仅负责调度。三个任务都导入[基础任务41856656733](https://github.com/W-Boat/WorkProof/actions/runs/41856656733)的精确镜像 `sha256:f6de16b596e73f92edd8a0ff127d99d0b53148e1ca1c5de480b5bb5ea2d462fd`，检查派生层关系后执行真实模型服务验收。

成功日志明确覆盖默认关闭、管理员选择后下载及离线准备、同意后真实HTTP推理、取消清理、加密备份、恢复后默认关闭、显式离线重新启用且不改原记录、已有配置拒绝覆盖，以及模型篡改后拒绝重新启用。输入均为合成文本；每份按自己的单个引擎验收，不代表同一实例同时启用三个模型，也不证明识别准确率。

| 单引擎产物 | 字节数 | 外层 SHA256 |
|---|---:|---|
| [中文 MPU / 13339344765](https://github.com/W-Boat/WorkProof/actions/runs/41861715138/artifacts/13339344765) | 552,946,342 | `51fda31742abf27bd874d3bf2f9304bcbc0132da3606d8404690db14ef3794ea` |
| [英文 MPU / 13340247315](https://github.com/W-Boat/WorkProof/actions/runs/41861715138/artifacts/13340247315) | 552,939,858 | `e689026bd1258d0b255bb5c2ad729794112194ec1e60dcd913e7509d0b9264b8` |
| [Desklib 英文 / 13341640295](https://github.com/W-Boat/WorkProof/actions/runs/41861715138/artifacts/13341640295) | 552,934,086 | `3e25138cbbf5db364ce94cbcca768af23f10781cf019a45d718c8d37397b862c` |

中文包和英文包已分别完整下载至 `E:/work/WorkProof-Delivery/institution-ai-runtime-zh-633ed1b.zip`、`E:/work/WorkProof-Delivery/institution-ai-runtime-en-633ed1b.zip`，外层大小与摘要匹配。每包9项文件摘要、精确文件集合、产品源码、基础任务、运行任务、引擎和镜像ID全部核对；无重复或越界归档路径。英文包在旧下载句柄确认不存在后精确206续传，并重新核对整个文件的SHA256。Desklib 正在本地下载，不能将它记为本地包内核对已通过。

三份成功日志 SHA256：中文 `635688299822253e39b9e4ab474753a774d771c25655f5bd35006b43bee55e53`；英文 `48c0cca7484555be55657f22656b90636d62d0760f24021fa672ea3ecd79bc30`；Desklib `fd9e34c970c02385ff90c4b577812803bb5b4e4c2136f3bdb1ead44c2697e309`。日志本地路径为 `E:/work/optional-ai-{zh,en,desklib}-633ed1b-success.log`。

这些是 Linux amd64 可选运行环境，不含模型权重、账号或部署秘密。本地未加载镜像、下载模型、运行推理或改动部署。须与[同版本基础包](INSTITUTION-DELIVERY-633ed1b.md)配套，不与旧cf1ab54包混用；按[可选AI部署说明](INSTITUTION-AI-DEPLOYMENT.md)操作。

中文包的运行时原始许可材料记录35个 Python 包，仍有1项原始声明缺口，`commercial_clearance` 明确为false；真实模型验收不解除模型、基础模型、训练数据或依赖的许可条件。三个引擎均为监督分类，独立 LRR 实验仍因漏报过高不进入正式工作台。
