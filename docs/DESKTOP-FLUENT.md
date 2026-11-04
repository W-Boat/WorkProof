# Fluent 桌面重写

这次是桌面工作台的整体视觉重写。原界面采用机构端主题变量和累积覆盖样式；保留品牌图标、软件入口、命令隔离、授权说明、同意公开证书的选项与原生窗口按钮。替换旧样式层，使用微软 Fluent UI Web Components 3.1.4 的真实按钮组件和官方深浅色主题。导航仍使用原生语义按钮，软件字母标记不是自绘微软图标。

布局采用 48px 应用顶栏、固定软件侧栏、独立滚动工作区和窄状态栏。操作步骤分为打开软件、允许连接、导出交付；安装检查紧邻启动入口。深色、浅色、跟随系统仍可保存。设计取值：DESIGN_VARIANCE=3、MOTION_INTENSITY=2、VISUAL_DENSITY=5。没有营销首页、滚动特效或新增运行时服务；离线模块由 Actions 中的 esbuild 打包，客户端不访问 CDN。

官方依据：[Fluent 2 开发指南](https://fluent2.microsoft.design/get-started/develop)、[组件源码与许可证](https://github.com/microsoft/fluentui/tree/master/packages/web-components)。新增依赖固定版本并写入根锁文件；具体交付包的第三方通知仍应随包核验，不能由项目主页 MIT 标签替代依赖清单审查。

验证范围：桌面专项用真实组件和页面、模拟受限 IPC，检查键盘焦点、禁用、主题、安装状态和连接撤销；真实窗口状态另由 Windows UIA 验收。此次源码变更尚未替换用户正在运行的旧包。机构管理端保持其统一 Vue 组件底座，不在管理端混入第二套组件系统。
