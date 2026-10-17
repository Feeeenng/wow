# WCL 公共报告事件导入与契约（2026-10-17）

## 范围和可信度

本阶段实现公共 WCL Report 的显式 fight 绑定、可恢复任务、完整快照发布、角色视角分类和有界分页。不上传原始 CombatLog，Archon 继续负责原日志；不获取目标工具代码。

官方公共 API 使用服务端 client credentials：BasicAuth 请求 `/oauth/token`，取得 WCL access token 后调用 `/api/v2/client`。私有报告需要独立用户 OAuth，本阶段明确拒绝 `private` 和 `unlisted`。平台个人令牌只能授权本平台团队，不替代 WCL 用户授权。[官方认证说明](https://www.warcraftlogs.com/api/docs)

当前没有用户提供的 WCL 凭证／线上报告，**没有执行线上 Report 验收**。实际验证为生产 httpx 经真正 loopback HTTP 服务交换 OAuth／GraphQL 协议，以及真实 PostgreSQL 迁移、API、发布和分页。协议样本按官方类型构造，不声称是真实报告响应。WCL 事件 JSON 官方标注可能变化，遇到关键字段不兼容会明确失败并保留旧版。[Report 类型与事件接口](https://www.warcraftlogs.com/v2-api-docs/warcraft/report.doc.html)

## 身份和时间

- 平台 UUID、CombatLog GUID、WCL 报告局部 actor ID 各自独立。WCL actor 没有被伪造为游戏 GUID，`sourceGuid`／`targetGuid` 均为空；使用 `identityNamespace=wcl:<reportCode>` 加 `sourceActorId`／`targetActorId` 建立界面内部键。
- 环境 actor `0`／`-1` 可以保留事实，但不能匹配玩家或 SELF。`sourceIsPlayer`／`targetIsPlayer` 仅来自 masterData 的 `type=Player`，不代表一定是当前 fight 的友方。[ReportActor 官方字段](https://www.warcraftlogs.com/v2-api-docs/warcraft/reportactor.doc.html)
- 友敌分类来自选中 fight 名单，不把整份报告所有 Player 猜为队友。SELF 必须由 leader／analyst 明确绑定录像到选中 fight 的友方 Player；未绑定不会按相同名称或 gameID 猜测。
- cast／empower／interrupt／dispel按source分类，aura／death／resurrect按target分类；owner为现有`player|team|boss`。缺少可靠友敌身份的事件不投影为某条轨道，原始事件分母单列。
- 事件 `pullTimeMs = report.startTime + event.timestamp - commonTeamPullStart`，允许负数。界面可仅绘制战斗范围，但服务端保留前后事实。导入不更改共同 Pull 起点，也不只换事件零点而遗漏视频映射。

## API

路径统一 `/api/v1`，每次请求先验证平台身份和当前团队成员关系。

| 方法与路径 | 行为 |
|---|---|
| `GET /teams/{team}/pulls/{pull}/wcl` | 当前配置、权限、任务状态与旧发布版本 |
| `POST /teams/{team}/pulls/{pull}/wcl/imports` | 显式绑定并持久入队，仅 leader／analyst |
| `GET /teams/{team}/recordings/{recording}/events?cursor=&limit=500` | 当前录像分类后的完整事件页，上限 1000 |

导入正文：`{reportCode,fightId,actorBindings:[{recordingId,actorId}],refresh?:false}`。reportCode 为 16 位字母数字；绑定只接受本团队当前 Pull 的录像。同请求运行中幂等，已 ready 默认幂等；显式 `refresh=true` 才重新读取报告版本。失败可修正后重发，其他运行中任务拒绝覆盖。

状态为 `{configured,canImport,status,jobId,reportCode,fightId,revision,eventCount,rawEventCount,actors,actorBindings,publishedReportCode,publishedFightId,publishedReportRevision,error}`；status 为 `unbound|pending|importing|ready|failed`。请求来源与已发布来源分开返回，失败不会把旧版演员当作新报告数据。无服务端凭证时 GET 明确 configured=false，POST 返回 503。

事件页沿用 `{revision,events,total,nextCursor,hasMore,reset}`。无完整发布版本返回 409，不能把“未导入”当作完整空场。每条事件保留 `rawType`、来源命名空间、独立 actor ID、游戏 spellId、角色名、类型和有符号毫秒；可选负层数／额外技能 ID 转为空，不传入原生 u32。非死亡关键事件缺少游戏技能 ID 时失败，不把局部 abilityID 猜成 spellId。

新增导入eventSchema=2：刷新不再冒充光环获得，支持empowerstart／empowerend／resurrect，empowerLevel仅在来源提供合法等级时保存。旧发布快照不改，显式刷新才使用新投影；客户端及服务端配套更新。类型依据、原生契约和缺少真实线上v2 JSON的边界见[事件补全验证](replay-event-completeness-2026-10-17.md)。

revision 绑定不可变快照 UUID、录像 UUID、全部显式绑定和共同零点；HMAC 游标另绑定用途、团队、录像、revision 和读取位置。签名常数时比较；伪造游标 422，旧版本／其他视角的合法游标返回首新页及 reset=true。页查询走 `(snapshot_id,ordinal)` 索引，不反复 COUNT 或扫描整场。

平铺录像目录在同一个 join 返回 `timelineRevision`、`timelineEventCount`、`timelineComplete`、`wclStatus`。有旧完整版本时即使刷新失败仍 complete=true；初次未导入为 false。

## 发布和恢复

新增三个表：`wcl_imports`、`wcl_snapshots`、`wcl_events`，迁移为 `20261017_03`。旧录像不补造事件。任务行持有永久 outbox、发起人、请求摘要、租约、尝试数、延期时间和旧发布指针；Redis 消息只传任务 UUID。

现有 Celery／beat 增加 `wow.dispatch_wcl` 和 `wow.import_wcl`，无需新增服务。broker 失败不丢任务；重复消息由行锁／租约处理。领取和发布再次核对发起人启用与团队管理角色，入队后失权不能继续发布。

WCL 的任务硬超时独立于媒体预算，显式为导入整体预算加两次 HTTP 请求预算，默认 660 秒，配置保证严格小于 1200 秒 WCL 租约。短媒体预算回归验证实际 Celery task 配置，不仅检查 Settings 数字，也不声称执行了 Linux prefork 强杀测试。

分页即使空 data 仍跟随 nextPageTimestamp；拒绝不推进、循环／越界、页数／事件／响应体积／暂存磁盘预算超限。429 根据有界 Retry-After 秒数或 HTTP-date 写入 PG 延期，不忙循环。暂存使用临时 JSONL，角色和技能索引只构建一次，不按事件反复扫描名单。

最终重新读取报告，比较 revision、分段数、选中 fight、actors 和 abilities。官方 revision 只在重新导出时增加，因此同时比较 segments／exportedSegments，防止上传中的混合版本。全部分页成功且版本稳定，才在同一事务批量写事件并切换发布指针；失败保留旧版。共同 Pull 与任务采用一致锁顺序，旧租约不能覆盖新快照。

## 配置与后续验收

WCL阶段完整后端python -m pytest -q为60通过，后续画笔／NUL／独立超时阶段完整89通过、0跳过、0失败、15.06秒；这些为原全服务基线。本轮新增事件后单元及API92通过，另真实PG＋HTTP WCL测试1通过，后者实际发布10条含新增类型／等级的事件并验证分页／SELF／失败保旧／撤权；未重复无关S3／worker矩阵。依旧有1项上游Starlette弃用提示。没有配置测试服务的默认运行会跳过真实服务用例，不能把默认命令当完整环境结果。

只需可选服务端 `WOW_WCL_CLIENT_ID`／`WOW_WCL_CLIENT_SECRET`，并沿用现有签名密钥及 Redis。endpoint、HTTP／整体超时、租约、页数、原始事件量、响应体积、暂存预算、页大小及重试限制集中 `backend/app/core/config.py`，凭证没有默认值。

仍需用户提供实际公共 WCL Report 和服务端凭证后，验证当前正式服真实事件 JSON、地域／语言、报告增量、实际配额、actor 显式对应与同场视频锚点。私有用户 OAuth、报告发现和自动可信角色绑定不在本轮伪实现。
