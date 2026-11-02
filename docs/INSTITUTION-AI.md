# 机构 AI 辅助分析工作台

本轮源码新增可选英文 Desklib v1.01，固定 revision `5fdea974cd4287c61674951ec78803aa274e2fb7`，默认仍关闭、不下载权重。页面的“分析模型”按语言选择，机构对每个模型分别校验得分类型；Desklib 的 sigmoid 与 MPU 的 softmax 不混用或平均。真实权重 CLI、Java 桥接、常规未配置页面及显式模型生产网页仍待本轮 Actions。完整许可及近期误报评估未完成，两种实现仍属于监督分类方法，不能计作多类独立检测原理。

57d5aef 的真实中英文完整网页专项 [41298447642](https://github.com/W-Boat/WorkProof/actions/runs/41298447642) 已通过，包括模型版本与下载报告；当前新增阅读流程简化仍待最新 Actions。

辅助报告返回 model（模型名称）、model_revision（固定权重版本）、score_kind（得分类型）、calibration（当前无校准）、network_used（推理未联网）。服务端与允许表校验模型及版本，不符则拒绝结果。页面“模型版本与报告”可保存无正文 JSON；它可以被编辑，不是签名证书，不证明发布身份或原文件以外内容。

模型选项已改为中文/英文 MPU v3，旧 GPT-2 ID 从选项和服务端允许列表移除；现有旧模型文件不会自动删除，但不能继续提交分析。管理员需显式准备 mpu-en-v3 新子目录。两种语言属于同一方法，效果评估和完整许可材料仍待完成。

普通核验页保持默认本地处理；本功能位于机构工作台，需要登录及单独的 `workproof:analysis:run` 权限。超级管理员继承已有全部权限，其他角色需通过现有菜单/按钮权限管理明确授权；不自动扩大证书检查权限，不自动迁移数据库。

用户依次选择DOCX/TXT/MD、选择语言对应的模型、确认发送文档，再查看参考结果。提交的是作品原字节，最多8MiB，发送同意同时在页面与接口检查。结果不是原证书的一部分，不认证身份、人类创作比例或原创性。短文本、超出处理长度、未配置、失败与取消分别说明；不给失败任务补零分。

## 管理员准备

保持独立Python环境，按 `tools/ai-assessment/requirements.txt` 准备预构建运行时；审核代码、模型、基础模型与分发条款后，再显式准备公开权重。不会随服务器启动自动下载或执行外部模型代码。

```text
python detector.py prepare --engine mpu-zh-v3 --model-dir /srv/workproof-models/mpu-zh-v3
python detector.py prepare --engine mpu-en-v3 --model-dir /srv/workproof-models/mpu-en-v3

WORKPROOF_AI_ENABLED=true
WORKPROOF_AI_PYTHON=/absolute/venv/bin/python
WORKPROOF_AI_SCRIPT=/absolute/WorkProof/tools/ai-assessment/detector.py
WORKPROOF_AI_MODELS=/srv/workproof-models
```

Python、脚本和模型根目录必须是管理员配置的绝对路径。脚本目录还需包含documents.py和engines.json。模型子目录必须与固定engine_id对应，且存在准备记录；配置检查只代表文件齐备，不代表模型质量、许可或实际推理已验收。默认关闭，不影响登录、证书管理或本地记录；本会话尚未给用户本机安装大权重或升级运行中的JAR。

## 接口与保留范围

| 接口 | 用途 |
|---|---|
| GET /api/workproof/analysis/capabilities | 准备状态、支持的模型和上传上限 |
| POST /api/workproof/analysis/tasks/{engine}/{format}?consent=true | 明确同意后提交原始二进制；format仅docx/txt/md |
| GET /api/workproof/analysis/tasks/{id} | 查询当前账号自己的任务 |
| DELETE /api/workproof/analysis/tasks/{id} | 请求停止自己的实际分析进程 |

字段：id为随机任务编号，state为阶段，report为经服务端筛选的参考结果。state区分queued（等待）、running（分析）、finalizing（清理）、done（完成）、cancelling（正在取消）、cancelled（已结束取消）、timeout（超时）、failed（失败）、cleanup_failed（临时输入清理失败）。只有清理完成后才公布正常完成结果；清理失败明确报告给用户，不冒称文件已删除。

report.status区分模型完成/不支持/文字太短/未准备；artifact_hash为上传原字节SHA256；raw_scores为未校准的分类分数；scope与message为简明范围及下一步。返回白名单不会转发模型报告里的正文或任意附加字段，审计不记录请求参数。

每个服务实例仅允许一个活动任务，最多保留16个短期任务摘要；任务约十分钟后失效，并按分钟清理。它们不持久化，重启即丢失，不是长期批量队列。单次进程120秒期限、输出64KiB，关闭或取消会停止受控进程，临时文件在最终阶段删除；权限仍按每次请求检查，账号只能看和取消自己的任务。页面关闭会尽力请求取消，网络断开或注销后的停止无法由客户端保证，服务器期限仍生效。

输入以私有临时文件交给本机模型进程，不继承数据库密码、JWT等环境变量，不调用shell。Python推理离线，重模型不进入记录守护进程；仍不是操作系统内存沙箱。部署应按机构原HTTPS、账号、运行时与临时目录运维流程配置。

## 验证与当前边界

55ae2ba的[机构验证41291714040](https://github.com/W-Boat/WorkProof/actions/runs/41291714040)已通过Java测试、Vue生产构建及原业务回归；同源码[真实模型桥接41291714008](https://github.com/W-Boat/WorkProof/actions/runs/41291714008)两个模型通过Java服务→实际Python→固定公开权重推理。原Java单元的进程fixture只用于权限归属、容量、取消与结果白名单，不能冒充模型验收。

完整工作台浏览器测试最初在文件输入的无障碍名称失败，已在363263c为选择器加明确aria-label。修正后[常规41292512199](https://github.com/W-Boat/WorkProof/actions/runs/41292512199)与[显式真实模型41292588758](https://github.com/W-Boat/WorkProof/actions/runs/41292588758)均已全部通过。常规模式显示未配置且禁止发送；显式`ai_models=true`在隔离Actions准备实际权重，通过生产Vue→鉴权HTTP→Java任务→Python验证原字节指纹、真实中文参考结果、短文说明、取消及手机布局。英文模型另有真实Java服务桥接验收；此网页流程未声称所有模型按钮组合都逐项跑过。合成测试文字不证明模型准确率或真实Word/WPS宿主安装。

上述历史验收覆盖两个 MPU 语言模型；新增 Desklib 的验收状态见本页开头。尚未完成大多数开源引擎、误报校准、持久批量、Windows AI环境、普通用户安装向导或用户本机升级。完整分发许可审查也未因此完成。
