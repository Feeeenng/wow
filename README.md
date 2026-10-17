# WoW Recorder

## Windows 客户端开发启动

前置环境：Node.js、Rustup 和 Visual Studio C++ 桌面开发工具。

日常启动客户端只需在仓库根目录执行：

```powershell
cd client
npm run tauri dev
```

仅在首次克隆仓库或前端依赖发生变化且尚未安装时，先执行：

```powershell
cd client
npm ci
```

该命令会同时启动 Vite 开发服务、编译 Rust 后端并打开 Tauri 客户端窗口。命令运行期间不要关闭当前终端；按 `Ctrl+C` 停止开发客户端。

## Windows 客户端打包

前置环境：Node.js、Rustup 和 Visual Studio C++ 桌面开发工具。

```powershell
cd client
.\package.ps1
```

脚本不需要参数，会安装锁定的前端依赖并生成 NSIS 安装包。产物位于
`client/src-tauri/target/release/bundle/nsis/`。

## 导入已有录像复盘

客户端进入“回放 → 导入录像”，选择包含 MP4 和配套 metadata.json 的目录，以及对应完整 CombatLog，可以一次选择多份日志。点击“开始导入”后会后台匹配战斗并生成播放文件；关闭面板或切页可以继续，原始录像、旁车与日志均保持只读。

回放支持事件／人物筛选、点击技能或死亡跳转、人工画面对齐、明确同场视角切换、个人轨道、书签及视频标注。标注进入编辑会暂停视频，修改后点击“保存标注”；本地标注保存在客户端状态，团队标注由服务器按当前权限和版本保存。

## 本机云端服务

需要可运行 Linux 容器的 Docker。首次在仓库根目录执行以下命令；初始化脚本生成随机凭证，已有 `.env` 时拒绝覆盖：

```powershell
.\init-cloud.ps1
docker compose build
docker compose up -d postgres minio redis
docker compose run --rm --no-deps api alembic upgrade head
docker compose run --rm --no-deps api python -m app.cli storage-init
docker compose up -d api worker beat
```

服务默认仅监听本机：API `http://127.0.0.1:18000`，MinIO `http://127.0.0.1:19000`，数据库端口 `15432`。Redis 不向宿主开放端口。不会自动迁移数据库、创建账号或上传本地录像。

按 [后端说明](backend/README.md) 显式创建用户、团队和个人令牌，再到客户端“个人中心”配置 API 地址、令牌并选择授权团队。在回放页选择录像后点击上传；“上传完成”“媒体就绪”“标准事件就绪”是独立状态。服务端不接收原始 CombatLog。需要导入标准事件时，在服务端 `.env` 配置自己的 WCL 应用凭证，重建／启动 API、worker 和 beat 后，从团队回放的“标准事件”关联公开报告与 fight，并显式绑定人物。当前不支持 private／unlisted 报告，不在客户端存放 WCL client secret。

MinIO 构建从其 [官方固定发行版](https://github.com/minio/minio/releases/tag/RELEASE.2025-09-07T16-13-09Z) 下载 x86_64 二进制并核对官方 SHA-256，使用 AGPLv3；当前构建方式避免依赖已不可用的社区镜像标签。发布或修改该服务时应保留相应许可证义务。其他架构尚未验证。

本轮验证范围和待验收项目见 [对照实施记录](docs/plans/2026-10-17-reviewtool-parity.md)。正式环境需按后端说明配置 HTTPS、外部可达地址和私有存储凭证；不要提交 `.env`。
## 独立Web复盘入口

Web核心入口已实现，启动与部署见[web/README.md](web/README.md)。浏览器使用现有平台访问令牌验证，只在内存保留凭证，按当前团队权限读取目录、媒体、标准事件和共享校准；时间点链接需要接收者登录，不是公开匿名分享。

桌面与Web共用[shared/replay](shared/replay)中的数据契约、时间映射、事件分页／身份及偏移规则。Web已有视频画笔及个人轨道；“保存个人布局”按账号／团队存入服务端，跨刷新／设备恢复，需要后端显式升级至20261017_05。Web静态资源从既有游戏资料构建，浏览器不依赖Tauri，也不直接连接S3。最新证据见[个人偏好验证](docs/research/web-preferences-validation-2026-10-17.md)，基础能力见[Web验证报告](docs/research/web-replay-validation-2026-10-17.md)；独立密码／OAuth／邀请与深入死亡分析仍待后续。
