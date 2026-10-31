# 许可核验证据

请先读 [商业使用核验报告](../COMMERCIAL-LICENSE-AUDIT.md)。本目录是证据记录，不是整个产品已获商业分发批准的声明。

* `dependency-inventory.json`：两份 npm 锁文件、Cargo 注册表版本声明和既有后台 JAR；包含开发/可选/跨平台记录。
* `dependency-inventory.cargo-cache.json`：该次 Cargo 元数据查询缓存，键为包名和版本。
* `npm-special-evidence.json`：WPS、VSCE-SIGN、bcryptjs 等发布包的许可文件、注册表许可字段与 tarball integrity；元数据和实际许可证冲突以人工核验为准。
* `proposed-components.json`：原规划候选项的核验时版本。不是当前项目的依赖锁文件。
* `maven-notices/`：从 Actions 已构建 JAR 的内嵌库中提取的许可、版权与通知原文。部分库的许可来自父 POM，见 inventory 中的来源 URL。

复核命令（不编译、不安装依赖）：

```powershell
python scripts/license-inventory.py --jar <Actions-built-scaffold-admin.jar> --output <report-directory>/dependency-inventory.json
```

需要 Python 3.11+ 和注册表网络访问。脚本非零退出表示存在未取得的许可元数据或其他采集错误；成功仅表示元数据完整。Maven 文本识别结果可能包含同一 JAR 内不同第三方代码的许可，不能将多个条目自动当作 `OR`。最终分发应另行核对实际安装包内的组件和源码义务。

GitHub Actions 工作流 `Dependency license evidence` 下载指定的既有 `institution-baseline` 产物复核，不重建后台。默认 run 记录在工作流中；产物过期或后台版本更新后需指定新的成功 run。机器证据按组件及其作者的原许可保留，不由根目录 MIT 重新授权。
