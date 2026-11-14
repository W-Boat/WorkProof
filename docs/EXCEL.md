# Excel 加载项开发版

Excel 适配使用微软 Office.js。机构以 HTTPS 部署 `office/index.html` 和构建出的 `manifest-excel.xml`，再按 Office 支持的加载项部署方式注册。清单声明 Workbook 宿主，与 Word 使用不同的加载项 ID。

先保存为 .xlsx 或 .xlsm，再在加载项中点击开始记录，并在 WorkProof 桌面允许连接。完成后点击导出，分别保存工作簿和对应证书。导出作品来自 Office 提供的完整文件副本，接收方应核验这一份副本。

当前采样覆盖工作表 ID、名称、使用区域、公式与值。原始内容在加载项内计算 BLAKE3，记录服务接收变化摘要、时间和工作表及单元格计数。工作簿来源的净文字增删为零，使用结构指标描述变化。

上限为 128 张工作表、2 万个使用区域单元格、200 万字符的序列化采样内容和 128 MiB 的交付文件。读取单元格前先读取区域尺寸，超限时停止采样。公式不变而结果变化也可能产生记录。采样周期内的多个动作可能合并或遗漏，格式、图表和完整操作事件仍需扩展。

完整文件导出需要宿主支持 CompressedFile 1.1。微软当前文档列明 Windows 和 Mac Excel 支持 Compressed，网页版 Excel 只支持 PDF。加载项会在运行时检查能力并说明不可用原因。真实宿主版本、安装交互与长期采样性能待验收。

开发验收覆盖合成 Office.js 宿主中的同尺寸内容变化、内容隐私、保留 .xlsm 导出文件名和切换工作簿后暂停。实际执行结果以 Office 专项 Actions 为准。

- [Document.getFileAsync 支持矩阵](https://learn.microsoft.com/en-us/javascript/api/office/office.document?view=office-js)
- [FileType 文件格式](https://learn.microsoft.com/en-us/javascript/api/office/office.filetype)
- [工作表与使用区域接口](https://learn.microsoft.com/en-us/javascript/api/excel/excel.worksheet?view=excel-js-preview)
