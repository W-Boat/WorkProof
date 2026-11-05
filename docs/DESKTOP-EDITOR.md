# 内置编辑器与 Fluent 桌面工作区

本次实现沿用已确认的第二版设计：固定的应用导航，文档内的撰写、过程、证书标签，以及完整设置页。图标直立；窗口操作按钮均为 46 × 36；主要文字为 14–17 px。动画采用 160–220 ms 的淡入、小幅位移和选中反馈，支持系统与应用“减少动态效果”。界面使用官方 Fluent Web Components，不宣称 HTML 外壳是原生 XAML 控件。

## 编辑与记录

- Tiptap 3.32.2 与 StarterKit；表格、段落对齐、代码高亮、Markdown 使用现成扩展。
- 所有在当前内置编辑器中分发的 Tiptap 事务均保存，包括不改正文的事务、选区、stored marks 与插件事务。保存 steps、选区、事务标记名称、文字增删量与本机经过时间。
- 编辑区另记录键盘、beforeinput/input、复制/粘贴/剪切命令、拖放、焦点与输入法合成事件。命令不等于系统动作一定成功。初始化、加载历史和 WorkProof 自己的只读状态切换不冒充用户操作。
- 本机 `editor.sqlite` 独立于已有宿主记录数据库。正文、标题、动作批次、版本检查点在一个 SQLite 事务提交。相同请求可幂等重试；过期版本拒绝覆盖。650–2000 ms 量级的自动保存有崩溃前未提交窗口，不能声称每个键都即时耐久落盘。
- 点击关闭前等待保存；系统关闭请求通知前端保存，失败保留窗口。断电、强制终止与系统崩溃不属于正常关闭保证。
- 最近操作显示 12 条，过程页显示最近 300 条与 120 个保存版本；更早的已存操作仍纳入导出。输入法、宿主版本和辅助输入需要真实 Windows 验收，不把浏览器夹具当宿主实测。

## 分页与 Word

- `tiptap-pagination-plus@3.1.0` 提供分页与切换命令（MIT）。
- PageBreak 直接复用 Folio Editor 的独立扩展，固定提交 `fcf3bc2153585ad7b44d00c7186bfed8299e8419`。原始 TypeScript、MIT 许可与文件摘要放在 `apps/desktop/frontend/vendor`。没有强制安装其声明依赖 Tiptap 2 的整个 npm 包。
- `@docen/docx@0.7.0` 提供现成 DOCX ↔ Tiptap JSON 转换（MIT），在专用 Worker 中运行，20 秒超时后终止；导入限制 8 MB，ZIP 中声明的解压总大小限制 32 MB。转换不上传。使用公开转换 API，不重写 OOXML 解析器或导出器。
- Docen 的旧 Tiptap 依赖通过根 overrides 统一到 3.32.2，以避免重复内核及已知旧版本问题；必须通过 Actions 的真实转换检查，不能仅凭版本号断言兼容。
- 导入保留本编辑器支持的正文、常用格式、标题、列表和表格。图片、复杂页眉页脚、批注、修订及复杂字体版式不是无损往返承诺。导入之前的历史不可补造。
- 导出 DOCX 由插件生成二进制，Rust 原样计算指纹、追加作品保存检查点、签署证书并写入一对新文件。内容预览是同一编辑文档的安全 HTML，不是像素级 Word 渲染。Word 插件负责格式转换，签名只绑定导出的文件字节与披露记录。

## 核验和交付

导出前重新计算已有记录链，并检查当前正文匹配最近保存检查点。每个导出附 `.wproof`，通过既有协议、Ed25519、Merkle 树与 BLAKE3 核验。证书不包含历史正文和原始事务文本；这些内容留在本机。使用系统文件选择器，拒绝覆盖已有文件。

核验网页运行于既有回环资源服务，在主窗口 iframe 显示。iframe 不获得工作台命令；所有新增原生命令仍只允许 `status` 窗口。父页面不获取引擎 token 或签名密钥。签名不单独认证作者身份、原创性或真实创作时间。

Actions 负责依赖安装、构建、Rust 存储与签名检查、三浏览器 Tiptap/Worker 功能检查与截图。浏览器测试中的存储 IPC 是夹具；真实 SQLite 与签名由 Rust 测试覆盖。Windows 包还需要原生 WebView2 与宿主人工验收。不得运行本地构建、测试或开发服务器。

## 第三方资料

构建会复制已安装桌面运行依赖的原始许可证文件，并输出 `ui/notices/index.json`，缺少许可原文的项保留在清单中，不当作已审核通过。Folio 的完整 MIT 许可另随包保留；全项目商业许可审查原有未决项并未因此自动解决。

- https://tiptap.dev/docs/editor/api/events
- https://github.com/RomikMakavana/tiptap-pagination-plus
- https://github.com/Swanand58/folio-editor
- https://github.com/DemoMacro/docen
