# 外部时间凭据：RFC 3161 工具

新增可选 Rust CLI `workproof-timestamp`，使用管理员显式指定的 OpenSSL 3 可执行文件生成标准请求和核验标准响应。它不进入后台守护进程，不新增 Rust 依赖，不更改 `.wproof` 或原签名，不连接网络。当前是原生互操作增量；浏览器核验、时间值展示、TSA服务配置和自动请求仍未实现。

依据 [RFC 3161](https://www.rfc-editor.org/rfc/rfc3161.html) 与 [OpenSSL ts 官方文档](https://docs.openssl.org/3.5/man1/openssl-ts/)。时间戳绑定原证书已验证的64字节签名，使用SHA-256和随机nonce；完整/部分记录保留相同原签名，因此可使用同一时间凭据，但它不证明部分文件的生成时间。

```text
workproof-timestamp request original.wproof request.tsq /absolute/path/to/openssl
workproof-timestamp verify original.wproof request.tsq response.tsr trusted-roots.pem /absolute/path/to/openssl
```

Windows也需OpenSSL可执行文件的绝对路径。工具不包含OpenSSL程序；管理员单独准备并审核其许可/版本，不把未知PATH程序自动当信任工具。将请求按所选TSA的官方接口提交，保留请求和响应。请求只包含签名的摘要，不含作品或过程正文；未经配置不联系任何TSA，不暗中接受服务条款或产生费用。

核验先验证请求nonce，再独立验证响应与原签名字节绑定，同时由OpenSSL执行CMS签名、时间戳签名证书用途及显式CA链核验。禁止默认CA目录/存储作为替代；CA文件需由验证者从可信渠道独立获得，不能因为证书包自带CA就认为可信。单份证书32MiB、请求64KiB、响应/CA各1MiB，子进程15秒期限，无shell，临时目录只存公开签名和凭据，结束清理，不读私钥或作品。

成功输出 `timestamp_verified=true`（外部签名和绑定在本次所选CA策略下通过）、`trust_policy=explicit-ca-file`。`artifact_checked`、`identity_verified`、`creation_time_verified`、`revocation_checked` 均为false。未检查撤销/CRL/OCSP或可信时间服务运营资质，不能把任意自建CA下的成功叫作公共权威认定；也未实现长期验证或过期链历史验证。原协议的 `time_evidence` 仍为 `none`，网页不会因此自动显示时间已认证。

这份凭据只能支持签名在TSA断言时间之前存在，不能确认实际开始/结束创作时间、劳动时长、作者身份或人类创作比例。CI使用短期合成测试CA和TSA，测试生成/核验、nonce不匹配、错CA、另一份证书的合法时间戳、修改证书、截断响应和部分证据复用；不以本地测试CA替代真实TSA信任验收。

源码 `3dd2113` 的[完整 Actions 41281504351](https://github.com/W-Boat/WorkProof/actions/runs/41281504351) 中 `Real RFC 3161 exchange with a synthetic test authority` 步骤已通过，包含所有成功/失败路径临时目录清理与原证书未修改检查；主工作流仍需等待全部任务终态。初版使用了 `ts` 不支持的CA禁用选项，已按官方实现改为仅传显式CA文件。此记录不证明浏览器或真实外部服务已完成验收。
