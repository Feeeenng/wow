# 云端录像上传后端

后端使用 FastAPI、SQLAlchemy、PostgreSQL 和私有 S3／MinIO。客户端只上传 MP4 与录像 manifest；完整 CombatLog 继续由 Archon 上传，本服务不提供原始日志上传接口。

当前实现账号／团队范围、幂等录像登记、SHA-256 绑定的 Multipart 签名、真实分片确认及断点恢复、完成／取消／重新开始，以及可恢复媒体任务、整文件校验、VOD CMAF/HLS 私有发布和团队回放 manifest。上传成功与媒体处理完成分离，只有全部媒体处理及发布成功才标记 ready。

同时实现 WCL 公共 Report 的显式 fight／演员绑定、持久导入任务、完整事件快照与分页；没有 WCL 凭证时明确禁用，不假装已完成线上报告验收。私有报告需要另行用户 OAuth。

团队视频画笔支持六种纯数据图形、共同战斗时间、当前角色权限和版本 CAS；多人同时保存不会静默覆盖，冲突返回 409。

## 启动与显式初始化

容器编排使用根目录 `compose.yaml`、`Dockerfile.backend` 和 `.env.example`；没有另一个后端 Dockerfile。迁移、桶初始化和账号创建都由操作者显式执行，不在应用启动时自动进行。

本地开发支持 Python 3.11 及以上。以下命令要求先提供独立开发用的 WOW_DATABASE_URL、WOW_S3_ENDPOINT_URL、WOW_S3_PUBLIC_ENDPOINT_URL、存储凭证／桶、WOW_REDIS_URL 和播放签名密钥；根模板主要供 Compose 插值，不能把其中 POSTGRES_* 变量误当成已生成的独立 Python 连接串：

```powershell
cd backend
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements-dev.txt
.venv/Scripts/alembic.exe upgrade head
.venv/Scripts/python.exe -m app.cli storage-init
.venv/Scripts/python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 18000 --no-access-log
```

默认开发环境文件为仓库根 `.env`，环境变量优先；容器不应把真实 `.env` 复制进镜像。数据库必须使用 `postgresql+psycopg://`，不会静默回退到 SQLite。

使用 Compose 时按根 README 初始化后，可直接在容器内执行本节 CLI，例如 docker compose exec api python -m app.cli create-user --name '成员名称'；签发令牌也在容器 CLI 中显式执行。不要把令牌输出保存到仓库。

`storage-init` 只创建缺失私有桶或核对已有桶；发现公开 ACL、通配主体 Allow 策略时拒绝使用，不覆盖既有策略。服务请求遇到缺失桶返回明确 503，提示操作者初始化。

## 账号与团队

没有默认账号、默认管理员、测试密码或匿名注册。第一阶段由有部署权限的操作者通过 CLI 显式建立平台身份：

```powershell
.venv/Scripts/python.exe -m app.cli create-user --name '成员名称'
.venv/Scripts/python.exe -m app.cli create-team --name '团队名称' --owner-user-id '<上一步的用户UUID>'
.venv/Scripts/python.exe -m app.cli add-member --team-id '<团队UUID>' --user-id '<成员UUID>' --role member
.venv/Scripts/python.exe -m app.cli issue-token --user-id '<成员UUID>' --label '个人客户端'
.venv/Scripts/python.exe -m app.cli revoke-token --token-id '<待撤销令牌UUID>'
```

签发令牌时只向执行者终端显示一次明文，数据库仅保存 SHA-256；不要把终端输出重定向到仓库日志或文档。令牌支持到期、撤销和账号停用。平台账号决定团队权限，角色 GUID、旁车 actorId 和 WCL report/fight 都不能授予权限。

团队角色为 `leader`、`analyst`、`member`。本轮所有成员可查看其团队录像，只能操作自己的上传任务；跨团队或他人的上传 ID 统一不可访问。账号管理界面和团队邀请流程后续接入，当前不虚构已经存在的用户登录 UI。

## HTTP 契约

所有业务路径前缀 `/api/v1`，JSON 使用 camelCase，认证为 `Authorization: Bearer <个人令牌>`。完整字段定义可从运行实例 `/openapi.json` 或 `/docs` 查看。

