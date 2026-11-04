# 私有临时输入与严格报告解析后的真实模型回归

- 源码：`633ed1bd80402d4637c6fb3b10a7c89932530fba`，包含私有临时输入 `739ed66` 和严格报告解析 `c61b6e2`。
- [Actions 41856656733](https://github.com/W-Boat/WorkProof/actions/runs/41856656733)显式以 `ai_models=true` 运行。scaffold（`126667024011`）、windows-launchers（`126667024182`）、backup-control-flow（`126667023469`）全部success。
- 日志确认实际准备固定中文MPU、英文MPU和英文Desklib模型，页面验收环境 `WORKPROOF_TEST_REAL_AI=1`。`test_institution_runtime.py`以 `check=True` 调用 `test_institution_ai_ui.cjs`，实际模型分支完成后返回成功。
- 覆盖实际捆绑Vue页面→鉴权HTTP→Java→模型进程，原文件指纹、中文说明/JSON下载、不含正文、短文提示、取消与更换模型；完成后折叠输入并显示说明下载，Desklib补值不重复呈现为第二项独立判断，390px页面不横向溢出。
- 该运行亦通过真实服务器镜像/隔离初始化和重启、加密归档与恢复相关检查。这里不扩大为全部故障矩阵或公开部署验收。
- 完整scaffold日志下载后检查，SHA256：`65bfaf5e2234ebb196e7ab83ddab33e7ac0af26f05105d74ed2b878145251260`。

此回归证明合成验收文字上的调用链，不重新证明检测准确率。独立误报评估和许可限制仍有效；未本地构建、下载权重、运行模型或升级用户安装的服务。
