# WorkProof v3：签名 Merkle 承诺与选择性披露

`workproof/3` 保留 [v1](PROTOCOL.md) 的事件链、Ed25519 和精确文件绑定，以及 [v2](PROTOCOL-V2.md) 的统计指标编码。新核验器继续接受历史 v1/v2；旧核验器应拒绝未支持的 v3。旧证书不能在不重新签发的情况下获得 Merkle 承诺。

## 签名清单

新增必需的 `merkle_root`，小写 64 位十六进制。v3 签名消息域为 UTF-8 `WorkProof:manifest:v3\0`，之后依次使用 v1 相同的十个 string 字段、`event_count`、`artifact_bytes`、`demo`，最后追加 `field(merkle_root)`。`field`、整数编码与 v1 相同。所有这些字段均在 Ed25519 签名内。

v1/v2 保留原签名域与字节编码，不拼入 Merkle 字段；非空 Merkle 根会被旧协议模式拒绝。`merkle_root` 缺省或为空时不序列化。完整证书仍为 `{manifest, records, signature}`，最多 100,000 条事件，并要求至少起始和最终保存两条事件。

## 树编码

继续使用已有 BLAKE3 实现，没有增加密码学依赖。所有字符串域均含末尾 NUL。

```text
H = BLAKE3-256
event_digest = event_hash("", event)   # 使用原规范的确定性编码；previous_hash 字符串为空
leaf = H("WorkProof:merkle-leaf:v3\0" || field(session_id)
         || field(record.hash) || field(event_digest))
node = H("WorkProof:merkle-node:v3\0" || left_raw_32_bytes || right_raw_32_bytes)
```

叶子严格按 `seq=0..event_count-1` 排列。每层相邻节点成对计算，孤立尾节点直接提升，不复制自己。其树形等价于递归按“小于当前叶子数的最大 2 的幂”切分，参考 [RFC 9162 §2.1 的树形定义](https://www.rfc-editor.org/rfc/rfc9162.html#section-2.1)。WorkProof 使用自己的域和 BLAKE3，不是 CT 日志、CT 协议兼容实现或第三方见证服务。实现为独立代码，没有引入该 RFC 的代码组件。

每条事件同时承诺其全部确定性字段与原链摘要。根绑定会话、顺序、数量和事件值。计算发生在签发、导出披露或核验时；追加记录的热路径沿用原链编码。

## 部分证据容器

文件仍使用 `.wproof` 扩展名，但结构独立：

```json
{
  "format": "workproof/disclosure/1",
  "manifest": {"protocol": "workproof/3", "merkle_root": "..."},
  "disclosed": [
    {"record": {"event": {"seq": 0}, "hash": "..."}, "siblings": ["..."]}
  ],
  "signature": "与原完整证书完全相同的签名"
}
```

示例只展示结构，不是可通过核验的完整值。`manifest` 原样保留全部字段，不允许未知字段；`record` 使用原事件与摘要结构。没有重复的完整 `records` 数组。

`siblings` 为从叶子向根顺序的小写摘要。在每层，若索引为奇数，则使用左侧兄弟；若为偶数且右侧存在，则使用右侧兄弟；若为孤立尾节点，直接提升且不消费路径元素。索引除以 2 向下取整，宽度除以 2 向上取整。结束时必须恰好消费所有路径元素，结果等于签名清单的根。最大深度 17。

披露条目按原 `seq` 严格递增、不重复，最多 1024 条，包含自动保留的起始 `seq=0` 与最终保存 `seq=event_count-1`。前者要求 `start` 且原链摘要与 genesis 相符；后者要求 `save`、checkpoint 匹配交付文件摘要、原链摘要等于清单链尾。披露事件的时间非递减；披露中相邻原序号的链链接仍会核对。

## 核验报告与展示

报告增加 `scope`、`merkle_valid`、`disclosed_events`、`total_events`。

- 完整证书：`scope=full`；要求文件、完整链、签名和 v3 根全部一致。旧版 `merkle_valid=null`，不将缺失根当已核验。
- 部分证据：`scope=selective`；要求格式、文件、原签名、所选事件与各自路径及强制边界一致。`chain_valid=false`，表示未核验完整记录链；合法部分证据的 `valid` 仍可为 true。

网页、PNG、打印证书明确标注“部分披露”，显示“已披露 / 总事件”。不将缺失事件连成过程曲线，不把已披露缺口数量当全部缺口数量；完整连续性不作通过声明。

## 使用

网页先核验完整 v3 证书，再在“选择性披露”中输入从 1 开始的事件编号或范围，例如 `6,21,41-43`。留空仅保留两条强制边界。导出在独立 Worker/Wasm 中进行，不上传作品、证书或读取签名私钥。

CLI 的序号从 **0** 开始，不接受范围；输出路径必须不存在：

```text
workproof-engine disclose input.wproof selected.wproof 5,20,40
workproof-engine disclose input.wproof boundaries-only.wproof
workproof-engine verify artifact selected.wproof
```

CLI 的披露导出验证原证书的内部一致性和原签名，但不读取作品；接收者仍需用精确交付文件完成 `verify`。输入证据上限 32 MiB，适用于 CLI 和浏览器。

## 隐私与信任边界

隐藏事件不随披露包发送，但文件名、会话、来源、声明起始时间、总条数、文件摘要/长度、公钥、签名、起始和最终保存统计仍公开。兄弟摘要属于承诺信息；Merkle 证明不等于零知识证明，也不承诺抵抗低熵猜测或消除元数据关联。

所选条目归属成立，不表示未披露事件符合任何属性，也不证明没有缺口、持续劳动、真人身份、原创性或 AI 使用比例。控制本地程序和签名密钥的攻击者仍可签发伪造记录。时间仍为 `none`，身份仍为 `self-signed`；TSA、机构认证和 C2PA 不由此获得。

验证覆盖原生 Rust、独立 JavaScript 编码/树形/Ed25519 与 CLI、真实浏览器 Worker/Wasm，以及历史 v2 冻结签名。各类结果仍以对应 Actions 运行记录为准。

## 宿主授权补充

Photoshop 原生插件另经桌面审批获得来源/会话隔离的原生授予；与 Word/WPS 浏览器来源授予不互换。两类插件授予都不能取得主令牌、读取全局状态或调用原生本机路径 `/seal`。签名协议不因传输通道改变；具体 API 与验收边界见 [Photoshop 接入](PHOTOSHOP.md)。
