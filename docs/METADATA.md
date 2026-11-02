# 本机文件元数据检查

核验页的“进一步检查 AI 线索”可读取 PNG 未压缩文字字段、JPEG 文件头的部分 EXIF/注释/XMP，以及 Word/WPS DOCX 与 PowerPoint/WPS PPTX 中的 `docProps/core.xml`、`app.xml`、`custom.xml` 属性。用户先确认其中姓名、标题、提示词等信息可以显示，再主动检查。文件不上传，不运行检测模型，不修改证书。

普通 Word、WPS、Photoshop 软件名称不作为 AI 线索。仅自定义属性的 prompt、workflow、parameters、aigenerator 等字段名称提示人工复核，字段可被伪造、删除或复制；检出不能确认 AI 来源，未检出也不能确认没有使用 AI。仅显示标量值，不解释嵌套属性结构。

DOCX/PPTX 使用浏览器原生 deflate-raw 解压，无新增依赖。ZIP 目录在分配条目之前限制原件 64 MiB、4096 项、4 MiB 目录、声明展开 128 MiB；拒绝重复路径、加密、不支持的方法、多卷、ZIP64、宏标记。仅解压三类属性，每类压缩与展开最多 256 KiB、压缩比 200 倍，流式超限停止，核对实际长度及 CRC。本地头的 CRC/尺寸必须与目录一致；bit3 流式写入时允许零值，但紧随压缩数据的带签名或不带签名 descriptor 必须与目录匹配。仅对读取的属性核对本地头和 descriptor，不声称验证整个 ZIP 的所有文件内容。其他部分不解压，不读取正文或关系，不执行宏，不发外部请求。浏览器缺少或不支持 deflate-raw 构造时明确提示升级。

属性先由 Worker 以严格 UTF-8 解码，拒绝 NUL、DTD、实体声明和非 UTF-8 声明，再在页面用原生 DOMParser 解析受限 XML。拒绝错误 XML 和不支持的根命名空间；最多每部分 10000 元素、总共显示 32 项、每字段值 160 字符，过滤控制字符和双向控制符，React 文本转义。三份 XML 最多 768 KiB，不进入 HTML 渲染。ZIP 读取与解压 Worker 继承原 15 秒超时、取消和换文件销毁规则。DOMParser 在主线程同步运行，元素数量检查发生在解析后，不受 Worker 的 15 秒中断或取消控制；依靠每份 XML 字节上限限制输入规模，不能称为硬时限或内存沙箱。

这不是完整 OOXML 格式验证器或可见全文分析。旧版 DOC/PPT、PDF、数字签名、图像像素及水印尚未纳入本功能；PNG 压缩文字和 CRC 保持明确未检查。普通损坏、过大或不支持文件如实提示未检查。

`tests/metadata.spec.ts` 增加真实 ZIP/deflate 的浏览器测试，覆盖普通 WPS 名称、可修改线索、转义、DTD/实体、宏、重复目录、坏 XML、stored 条目、bit3 descriptor、CRC 不符、伪造条数、实际解压超声明、展开总量/单项/压缩比上限、按 URL origin 检查无外联和手机布局。本机不构建或运行测试，最终验收以 GitHub Actions 为准；合成文件不代表真实宿主安装验收。

PPTX 复用同一 ZIP 与属性解析器，仅根据唯一的 word/document.xml 或 ppt/presentation.xml 标记区分属性展示类型；两种主部件并存时拒绝。只读取三类 docProps 属性，不读取幻灯片正文。该类型标记不是来源软件或完整 OOXML 有效性的证明，旧 PPT/DOC 仍不支持。结构参考[微软 PresentationML 说明](https://learn.microsoft.com/en-us/office/open-xml/presentation/structure-of-a-presentationml-document)。新增浏览器测试覆盖普通 PowerPoint 名称不触发生成线索、自定义 workflow、幻灯片正文不显示、混合主部件和宏拒绝。此改动不新增检测模型，也不提供水印验证。

## JPEG 来源属性

JPEG 仅读取第一段 SOS 图像扫描前的元数据，最多 4 MiB 文件头、4096 数据段、累计 1 MiB APP1/COM；不解码图像，不验证完整 JPEG、扫描体或 EOI，不检查扫描之间/之后的元数据。APP1 内识别 Exif TIFF 的大小端、IFD0 和单个 Exif 子目录，最多 256 条目。只展示 Software、ImageDescription、Artist、Copyright 的 ASCII 文本，以及 UserComment 的 ASCII 或带 BOM 的 UTF-16（单值最多 16 KiB）；其他编码、GPS、缩略图、MakerNote 和更多目录不读取。EXIF 读取边界或目录错误时撤回该段的已收集字段并记为未检查，不把残缺属性当完整结果。字段含义与编码参考 [CIPA Exif 规范](https://www.cipa.jp/std/documents/e/DC-X008-Translation-2019-E.pdf)。

COM 仅按严格 UTF-8 展示，其他编码记为未检查。标准 XMP APP1 最多 4 包（每包由 JPEG 段长度限制为小于 64 KiB）；严格 UTF-8、拒绝 NUL/DTD/实体与非 UTF-8 声明。主线程 DOMParser 只接受 xmpmeta/RDF 与直接 Description 中的简单标量属性或属性值；每包最多 4096 元素（解析后检查），扩展 XMP、数组、结构属性不解释并计入未检查。总共最多显示 32 项、每值 160 字符，依旧使用文本转义、控制符清理与 Worker 取消机制。JPEG 和 XMP 结构依据 [Adobe 官方 XMP 规范入口](https://developer.adobe.com/xmp/docs/xmp-specifications/)。

XMP 的 prompt、workflow、parameters、aigenerator 字段名仅提示检查可修改的生成流程线索。Software、CreatorTool、注释内出现的普通编辑软件名称不触发 AI 判断。未识别的属性、已删除的标记或没有命中的字段不构成“没有使用 AI”的证据。本模块不检查 C2PA 签名；其核验使用独立的图片凭据入口。

属性展示复用核验页已有 Panel、Tag、颜色与间距变量。常见字段显示中文名称，例如“编辑软件”“图片注释”“提示词”，原始字段及定位统一收在“查看原始字段与位置”中，保留复核依据。卡片自动适应窄屏；字段原值仍按可修改信息展示，不改写为来源事实。

JPEG 的 Actions 浏览器用例使用浏览器实际编码的 JPEG 加合成 EXIF/XMP，覆盖大小端、中文 BOM 注释、普通软件名称、可修改提示字段、脚本转义、异常偏移、DTD 外链拒绝、嵌套属性跳过、段长度与数量限制、32 项显示上限、无外联与手机宽度。合成属性不是实际生成工具标记或真实来源证明，不能用作检测效果评估。
