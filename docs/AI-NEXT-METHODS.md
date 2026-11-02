# 新检测方法与评估数据的接入核查

现有 MPU v3 中英文配置属于同一检测方法，不能按两个独立方法计算。Desklib 的真实模型及机构网页链路已验收，仍未商业放行或证明效果；C-ReD 和 DetectRL-X 仍为评估数据候选。

- Desklib v1.01：固定 revision `5fdea974cd4287c61674951ec78803aa274e2fb7`，英文 DeBERTa-v3-large 分类器，采用均值池化与单 logit/sigmoid。本地独立适配不加载上游 Python，严格匹配 Safetensors 参数，新增 CLI、机构选择与按引擎匹配的 sigmoid 评估类型。[真实模型与 Java 验收](https://github.com/W-Boat/WorkProof/actions/runs/41502727303)以及[真实机构网页流程](https://github.com/W-Boat/WorkProof/actions/runs/41503104263)均通过；合成输入只证明调用链，不证明准确率。与 MPU 是不同模型实现，仍属于监督分类方法，不能据此声称覆盖多类独立检测原理。模型卡标 MIT，固定发布目录未见完整 LICENSE/NOTICE，[许可记录](licenses/ai-models/desklib-en-v1.01-source.json)仍为未商业放行。来源：[固定官方模型卡](https://huggingface.co/desklib/ai-text-detector-v1.01/blob/5fdea974cd4287c61674951ec78803aa274e2fb7/README.md)、[官方源码说明](https://github.com/desklib/ai-text-detector)。
- C-ReD：作者发布的 2026 中文基准候选，覆盖多领域与生成器，适合继续核查近期中文评估数据。仍需确定不可变数据版本、逐类生成器及时间、人工文本来源、许可、校准/评估切分与训练泄漏；尚未下载或用于准确率结论。根 LICENSE 路径本轮返回 404，这只说明该路径不可用，不能替代完整目录和数据许可审查。来源：[作者仓库](https://github.com/HeraldofLight/C-ReD)。
- DetectRL-X：固定数据 revision `ccc9a0a74793dd3448e0da1650b430f5df1b0402`，作者 2026 发布的双语候选（另含其他语言），声明包含 DeepSeek-V3、GPT-4o、Gemini-2.5-Flash、Qwen-Max。已检查原始 JSON 的第一条记录字段，并固定 general_256 文件大小与 SHA256；未下载全量或运行效果评估。[来源核查](licenses/ai-models/detectrl-x-source.json)记录 MIT 声明及完整许可/原始语料权利缺口。不同策略共享训练数据，不可把不同文件名视作独立校准/评估集；还需检查重复人工原文、生成来源和领域切分。256 长度变体的结论不能泛化为完整作业。来源：[固定作者数据卡](https://huggingface.co/datasets/WUJUNCHAO/DetectRL-X/blob/ccc9a0a74793dd3448e0da1650b430f5df1b0402/README.md)。

接入门槛保持明确：先固定模型/代码/数据与适用许可，再实现独立适配和真实推理，最后在冻结策略与独立样本上报告覆盖、误报、漏报及区间。候选列表、元数据字段、指标 fixture 和模型能启动均不能替代这些步骤。尚无足够依据给近期中英文效果作保证。
