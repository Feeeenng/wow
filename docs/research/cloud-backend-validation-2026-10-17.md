# 云端上传与媒体处理验证（2026-10-17）

## 当前结论

已新增可运行的 FastAPI 后端、PostgreSQL 模型与四版冻结迁移、私有 S3 Multipart、显式账号／团队配置、可恢复媒体任务、受限 HLS 播放、WCL 公共事件导入及团队画笔快照。当前 head 完整真实环境回归最终为 **89 通过、0 跳过、0 失败**，用时 15.06 秒，另有 1 项上游测试客户端弃用提示。此前 M5 为 47 项、WCL 阶段为 60 项、初版画笔为 87 项；现包含 NUL 及独立 WCL 硬超时回归，以本次统一结果为准。

真实验证使用临时官方二进制：Windows PostgreSQL 17.11、WSL MinIO RELEASE.2025-09-07T16-13-09Z、WSL Redis 7.2.11（Alpine 3.21 官方包）。凭证仅由测试进程读取系统临时私有文件，未写入仓库和报告，没有安装系统服务。Python 为本机 3.12，Celery 为 Windows solo 池；根 compose 的 Python 3.11+ Linux prefork、Redis 7.4.11 和容器镜像构建仍未验收，版本差异明确保留。

## 实现边界

- 完整 CombatLog 继续交给 Archon；后端只接受录像 MP4 和最小 manifest，不提供重复的原始日志上传通道。
- 平台账号、团队成员与随机个人令牌通过操作者显式 CLI 创建；不存在默认账号或默认管理员。令牌数据库只存 SHA-256，支持撤销、过期和账号停用。
- 所有团队数据查询先限定当前成员范围，上传任务进一步限定上传者。角色 GUID、actorId、WCL report/fight 都不能扩大平台权限。
- 录像以团队／账号／设备／本地 Pull／产物版本幂等；参数内容变化返回 409。S3 对象路径由服务器 UUID 构造。
- Multipart 签名绑定片号、长度和 SHA-256。确认和恢复读取真实 S3 分片；ETag 不是文件 MD5，Multipart 复合 SHA 也不冒充整文件 SHA。
- 明确的 S3 会话丢失返回可恢复 `aborted` 状态；网络、权限和存储异常不会被误认为“已完成”或静默清空进度。
- 完成对象后在同一 PG 事务创建任务和 outbox。broker 暂时不可用保留永久任务；未认领消息和过期租约可重排，重复消息不能创建第二个有效处理者。
- worker 验证整文件 SHA-256，再生成 VOD CMAF/HLS、完整解码、校对视频包 PTS 映射、写完私有产物，最终事务才发布 `ready` 和 `playbackVersion`。
- Bearer 媒体代理及短期 HMAC grant 均每次检查账号启用、当前团队成员、ready 和版本。旧版本返回 410；grant 同时绑定播放用途／账号／团队／录像／版本／到期时间，采用常数时签名比较。
- HLS 普通片段与 `EXT-X-MAP` 都传播 grant；Bearer 清单保持相对 URI，便于桌面受限代理使用。仅开放固定媒体文件名，支持单范围 Range，CORS 明确白名单，默认禁用访问日志以避免记录 grant。

## 验证层级

| 层级 | 实际执行内容 | 可证明范围 |
|---|---|---|
| 领域单元 | 时间、映射边界、令牌失效、权限子查询、幂等冲突、分片恢复、大小／SHA 拒绝、完成响应丢失恢复、broker 失败、旧租约保护、签名用途和版本 | 生产逻辑与异常分支 |
| PostgreSQL 离线 | 实际生成四版迁移 SQL，检查十四个业务表、JSONB、时区字段、跨团队复合外键和唯一幂等键 | SQL 可生成、约束存在；另有真实迁移验证 |
| S3 SDK | 真实 boto3／botocore Stubber、公共 endpoint 签名、绑定请求头、原生分页、私有桶策略拒绝、完成请求校验字段 | SDK 请求／响应契约；不是 S3 网络兼容 |
| HTTP | 真实 FastAPI 路由与领域服务，外部边界受控；401／403／404／409／410／413／416 参数与权限、Range、CORS、显式处理重试 | HTTP 契约和应用行为 |
| 原生 API 进程 | 实际启动 Uvicorn 到临时本地端口，读取 `/health/live` 与 `/openapi.json`，随后关闭自己启动的进程 | 入口可启动、契约导出；不证明 PG／S3 可用 |
| 实际媒体 | 本机已有 FFmpeg／ffprobe 生成 7 秒 H.264/AAC，输出至少两段 CMAF、完整解码，首段及后续分片对应 rawvideo 帧 SHA 一致 | 实际媒体转换与时间平移；S3 发布边界仍为替身 |
| 真实 PG／S3 | 随机隔离 schema 执行迁移，多片网络 PUT、漏确认恢复、合并、原片 SHA、私有 HLS 与 Range | 真实数据库约束及 MinIO 网络协议通过 |
| Redis 交付 | 独立 worker 与 beat 经真实 Redis 消费 PG outbox，断言只领取一次并最终 ready | 没有 eager 或同步调用代替交付；容器未验收 |
| WCL 协议与索引 | 真正 loopback HTTP 的 OAuth／GraphQL 加真实 PG；空页推进、失败保旧、显式 SELF、跨视角游标重置、负时间、配置／权限、暂存预算 | 未访问线上 WCL，协议样本按官方类型构造 |
| 团队画笔 | 两编辑者独立真实 PG 连接的首次／更新 CAS 竞争、权限／撤权、形状／负载／有限坐标校验和 PUT CORS | 后端保存通过，桌面绘制交互由主线另验 |

