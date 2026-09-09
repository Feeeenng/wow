# 本地 Boss 自动录像实施计划

> **执行要求：** 按任务顺序实施；领域逻辑使用测试驱动开发。仓库禁止未经用户授权执行测试、构建和 Git 提交，因此执行前必须先取得相应命令授权，且本计划不包含自动提交步骤。

**目标：** 客户端自动持续录制 OBS，增量读取中国区正式服 CombatLog，并在每次 Boss 战结束后生成覆盖开战前 5 秒至结束后 5 秒的本地 MP4 与 JSON manifest。

**架构：** Rust 新增 `combat_log` 与 `recording` 两个领域。CombatLog 只负责路径、增量读取和 Encounter 事件，Recording 负责 Pull 状态、OBS 源文件时间锚点、JSON 恢复和 FFmpeg 成片；React 只展示目录和运行状态。现有 OBS 领域继续负责采集和编码，直播会话只管理 Streaming。

**技术栈：** Rust 2021、Tauri 2、Tokio、Serde、obws 0.15、SHA-256、React 19、TypeScript、Ant Design、固定版本 Windows x64 LGPL FFmpeg。

---

## 文件结构

- `client/src-tauri/src/combat_log/model.rs`：日志设置、游标和 Encounter 事件契约。
- `client/src-tauri/src/combat_log/parser.rs`：解析日志时间与 `ENCOUNTER_START/END`。
- `client/src-tauri/src/combat_log/reader.rs`：按字节游标读取完整新增行并处理轮转、截断。
- `client/src-tauri/src/combat_log/discovery.rs`：发现中国区正式服 Logs 目录并校验手动路径。
- `client/src-tauri/src/combat_log/mod.rs`：领域状态、Tauri commands 和监控任务入口。
- `client/src-tauri/src/recording/model.rs`：源录像、Pull、处理任务、manifest 和公开状态。
- `client/src-tauri/src/recording/pull_tracker.rs`：纯 Pull 状态机与稳定 ID。
- `client/src-tauri/src/recording/store.rs`：`recording-index.json` 原子保存与损坏文件保护。
- `client/src-tauri/src/recording/processor.rs`：构造并执行 FFmpeg stream-copy 裁切。
- `client/src-tauri/src/recording/coordinator.rs`：持续录制、OBS 轮转、时间映射和任务编排。
- `client/src-tauri/src/recording/config.rs`：前后缓冲、轮转、超时、目录和 FFmpeg 路径。
- `client/src-tauri/src/recording/mod.rs`：领域入口和公开命令。
- `client/src-tauri/src/obs/runtime/service.rs`：提供协调器需要的录像启动、轮转和状态能力。
- `client/src-tauri/src/live/model.rs`、`client/src-tauri/src/live/session.rs`：移除直播对录像生命周期的所有权。
- `client/src-tauri/src/lib.rs`：注册状态、后台任务和命令。
- `client/src/features/combat-log/model.ts`：CombatLog 前端契约。
- `client/src/features/combat-log/combatLogService.ts`：Tauri command 适配。
- `client/src/features/combat-log/useCombatLogSettings.ts`：页面状态和轮询。
- `client/src/features/combat-log/CombatLogSettings.tsx`：真实目录、监控与错误状态。
- `client/src/features/obs/ObsRuntimePanel.tsx`、`client/src/features/obs/ObsSettingsPanel.tsx`、`client/src/features/obs/useObsSettings.ts`：将测试录制按钮改为持续录制状态。
- `client/src-tauri/resources/ffmpeg-runtime/`：固定版本 FFmpeg 可执行文件、共享库、许可证和 NOTICE。
- `client/src-tauri/tauri.conf.json`、`client/package.ps1`：打包并校验 FFmpeg 资源。

## 第一阶段：日志边界与持续录制

### 任务 1：Encounter 日志解析

**文件：**
- 新建：`client/src-tauri/src/combat_log/model.rs`
- 新建：`client/src-tauri/src/combat_log/parser.rs`
- 新建：`client/src-tauri/src/combat_log/mod.rs`
- 修改：`client/src-tauri/src/lib.rs`

