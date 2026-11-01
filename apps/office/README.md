# Word / WPS 文字加载项

## 本轮交互修正（待 Actions 验证）

暂停不等待已悬挂的宿主快照：先停止本机采样，再尝试保存队列；暂停前发起的快照即使在续录后返回，也按代际丢弃。无法取消宿主 API 本身，仍可能占用宿主资源。本机服务离线时仍保持暂停，明确显示部分操作尚未保存。请保持任务窗打开，恢复连接后点击继续记录；继续前先补传队列并标明暂停缺口，失败不会恢复采样。内存队列仍不跨面板关闭保存。

导出不再连续触发两次自动下载。生成绑定原字节的作品与证书后，页面提供“保存作品”“保存证书”两个独立链接，可重复点击；必须自行核对下载位置。页面只能确认文件已准备，无法确认宿主是否允许下载或文件是否落盘。继续编辑后，原链接仍是上一次准备的版本，应重新导出后交付。

首次配对可点击“取消连接”，终止本页请求并忽略迟到的批准，不创建新记录。请求超时和取消使用基础 AbortController、计时器及监听转发，不依赖较新 WebView 才支持的 AbortSignal.any/timeout。服务器待确认请求仍由原协议过期，并非已撤销桌面全部授权。本轮未改系统证书信任、Office 注册或证明协议；新增断网暂停/恢复、独立下载和迟到批准测试，全部等待 Actions，不冒称真实 Word/WPS 宿主保存验收。

优先交付宿主。共用 TypeScript 采集与核验协议，分别通过 Office.js 与 WPS JSAPI 读取本机当前文档。宿主提供的接口决定兼容性，不能宣称所有历史版本均支持。

## 安装与服务器

Word 加载项页面由机构服务器通过 HTTPS 提供。CI 构建 `apps/office/dist`；配置 `WORKPROOF_PUBLIC_ORIGIN=https://机构域名` 时会生成指向 `/office/index.html` 的 Word 任务窗清单。不在未指定域名时生成一个看似可用的假地址。Word 加载项可通过机构集中部署或宿主允许的加载方式注册。

WPS 加载项需由宿主加载同一任务窗页面，并提供 `Application` 或 `wps.WpsApplication()` 及文件系统 JSAPI。缺少接口时明确报错，不能模拟导出成功。WPS 加载清单、发布包与桌面安装引导仍待接入。

插件首次连接时向本地引擎请求临时授权。用户在桌面窗口核对完整来源网址并允许后，得到仅限该来源、该宿主和自建会话的令牌。原生主令牌不暴露给网页。网页不能调用原生文件路径 seal 接口。授权内存保存，最长 8 小时；引擎重启需要重新批准。浏览器的本地网络权限、混合内容策略和机构策略仍需真实宿主验证。

批准后，可在桌面“已授权的插件连接”查看来源与到期时间，并单独断开。撤销后旧令牌的后续请求会被拒绝，不删除已有记录，也不影响其他连接；重新使用需再次批准。该列表不包含使用原生主令牌的 VS Code/Blender。详见 [连接管理](../../docs/ADAPTER-CONNECTIONS.md)。

## 采集和文件绑定

默认每秒采样字符与段落统计；超过百万字符时降低为约五秒。只在内存中临时读取正文与计算变更指纹；不保存正文、删除草稿、剪贴板、物理击键时长或 AI 推断。采样之间的动作可能合并或遗漏，不能把净增删量当作全部击键数量。较长的调度中断及用户暂停会记录缺口。

Word 使用 `Office.context.document.getFileAsync('compressed')` 获得一份交付用 `.docx`。因其为临时导出副本，不能假定它与磁盘上另存的 `.docx` 字节相同。加载项提供该交付件与对应证书的独立保存链接，用户核对下载位置后交付这对文件。

WPS 先调用当前文档的 Save，再由 FileSystem.readAsBinaryString 读取保存文件。两个流程均在加载项中计算 BLAKE3，作品字节不发往服务器或本地 HTTP 接口；本地引擎只接收摘要、长度和统计事件。

## 官方依据

- [Word 全文文件导出](https://learn.microsoft.com/en-us/office/dev/add-ins/word/get-the-whole-document-from-an-add-in-for-word)
- [Word 事件生命周期](https://learn.microsoft.com/en-us/office/dev/add-ins/word/word-add-ins-events)
- [WPS FileSystem](https://open.wps.cn/documents/app-integration-dev/wps365/client/wpsoffice/jsapi/addin-api/FileSystem/obj)

目前完成的是适配源码和授权协议，完整宿主安装与真实 Office/WPS 运行验收仍待完成。
