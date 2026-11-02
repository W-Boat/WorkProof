# 可选 AI 辅助分析工具

独立 Python 按需运行，不进入 Rust 常驻记录进程。机构工作台已接入文件选择、明确发送同意、任务查询及取消，配置见[机构辅助分析](../../docs/INSTITUTION-AI.md)。用户本机尚未安装模型。

现有 MPU 中英文模型属于同一方法；新增 Desklib 英文分类器已通过[真实模型与 Java 调用](https://github.com/W-Boat/WorkProof/actions/runs/41502727303)和[机构网页](https://github.com/W-Boat/WorkProof/actions/runs/41503104263)验收。两种实现都属于监督分类，不能称为多类独立检测原理或“大多数开源引擎已支持”。旧英文 GPT-2 参考模型已从注册表、机构接口和用户选项移除；命令行必须明确指定引擎，不再隐式选择它。

| 引擎 | 固定权重 revision | 语言 |
|---|---|---|
| `mpu-zh-v3` | `47695ff451b32c225dd938f4f478f7fdc6aa6bb0` | 中文 |
| `mpu-en-v3` | `3ceb1d1bb7b9ca11585ce3f4299950e1c465b6d8` | 英文 |
| `desklib-en-v1.01` | `5fdea974cd4287c61674951ec78803aa274e2fb7` | 英文 |

两者类别映射均为 0=Human、1=AI，依据[固定官方演示代码](https://huggingface.co/spaces/yuchuantian/AIGC_text_detector/blob/191c98291f204cae3e52db965ab0f944c9005067/app.py)，不是根据分数或默认 LABEL 名称猜测。配置预期 LABEL_0/1，运行时若变化拒绝推理。

上游[项目说明](https://github.com/YuchuanTian/AIGC_text_detector)称 2025 年 v3 面向 GPT-4、DeepSeek-V3 及推理模型。这是上游适用范围声明，不能代替 WorkProof 对当前模型、中文误报、混合写作、改写和翻译的独立评估。真实模型合成输入测试只验证调用链路和数值格式。

## 使用

```text
python detector.py prepare --engine mpu-zh-v3 --model-dir /absolute/path/models/mpu-zh-v3
python detector.py infer-file --engine mpu-zh-v3 --model-dir /absolute/path/models/mpu-zh-v3 --input-file /absolute/path/work.docx --language zh
python detector.py prepare --engine mpu-en-v3 --model-dir /absolute/path/models/mpu-en-v3
python detector.py infer --engine mpu-en-v3 --model-dir /absolute/path/models/mpu-en-v3 < request.json
```

JSON 输入形如 `{"language":"en","text":"..."}`。prepare 明确联网下载固定公开文件，不读取作品；infer 只使用本地模型并关闭遥测，禁止远程自定义代码。准备记录含逐文件 SHA256，运行前以 1 MiB 缓冲流式核对；该记录不是第三方签名。

两个 MPU 上游模型都只发布 `.bin` 权重：固定 PyTorch 版本，显式 `weights_only=True`，不回退到不受限加载，不扩展反序列化白名单。受限加载不能替代操作系统内存沙箱或防止所有拒绝服务，见[PyTorch 说明](https://docs.pytorch.org/docs/2.15/notes/serialization.html)。

Desklib 只读取固定 Safetensors，权重约 1.74 GB，另有 tokenizer 等资源，不进入轻量记录安装包。独立本地适配按发布的 DeBERTa/掩码均值池化/单 logit 架构加载，严格核对参数键，不执行上游 Python；权重、分词模型及模型卡另外核对注册表中的固定 SHA256。准备方式与其他引擎相同，将 `--engine` 和目录末级设为 `desklib-en-v1.01`。保持本产品 512 token 上限，未采用上游示例的静默截断。

## 输入与结果

中文至少 80 个汉字，英文至少 80 个空格分词；所选语言必须匹配。最多 512 个模型 token，超长返回未分析，绝不悄悄截断。文字输入上限 32 KiB。不支持、太短、未准备、错误分别报告，不将失败解释为未使用 AI。

结果含引擎、模型 revision、输入 SHA256、Human/AI 原始 `raw_scores` 和 `calibration=null`。MPU 的 `score_kind=uncalibrated_class_softmax`；Desklib 为 `uncalibrated_binary_sigmoid`，Human 仅为 AI sigmoid 得分的补值，并非第二个独立输出。这些数值不是 AI 内容比例或已校准的作者概率，不在不同模型之间平均。不得单独据此认定作弊或原创性，也不验证作者身份或创作证书。

支持 UTF-8 TXT/Markdown、Word/WPS 保存的 UTF-8 XML DOCX。原文件不改写，报告含原文件和提取文字 SHA256，不保存正文。DOCX 仅提取主文档 w:t 源文字，可能包括隐藏和修订文字；不是 Office 排版后的可见全文，不读取页眉、脚注、批注，不做 OCR，不执行宏或外部关系。

独立工具限制：原件 64 MiB、ZIP 4096 项/4 MiB 中心目录、声明展开 128 MiB、主 XML 4 MiB/200 倍压缩比/10 万节点/128 层、提取文字 32 KiB。拒绝 DTD、UTF-16 XML、重复 ZIP 路径、宏包和异常目录。机构入口另收紧原件为 8 MiB。合成 DOCX 测试不代表真实 Word/WPS 插件安装验收。

## 许可与验证边界

中英文固定 revision 模型卡均声明 Apache-2.0；[英文模型卡](https://huggingface.co/yuchuantian/AIGC_detector_env3/blob/3ceb1d1bb7b9ca11585ce3f4299950e1c465b6d8/README.md)仅有许可标签。英文配置指向 RoBERTa-base，中文指向 hfl/chinese-roberta-wwm-ext。代码、权重、基础模型及实际运行依赖的完整许可材料仍需分别核对，当前不作整套环境商业分发放行。

Desklib 固定模型卡标 MIT，发布目录没有完整 LICENSE/NOTICE；基座为微软 DeBERTa v3 large。该声明不足以完成权重及商业分发审查，[核查记录](../../docs/licenses/ai-models/desklib-en-v1.01-source.json)保留固定版本、摘要与缺失项，`commercial_clearance=false`。本次接入不复用无明确完整许可的上游 Python 源文件，也不替代数据集和依赖许可检查。

专用 Actions 显式准备真实固定权重，检查离线推理、语言/短文状态、真实 DOCX 输入及 Java 服务调用；机构手动 `ai_models=true` 另验证生产网页中英文选择和结果。公开产物只保留结果、依赖清单及模型文件摘要，不含权重或作品正文。不同方法的引擎、现代样本误报评估、长期任务和安装向导仍待完成。

实际安装环境的许可原文与缺失项归档见[运行时许可](../../docs/AI-RUNTIME-NOTICES.md)；不能将顶层依赖声明或模型卡标签当作整体商业分发放行。
