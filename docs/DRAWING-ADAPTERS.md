# 绘画软件接入

用户最新指定优先支持 Photoshop（PS）、PaintTool SAI2、Adobe Illustrator（AI）。Photoshop 已有 UXP 开发适配；Illustrator 新增原生只读采样探针；SAI2 外部记录方式尚未实现。Krita 开发插件继续补真实宿主验收。不能把文件可打开或探针能返回数据当作完整记录已接入。

## Krita 开发版

通过 Krita“工具 → 脚本 → 从文件导入 Python 插件”导入 `workproof-krita-dev.zip`，按提示在 Python 插件管理器启用 WorkProof 并重启，在“设置 → 面板”打开 WorkProof。

打开 WorkProof 桌面端，保存当前作品，在 Krita 面板点开始，然后在 WorkProof 中允许连接。插件使用独立、可撤销的来源授权，不读取桌面主令牌；原生来源白名单新增 Krita 需要本次提交或后续版本的收集器，已安装的旧 Windows 包尚不具备该项授权。

记录包含图层/组/可见计数、图层层级/顺序/透明度/混合模式的本机摘要，以及 64×64 合成缩略图的变化摘要。QAction 监听复制、粘贴、剪切、撤销和重做命令触发；命令触发不等于操作最终生效。截图、像素、图层名称和持久节点 ID 不进入公开事件。摘要不上传服务器。

宿主对象只在主线程访问，网络与文件指纹使用一个工作线程，界面保持可操作。发送失败保留原事件序号与内容，继续时标注缺口。切换文档、图层扫描不完整或队列超限时暂停，不把不同作品混在一个会话里。

导出先保存作品并调用随包 Rust 引擎计算 BLAKE3 文件指纹，最终 save 事件和签名证书绑定实际文件；证书与原作品分开交付，已有证书不覆盖。Windows 自动定位安装包内摘要程序，其他平台需选择对应本机可执行程序。当前 CLI 限制文件不超过 128 MiB。

## 能力边界与验证

缩略图变化不是逐笔记录，会漏掉细微变化及隐藏图层画面变化；图层改名未采集。宿主忙时推迟采样，超过 15 秒标注缺口。100ms 图层与 200ms 总采样预算在调用边界检查，不能抢占宿主单次同步调用。最多 4096 节点、64 层。

当前增加核心模拟与真实 Rust 收集器检查，尚未完成真实 Krita 启动、实际画笔/快捷键和插件导入验收。CI 结果以对应 Actions 为准，未通过之前不作为可安装正式版交付。

插件分发采用 GPL-3.0-or-later，包含完整插件源代码与 COPYING；自有独立 core 可选 MIT。没有捆绑 Krita、Qt、PyQt 或第三方绘图资源。GPL 允许商业使用，分发仍需遵守源码与许可义务。

接口依据：[官方插件说明](https://docs.krita.org/en/user_manual/python_scripting/krita_python_plugin_howto.html)、[Document](https://api.kde.org/legacy/krita/html/classDocument.html)、[Node](https://api.kde.org/legacy/krita/html/classNode.html)。

后续顺序：真实 Krita 宿主验收及桌面安装入口 → GIMP / Inkscape 宿主方案 → 商业绘画软件按公开插件能力逐项确认。平台没有可用接口时明确说明，不伪造全动作支持。

## 2026-11-14 验证记录

源码 `9de232b` 的 [Krita 专项 43578617911](https://github.com/W-Boat/WorkProof/actions/runs/43578617911) 已成功。7 项核心模拟、真实 Rust 收集器批准连接、证书签名导出、篡改拒绝、来源/会话隔离及撤销检查通过。开发 ZIP 已下载并核对外层 GitHub 摘要和内层 ZIP 摘要，包含 GPL 许可与完整插件源代码。

插件目前基于 PyQt5，真实 Krita 5.x/Qt5 宿主导入与绘画尚未验收，Qt6 版本未适配。配套桌面构建仍在运行，用户当前安装版仍为 `8d85093`，不能直接批准 Krita 来源。已验证插件 ZIP不等于已完成客户端安装或真实宿主交付。

## PS / SAI2 / AI 优先范围（追加）

- Photoshop：复用现有 UXP 适配，继续补真实宿主、正式分发和大 PSD/PSB 流式路径；已有模拟与收集器检查不等于 Adobe 宿主验收。
- Illustrator：[原生只读探针](../apps/illustrator/README.md) 已通过 Windows 模拟/脚本解析 Actions，未接完整授权记录链、真实软件和安装流程。2027 年公开 UXP 插件接口前不伪造兼容模块。
- SAI2：[实施要求与观测边界](../apps/sai2/README.md) 已明确，尚未实现。文件保存或前台输入统计必须明确标成外部观测，不冒充图层和笔触 API。

Krita 的真实宿主验收仍未通过：原最新发行包的 Python/Qt 绑定失败；Qt5 脚本运行器打开 GUI 缺少资源；完整 GUI 在旧版宿主遇到文档路径与 API 差异。已改为真实插件管理器、文档非阻塞图像锁和固定 5.2 / Qt5 环境，最新修正版 Actions 43580995145 仍在运行。桌面 Krita 入口也修复了软件选项加入错误下拉框的问题，交互 Actions 43580995140 仍在运行。不能用旧的核心成功覆盖这些真实失败。

用户已确认本机尚未安装 SAI2 和 Illustrator；只读安装登记检查检测到 Photoshop 2025 26.11.0.18，检查当时未运行。后续优先使用该合法 Photoshop 做实机验收；SAI2/Illustrator 继续源码、自动检查和安装准备，真实宿主待可用后验收，不将未安装作为其他开发的阻塞。
