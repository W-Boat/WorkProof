# 从 WorkProof 安装和注册插件

在桌面工作台的「应用连接」选择软件，即可查看该宿主的设置入口。安装状态与连接授权独立，首次连接仍需确认来源。

| 宿主 | 当前入口 | 待完成 |
| --- | --- | --- |
| Word、PowerPoint | 通过现有 Windows 原生安装工具检查和注册 | 各宿主版本验收 |
| VS Code | 从桌面安装随包 VSIX，并向 VS Code 查询扩展安装状态 | 版本检查与卸载入口 |
| Blender | 桌面调用官方扩展安装命令并启用随包 ZIP | 实机确认安装后重启及面板可见 |
| Krita | 打开随包 ZIP 所在目录 | 宿主导入与启用，后续补桌面引导 |
| Photoshop | 打开随包开发插件目录 | 由 Adobe 工具生成并验收 CCX，接入正式安装流程 |
| Excel | 已有 Office.js 清单与任务窗开发包 | 机构 HTTPS 地址、清单注册与真实 Excel 验收 |
| WPS 文字、演示、表格 | 已有加载项入口与发布资源 | WPS 发布、注册和真实宿主验收 |
| Illustrator、InDesign、SAI2 | 从应用连接直接开始记录 | 对应宿主及版本验收 |

- [Blender 扩展命令](https://docs.blender.org/manual/en/latest/advanced/command_line/extension_arguments.html)
- [Adobe UXP 插件安装](https://developer.adobe.com/uxp/guides/how-to/distribution/install/)
- [WPS 加载项发布](https://open.wps.cn/documents/app-integration-dev/wps365/client/wpsoffice/wps-integration-mode/wps-addin-development/wps-addin-development-instructions)
