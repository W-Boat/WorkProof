# Fluent 2 桌面专项复验

源码 `ddfac4373a07e93cff06ac7ef00c4f8252235df3`，[专项41966703866](https://github.com/W-Boat/WorkProof/actions/runs/41966703866) job127045257838 success：Chromium、Firefox、WebKit共39项通过，28.3秒。使用离线打包的真实 Fluent 3.1.4 控件，显式按钮角色和禁用状态修复了首轮411da4a的失败。原有断开连接、拒绝重复启动、安装配置、主题、内嵌核验入口和窗口命令路由检查保留。

IPC仍为模拟，不代表原生窗口操作或Office真实加载已通过。运行日志 `E:/work/fluent-ddfac43-success.log`；截图产物13388156445为2,580,234字节，GitHub记录SHA256 `22cc3ebd58c20442810b771c444b5d12133a2dad8403e2a8691d007c29595f66`。下载与视觉检查另行执行，不能仅凭该摘要声称本地包已核验。

同源码的Office专项41966703697：Word x86编译、动作分类、COM接口、文档绑定与快照检查通过；PPT x86 DLL编译和动作分类通过，但严格快照模拟器把新增ActiveWindow、PageSetup查询计入forbiddenAccess，job失败。后续补充具体对象和数值属性、引用计数与可选读取失败检查，不删除正文、图片、备注访问的禁止规则。不能把合成按键分类通过当成实际Office输入路径验收。
