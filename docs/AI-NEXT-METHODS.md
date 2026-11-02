# 新检测方法与评估数据的接入核查

现有 MPU v3 中英文配置属于同一检测方法，不能按两个独立方法计算。Desklib 现已进入源码接入与 Actions 验收阶段，仍未商业放行或证明效果；C-ReD 仍为数据候选。

- Desklib v1.01：固定 revision `5fdea974cd4287c61674951ec78803aa274e2fb7`，英文 DeBERTa-v3-large 分类器，采用均值池化与单 logit/sigmoid。本地独立适配不加载上游 Python，严格匹配 Safetensors 参数，新增 CLI、机构选择与按引擎匹配的 sigmoid 评估类型；真实推理与网页链路交给本次 Actions，尚不能记为已验收。与 MPU 是不同模型实现，仍属于监督分类方法，不能据此声称覆盖多类独立检测原理。模型卡标 MIT，固定发布目录未见完整 LICENSE/NOTICE，[许可记录](licenses/ai-models/desklib-en-v1.01-source.json)仍为未商业放行。来源：[固定官方模型卡](https://huggingface.co/desklib/ai-text-detector-v1.01/blob/5fdea974cd4287c61674951ec78803aa274e2fb7/README.md)、[官方源码说明](https://github.com/desklib/ai-text-detector)。
- C-ReD：作者发布的 2026 中文基准候选，覆盖多领域与生成器，适合继续核查近期中文评估数据。仍需确定不可变数据版本、逐类生成器及时间、人工文本来源、许可、校准/评估切分与训练泄漏；尚未下载或用于准确率结论。根 LICENSE 路径本轮返回 404，这只说明该路径不可用，不能替代完整目录和数据许可审查。来源：[作者仓库](https://github.com/HeraldofLight/C-ReD)。

接入门槛保持明确：先固定模型/代码/数据与适用许可，再实现独立适配和真实推理，最后在冻结策略与独立样本上报告覆盖、误报、漏报及区间。候选列表、元数据字段、指标 fixture 和模型能启动均不能替代这些步骤。尚无足够依据给近期中英文效果作保证。
