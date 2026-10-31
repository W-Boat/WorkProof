# WorkProof 协议 v1

## 容器

`.wproof` 是 UTF-8 JSON：`manifest`、`records`、`signature`。所有结构拒绝未知字段。此版本最多 100,000 事件；浏览器拒绝超过 32 MiB 的证据包。文件摘要算法为 BLAKE3-256，签名为 Ed25519；十六进制输出为小写。

## 确定性编码

签名和事件摘要不依赖 JSON 属性顺序。`field(s)` 为 UTF-8 字节长度的 u32 小端编码，后接 UTF-8 字节。整数为 u64 小端，布尔为一字节 0/1。

Genesis = BLAKE3(`WorkProof:genesis:v1\0` || field(session_id))。

事件摘要 = BLAKE3(`WorkProof:event:v1\0` || field(previous_hash_hex) || seq || elapsed_ms || inserted || deleted || chars || field(kind) || field(checkpoint))。

签名消息 = `WorkProof:manifest:v1\0`，依次拼接以下 string 字段的 field 编码：

1. protocol
2. session_id
3. file_name
4. started_at
5. source
6. chain_head
7. artifact_hash
8. public_key
9. identity
10. time_evidence

最后拼接 event_count (u64)、artifact_bytes (u64)、demo (u8)。

## 核验要求

- protocol 必须为 `workproof/1`；本版本只接受 `self-signed` 身份与 `none` 时间凭据。
- 序号从 0 连续递增，elapsed_ms 非递减；首事件必须为 start。
- 每个事件摘要、总条目数、最终链尾都必须一致。
- 最后事件必须为 save，checkpoint 必须等于最终文件的 BLAKE3 摘要。
- 核验输入文件的精确字节摘要及长度必须一致。
- 使用清单中的公钥严格验证 Ed25519 签名；签名有效不代表公钥属于真实身份。

字符统计使用 VS Code 的 UTF-16 代码单元，不等于自然语言字数。没有内容级草稿快照，不能复原文字，也不能证明最终文件语义由过程逐步产生。

## 本地 API

监听 `127.0.0.1:43127`，不配置跨域。所有 API 必须附带启动时随机生成的 Bearer 令牌，并拒绝带 Origin 的浏览器请求。请求体上限 256 KiB，每批最多 256 事件。

`POST /v1/sessions` 创建会话；`POST /v1/sessions/{id}/events` 事务追加；同序号相同数据可重试，不同数据拒绝。只有 SQLite 提交成功后确认。`POST /v1/sessions/{id}/export` 检查最后保存 checkpoint 并签发证据。`GET /v1/status` 提供配对检查。

攻击者控制当前用户、本地程序、插件或密钥时，可伪造事件和新的签名记录。此协议未提供可信执行环境或第三方见证，不防御这一能力。