- [ ] 先在 `parser.rs` 写测试：合法 `ENCOUNTER_START` 返回 Boss ID、名称、难度、人数和上海时区 Unix 毫秒。
- [ ] 写测试：合法 `ENCOUNTER_END` 返回相同字段及成功标记。
- [ ] 写测试：技能事件、字段不足、非法时间和包含逗号的引号字段均不会被误识别。
- [ ] 执行 `cargo test combat_log::parser --lib`，确认测试因解析器尚未实现而失败。
- [ ] 实现无额外依赖的 CSV 字段扫描和日志时间解析。年份从日志文件修改时间锚定，跨年时选择离锚点最近的候选年份。
- [ ] 再执行 `cargo test combat_log::parser --lib`，预期全部通过。

领域入口采用：

```rust
pub enum EncounterEvent {
    Start(EncounterStart),
    End(EncounterEnd),
}

pub fn parse_encounter_line(
    line: &str,
    anchor_year: i32,
) -> Result<Option<EncounterEvent>, ParseError>;
```

### 任务 2：增量日志读取

**文件：**
- 新建：`client/src-tauri/src/combat_log/reader.rs`
- 修改：`client/src-tauri/src/combat_log/model.rs`

- [ ] 先写测试：首次读取只返回完整行，并保存末尾半行。
- [ ] 写测试：追加半行剩余内容后只产生一次完整事件。
- [ ] 写测试：文件截断或文件标识变化时重置游标，普通轮询不重复读取。
- [ ] 执行 `cargo test combat_log::reader --lib`，确认因 Reader 未实现而失败。
- [ ] 实现 `CombatLogReader::poll()`，游标保存规范化路径、文件长度、修改时间、已确认字节位置和尾行。
- [ ] 再执行 `cargo test combat_log::reader --lib`，预期全部通过。

读取接口采用：

```rust
pub struct CombatLogReader {
    cursor: CombatLogCursor,
}

impl CombatLogReader {
    pub async fn poll(&mut self, path: &Path) -> Result<Vec<LogLine>, String>;
}
```

### 任务 3：路径发现与可恢复设置

**文件：**
- 新建：`client/src-tauri/src/combat_log/discovery.rs`
- 修改：`client/src-tauri/src/combat_log/model.rs`
- 修改：`client/src-tauri/src/combat_log/mod.rs`
- 修改：`client/src-tauri/src/lib.rs`

- [ ] 先写测试：只接受以 `_retail_\Logs` 结尾的存在目录，并按最新 CombatLog 选择文件。
- [ ] 写测试：无候选、单候选、多候选分别返回明确状态。
- [ ] 执行 `cargo test combat_log::discovery --lib`，确认失败原因是发现逻辑缺失。
- [ ] 实现常见 Battle.net 安装根目录与固定盘符候选检查，不递归扫描整盘。
- [ ] 实现 `get_combat_log_status`、`set_combat_log_directory` 和 `set_combat_log_monitoring`，设置写入 `LocalStateStore` 的 `combatLog` 区段。
- [ ] 再执行 `cargo test combat_log::discovery --lib`，预期全部通过。

### 任务 4：Boss Pull 状态机

**文件：**
- 新建：`client/src-tauri/src/recording/model.rs`
- 新建：`client/src-tauri/src/recording/pull_tracker.rs`
- 新建：`client/src-tauri/src/recording/mod.rs`
- 修改：`client/src-tauri/src/lib.rs`

- [ ] 先写测试：Start 创建唯一 Pull，重复 Start 不重复创建。
- [ ] 写测试：匹配 End 进入等待尾帧状态，错配 End 只产生诊断。
- [ ] 写测试：新 Start 中断旧 Pull，快速连续 Pull 仍保留两个独立窗口。
- [ ] 写测试：窗口严格计算为 Start 前 5000 毫秒、End 后 5000 毫秒。
- [ ] 执行 `cargo test recording::pull_tracker --lib`，确认状态机尚未实现导致失败。
- [ ] 用 SHA-256 对规范化日志标识、开始时间和 `encounterId` 生成稳定 Pull ID，完成最小状态机。
- [ ] 再执行 `cargo test recording::pull_tracker --lib`，预期全部通过。

### 任务 5：持续录制职责调整

**文件：**
- 修改：`client/src-tauri/src/obs/runtime/service.rs`
- 修改：`client/src-tauri/src/obs/runtime/installer.rs`
- 修改：`client/src-tauri/src/live/model.rs`
- 修改：`client/src-tauri/src/live/session.rs`

