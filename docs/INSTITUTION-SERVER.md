# 机构服务器部署

本说明对应 `deploy/institution/` 的单机 Docker Compose 部署。源码已准备，实际支持范围以该版本 Actions 容器验收结果为准。首版目标为 Linux amd64 容器，可由 Linux Docker Engine 或支持 Linux 容器的 Docker Desktop 运行；不把 Windows 原生容器、ARM、所有服务器系统列为已验收。

服务使用同提交构建的机构 JAR（包含 Vue 与 Office 页面）及独立 Rust `workproof-inspector`。用户不需要 Maven、Node、Java、Python 或本地编译；需要 Docker Engine 与 Compose v2，以及拉取 MySQL/Valkey 镜像的网络。Docker Desktop 自身授权、MySQL、Valkey、Temurin 和镜像中的系统软件分别适用其原始条款，项目 MIT 声明不覆盖全部镜像。现有商业许可审查缺口仍见[商业审查](COMMERCIAL-LICENSE-AUDIT.md)。

## 领取与检查部署包

从通过容器验收的 GitHub Actions 下载服务器包，先按随包 SHA-256 清单检查完整性，再解压到专用目录。包应提供预构建应用镜像归档、`compose.yaml`、源码及本说明。镜像名称为 `workproof-institution:local`；名称不是发布者身份认证，应核对运行链接、源码提交和摘要。执行 `docker load -i <应用镜像归档.tar>` 加载已构建镜像，不运行本机 Docker build。

不要把部署目录设为其他人的共享可写目录。密码不写在 `.env`、命令参数、镜像或普通日志中。Compose 命名卷分别保存应用配置、初始账号、MySQL 根密码、MySQL 应用密码、数据库、缓存及应用数据；能控制 Docker daemon 或宿主管理员的主体仍可访问这些数据。普通容器用户不等于对宿主管理员保密。

## 全新部署

以下操作仅用于该 Compose 项目拥有的全新空库。不要指向用户已有数据库，也不要把它当作升级或恢复工具。

在部署目录执行 `sh setup-new.sh`；Windows 可执行 `powershell -File .\Setup-New.ps1`。脚本只依次调用以下四个 Docker 命令，任一步失败就停止：

```sh
docker compose run --rm prepare
docker compose up -d database cache
docker compose run --rm initialize
docker compose up -d app
```

`prepare` 只在空的专用配置卷中生成随机 JWT、数据库密码和初始管理员账号，不连接数据库；已有文件时拒绝覆盖。MySQL 镜像首次创建专用 `workproof` 空库和同名数据库用户。`initialize` 检查该库没有表，再调用同包 JAR 的 BCrypt 工具，替换原 V2 中的开发密码，复用原 V1/V2，并禁用所有非 admin 示例账号。默认保留的示例组织、角色和菜单不是机构真实数据，管理员正式使用前应核对。

初始化进行中会留下私有 `.initializing` 记录；成功后写 `initialized.json`。MySQL DDL 不能整体回滚，失败时可能已经创建部分表，因此工具保留现场并拒绝重放。不要删除状态标记“强行重试”，不要对已有部署运行 `docker compose down -v`。先停止应用并由运维人员检查数据库、凭据卷和备份，另行制定恢复方案。普通 `up`、应用重启和健康检查均不初始化或迁移数据库。

`docker compose ps` 查看启动和健康状态。应用就绪后访问 `http://127.0.0.1:18081/login`。在远程服务器上，该地址只在服务器本机可用，需通过 SSH 隧道或现有 HTTPS 反向代理访问。

## 查看初始账号

只有显式执行以下命令才输出初始账号，输出格式为一行 JSON，字段 `username` 是用户名，`password` 是初始密码：

```sh
docker compose run --rm account
```

不要将该输出粘贴到公共日志、截图或 CI 归档。初始账号记录放在仅工具容器挂载的独立卷，应用容器不能读取它。登录后修改密码；该命令显示的是首次准备记录，不会从数据库读取或重置当前密码。修改后应按机构秘密保管政策处理初始记录。

## 访问、持久化和升级

MySQL 与 Valkey 不发布宿主端口。应用容器以 UID/GID 10001 运行，仅发布 `127.0.0.1:18081`；使用 `WORKPROOF_HTTP_PORT` 可更换回环端口。不要为图方便改为公开数据库端口或无密码公网缓存。

需要 Word 机构清单时，在部署目录自有 `.env` 中配置 `WORKPROOF_PUBLIC_ORIGIN=https://实际机构域名`，让已有反代终结合法 HTTPS，再重新创建 app。这里只配置公开来源，不自动申请证书、不修改系统信任。未设置有效 HTTPS 来源时 `/office/manifest-word.xml` 保持 503。WPS 的正式点击安装发布仍受独立 SDK 许可及宿主验收限制，见[Office 服务说明](OFFICE-SERVER.md)。

`docker compose stop` 停止服务并保留卷；`docker compose up -d app` 正常重启。更换应用镜像前先备份数据库和全部私有配置卷，保存原镜像摘要，停止 app，再加载已验收的新镜像。此包不自动改 SQL 或重置密码。运行中的数据库与任务暂存不能通过盲目复制目录宣称得到一致备份；服务器备份/恢复链路仍需独立验收，既有 Windows 本地准备工具不适用于本容器。

目录、持久任务和 AI 默认关闭。V3/V4 不在普通启动或全新初始化中执行；启用前需显式备份、核对迁移和权限，再按[持久任务说明](INSTITUTION-JOBS.md)准备。本版入口主动保持三个开关关闭，不提供未经验收的环境变量开关捷径。后续迁移管理工具另行交付。不可把未启用模块宣传为生产就绪。

## 构建与验收边界

镜像增加了备份字节的加密封装基础 `backup_crypto.py`，使用固定参数的 scrypt 与 AES-256-GCM，口令只从标准输入或终端读取。解密输出须等完整认证成功后才发布，并拒绝覆盖已有文件。该模块不执行数据库导出、归档解析或恢复；完整加密备份与恢复流程仍待实现，不能将它当成已经可用的备份入口。对应 Actions 在实际镜像中检查原字节往返、篡改和错误口令拒绝、权限、符号链接及真实写入失败。

Dockerfile 仅供 Actions 构建及审阅，要求上下文含 `app.jar`、`workproof-inspector`、`entrypoint.py`、`manage.py`、`backup_crypto.py` 和原始 `sql/V1__init_schema.sql`、`sql/V2__seed_data.sql`。Java 基于 Temurin 17 JRE Noble，原生检查器在 Ubuntu 24.04 构建，仍必须在实际容器内执行并核对动态依赖；不能从源码名称推断所有发行版兼容。

应验收：未经准备 app 拒绝启动且不建表；随机管理员真实登录、默认密码拒绝、示例普通账号停用；受保护 API、Vue 深链接、Office 页面；真实证书成功/篡改拒绝；重启保留账号；重复 prepare/initialize 与非空库拒绝；配置卷及应用 UID；MySQL/Valkey 无宿主公开端口；普通日志和归档无密码。这些步骤只在 Actions 独立 Compose 项目中运行，不针对用户本机库。

容器与编排依据：[Temurin 官方容器](https://github.com/adoptium/containers)、[Compose 健康依赖](https://docs.docker.com/compose/how-tos/startup-order/)。私有文件由本项目显式生成并挂载，不假定 Compose 会自动把文件秘密映射成 Spring 环境变量。
