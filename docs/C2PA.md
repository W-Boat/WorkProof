# C2PA PNG 证据封装（开发中）

源码4651999已通过[C2PA专项41288148673](https://github.com/W-Boat/WorkProof/actions/runs/41288148673)：真实合成PNG/CA/签名器往返，独立CA信任、完整与选择性披露、修改像素/断言/过程记录拒绝、错CA拒绝、不覆盖输出、不改原文件，以及strace未见核验联网调用。333个锁定包的声明和实际许可材料已采集；13项包内缺失材料补充至确切VCS提交，少数上游仅以README授予任选许可的条目明确选择Apache-2.0并附标准正文。源码7c80a85的可下载Linux开发包继续构建中，不能把开发包、合成CA或上述验收称为正式C2PA公共信任认证。

独立工具 `tools/c2pa` 使用官方 Rust SDK c2pa 0.91.7，禁用默认 HTTP/OpenSSL 功能，使用 Rust 原生密码学。它有独立工作区和锁文件，不进入轻量记录引擎或桌面后台依赖图。当前仅支持PNG，JPEG/PDF、浏览器解析和桌面向导尚未实现；不能把本增量记为全部C2PA交付完成。

嵌入元数据会改变PNG的字节，因此不能直接用嵌入后的完整文件哈希冒充原作品哈希。本工具定义 `png-remove-cabx-v1`：只移除PNG中的C2PA `caBX` 块，其他字节（包括块顺序与CRC）全部保留，使用原WorkProof协议检查恢复后的原PNG。封装时先核对原PNG与证书，生成后再次检查恢复字节与原件逐字节一致，任意其他改动均拒绝写出；输入已经有C2PA的PNG暂时拒绝，避免悄悄抹掉旧来源历史。

自定义断言 `org.workproof.process` 中保存原证书JSON，内部schema为 `workproof-c2pa/1`，保留完整或选择性披露范围；接收方必须同时通过C2PA资产签名与WorkProof原PNG绑定。明确传入 `--allow-public-process` 才会嵌入，表示同意让拿到PNG的人读取所选证书的过程信息。建议先做选择性披露，确认文件名、时间与事件可公开。原PNG和原wproof不改写，输出不覆盖已有文件。

```text
workproof-c2pa embed original.png original.wproof signer-chain.pem signer-key.pem signed.png --allow-public-process
workproof-c2pa verify signed.png independently-trusted-roots.pem
```

签名仅支持ES256，管理员需自行准备合法的签名证书链与私钥；不自动创建用户身份，不使用示例证书签署真实交付。私钥只由此一次性工具读取，不进入后台、日志、证书或机构数据库。验证者从独立可信渠道取得CA，不自动信任封装自带的链或系统Root。工具不导入操作系统信任，不自动连接TSA或远程证据站点。

核验成功说明封装签名在本次明确选择的CA下通过、恢复原PNG与WorkProof签名/过程证据一致；不证明作者身份、实际创作时间、原创性或人类创作比例，不查询撤销。合成CI测试CA不能用作公共权威信任。输入原PNG最多64MiB、封装PNG96MiB、原证书8MiB、链/CA256KiB、私钥64KiB，最多4096个PNG块，校验块CRC和IEND边界；这些限额不等于独立内存沙箱。

依据：[官方Rust SDK](https://github.com/contentauth/c2pa-rs)、[Builder](https://docs.rs/c2pa/latest/c2pa/struct.Builder.html)、[Reader](https://docs.rs/c2pa/latest/c2pa/struct.Reader.html)。SDK实际0.91.7归档SHA-256 `f258d5bfe6465d1a5c570d32b70a261f35e4e45a753e7122a88d3ba0472999b0` 已与crates.io版本checksum核对；其MIT/Apache-2.0允许商业使用，但新增完整依赖及实际许可仍需独立归档审查。专用Actions会采集锁文件和实际notice，不以构建绿色代替法律放行。
