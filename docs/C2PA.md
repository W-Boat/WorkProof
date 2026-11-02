# C2PA PNG / JPEG / PDF 证据封装（开发中）

PDF 增量源码及桌面文件选择、格式报告校验已加入，尚待新 Actions 实际构建与完整往返验收；下文既有绿色记录只证明其当时覆盖的 PNG/JPEG 范围。PDF 暂未接入浏览器解析。

最新复验：`6411293` 的 [专项 41386033416](https://github.com/W-Boat/WorkProof/actions/runs/41386033416) Linux、Windows x64、macOS Intel/ARM 四任务全部成功，包含各平台实际 PNG、基线/渐进 JPEG 签署与核验。此前 macOS 失败来自测试 CA 继承 runner 的 OpenSSL 默认配置，导致重复 Basic Constraints；OpenSSL 自身也拒绝该链。现使用隔离配置生成合法合成 CA，保留全部产品信任校验与错根拒绝。Windows/macOS 三个开发包各 639 个文件摘要已核对，仍未测这些平台的网络系统调用；仅 Linux 有 strace 证据。以下失败状态为历史，具体见 [交付证据](DELIVERY-2026-11-02.md)。

2026-11-02 最新状态：Linux 真实 PNG/JPEG 往返及两类 JPEG 的网络调用跟踪已通过；`3a87738` 的 [专项 41384413851](https://github.com/W-Boat/WorkProof/actions/runs/41384413851) Windows x64 实际签署、核验及开发包也已成功，归档和包内 639 个文件摘要已核对。Windows 未测网络调用，macOS ARM/Intel 实际显式 CA 核验仍失败。详见 [交付证据](DELIVERY-2026-11-02.md)。下述早期“继续构建中”描述为历史，不覆盖此状态。

源码4651999已通过[C2PA专项41288148673](https://github.com/W-Boat/WorkProof/actions/runs/41288148673)：真实合成PNG/CA/签名器往返，独立CA信任、完整与选择性披露、修改像素/断言/过程记录拒绝、错CA拒绝、不覆盖输出、不改原文件，以及strace未见核验联网调用。333个锁定包的声明和实际许可材料已采集；13项包内缺失材料补充至确切VCS提交，少数上游仅以README授予任选许可的条目明确选择Apache-2.0并附标准正文。源码7c80a85的可下载Linux开发包继续构建中，不能把开发包、合成CA或上述验收称为正式C2PA公共信任认证。

独立工具 `tools/c2pa` 使用官方 Rust SDK c2pa 0.91.7，禁用默认 HTTP/OpenSSL 功能，使用 Rust 原生密码学。它有独立工作区和锁文件，不进入轻量记录引擎或桌面后台依赖图。源码8cdf211新增JPEG封装，专项41335157249的真实签署步骤已通过。PDF 当前是新增待验收的 CLI 能力；浏览器内解析与更广格式的桌面向导仍需继续完善。

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

## PDF 严格增量封装（源码待验收）

PDF 采用 `workproof-c2pa/2` 断言，新增签名字段 `original_length` 和 `pdf-strict-incremental-v1` 绑定规则。原 PDF 全部字节作为输出的完整前缀保留，末尾只追加 C2PA 文件流、文件说明、新 Catalog 及 xref/trailer；原页面、字体、内容流和已有附件不重新保存。Catalog 的其他字段、Names 的其他命名空间、EmbeddedFiles 名单和 AF 关联文件列表保留，添加一份 WorkProof 来源信息。

核验先通过 SDK 的签名、资产数据哈希和明确选择的 CA，再从已签名的长度恢复原件、验证 WorkProof 证据。长度截断本身不是安全判断：工具根据原件与当前 manifest 重新生成整个允许的追加区域，并逐字节比较输出。新增页面对象、改变 Catalog、增加后续修订或任何不符合本工具严格格式的追加都会拒绝；不会把不同 PDF 的相同视觉效果当作相同原始字节。

```text
workproof-c2pa embed original.pdf original.wproof signer-chain.pem signer-key.pem signed.pdf --allow-public-process
workproof-c2pa verify signed.pdf independently-trusted-roots.pem
```

当前明确拒绝加密 PDF、已有 PDF 数字签名、已有 C2PA、压缩对象流 ObjStm、名字冲突、过深直接对象及不规范结构。普通压缩页面内容流保持原样，不解码后重写。使用 lopdf 严格解析，单个自动解压的交叉引用流限 2MiB，解析后对象数限 100000，命名文件及 AF 数量限 4096；原件 64MiB、封装文件 96MiB。输入限额与解析限额不等于操作系统内存沙箱或支持全部 PDF 格式。

新增 `scripts/test_c2pa_pdf.py` 在 Actions 上调用真实 CLI、真实合成 ES256 CA/签名器和签名过程证据；检查完整/选择性披露、原件前缀、独立 PDF 解析器的页面文字与原附件、错 CA、错证书、修改内容、额外修订、已有 C2PA 和真实加密 PDF 拒绝。Rust 单元检查还单独覆盖“原件前缀完全相同但新增 Catalog 改指页面”的拒绝，避免只有签名破坏测试而遗漏增量结构检查。报告新增 `original_pdf_checked`；所有身份、创作时间、原创性与撤销范围仍与现有工具相同。
