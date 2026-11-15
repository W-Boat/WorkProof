# 从 WorkProof 安装和注册插件

在桌面工作台的「应用连接」选择软件，即可查看该宿主的设置入口。安装状态与连接授权独立，首次连接仍需确认来源。

| 宿主 | 当前入口 | 待完成 |
| --- | --- | --- |
| Word、PowerPoint | 通过现有 Windows 原生安装工具检查和注册 | 各宿主版本验收 |
| VS Code | 从桌面安装随包 VSIX，并向 VS Code 查询扩展安装状态 | 版本检查与卸载入口 |
| Blender | 桌面调用官方扩展安装命令并启用随包 ZIP | 实机确认安装后重启及面板可见 |
| Krita | 安装到当前用户的默认插件目录 | 在宿主启用并重启，默认目录及宿主版本仍需真机验收 |
| Photoshop | 打开随包开发插件目录，或选择已有 CCX 交给 Adobe Creative Cloud 安装 | 发布 WorkProof CCX，验收 Adobe 确认和安装流程 |
| Excel | 输入机构 HTTPS 地址，在桌面保存专用清单 | 由机构管理员部署清单，随后验收真实 Excel |
| WPS 文字、演示、表格 | 从桌面打开机构的 HTTPS 安装页 | 机构用 WPS 发布工具部署安装页，用户在页面确认安装，真实宿主待验收 |
| Illustrator、InDesign、SAI2 | 从应用连接直接开始记录 | 对应宿主及版本验收 |

- [Blender 扩展命令](https://docs.blender.org/manual/en/latest/advanced/command_line/extension_arguments.html)
- [Adobe UXP 插件安装](https://developer.adobe.com/uxp/guides/how-to/distribution/install/)
- [WPS 加载项发布](https://open.wps.cn/documents/app-integration-dev/wps365/client/wpsoffice/wps-integration-mode/wps-addin-development/wps-addin-development-instructions)
