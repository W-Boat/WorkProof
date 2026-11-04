# 7b40abb 配套包核对与真实配置失败

源码 `7b40abbd9f1e4eb3432c4d905e47fbb1420049b2` 的[Office任务41879998074](https://github.com/W-Boat/WorkProof/actions/runs/41879998074)三个任务全部success。产物13350272108为41,012,584字节，外层SHA256 `9b8d604b1ace064b4167e62b3efd236e30b98bf59188856824908da3112e5342` 与GitHub一致。

内层 `E:/work/WorkProof-Delivery/WorkProof-PC-7b40abb.zip` 的SHA256为 `b15b2805720fe737baa460a4b473b1baae228049262f047290b53b71499a3773`。2,425项包内摘要、文件集合、x64桌面与四种Office DLL位数、产品源码及随包生成Wasm文件的来源和摘要均核对。独立解压目录为 `E:/work/WorkProof-Delivery/WorkProof-PC-7b40abb/`，未覆盖旧安装或已注册DLL，未终止正在运行的3905346。

本机使用桌面实际指定的Windows PowerShell 5.1，只执行 `desktop-office-setup.ps1 -HostName Word`（未带Install）进行只读安装状态检查，返回error：`native-office-platform.ps1`中文文本因UTF-8无BOM被ANSI解码，引发解析错误。没有发生安装、注册或数据库写入。这证明已有pwsh语法检查不足；成功构建和包摘要不能证明首次配置可用。

因此该包只可用于界面预览，不能交付为首次安装已通过。原始下载包保持不变。修复提交4574847仅在生成清单前为自有根目录PowerShell脚本写入UTF-8 BOM，不改第三方许可证据，并新增真正Windows PowerShell 5.1逐脚本解析检查；修复源码尚须新Actions验证。
