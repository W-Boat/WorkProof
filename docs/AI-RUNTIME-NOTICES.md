# Python 运行环境许可原文归档

86012bd 的真实模型专项 41298806491 已通过许可边界测试和实际环境归档；中英文两份证据各含35个distribution/188份许可文件，下载后已再次核对归档与每份原文SHA。唯一缺项是tokenizers0.23.3的实际wheel RECORD没有许可。另从PyPI固定sdist核对并补充版本级Apache原文（见docs/licenses/ai-runtime/tokenizers-0.23.3/source.json），不篡改原installed manifest的缺失事实，不证明wheel可复现血缘或静态依赖完整许可。

`tools/ai-assessment/collect_notices.py --output 新目录`只读取当前 Python 的 purelib/platlib 中实际已安装 distribution 的 RECORD 文件清单，收集 LICENSE/LICENCE、NOTICE、COPYING、COPYRIGHT 及 `.dist-info/licenses` 内文件。不会联网、导入包或运行模型。输出目录必须不存在，且不能位于当前 site-packages 内；失败保留现场，不覆盖旧归档。

原始字节保存在编号文件中，manifest.json 记录包名、实际版本、包内相对原路径、归档路径、大小和逐文件 SHA256，不记录本机绝对安装路径。候选文件最多一万项，单项4MiB、总计64MiB；拒绝越界及符号链接。缺少 RECORD、未找到许可、文件不可读或超过限制均明确列出，不用模型卡或 metadata 标签补造授权原文。

这份归档不是完整商业放行：RECORD 之外的文件、二进制静态嵌入组件、系统动态库、基础权重血缘、训练集及模型附带条件仍须另核。源码/依赖更新后需要用实际交付环境重新收集，不能拿开发环境替代正式运行时。

验收在 Actions 的实际 CPU 运行环境安装完成后执行；上传完整目录。检查 manifest 中无绝对路径、每条记录的字节与 SHA256 匹配、目录二次使用拒绝、缺失许可条目确实保留；另外用隔离 site-packages fixture 验证越界/符号链接/大小限制。只检查文件名或输出数量不代表全部组件已覆盖。当前新增源码尚未在本机运行或测试，实际验收以主线 Actions 为准。
