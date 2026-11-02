# C2PA PNG / JPEG 证据封装（开发中）

最新复验：`6411293` 的 [专项 41386033416](https://github.com/W-Boat/WorkProof/actions/runs/41386033416) Linux、Windows x64、macOS Intel/ARM 四任务全部成功，包含各平台实际 PNG、基线/渐进 JPEG 签署与核验。此前 macOS 失败来自测试 CA 继承 runner 的 OpenSSL 默认配置，导致重复 Basic Constraints；OpenSSL 自身也拒绝该链。现使用隔离配置生成合法合成 CA，保留全部产品信任校验与错根拒绝。Windows/macOS 三个开发包各 639 个文件摘要已核对，仍未测这些平台的网络系统调用；仅 Linux 有 strace 证据。以下失败状态为历史，具体见 [交付证据](DELIVERY-2026-11-02.md)。

2026-11-02 最新状态：Linux 真实 PNG/JPEG 往返及两类 JPEG 的网络调用跟踪已通过；`3a87738` 的 [专项 41384413851](https://github.com/W-Boat/WorkProof/actions/runs/41384413851) Windows x64 实际签署、核验及开发包也已成功，归档和包内 639 个文件摘要已核对。Windows 未测网络调用，macOS ARM/Intel 实际显式 CA 核验仍失败。详见 [交付证据](DELIVERY-2026-11-02.md)。下述早期“继续构建中”描述为历史，不覆盖此状态。

源码4651999已通过[C2PA专项41288148673](https://github.com/W-Boat/WorkProof/actions/runs/41288148673)：真实合成PNG/CA/签名器往返，独立CA信任、完整与选择性披露、修改像素/断言/过程记录拒绝、错CA拒绝、不覆盖输出、不改原文件，以及strace未见核验联网调用。333个锁定包的声明和实际许可材料已采集；13项包内缺失材料补充至确切VCS提交，少数上游仅以README授予任选许可的条目明确选择Apache-2.0并附标准正文。源码7c80a85的可下载Linux开发包继续构建中，不能把开发包、合成CA或上述验收称为正式C2PA公共信任认证。

独立工具 `tools/c2pa` 使用官方 Rust SDK c2pa 0.91.7，禁用默认 HTTP/OpenSSL 功能，使用 Rust 原生密码学。它有独立工作区和锁文件，不进入轻量记录引擎或桌面后台依赖图。源码8cdf211新增JPEG封装，专项41335157249的真实签署步骤已通过，发布模式工具仍在构建复验。PDF、浏览器解析和桌面向导尚未实现；不能把本增量记为全部C2PA交付完成。

嵌入元数据会改变PNG的字节，因此不能直接用嵌入后的完整文件哈希冒充原作品哈希。本工具定义 `png-remove-cabx-v1`：只移除PNG中的C2PA `caBX` 块，其他字节（包括块顺序与CRC）全部保留，使用原WorkProof协议检查恢复后的原PNG。封装时先核对原PNG与证书，生成后再次检查恢复字节与原件逐字节一致，任意其他改动均拒绝写出；输入已经有C2PA的PNG暂时拒绝，避免悄悄抹掉旧来源历史。

自定义断言 `org.workproof.process` 中保存原证书JSON，内部schema为 `workproof-c2pa/1`，保留完整或选择性披露范围；接收方必须同时通过C2PA资产签名与WorkProof原PNG绑定。明确传入 `--allow-public-process` 才会嵌入，表示同意让拿到PNG的人读取所选证书的过程信息。建议先做选择性披露，确认文件名、时间与事件可公开。原PNG和原wproof不改写，输出不覆盖已有文件。

```text
workproof-c2pa embed original.png original.wproof signer-chain.pem signer-key.pem signed.png --allow-public-process
workproof-c2pa verify signed.png independently-trusted-roots.pem
```

签名仅支持ES256，管理员需自行准备合法的签名证书链与私钥；不自动创建用户身份，不使用示例证书签署真实交付。私钥只由此一次性工具读取，不进入后台、日志、证书或机构数据库。验证者从独立可信渠道取得CA，不自动信任封装自带的链或系统Root。工具不导入操作系统信任，不自动连接TSA或远程证据站点。

核验成功说明封装签名在本次明确选择的CA下通过、恢复原PNG与WorkProof签名/过程证据一致；不证明作者身份、实际创作时间、原创性或人类创作比例，不查询撤销。合成CI测试CA不能用作公共权威信任。输入原PNG最多64MiB、封装PNG96MiB、原证书8MiB、链/CA256KiB、私钥64KiB，最多4096个PNG块，校验块CRC和IEND边界；这些限额不等于独立内存沙箱。

依据：[官方Rust SDK](https://github.com/contentauth/c2pa-rs)、[Builder](https://docs.rs/c2pa/latest/c2pa/struct.Builder.html)、[Reader](https://docs.rs/c2pa/latest/c2pa/struct.Reader.html)。SDK实际0.91.7归档SHA-256 `f258d5bfe6465d1a5c570d32b70a261f35e4e45a753e7122a88d3ba0472999b0` 已与crates.io版本checksum核对；其MIT/Apache-2.0允许商业使用，但新增完整依赖及实际许可仍需独立归档审查。专用Actions会采集锁文件和实际notice，不以构建绿色代替法律放行。

## JPEG 增量验证

`8cdf211` 在独立工具内新增 `image/jpeg` 与 `jpeg-remove-c2pa-app11-v1` 归一化。仅移除带 C2PA JUMBF UUID、标签及合法分片序号的 APP11；其他 APP11、EXIF、XMP、压缩数据及顺序保留。SDK 签署后的恢复结果必须与原 JPEG 逐字节相同，否则拒绝输出，不重编码图片。已有 C2PA 的输入暂时拒绝重新封装。

[专项 41335157249](https://github.com/W-Boat/WorkProof/actions/runs/41335157249) 的真实签署步骤已通过：使用实际基线/渐进 JPEG、1500 条签名事件、多片 APP11、独立合成 CA、完整及选择性证据，并检查元数据保留、像素/元数据修改及错误 CA 拒绝。该专项发布模式复验和 Linux 开发包上传也已成功；基线与渐进 JPEG 均实际产生7个 APP11 分片。后续增加 JPEG 专用 strace 网络调用检查，结果以新增任务为准。JPEG 只在一次性工具中解析，不加入轻量守护进程依赖图。

报告新增 `original_asset_checked`、`original_jpeg_checked` 与 `media_type`；PNG 的 `original_png_checked` 保留，仅在实际 PNG 检查时为 true。所有格式仍不认证作者身份、原创性或人类创作比例，不进行撤销查询。原图最多64MiB、封装图96MiB；JPEG 最多16384个标记并拒绝尾随数据和无序分片。

```text
workproof-c2pa embed original.jpg original.wproof signer-chain.pem signer-key.pem signed.jpg --allow-public-process
workproof-c2pa verify signed.jpg independently-trusted-roots.pem
```
