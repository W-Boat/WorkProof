# 可选AI参考引擎（实验适配）

这是独立的Python按需工具，不进入Rust常驻记录进程。首个适配器固定为英文GPT-2参考分类器，不能当作中文、ChatGPT或所有现代生成器的通用检测器。它不是新增阶段全部完成，也尚未接入普通用户的网页/机构分析流程。

```text
python detector.py prepare --model-dir /absolute/path/to/model
python detector.py infer --model-dir /absolute/path/to/model < request.json
```

请求JSON形如 `{"language":"en","text":"..."}`。prepare明确联网下载公开模型，不读取用户文本；infer只使用本地模型，设置HF离线模式，禁止远程自定义代码，只允许Safetensors。准备记录列出文件摘要，运行前核对文件没有相对准备记录改变；该记录不是第三方签名认证。

明确支持范围：英文，至少80个空格分词，最多512个模型token；不截断长文，不把不支持、缺模型或错误当成“未使用AI”。返回uncalibrated_class_softmax与Fake/Real两个原始分数、输入SHA256及模型revision，不能解释为AI内容占比或已校准的作者概率。短文本、中文和缺模型分别给出独立状态。

模型来源：[固定revision模型卡](https://huggingface.co/openai-community/roberta-base-openai-detector/blob/6cba99c003b711c7fe94f8a3aa2be35a792cb6fa/README.md)。模型卡声明MIT并明确其GPT-2/英文使用范围及不宜独立判断学术不端的限制。运行时依赖、完整许可原文与分发包仍需独立审查，当前没有作整个模型运行环境的商业分发放行，不自动向用户设备安装模型。

中文候选[yuchuantian/AIGC_detector_zhv3](https://huggingface.co/yuchuantian/AIGC_detector_zhv3)已核对到固定revision `47695ff451b32c225dd938f4f478f7fdc6aa6bb0`，模型卡声明Apache-2.0，当前只提供pytorch_model.bin且配置未明确标签映射；仍需核对官方推理逻辑、基础模型许可、安全加载和真实中文验收，不能因为看到Apache标签就称已可用。

专用Actions会显式下载真实权重，在CPU离线推理合成文本，验证状态、标签与数值格式，不声称这些样本证明检测准确率。模型和用户正文不进入公开产物，只保留运行结果、依赖元数据与模型文件摘要；中文误报/漏报、多引擎校准和用户操作入口仍在后续范围。