## 命令与结果

```powershell
cd backend
.venv/Scripts/python.exe -m pytest -q
.venv/Scripts/python.exe -m pip check
```

最终 pytest：89 项通过、0 项跳过、0 项失败；退出码 0。此前 PG 画笔与通用契约定向 8 项、后续 NUL 定向 28 项都已纳入本次完整 head 回归。`pip check`：`No broken requirements found.`，退出码 0。Starlette 对现有 httpx 测试客户端给出弃用提示，当前测试仍正常通过；没有把提示隐藏成无警告结果。完整运行显式设置了 WOW_RUN_SERVICE_TESTS=1 和隔离 PG／S3／Redis 配置，默认无服务运行仍跳过真实用例。

worker 边界另修复：媒体预算可设为 10 秒，而 WCL 导入预算仍为 600 秒，原先共享任务硬超时会错误缩短 WCL。新增独立子进程回归先复现失败；为 `wow.import_wcl` 显式设置自己的 660 秒 time_limit 后通过，并小于 1200 秒 WCL 租约。该测试验证真实 Celery task 配置，不冒充 Linux prefork 的实际强杀时序验收。

验证中发现并修复的问题包括：冻结迁移的 JSONB／UUID 渲染引用、Windows FFmpeg 相对 init 文件写到错误工作目录。修复后重新执行相关及完整后端用例，最终结果如上；没有以代码阅读代替实际媒体测试。

依赖直接版本已经固定，并通过 PyPI 元数据和实际独立 venv 安装核对。Celery 使用 5.6.3，其 Kombu Redis 依赖要求 `<6.5`，因此 Redis Python 客户端固定 6.4.0；没有误用当前更高但不符合该依赖范围的版本。[Celery 发布信息](https://pypi.org/project/celery/5.6.3/)、[boto3 上传协议](https://docs.aws.amazon.com/boto3/latest/reference/services/s3/client/complete_multipart_upload.html)、[SQLAlchemy PostgreSQL 驱动](https://docs.sqlalchemy.org/en/20/dialects/postgresql.html#module-sqlalchemy.dialects.postgresql.psycopg)

## 真实服务用例与尚待验收

`backend/tests/integration/test_postgres_s3.py` 只在 `WOW_RUN_SERVICE_TESTS=1` 且提供独立 `WOW_TEST_*` 配置时运行。它创建随机隔离 PG schema，应用真实迁移，创建测试账号／团队，生成合法合成 MP4 并添加合法 free atom 触发多片上传，直接 PUT 签名地址，恢复未确认分片，完成对象，再执行生产媒体处理领域、读取私有 HLS／Range，并验证移除成员后拒绝访问。用例只清理自身 schema、Multipart 会话和随机对象，不使用 SQLite。

两个真实服务用例均已运行。媒体用例启动独立 worker／beat，经真实 Redis 领取任务；原片完整 SHA、ready 发布版本、grant 清单／初始化段／分片均已验收。真实数据库删除成员后，Bearer 与 grant 均立即拒绝；只清理自己的 schema、对象、Multipart 和 Redis 队列前缀，不使用 FLUSHDB。共同 Pull 基准另补正负 delta 两路测试，平铺目录和 manifest 共用映射，保留原始登记及幂等身份。

进程强制中断、Redis 重启／断线、跨设备源地址和 Linux FFmpeg／容器差异仍待验收。WCL 公共 API 标准事件导入已实现并完成真实 PG 加离线 HTTP 协议验收，详细见 `wcl-public-import-2026-10-17.md`；没有线上 WCL 凭证或报告，不能声称线上事件验收。私有 WCL 用户 OAuth、账号／团队 UI 和跨设备自动同步继续实现。

当前媒体输出支持 H.264 视频及 AAC 主音轨，保留私有原对象全部音轨；其他编码返回明确失败，未实现转码回退。过期任务可能留下未发布的私有输出或被强制结束后的临时目录，后续需要按未引用版本和失效任务做保留清理；当前不会为清理而冒险删除唯一原片。
## 最新补充：独立Web与映射边界

独立Web阶段重新执行完整单元／API及真实PG／MinIO／Redis／独立Celery集成：116通过、0失败、0跳过，17.00秒。校准偏移现在限定在各原始拼接段的物理范围，选场manifest补齐事件摘要并与实际分页版本核对；没有新增迁移。并发／权限／换版测试仍覆盖，最新细节见[Web双端报告](web-replay-validation-2026-10-17.md)。其他小节的115等早期计数为各阶段历史实测。
