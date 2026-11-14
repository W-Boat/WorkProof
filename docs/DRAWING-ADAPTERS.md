# 绘画软件接入

新增 Krita 原生 Python 面板开发版，已有 Photoshop UXP 接入继续保留。本阶段重点覆盖绘画场景；GIMP、Inkscape、SAI、CLIP STUDIO PAINT 与 Procreate 尚未接入，不能将文件可打开当作操作已采集。

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
