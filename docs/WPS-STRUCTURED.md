# WPS 演示与表格开发适配

WPS 演示和 WPS 表格复用现有 Word/WPS 任务窗、桌面授权和证书协议。开发源码包含两个独立入口，构建后分别在 `office/wps-presentation` 和 `office/wps-spreadsheets`。对应的加载项类型为 `wpp` 和 `et`。

用户在宿主中保存本地作品，打开 WorkProof 工作台，开始记录并回到桌面允许连接。完成后在加载项中准备作品和证书，再分别保存两个文件。

演示适配读取幻灯片及对象数量，并在本机对文本、对象类型、位置、尺寸和旋转角度计算摘要。表格适配读取工作表名称、使用区域的位置和公式，计算本机摘要并记录工作表与使用区域单元格数量。正文、公式和单元格内容用于本机计算摘要，发送到记录服务的事件包含摘要、计数和时间。

这两类来源的文字净增删计数为零，保留各自的结构统计，核验页当前按非文字来源处理。相同对象数下的文本或位置变化、相同单元格数下的公式变化均会改变摘要。采样之间的连续操作可能合并或遗漏。

当前限制为 128 张幻灯片或工作表、4096 个演示对象、2 万个使用区域单元格和 200 万字符的采样内容。区域很大且多数单元格为空时也会触及限制。当前覆盖顶层演示对象，组合内编辑、颜色、效果和完整格式变化仍需扩展。表格格式、图表和计算结果变化也需继续扩展。

导出复用 WPS 的 Save 与 FileSystem.readAsBinaryString，作品上限为 128 MiB。作品字节在任务窗内计算 BLAKE3，再绑定签名证书。真实版本是否提供这些接口及下载能力，需要逐宿主验收。

机构仍需使用 WPS 支持的发布流程部署。构建产物包含任务窗资源、ribbon.xml 和宿主类型说明，正式发布地址与安装验收待完成。真实宿主验收范围和 Actions 测试结果需分别核对。

## 官方接口依据

- [演示 Application](https://open.wps.cn/documents/app-integration-dev/wps365/client/wpsoffice/jsapi/wpp/Application/obj)
- [演示 TextFrame](https://open.wps.cn/documents/app-integration-dev/wps365/client/wpsoffice/jsapi/wpp/Shape/member/TextFrame)
- [表格 Application](https://open.wps.cn/documents/app-integration-dev/wps365/client/wpsoffice/jsapi/et/Application/obj)
- [WPS 加载项发布](https://open.wps.cn/documents/app-integration-dev/wps365/client/wpsoffice/wps-integration-mode/wps-addin-development/wps-addin-development-instructions)