| 方法与路径 | 用途 |
|---|---|
| `GET /me` | 当前平台用户和明确加入的团队 |
| `POST /recordings` | 登记视频与 manifest，返回上传任务 |
| `GET /uploads/{id}/status` | 从实际 S3 分片恢复已确认进度 |
| `POST /uploads/{id}/parts` | 以 `{partNumber,checksumSha256}` 签发片号、大小和 SHA 绑定的 PUT URL |
| `POST /uploads/{id}/parts/{number}/confirm` | 空正文；服务端读取真实分片，不采信客户端 ETag |
| `POST /uploads/{id}/complete` | 空正文；验证全部实际分片后完成对象 |
| `POST /uploads/{id}/abort` | 显式取消未完成任务 |
| `POST /uploads/{id}/restart` | 显式丢弃旧会话重传，禁止覆盖已完成对象 |
| `GET /teams/{teamId}/pulls` | 授权团队战斗目录 |
| `GET /teams/{teamId}/pulls/{pullId}/replay` | 各视角的真实上传、处理和映射状态 |
| `GET /teams/{teamId}/recordings` | 单次 SQL join 获取有界平铺视角目录 |
| `GET /teams/{teamId}/recordings/{id}/media/{filename}` | 每次检查账号、团队、ready 与发布版本的私有媒体代理 |
| `POST /teams/{teamId}/recordings/{id}/processing/retry` | 上传者或团长显式重试失败处理；排队幂等，活跃租约拒绝重入 |
| `GET /teams/{teamId}/pulls/{pullId}/wcl` | WCL 配置／权限、当前导入任务及旧完整发布版本 |
| `POST /teams/{teamId}/pulls/{pullId}/wcl/imports` | leader／analyst 显式绑定公共报告与 fight；可选角色绑定及 refresh |
| `GET /teams/{teamId}/recordings/{id}/events` | 视角分类后的完整 WCL 事件，签名游标分页 |
| `GET /teams/{teamId}/recordings/{id}/annotations` | 当前团队画笔完整快照及实际 canEdit |
| `PUT /teams/{teamId}/recordings/{id}/annotations` | 上传者／团长／分析员按 expectedVersion 原子保存，冲突 409 |

录像登记包含 `teamId`、`deviceId`、`localPullId`、`artifactVersion`、`fileSizeBytes`、`fileSha256`，以及角色、Encounter、日志起止毫秒、视频零点／时长、可选分段映射和角色名单。可选 `mediaCalibrated`、`clockDiscontinuous`、`calibrationError` 保留本地声明；服务端不会仅凭客户端声明把同步标为已验证。

幂等身份为团队、当前平台用户、设备、本地 Pull 和产物版本；同身份但不同文件或 manifest 返回 409。S3 对象路径由服务器 UUID 构造，不接收客户端对象路径或 endpoint。

片 SHA 使用小写 64 位十六进制；签名响应提供正确的 Base64 SHA 请求头及 Content-Length。直接 PUT 时只带响应 `headers`，**不得向对象存储发送平台 Bearer 令牌**。默认分片 64MiB，可配置为 5～64MiB，末片按返回的实际大小上传。

确认／完成读取存储端实际大小、SHA-256 和 ETag。Multipart ETag 不是全文件 MD5；Multipart 复合 SHA-256 也不是原文件 SHA-256。上传完成时 `verification=partsVerified`，整文件验证与媒体处理尚未执行时 `fullFileSha256Verified=false`，不能据此提前删除唯一原片。

S3 明确返回 `NoSuchUpload` 且没有已完成原片时，`status` 正常返回 `uploadStatus=aborted`、空确认列表及可展示原因，用户显式重试调用 `restart`。网络故障和权限故障返回 503，不会被误当成丢失会话或清空进度。

团队归组仅使用本团队内显式 `teamPullId` 或明确的 WCL reportCode/fightId，不把“同一 Boss 且时间接近”当作可靠归组。报告身份未经 WCL 复核时标记 `unverified`。

## 媒体任务与私有播放

完成上传时，在同一个 PostgreSQL 事务写入 `processing_jobs` 和 `processing_outbox`。Celery 消息只传任务 UUID；Redis 不承载永久业务状态。beat 定期重发未领取的消息并恢复过期租约，broker 暂时不可用时保留 outbox，重复投递由任务行锁和唯一租约处理。

Linux 容器中的入口为：

```text
celery -A app.worker:celery_app worker --loglevel=INFO --concurrency=1
celery -A app.worker:celery_app beat --loglevel=INFO --schedule=/tmp/wow-celerybeat-schedule
```

worker 从私有原对象下载，验证实际大小与**整文件 SHA-256**，在服务端临时目录用 FFmpeg stream-copy 生成 VOD CMAF，完整解码校验输出，再用相同视频包的 SHA 关联源／发布 PTS 并调整偏移。初始化段、分片和清单写完后，最终事务才更新 `ready`、`playbackVersion` 和整文件验证事实。