- [ ] 先提取并测试纯决策函数：仅当 OBS 已连接、捕捉就绪且录像未运行时返回 `Start`；未就绪或已运行返回 `Wait`。
- [ ] 执行 `cargo test obs::runtime::service::tests::continuous_recording --lib`，确认决策函数缺失导致失败。
- [ ] 将录制启动封装为 `ensure_recording_active`，由 OBS 守护循环以已有 2 秒节奏调用，失败写入现有 `last_error`，不得忙循环。
- [ ] 删除 `LiveSession.recording_started_by_session`；直播开始只启动 Streaming，停止直播只停止 Streaming。
- [ ] 保留公开录制状态查询，但不再向前端暴露可停止正式录制的操作入口。
- [ ] 再执行上述单元测试，并执行 `cargo test live::session --lib`，预期通过。

## 第二阶段：录像分段、恢复与成片

### 任务 6：源录像锚点和窗口映射

**文件：**
- 新建：`client/src-tauri/src/recording/config.rs`
- 新建：`client/src-tauri/src/recording/coordinator.rs`
- 修改：`client/src-tauri/src/recording/model.rs`
- 修改：`client/src-tauri/src/obs/runtime/service.rs`

- [ ] 先写测试：单源文件窗口映射得到正确输入偏移和时长。
- [ ] 写测试：跨源文件和两个重叠 Pull 均保留完整源区间。
- [ ] 写测试：OBS 中断产生缺口时 Pull 被标记异常，而不是伪造连续时间。
- [ ] 执行 `cargo test recording::coordinator --lib`，确认映射器缺失导致失败。
- [ ] 为 OBS 连接注册 `RecordStateChanged` 与 `RecordFileChanged` 监听，保存墙钟 UTC 毫秒和 `Instant` 锚点。
- [ ] 实现周期 `SplitRecordFile` 与 Pull 尾帧完成时轮转；只有收到 `RecordFileChanged` 才封闭旧源文件。
- [ ] 实现 `map_clip_sources`，输出一个或多个 `SourceSlice`，并计算真实 `videoZeroMs`。
- [ ] 再执行 `cargo test recording::coordinator --lib`，预期通过。

### 任务 7：JSON 业务索引与崩溃恢复

**文件：**
- 新建：`client/src-tauri/src/recording/store.rs`
- 修改：`client/src-tauri/src/recording/model.rs`

- [ ] 先写测试：索引可往返序列化，schema 版本固定为 1。
- [ ] 写测试：写入通过同目录临时文件原子替换；损坏 JSON 被重命名保留且返回错误。
- [ ] 写测试：引用计数未归零或任务失败时源文件不可清理。
- [ ] 执行 `cargo test recording::store --lib`，确认 Store 缺失导致失败。
- [ ] 实现 `RecordingStore::load/save`，保存日志游标、当前 Pull、源文件、处理队列与回放索引。
- [ ] 再执行 `cargo test recording::store --lib`，预期通过。

### 任务 8：固定 FFmpeg 资源与 stream-copy 处理器

**文件：**
- 新建：`client/src-tauri/src/recording/processor.rs`
- 新建：`client/src-tauri/resources/ffmpeg-runtime/LICENSE.txt`
- 新建：`client/src-tauri/resources/ffmpeg-runtime/NOTICE.md`
- 新增：`client/src-tauri/resources/ffmpeg-runtime/bin/ffmpeg.exe` 及其 LGPL 共享运行库
- 修改：`client/src-tauri/tauri.conf.json`
- 修改：`client/package.ps1`

- [ ] 使用 FFmpeg 官方下载页列出的 BtbN Windows 构建，固定为发布标签 `autobuild-2026-09-04-14-01`、版本 `n8.1.2-50-g1a748fe2cd`、归档 `ffmpeg-n8.1.2-50-g1a748fe2cd-win64-lgpl-shared-8.1.zip`。下载 URL 固定为 `https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-09-04-14-01/ffmpeg-n8.1.2-50-g1a748fe2cd-win64-lgpl-shared-8.1.zip`，归档 SHA-256 固定为 `d4a0db2e182e6d1535a022523d329daf8daff9d69db88d5aa569732005cffa91`；NOTICE 同时记录 FFmpeg 与 BtbN 构建来源，不使用 `latest` URL。
- [ ] 先写测试：单输入命令包含 `-ss`、`-t`、`-map 0`、`-c copy`、`-avoid_negative_ts make_zero` 和 `-movflags +faststart`。
- [ ] 写测试：多输入使用 concat 清单，路径按 FFmpeg concat 规则转义，参数通过 `Command::args` 传递而不拼 Shell。
- [ ] 写测试：非零退出、输出不存在或输出为空均返回包含 Pull ID 的错误。
- [ ] 执行 `cargo test recording::processor --lib`，确认命令构造器缺失导致失败。
- [ ] 实现串行 Processor；先把所需源区间 stream-copy 为中间 MP4，再 concat 为最终 MP4，成功后原子写同名 manifest。
- [ ] 在 `package.ps1` 校验每个内置文件 SHA-256；在 Tauri resources 中加入 `ffmpeg-runtime/`。
- [ ] 再执行 `cargo test recording::processor --lib`，预期通过。

