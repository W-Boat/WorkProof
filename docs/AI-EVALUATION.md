# AI 检测效果评估契约

`tools/ai-assessment/evaluate.py` 是离线评估工具，不下载样本或模型，不从评估集调整阈值。当前没有提供经过复核的近期模型基准集，也没有因此证明检测效果。Actions 的指标 fixture 只检查计算与输入约束，不能用作准确率验收。

## 输入

JSONL 每行一份独立样本，UTF-8，最多 1000 份/16 MiB；文字最多 32 KiB。拒绝重复 ID、完全相同文字、缺失来源或许可声明。样本、策略、引擎清单与检测器返回的 JSON 均拒绝重复键（含嵌套字段）及 NaN/Infinity 常量，避免标签、许可声明或阈值被后一个同名字段覆盖。示意如下，不是可用基准：

```json
{"id":"example-001","language":"en","kind":"ai_original","truth":"ai","generator":"provider-model-version","text":"实际经过许可的评估文字","source":{"url":"https://example.org/dataset","license":"实际数据集许可标识","record":"不可变数据版本与行号、生成日期和记录"}}
```

`kind` 为 human_original（人工原文）、ai_original（生成原文）、paraphrased（改写）、mixed（混合）、translated（翻译）。`truth` 为 human、ai 或 mixed；混合类别必须标 mixed，混合样本不进入二元误报/漏报分母。改写/翻译必须按真实来源标注，不根据风格猜标签。人工原文的 generator 固定 human，其余应记录具体生成器版本。来源 URL 必须 HTTPS，但工具不访问它；来源真实性、许可适用性及标签需要人工复核，填写字符串不等于得到许可。

独立策略 JSON 固定引擎 revision、AI 类别分数与阈值：

```json
{"engine_id":"mpu-en-v3","model_revision":"3ceb1d1bb7b9ca11585ce3f4299950e1c465b6d8","score_kind":"uncalibrated_class_softmax","score_label":"AI","threshold":0.7,"calibration_dataset_sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","calibration_input_sha256":["bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"],"threshold_source":"替换为真实独立校准来源与冻结记录"}
```

示例阈值及摘要仅为格式示意，不能用于生产。策略必须声明与评估文件不同的校准集 SHA256，并事先冻结阈值。工具核对数据文件摘要不同、模型 revision，以及提供的校准文字 UTF-8 SHA256 清单与评估文字没有完全相同项。清单必须包含 1 至 1000 个不重复摘要；工具不能证明清单完整、语义近重复/共享来源不存在、声明真实或阈值事先冻结；正式评估需复核样本级泄漏、共享提示词/作者、时间及领域切分。不要用本次评估结果挑选阈值后再报告同一集表现。

## 运行与报告

在获准的 Actions 评估环境准备模型与有权使用的数据后运行；本项目约定不在用户本机构建/测试：

```text
python tools/ai-assessment/evaluate.py --dataset samples.jsonl --policy frozen-policy.json --model-dir /absolute/prepared-model --output new-report.json
```

进程执行目前仅支持 POSIX（Actions Linux）；Windows 明确拒绝，不能声称 Windows 进程树已受控。工具逐样本调用既有 `detector.py infer`，不启动下载，单样本 120 秒期限；标准输出增量读取最多 64 KiB 加 1 字节后拒绝，stderr 直接丢弃，不收集日志；非零退出或错误协议不会计作成功。每次调用创建独立 session，超时或结束清理该进程组中继承的子孙进程。主动 setsid 脱离进程组的程序不在保证范围；这是运行受信任检测脚本的 CLI，不是隔离服务或沙箱。每样本重新加载与校验权重，适合初始受限评估，吞吐尚未优化。输出文件以独占方式创建，避免覆盖既有结果；报告不保存正文或来源 URL，仅保留样本 ID、输入 SHA256、分组、标签、原始分数、预测/状态、数据与策略摘要。标识符及标签自身仍可能敏感，公开产物前应复核。

报告给出总体及语言、生成模型、处理类型分组计数、完成率、状态分布、误报率与漏报率及 Wilson 95% 区间。未支持、短文、缺模型、超时及错误均保留为覆盖缺口，不当作人工文本；无适用分母返回 null。混合文字只计覆盖和原始得分，不强行作二元判断。Wilson 区间假设样本独立，相关文档/共享提示词会破坏该假设。

阈值分类仅用于检测器评估，原始 softmax 不是 AI 内容比例或作者概率。当前仅支持既有分类分数协议；统计曲率、水印 p 值等必须另定义匹配的策略，不能伪装为相同概率或直接混合平均。正式效果结论还需有来源的近期模型、人工原文、中文、改写、混合、翻译、域外文本和短文本样本，报告各组覆盖及误报，不能以总体数字掩盖失效范围。
