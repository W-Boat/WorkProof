# Word / PowerPoint 位数与工作包

同一个 64 位 Windows 工作包同时提供 32 位和 64 位 Office 加载项。安装脚本读取 Word 或 PowerPoint 程序的 PE 位数，选择匹配的 DLL，用户不必自行换文件。现有 `WorkProofWord.dll` / `WorkProofPowerPoint.dll` 为 x64，新增 `.x86.dll` 为 x86；它们都放在工作包根目录，与 Rust 引擎相邻。引擎和桌面程序仍为 x64，此包不支持 32 位 Windows。

安装前先检查所需 DLL 是否存在且架构匹配。缺少 32 位组件时会给出明确提示，不会先写入不匹配的 COM 注册。默认安装和 `-NoCopy` 都保留所选文件名。启动入口按宿主实际位数读取注册；没有找到宿主且只有一份有效注册时可使用该注册，存在冲突时提示重新安装。

只读诊断示例：`open-native-word.ps1 -OfficePath <WINWORD.EXE完整路径> -Inspect`，或对应 PowerPoint 脚本与程序路径。输出为所选 DLL、运行目录、桌面程序路径与架构，不启动软件。普通用户直接使用工作包中的安装与打开按钮即可。

Actions 分别在 MSVC x86 和 x64 环境构建两种宿主 DLL，检查实际 PE 架构和未修饰的 COM 导出，再运行 COM / ActiveX / OLE 生命周期探针。位数选择测试使用这些真实编译产物作为 PE 输入，在独立注册前缀中检查正确文件选择、拒绝错误架构、缺 DLL 时不写注册、只读启动解析及移除。

这些探针不是实际 Word / PowerPoint 主机。隔离前缀也不等同于真实 `HKCU\Software\Classes` 的 WOW64 重定向验收；仍需分别在真实 32 位和 64 位 Office 中检查侧栏加载、记录、保存与导出。不能用 CI 证明全部 Office 版本均已兼容。现有 Word / PPT 正在使用的 DLL 不会在本机为这些测试而替换。
