# PowerShell 5.1 修复版配套包

[Office任务41883593825](https://github.com/W-Boat/WorkProof/actions/runs/41883593825)的三个任务全部success，源码 `eb9f2ca370c45e71daaf6c757d2b8861d033a5c0`，包含4574847编码修复。实际Windows PowerShell 5.1逐个解析已打包根目录脚本通过；现有真实PE位数与隔离注册/复制检查继续执行。

产物13350429324为41,013,065字节，外层SHA256 `8435219d6955e8a0197c33b13a4ca79971ee05eaff1b9a6f6389996c32671890`。本机内层 `E:/work/WorkProof-Delivery/WorkProof-PC-eb9f2ca.zip` SHA256 `e7daf82ebd1f3df80afba85eadc3e59cb3946ad3ddda91687dcda0d39ae162dc`；2,425项完整文件摘要、集合、PE位数及生成Wasm来源全部匹配，解压到同名独立目录。

本机仅使用Windows PowerShell 5.1执行新包 `desktop-office-setup.ps1 -HostName Word`，没有传Install。结果为 `installed:true,available:true,restart_required:false`，确认之前辅助脚本的中文解析错误已消除。这只说明本机已有Word加载项注册且DLL位数检查通过，不证明已安装新DLL，也不证明首次安装写入路径已在真实Office环境完成。

已创建桌面“WorkProof PC 新版”快捷方式指向该目录，并移除本次任务自己创建且精确指向7b40abb的旧预览快捷方式。原3905346进程22700仍在托盘运行；未杀进程、替换DLL、自动注册或更改数据库。用户退出旧版托盘程序后可使用新快捷方式。普通NSIS安装与原生窗口UIA动作仍待后续全量任务，不把配套包成功扩大为这些检查通过。