当前服务器媒体管线支持 H.264 视频与 AAC 主音轨。原对象及全部原始音轨完整保留；发布版选择首视频／首音轨。其他编码返回明确失败，尚未接入转码回退，不能声称任意编码兼容。整体处理超时加网络重试预算必须小于租约，默认 30 分钟处理预算、60 分钟租约；旧 worker 的最终提交还必须匹配当前有效租约。

WCL 导入使用独立任务硬超时 `wcl_import_timeout_seconds + 2 * wcl_timeout_seconds`，默认 660 秒，并由配置校验保证严格小于 WCL 租约；缩短媒体处理预算不会提前终止 WCL。已通过独立子进程检查实际 Celery task 的 time_limit。

每次输出使用独立租约 UUID 前缀。旧任务不能覆盖新产物；失败或过期任务可能留下未发布的私有输出对象，后续需要按未引用版本做保留策略清理，不会因此删除原片。

媒体白名单只有 `index.m3u8`、`init.mp4`、`segment-00000.m4s` 形式。桌面 Rust 代理及独立 Web 的 HLS.js 使用 Bearer 和 `version=<playbackVersion UUID>`；版本变化返回 410，清单保留相对 URI。另提供短期 HMAC grant，绑定播放用途、账号、团队、录像、发布版本和到期时间；清单向普通片段及 `EXT-X-MAP` 传播 grant。独立 Web 当前不把平台令牌或 grant 放到分享链接。

每一片都重新检查账号启用和当前团队成员关系，成员被移出后不能继续读取。支持单范围 HTTP Range。播放 URL 不包含平台 Bearer 或 S3 凭证，存储桶保持私有；默认启动关闭访问日志，避免把 grant 查询字符串记入日志。CORS 仅开放配置中的桌面／开发来源。

## 配置

| 环境变量 | 说明 |
|---|---|
| `WOW_DATABASE_URL` | 必填 PostgreSQL psycopg 连接串 |
| `WOW_S3_ENDPOINT_URL` | 必填，服务器内部存储连接地址 |
| `WOW_S3_PUBLIC_ENDPOINT_URL` | 必填，给桌面签名 URL 使用的可达地址 |
| `WOW_S3_ACCESS_KEY`、`WOW_S3_SECRET_KEY` | 必填，无默认凭证 |
| `WOW_S3_BUCKET` | 必填私有桶 |
| `WOW_S3_REGION`、`WOW_S3_ADDRESSING_STYLE` | 默认 `us-east-1`／`path` |
| `WOW_MULTIPART_PART_SIZE_BYTES` | 默认 67108864，范围 5～64MiB |
| `WOW_UPLOAD_URL_TTL_SECONDS` | 默认 900 秒 |
| `WOW_MAX_VIDEO_BYTES` | 默认 50GiB |
| `WOW_MAX_REQUEST_BYTES` | JSON API 请求体上限，默认 2MiB，包括分块编码请求 |
| `WOW_REDIS_URL` | worker／beat 必填 broker URL；API 不依赖 broker 才能保存上传事实 |
| `WOW_PUBLIC_API_URL` | 客户端可达的 API 根地址，用于生成 Web 播放 URL |
| `WOW_PLAYBACK_SIGNING_KEY` | Web 播放所需随机密钥，至少 32 字符，无默认密钥 |
| `WOW_FFMPEG_PATH`、`WOW_FFPROBE_PATH` | 服务端程序路径或 PATH 名称，不自动下载 |
| `WOW_PROCESSING_TEMP_DIRECTORY` | 可写临时根目录，默认系统临时目录下 wow-processing |
| `WOW_PROCESSING_TIMEOUT_SECONDS`、`WOW_PROCESSING_LEASE_SECONDS` | 默认 1800／3600，必须保留网络调用余量 |
| `WOW_PROCESSING_MAX_ATTEMPTS` | 默认 3 次自动处理尝试；永久内容失败直接停止 |
| `WOW_CORS_ORIGINS` | JSON 数组；默认 Tauri 及本机 1420 开发源，禁止通配替代授权 |
| `WOW_WCL_CLIENT_ID`、`WOW_WCL_CLIENT_SECRET` | 可选服务端公共 API 凭证，缺任一则 disabled；不向桌面发送 |

其余超时、页数、名单和映射限制统一位于 `app/core/config.py`。业务时间统一 `Asia/Shanghai`；数据库使用带时区字段，管理接口展示时间为 `YYYY-MM-DD HH:mm:ss`。

## 验证边界

```powershell
cd backend
.venv/Scripts/python.exe -m pytest -q
```

