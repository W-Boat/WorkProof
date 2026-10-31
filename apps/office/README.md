# Word / WPS 文字加载项

优先交付宿主。共用 TypeScript 采集与核验协议，分别通过 Office.js 与 WPS JSAPI 读取本机当前文档。宿主提供的接口决定兼容性，不能宣称所有历史版本均支持。

## 安装与服务器

Word 加载项页面由机构服务器通过 HTTPS 提供。CI 构建 `apps/office/dist`；配置 `WORKPROOF_PUBLIC_ORIGIN=https://机构域名` 时会生成指向 `/office/index.html` 的 Word 任务窗清单。不在未指定域名时生成一个看似可用的假地址。Word 加载项可通过机构集中部署或宿主允许的加载方式注册。

WPS 加载项需由宿主加载同一任务窗页面，并提供 `Application` 或 `wps.WpsApplication()` 及文件系统 JSAPI。缺少接口时明确报错，不能模拟导出成功。WPS 加载清单、发布包与桌面安装引导仍待接入。

插件首次连接时向本地引擎请求临时授权。用户在桌面窗口核对完整来源网址并允许后，得到仅限该来源、该宿主和自建会话的令牌。原生主令牌不暴露给网页。网页不能调用原生文件路径 seal 接口。授权内存保存，最长 8 小时；引擎重启需要重新批准。浏览器的本地网络权限、混合内容策略和机构策略仍需真实宿主验证。

## 采集和文件绑定

默认每秒采样字符与段落统计；超过百万字符时降低为约五秒。只在内存中临时读取正文与计算变更指纹；不保存正文、删除草稿、剪贴板、物理击键时长或 AI 推断。采样之间的动作可能合并或遗漏，不能把净增删量当作全部击键数量。较长的调度中断及用户暂停会记录缺口。

Word 使用 `Office.context.document.getFileAsync('compressed')` 获得一份交付用 `.docx`。因其为临时导出副本，不能假定它与磁盘上另存的 `.docx` 字节相同。加载项下载该交付件与对应证书，用户应交付这对文件。

WPS 先调用当前文档的 Save，再由 FileSystem.readAsBinaryString 读取保存文件。两个流程均在加载项中计算 BLAKE3，作品字节不发往服务器或本地 HTTP 接口；本地引擎只接收摘要、长度和统计事件。

## 官方依据

- [Word 全文文件导出](https://learn.microsoft.com/en-us/office/dev/add-ins/word/get-the-whole-document-from-an-add-in-for-word)
- [Word 事件生命周期](https://learn.microsoft.com/en-us/office/dev/add-ins/word/word-add-ins-events)
- [WPS FileSystem](https://open.wps.cn/documents/app-integration-dev/wps365/client/wpsoffice/jsapi/addin-api/FileSystem/obj)

目前完成的是适配源码和授权协议，完整宿主安装与真实 Office/WPS 运行验收仍待完成。
