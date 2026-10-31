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

- 事件只含层数、组数、实际可见节点数及动作类别；不保存像素、图层名称、历史状态名称或描述符。文档/历史 ID 仅用于当前内存中的隔离与并发变化检查，不送入事件。
- 隐藏面板会暂停；继续时披露缺口，换文档拒绝续录。离线事件保留到恢复并重试，停止前须确认已提交；关闭宿主仍可能丢失未提交队列。
- UXP File.read 在当前实现一次读取文件，因此副本上限 128 MB，不支持超大 PSD/PSB。此限制不改变长期大文件目标，后续需补安全流式文件权限与读取路径。
- 当前传输仅向 `http://127.0.0.1:43127`。Adobe 文档说明 macOS 对不安全 HTTP 有额外限制；没有通过修改系统策略绕过。Windows 实机、macOS 安全传输与实际宿主验收仍需完成。
- 原生授权需要无 Origin 的 UXP 原生请求；若宿主运行时附加 Origin，当前应明确报错，不伪造网站来源或放开浏览器 CORS。宿主版本的实际网络行为必须实测。
- 本机插件名称为自声明，不是经过认证的 Adobe 插件身份。授权只可操作自己的 Photoshop 会话，不能读其他会话、查询全局统计、调用原生 `/seal` 或取得主令牌。

## 验证与分发

构建、控制器/宿主 API 模拟、真实 Rust 收集器/SQLite/签名/CLI 核验与归档检查均在 GitHub Actions。模拟 API 不代表真实 Photoshop 验收；报告必须分别注明。

`apps/photoshop/dist` 是构建后的开发加载目录，ZIP 是源交付/开发包，不应改名为 `.ccx` 冒充正式安装器。包含本项目与打包哈希库的许可；Adobe API 模块由宿主提供，不作为 MIT 库打进包。

官方参考：

- [UXP manifest 与权限](https://developer.adobe.com/uxp/guides/explanation/concepts/manifest/)
- [网络与 macOS HTTP 边界](https://developer.adobe.com/uxp/guides/how-to/recipes/network/)
- [文档保存与历史状态](https://developer.adobe.com/photoshop/uxp/ps_reference/classes/document/)
- [动作通知](https://developer.adobe.com/photoshop/uxp/2022/ps-reference/media/photoshopaction)
- [动作代码表](https://developer.adobe.com/photoshop/uxp/2022/ps-reference/media/eventcodes)
- [文件选择与权限](https://developer.adobe.com/photoshop/uxp/2022/uxp-api/reference-js/modules/uxp/persistent-file-storage/storage)
