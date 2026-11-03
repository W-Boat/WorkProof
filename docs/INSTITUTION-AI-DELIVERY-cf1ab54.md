# 中文 AI 可选运行环境包核对

英文 MPU 候选包也已本地核验：`E:/work/WorkProof-Delivery/institution-ai-runtime-en-cf1ab54.zip`，artifact `13227191055`，552,864,100字节，外层 SHA256 `e5c91a1c5d7a64a5567564ca3163c8969b1b52bc9578326882a38ba022238234` 与 GitHub 一致，9项包内摘要全部匹配。记录的英文引擎、源码和基础镜像与配套基础包一致，见[英文包检查](evidence/institution-ai-cf1ab54/en-package-inspection.json)。它与中文包同样不含模型和私有部署配置；Desklib候选包仍在续传，未验收其本地归档。

配套基础包也已下载至 `E:/work/WorkProof-Delivery/institution-server-cf1ab54.zip`：artifact `13225657527`，222,507,555 字节，SHA256 `af51a3e3ed2f22174c8e7c19ad04d53fdb69f149abb6c5ee5a074041864b92e9` 与 GitHub 一致，26项包内摘要全部匹配。[基础包检查记录](evidence/institution-ai-cf1ab54/base-package-inspection.json)与下面的 AI 包记录交叉核对过源码、基础任务、精确基础镜像 ID 和 Linux amd64 平台。两份包现已本地核验配套，不代表已经安装、具备模型权重或完成商业许可审查。

源码 `cf1ab548e6edce10c46257185ce92a64233d5274` 的[三模型任务 41626918967](https://github.com/W-Boat/WorkProof/actions/runs/41626918967)全部成功。中文 MPU 候选运行环境 artifact `13226851651` 已完整下载到 `E:/work/WorkProof-Delivery/institution-ai-runtime-zh-cf1ab54.zip`，大小 552,841,598 字节。

外层 SHA256 为 `12b930a7c2ea35c1c80a58a48d18abb8c8a7c51a5bd083a6e35bfa4cfa34960d`，与 GitHub 元数据一致。包内清单的9项文件摘要全部核对，包含镜像归档、运行时记录、管理工具、说明及许可材料。源码、任务编号、Linux amd64平台和中文引擎标识均一致；[完整只读记录](evidence/institution-ai-cf1ab54/zh-package-inspection.json)已保存。

本包是可选 CPU 运行环境，不包含模型权重、账号和部署配置。它要求基础任务 `41625621375` 同源码镜像 `sha256:13e8579cf7ab22d1a8395db3ceabce514eb62ce7184ce9806447b0edc7e0abfc`；不要与先前已下载的 `6592819` 基础包混用。可选镜像 ID 为 `sha256:9f56cefe019b7cfaf50c338b55a1353b9f0f8645af1260cfb894c0320151ab95`，下载的摘要是完整性证据，不替代发布者身份签名。

云端已验证该镜像的中文模型准备、真实接口推理、取消清理、备份恢复、恢复后重新启用及篡改拒绝，打包时验证过导出镜像配置、层摘要和重新加载。此次本地只核对 ZIP，不加载镜像，不改动已安装应用或数据库。尚未将这套包安装到用户服务器，不能据此声称现有部署已启用。

运行时记录覆盖35个已安装发行包，1个包仍有原许可文件缺失记录，附带版本级补充材料；这不是完整商业放行。具体部署顺序见[入门说明](INSTITUTION-START-HERE.md)，许可与模型误报仍按各自报告处理。
