# 增加不同的 AI 辅助判断方法

独立中文结果已完成：留出集误报10/188（5.32%），漏报152/192（79.17%），在当前固定模型/方法配置下效果不足，继续不启用正式检测；英文仍在运行。冻结阈值、覆盖、置信区间和限制见[评估结果](LRR-EVALUATION-RESULTS.md)，不能用前面的合成运行成功替代这个效果结论。后续新模型/方法评估需预先确定配置并使用新的未观察留出数据，避免根据本次留出表现反复调参。

源码 `19a122f` 的[边界复验 41629078832](https://github.com/W-Boat/WorkProof/actions/runs/41629078832)已成功：真实512 token合成输入完成511个有前缀token评分，记录的加载及计算约6.93秒、进程峰值RSS为3,999,128 KiB；513 token输入按明确预算拒绝，无评分字段。该输入是重复单词构造的运行边界，不是最坏文本内容或准确率样本。模型边界和数学测试也通过；[结果记录](evidence/lrr-19a122f/synthetic-results.json)的GitHub ZIP摘要已核对。独立中英文评估仍在运行，阈值没有接入生产。

后续资源复验新增恰好512 token 的合成输入和513 token拒绝检查，以实际验证上限与不截断行为；该增量尚待 Actions，不能用两个短样本的成功替代。独立中英文评估 `41628627615` 仍按原始源码和冻结流程运行，不因资源测试增量重新选样或重启评估。

首轮源码 `9249f58` 的[实验 41628044799](https://github.com/W-Boat/WorkProof/actions/runs/41628044799)已成功。固定模型英文/中文合成样本分别为106/108 token，记录的加载及评分时间约2.86/2.53秒，进程峰值 RSS 为3,999,240/3,999,844 KiB。该计时不包含模型文件核验和进程启动，不能当完整请求延迟；这两个短样本也不能证明512 token最坏资源情况。原始非文本结果及 artifact 摘要已核对，见[记录](evidence/lrr-9249f58/synthetic-results.json)。没有准确率或生产就绪结论。

新增 `lrr-calibration.yml` 为显式运行的独立中英文评估：复用已核验的源分组与固定384条/语言/分区选择，先准备两分区并查重，校准后冻结阈值，再评分留出集。LRR使用自身非负比值，未接入分类器概率协议；校准要求每类至少100条已评分且总覆盖至少90%，否则失败，不改阈值目标或输入门槛。输出只含样本摘要、标签、分组、数值和选择记录，不上传原文。新评估尚待 Actions，不能把合成样本成功替代真实误报评估。

实验源码正在补充为独立 `lrr_probe.py`，没有接入生产引擎注册表。`lrr-experiment.yml` 将固定模型字节、检查独立公式边界，并用合成中英文测量真实内存和耗时；不上传权重或原文，不在本地运行模型。这些检查即使通过，也不证明检测准确率，独立校准及留出评估仍是后续必需工作。

现有 MPU 中英文与 Desklib 英文已完成可选 CPU 服务流程验收，但仍属于监督分类。这不满足“多种独立方法”的完整目标。以下是下一步技术调查，不是已接入、效果或商用许可通过的声明；已有元数据线索和创作过程证据也继续独立展示。

## 下一项实验：依据公开公式计算 LRR

[DetectLLM 论文 §3.1](https://aclanthology.org/2023.findings-emnlp.827.pdf)定义 LRR 为目标 token 负对数概率之和除以其对数排名之和；排名从 1 开始，论文观察到机器生成文本通常取值较大。它是统计比值，不是“AI 内容百分比”。论文没有验证 Qwen3-0.6B 或中文效果，不能沿用其准确率、AUROC 或阈值。

[官方仓库](https://github.com/mbzuai-nlp/DetectLLM)本轮未查到可核验的完整源码许可证原文，因此不复制其函数、注释、配置或数据。可依据论文公式独立实现概率、排名、求和和比值；这是技术来源边界，不是法律结论，也不称为官方引擎。拟采用明确的实验标识，并在独立校准和留出评估前保持无阈值参考值。

候选评分模型为 [Qwen/Qwen3-0.6B-Base](https://huggingface.co/Qwen/Qwen3-0.6B-Base)，固定 revision `da87bfb608c14b7cf20ba1ce41287e8de496c0cd`。该版本的 [LICENSE 原文](https://huggingface.co/Qwen/Qwen3-0.6B-Base/blob/da87bfb608c14b7cf20ba1ce41287e8de496c0cd/LICENSE)为 Apache-2.0。[权重页](https://huggingface.co/Qwen/Qwen3-0.6B-Base/blob/da87bfb608c14b7cf20ba1ce41287e8de496c0cd/model.safetensors)提供文件 SHA256 `cd2a512003e2f9f3cd3c32a9c3573f820bb28c940f73c57b1ddaa983d9223eba`，不能替换成页面另列的 Xet hash。该来源记录仍需在 Actions 下载后逐字节复核。

[配置](https://huggingface.co/Qwen/Qwen3-0.6B-Base/blob/da87bfb608c14b7cf20ba1ce41287e8de496c0cd/config.json)的词表上限为 151,936、上下文为 32,768。按 596,049,920 参数估算，FP32 权重约 2.384 GB；512 token 完整 FP32 logits 约 311 MB。框架、转换、激活和页缓存会增加峰值，尚未实测，不能据此说 7 GB runner 或 120 秒期限一定足够。完整上下文的 logits 约 19.9 GB，因此初始实验应设置明确的输入预算，超限返回不能评分，不能暗中截断。

拟定实现要求：原文因果评分，不套聊天模板、不生成或改写；第一项无前缀 token 不评分；明确特殊 token、最少 token 和最大长度；排名采用 `1 + count(logit > target_logit)` 并标记这是自定义并列规则；分母为零、数值无效或超预算时不给出伪造分数。结果使用独立的比值类型和高值方向，保留 `calibration=null`，不填入现有 Human/AI 概率字段。

接入顺序是固定来源/原文/小文件摘要，Actions 验证真实权重与内存/耗时，独立报告协议和普通用户解释，最后用不重叠的中英文校准及留出集检验误报。任何一步未通过，都不能以单个模型能返回数值代替整个方法可用。

## 另两项候选保留调查

DNA-GPT 后续源码核查：官方 `DNA-GPT-dist.py` 当前演示不能直接导入到机构服务。它在模块级修改TLS校验并下载语言资源；生成流程依赖外部API，生成返回变量前后不一致；分词器保留英文字母/数字，不能据此支持中文。依据是[官方演示源文件](https://github.com/Xianjun-Yang/DNA-GPT/blob/main/DNA-GPT-dist.py)，不是本地运行结果。该来源使用浮动main，仅为调查记录，接入前还需固定提交、归档原许可与版权。

因此下一步若选择再生成方法，需要明确采用哪个现代模型、是否本地运行、分词与长度规则、生成次数、随机种子和资源上限，再在新校准/未观察留出样本上测量。不能加载原演示来绕过TLS、使用用户未同意的外部服务，或沿用原模型阈值宣称中文有效。当前未复制或执行该演示，没有要求用户提供API密钥，也没有把它加入已支持列表。

[Binoculars 代码许可证](https://github.com/ahans30/Binoculars/blob/main/LICENSE.md)是 BSD-3-Clause，但 [README](https://github.com/ahans30/Binoculars/blob/main/README.md)同时写有 implementation 用于 academic purposes 的表述，不能忽略这项冲突。[官方实现](https://github.com/ahans30/Binoculars/blob/main/binoculars/detector.py)默认两个 Falcon 7B 模型，BF16 权重合计约 28 GB 的估算不适合当前 CPU runner。换成现代小模型需重新验证方法和阈值，不能直接沿用 Falcon 的结果。

[DNA-GPT 官方许可证](https://github.com/Xianjun-Yang/DNA-GPT/blob/main/LICENSE)为 MIT；其[论文](https://arxiv.org/abs/2305.17359)采用截断再生成与 n-gram 差异，属于另一种方法。多次生成可能超出现有 CPU 服务期限，中文效果也需独立评估。源码原文许可不等于所选生成模型、数据和整个部署链的权利已全部核清。

本轮仅浏览上述官方来源，没有下载权重、执行模型或将候选代码引入产品。
