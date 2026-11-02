# WorkProof Photoshop UXP 适配器

本目录为自有 MIT 代码，使用宿主提供的 Photoshop/UXP API。当前交付源代码与可加载开发包，不含 Adobe 运行时、商业软件或 `.ccx` 市场安装器；没有提交 Adobe Marketplace。注册插件 ID、正式签包与分发需合法的 Adobe 开发者流程。

## 使用

1. 安装 WorkProof 桌面引擎，以及合法的 Photoshop/UXP Developer Tool；本开发包声明 Photoshop 23.3+、UXP manifest v5、PS API v2。不能推断所有历史版本兼容。
2. 在 UXP Developer Tool 添加本包的 `manifest.json` 并加载；从 Photoshop 插件菜单打开 WorkProof。
3. 点击开始，选择新的 `-workproof.psd` 交付副本位置，再在 WorkProof 桌面窗口允许刚发起的“Photoshop 本机插件自声明”请求。
4. 主动记录当前文档。导出时选择 `.wproof` 证书位置；插件在 `executeAsModal` 中保存 PSD 副本，然后对实际字节计算 BLAKE3，将摘要和统计送给本机引擎。签名仍为本机自签名，v3 证书可独立核验或选择性披露。
5. 交付本次导出的 PSD 副本与证书。不要拿另一份重新保存的 PSD 替换交付件。

文件选择由用户明确授权，插件不请求全盘访问。拒绝覆盖正在创作的源文档，动作回调不执行网络、哈希、图层遍历或保留描述符。统计/动作类别每秒合并；绘画、创建/删除/移动/合并、属性变化和撤销信号只表示观察类别，不是每次动作的完整回放。未注册/未触发的动作可由历史状态变化补为一般编辑信号，不能承诺所有笔画或精确重做方向。

## 隐私与限制

- 事件包含层数、组数、实际可见节点数、动作类别，以及开始/图层变化/继续时的 BLAKE3 结构摘要。图层 ID、父级、排列位置、类型和可见性仅在内存中组成确定性快照；证书只签入摘要，不发送原始 ID、像素、图层名称、历史状态名称或描述符。文档/历史 ID 也仅用于当前内存中的隔离与并发变化检查。
- 即使图层数量不变，重新排序、移入/移出组、替换图层或可见性变化也会产生新的结构观察。最多遍历 50000 个唯一节点，重复/缺失 ID 或遍历期间历史状态改变时拒绝继续；摘要检查不能恢复原图层树，不构成逐操作回放或完整分支历史。重做/撤销方向不依赖历史 ID 的大小推断。
- 隐藏面板会暂停；继续时披露缺口，换文档拒绝续录。离线事件保留到恢复并重试，停止前须确认已提交；关闭宿主仍可能丢失未提交队列。
- UXP File.read 在当前实现一次读取文件，因此副本上限 128 MB，不支持超大 PSD/PSB。此限制不改变长期大文件目标，后续需补安全流式文件权限与读取路径。
- 当前传输仅向 `http://127.0.0.1:43127`。Adobe 文档说明 macOS 对不安全 HTTP 有额外限制；没有通过修改系统策略绕过。Windows 实机、macOS 安全传输与实际宿主验收仍需完成。
- 原生授权需要无 Origin 的 UXP 原生请求；若宿主运行时附加 Origin，当前应明确报错，不伪造网站来源或放开浏览器 CORS。宿主版本的实际网络行为必须实测。
- 本机插件名称为自声明，不是经过认证的 Adobe 插件身份。授权只可操作自己的 Photoshop 会话，不能读其他会话、查询全局统计、调用原生 `/seal` 或取得主令牌。

## 验证与分发

构建、控制器/宿主 API 模拟、真实 Rust 收集器/SQLite/签名/CLI 核验与归档检查均在 GitHub Actions。模拟 API 不代表真实 Photoshop 验收；报告必须分别注明。

`apps/photoshop/dist` 是构建后的开发加载目录，ZIP 是源交付/开发包，不应改名为 `.ccx` 冒充正式安装器。包含本项目与打包哈希库的许可；Adobe API 模块由宿主提供，不作为 MIT 库打进包。

## 可选的图层关系文件

开始前勾选“另存图层关系与顺序”可导出 `.wgraph`。默认关闭，原有结构摘要路径保留。开启后仅分享会话内重新编号的图层/组、父子关系与顺序，不含 Photoshop 原始图层 ID、图层名、像素或可见性。关系本身可能透露作品组织方式，请按需交付。编号只比较相邻采样中仍存在的节点；未观测到的删除与重建不能据此判为同一持续身份。

后台按真实事件序号请求本机 Rust 计算结构检查点，事件落盘确认后才收录快照。断线重试沿用原快照，已提交但丢失确认的事件不会重新采样。每会话 128 份快照、每份 10000 个节点、合计 50000 个节点、8 MiB 与 256 层限制；超过限制暂停并提示，仍可导出已提交记录。结构图不表示全部编辑历史。

开启该选项后，导出时另外弹出一次 `.wgraph` 保存位置选择；取消则不写入本次证书。保存使用同一 UXP `getFileForSaving` 与 `Entry.write` 权限机制，不推断同目录权限。请同时交付所选 PSD 副本、`.wproof` 和 `.wgraph`。选择性披露证书须包含结构文件引用的全部事件。可使用 `workproof-engine inspect-evolution FILE.wproof FILE.wgraph` 或网页进行核对。新增 Actions 验收使用模拟 Adobe API 与真实 Rust 引擎，不代表真实 Adobe 主机验收。

官方参考：

- [UXP manifest 与权限](https://developer.adobe.com/uxp/guides/explanation/concepts/manifest/)
- [网络与 macOS HTTP 边界](https://developer.adobe.com/uxp/guides/how-to/recipes/network/)
- [文档保存与历史状态](https://developer.adobe.com/photoshop/uxp/ps_reference/classes/document/)
- [动作通知](https://developer.adobe.com/photoshop/uxp/2022/ps-reference/media/photoshopaction)
- [动作代码表](https://developer.adobe.com/photoshop/uxp/2022/ps-reference/media/eventcodes)
- [文件选择与权限](https://developer.adobe.com/photoshop/uxp/2022/uxp-api/reference-js/modules/uxp/persistent-file-storage/storage)

结构摘要增量已加入源码，待 Actions 验证。新增测试分别使用宿主 API 模拟及真实 Rust 引擎签发，覆盖同数量排序/父级变化、摘要进入签名事件、原始图层 ID 不外传与身份/导出保护；这不代表已在真实 Adobe Photoshop 中验收。Layer.id/kind/layers/visible 以及 HistoryState.id 的使用依据：[Adobe Layer](https://developer.adobe.com/photoshop/uxp/ps_reference/classes/layer/)、[Adobe HistoryState](https://developer.adobe.com/photoshop/uxp/ps_reference/classes/historystate/)。