### 任务 9：后台监控与恢复编排

**文件：**
- 修改：`client/src-tauri/src/combat_log/mod.rs`
- 修改：`client/src-tauri/src/recording/coordinator.rs`
- 修改：`client/src-tauri/src/recording/mod.rs`
- 修改：`client/src-tauri/src/lib.rs`

- [ ] 先写编排测试：Start 只建 Pull；End 等 5 秒后入队；处理不阻塞下一次日志轮询。
- [ ] 写恢复测试：启动时恢复待处理任务；OBS 无连接时持续监控日志但将 Pull 标记缺少视频。
- [ ] 执行 `cargo test recording::tests::monitoring --lib`，确认编排缺失导致失败。
- [ ] 在 Tauri setup 注册唯一 `CombatLogState`、`RecordingState` 和后台监控任务。
- [ ] 将日志游标与每次 Pull 状态转换及时写入 `recording-index.json`，处理队列使用单消费者串行执行。
- [ ] 实现 `get_recording_status` 和 `list_local_recordings`，供当前设置页和后续回放页使用。
- [ ] 再执行上述测试，预期通过。

### 任务 10：接通设置界面与只读录制状态

**文件：**
- 新建：`client/src/features/combat-log/model.ts`
- 新建：`client/src/features/combat-log/combatLogService.ts`
- 新建：`client/src/features/combat-log/useCombatLogSettings.ts`
- 修改：`client/src/features/combat-log/CombatLogSettings.tsx`
- 修改：`client/src/features/obs/ObsRuntimePanel.tsx`
- 修改：`client/src/features/obs/ObsSettingsPanel.tsx`
- 修改：`client/src/features/obs/useObsSettings.ts`
- 修改：`client/src/features/obs/obsService.ts`

- [ ] 将静态路径替换为 Rust 返回的真实路径、发现状态、监控状态、当前日志文件和最近错误。
- [ ] 目录按钮调用 Tauri dialog 后再调用 `set_combat_log_directory`；Switch 调用 `set_combat_log_monitoring`。
- [ ] 覆盖加载、未发现、多候选、监控中、错误和禁用状态，窄屏时三列布局降为单列。
- [ ] 删除前端 `startRecording/stopRecording/toggleRecording` 操作；OBS 面板展示“持续录制中 / 等待游戏 / 正在恢复”，不提供停止按钮。
- [ ] 执行 `npm run build`，预期 TypeScript 与 Vite 构建成功。

### 任务 11：静态检查与桌面验收

**文件：**
- 修改：`.agents/CONTEXT.md`
- 修改：`.agents/HANDOFF.md`
- 修改：`.agents/history/2026-09.md`（以 `.agents/INDEX.md` 的实际分卷为准）

- [ ] 执行 `cargo test --lib`，确认所有 Rust 单元测试通过且无失败。
- [ ] 执行 `npm run build`，确认前端构建成功。
- [ ] 执行 `git diff --check` 和 `rg` 检查旧录制按钮、直播录像所有权字段与相对导入均已移除。
- [ ] 启动桌面客户端，确认 WoW 未运行时显示等待且不反复报错。
- [ ] 启动 WoW 后确认 OBS 自动持续录制，直播开始/停止均不影响录像。
- [ ] 使用包含 3 个连续 Boss Pull 的受控 CombatLog，确认每场生成独立 MP4 与 manifest，窗口为前 5 秒和后 5 秒。
- [ ] 人为中断 OBS、FFmpeg 和客户端，确认异常状态可见、源文件保留且重启后任务恢复。
- [ ] 按 `.agents/README.md` 追加本次结果和未决事项，文档只使用简体中文。

## 验收边界

- 本计划不实现技能标签、时间轴事件展示、云端上传或多人同步。
- 不使用 SQLite，不新增浏览器 `localStorage`。
- 不删除用户已有录像；自动清理仅能作用于本功能登记且已无任务引用的源文件。
- stream copy 起点受关键帧限制，manifest 必须保存实际 `videoZeroMs`，不能假定它恒等于 5000。