单元及 HTTP 用例使用生产领域服务、参数验证和路由，但以受控 Session 结果及 S3 SDK Stubber 替换外部服务。离线迁移测试真实生成 PostgreSQL SQL，不建立数据库，也不使用 SQLite 冒充 PostgreSQL 联调。

真正 PostgreSQL／S3／Redis 用例为 `tests/integration/test_postgres_s3.py`。默认跳过；显式设置 `WOW_RUN_SERVICE_TESTS=1` 以及 `WOW_TEST_DATABASE_URL`、`WOW_TEST_S3_ENDPOINT_URL`、`WOW_TEST_S3_PUBLIC_ENDPOINT_URL`、`WOW_TEST_S3_ACCESS_KEY`、`WOW_TEST_S3_SECRET_KEY`、`WOW_TEST_S3_BUCKET`、`WOW_TEST_REDIS_URL` 后执行。它启动独立 worker／beat，真实经 Redis 领取任务，不使用 eager 或同步处理冒充 broker 交付。可用 `WOW_TEST_FFMPEG_PATH`／`WOW_TEST_FFPROBE_PATH` 显式指定已安装程序。

该用例使用随机隔离 schema、独立队列／Redis key 前缀和随机对象，结束只清理自身数据，不使用 `FLUSHDB`；必须配置测试服务，不连接正式业务库。

最新个人偏好阶段的完整回归为**122通过、0跳过、0失败**，31.39秒，包含所有单元／API及显式启用的真实服务集成，另有1项上游Starlette弃用提示。隔离服务为PostgreSQL17.11、MinIO RELEASE.2025-09-07T16-13-09Z、Redis7.2.11，由临时官方二进制启动，没有安装系统服务；五版迁移、实际Multipart、独立worker／beat、整文件SHA、私有HLS／Range／grant、撤权、WCL及共享校准并发均覆盖。新增映射偏移不能跨越原拼接段，选场manifest事件摘要与实际页版本一致。此前116项等为阶段历史，详见根docs/research/web-preferences-validation-2026-10-17.md。

个人布局使用第五版迁移的replay_preferences，联合主键team_id／user_id仅来自当前团队及认证身份，成员删除级联清理；普通成员可保存本人布局，团长不能代读或代写。GET缺行返回版本零且不插入；PUT携带expectedVersion及完整document，原子CAS防止跨页面覆盖，冲突409保留旧快照。契约限制位于app/core/replay_preferences.py，输入拒绝未知字段、无效目标、控制字符及非有限数值，不保存媒体／连接状态。迁移只在隔离库验证，正式部署需独立审阅后显式执行。

共享人工校准使用既有录像JSON的独立sharedCalibration区段，不新增迁移，不改变原始映射／请求摘要；GET／PUT /api/v1/teams/{team}/recordings/{recording}/calibration按当前成员及上传者／管理者授权，保存同时校验编辑版本和媒体发布版本。WOW_SHARED_CALIBRATION_MAX_OFFSET_MS默认300000毫秒；换版后旧值不应用，显式复核才能重新保存。这不是多事件自动漂移拟合。

WCL 增量验证使用真实 PostgreSQL 加真正 loopback HTTP 协议服务，验证 OAuth／GraphQL、空页继续、完整发布、双视角 SELF、失败保旧、游标版本与权限；没有访问线上 WCL。详细契约和限制见根目录 `docs/research/wcl-public-import-2026-10-17.md`。

画笔验证包括两个编辑者以独立真实 PG 连接竞争首次／已有版本，均一个成功、另一个 409；坐标、图形、文本、负载上限、权限、撤权及 NaN 的稳定 422 均覆盖。随后补充边界的定向 8 项复验通过。详细见根目录 `docs/research/team-annotations-validation-2026-10-17.md`。

后续 Rust 契约审阅又修复 NUL 输入原先导致 PostgreSQL 503 的边界：服务端入库前明确 422，Tab／Windows 换行仍保留。画笔定向 28 项通过后，已再运行上述完整 89 项，包含 NUL 和 WCL 独立硬超时配置回归。

本机 Python 为 3.12，Windows Celery 使用 solo 池；根 compose 的 Python 3.11+ Linux prefork、Redis 7.4.11 和镜像构建尚未验收。另有真实 Uvicorn 进程启动和合成 H.264/AAC 的实际 FFmpeg、完整解码、对应可见帧 SHA 对照。共同 Pull 时间基准的正负偏移都有测试，原始登记 manifest 和幂等身份保持不变。详细证据见根目录 `docs/research/cloud-backend-validation-2026-10-17.md`。
