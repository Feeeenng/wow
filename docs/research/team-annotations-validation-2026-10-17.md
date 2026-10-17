# 团队视频画笔与时间标记后端（2026-10-17）

## 契约

`GET /api/v1/teams/{team}/recordings/{recording}/annotations` 返回 `{version,items,canEdit}`。历史录像无快照时读取版本为 0、items 为空，GET 不创建数据库记录。

`PUT` 同路径接受 `{expectedVersion,items}`，成功返回新 `{version,items,canEdit}`。全部标记作为一个完整快照原子保存，版本从 1 递增；竞争或过期版本返回 409，客户端必须重新读取并由用户决定如何保留修改，不能静默覆盖。达到 u32 最大版本也拒绝覆盖。

每条 Annotation：`{id,kind,points,color,width,text,atMs,durationMs}`。id 为 UUID，规范化后不能重复；kind 为 pen／arrow／rect／ellipse／text／marker；point 为有限的 0～1 归一化视频内容坐标，黑边不属于视频内容。arrow／rect／ellipse 恰好两个点，text／marker 恰好一个点，pen 至少两个点；text 图形必须有可见文字。

color 为六位十六进制颜色，返回统一大写；width 为有限的 1～12。text 默认为空字符串，作为字面文本保存，不解析 HTML 或 SVG，也不接收额外可执行字段。前端应使用文本节点。atMs 为共同战斗毫秒，范围包含 0 和战斗终点；durationMs 为必填正整数，默认允许 1～60000 毫秒。末尾标记可以持续超过战斗终点，显示由可播放范围自然裁切，不改变其原始持续时间。

文本仅明确拒绝 PostgreSQL JSONB 无法保存的 NUL 字符；Tab、Windows CRLF 和字面 `<b>` 等内容原样保留，不能因 Rust 额外禁用全部控制字符而导致合法团队快照无法读取。

默认上限为 200 条标记、每条 512 点、总计 20000 点、每条文字 500 字；全部限制位于后端 Settings，并受现有 2MiB JSON 请求体限制。不存在客户端可自报的用户 ID、团队角色、Bearer 或任意路径字段。

## 权限与持久化

当前团队成员均可读。录像上传者、该团队 leader 或 analyst 可以写；其他 member 只读，移出团队后读写均拒绝。每次请求先团队范围再查录像，角色 GUID 与 WCL actor 不能赋予权限；canEdit 是后端根据当前关系计算的事实。

新增冻结迁移 `20261017_04_annotations.py`，只创建 annotation_snapshots，不修改历史媒体、共同时间轴或 WCL 数据。快照包含 team_id／recording_id 复合外键、JSONB items、BIGINT version、更新者和带时区更新时间；版本数据库约束为 u32，业务时间使用统一 Asia/Shanghai 工具。

缺行写入先通过 PostgreSQL ON CONFLICT DO NOTHING 创建事务内版本 0，再通过 UPDATE WHERE version=expectedVersion RETURNING 原子 CAS。失败回滚，不保留占位空行。写事务锁当前成员关系，与同时撤权形成明确事务次序。两个不同编辑者锁不同成员行，仍由 CAS 决定唯一保存者。

API 保持注入／契约／调用层，业务放在 services/annotations；没有修改桌面或前端文件。CORS 增加 PUT。统一输入错误只返回 loc／msg／type，不回显输入值；这样 NaN 被拒绝后不会因错误响应再次编码 NaN 而变成 500，也不会回显额外敏感字段。

## 实际验证

定向命令：

```powershell
cd backend
.venv/Scripts/python.exe -m pytest -q tests/unit/test_annotations.py tests/unit/test_migration.py tests/unit/test_worker_entry.py
.venv/Scripts/python.exe -m pytest -q tests/integration/test_annotations_postgres.py
```

首批定向单元／迁移／worker 入口 27 项通过，真实 PostgreSQL 定向 3 项通过；真实运行需显式 `WOW_RUN_SERVICE_TESTS=1` 和测试数据库配置，默认不连接正式数据库。

当前完整后端真实环境回归：**89 项通过、0 跳过、0 失败，15.06 秒，退出码 0**，包含原有上传／媒体／WCL、画笔、NUL 和 WCL 独立硬超时用例。此前画笔基线为 87 项；缺行错误版本不留占位和 u32 上限不覆盖断言的定向 8 项也已通过并纳入最终回归。`pip check` 无冲突；生产函数／类中文 docstring 与新增 Python 尾空白检查无问题。保留 1 项上游 Starlette 测试客户端弃用提示。

真实用例使用随机隔离 schema、四版迁移和独立连接。验证首次缺行竞争、已有版本竞争均恰好一个 200、另一个 409，最终完整快照等于胜者；另覆盖六种形状、有限坐标、颜色／宽度／UUID／文本／数量／点数／总点数／持续时间／共同时间边界、空快照、越权、撤权、失效版本、PUT 预检及 NaN 的稳定 422。只清理自身 schema，不使用 SQLite 替代。

桌面实际绘制、黑边／全屏坐标、重启恢复及多人界面冲突提示由主线继续验收，此后端报告不冒充已经完成 UI 验收。

## Rust 定向审阅与 NUL 修复

对 `recording/annotations` 和 `cloud/replay/annotations.rs` 的审阅确认：本地同一业务区段通过统一 Mutex 串行执行读／CAS／持久化，LocalStateStore 只在实际落盘替换成功后更新内存；团队操作复用当前 ReplayClient，并在返回前检查连接身份没有变化。

指定 `cargo test --lib annotations:: -- --nocapture` 首次暴露 `tokio::join!` 编译失败，因为项目没有启用 Tokio macros。改用已存在依赖 `futures_util::join!`，不修改依赖。Rust 另外去掉与后端不一致的通用控制字符限制，仅拒 NUL，并新增 Tab／CRLF 团队 DTO JSON 往返验证。

NUL 新回归先通过真实 PostgreSQL／API 复现：原返回 503，预期应为 422，测试确实失败。修复后输入校验在入库前拒绝 NUL，不创建快照；Tab／CRLF 和字面文本经过真实 JSONB 保存读取保持一致。

Rust 审阅结果：指定 Rust 定向 **3 通过、0 失败、0 忽略**，另 109 项被筛选；后端 `pytest -q tests/unit/test_annotations.py tests/integration/test_annotations_postgres.py` **28 通过、0 失败，2.76 秒**，含新增真实 PG 用例，保留 1 项上游警告。随后已完成包含本次 NUL 修复的完整 89 项回归，以前文最新统一结果为准。
