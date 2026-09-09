# 本地回放前端实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 将 Rust 生成的本地 Boss 录像接入客户端回放页，并通过 hls.js、原生视频元素和 Media Chrome 完成本地播放及 Pull 边界跳转。

**架构：** Rust 保留最终 MP4，同时用内置 FFmpeg stream copy 生成 CMAF/fMP4 HLS。受限自定义协议仅提供应用录像目录中的 HLS 文件；React 轮询 `list_local_recordings`，由独立 HLS 适配组件把清单挂载到 Media Chrome 管理的原生视频元素。

**技术栈：** Rust、Tauri 2、FFmpeg、React 19、TypeScript、hls.js 1.7.2、Media Chrome 4.19.2、Ant Design 6.5。

**规格：** `docs/superpowers/specs/2026-09-06-local-boss-recording-design.md`、`DESIGN.md`

## 全局约束

- 只接入本地 Boss 录像，不实现技能事件、云端上传或多人同步。
- 保留最终 MP4 与 JSON manifest，HLS 只作为本地和未来云端一致的播放产物。
- React 不直接访问任意文件路径；本地协议只能读取应用录像目录下由 Pull ID 定位的 HLS 文件。
- 项目模块使用 `@/` 路径别名，界面与业务注释使用简体中文。
- 不引入 SQLite，不改变 OBS 持续录制与 CombatLog Pull 边界逻辑。
- 未经用户指定不运行测试、类型检查或构建，只执行允许的静态检查。

---

### 任务 1：生成本地 HLS 播放产物

**文件：**
- 新建：`client/src-tauri/src/recording/playback/hls.rs`
- 新建：`client/src-tauri/src/recording/playback/mod.rs`
- 修改：`client/src-tauri/src/recording/processor.rs`
- 修改：`client/src-tauri/src/recording/model.rs`
- 修改：`client/src-tauri/src/recording/mod.rs`

**接口：**
- 输入：最终 MP4、Pull ID、应用录像目录。
- 输出：`recordings/hls/<pull-id>/index.m3u8`、`init.mp4`、`segment-*.m4s`，并把清单路径保存到 `BossPull.playback_path`。

- [x] 在 HLS 模块中定义 stream-copy 参数构造函数，固定 VOD、fMP4 分片和相对文件名。
- [x] 最终 MP4 严格校验成功后生成 HLS，只有两种产物都成功才进入 `ready` 或 `partial`。
- [x] 为旧索引中的 `playbackPath` 使用 `serde(default)`，保持 JSON 向后兼容。

### 任务 2：提供受限 HLS 本地协议

**文件：**
- 新建：`client/src-tauri/src/recording/playback/protocol.rs`
- 修改：`client/src-tauri/src/lib.rs`

**接口：**
- 输入：`http://local-replay.localhost/<pull-id>/<file>`。
- 输出：仅限合法 Pull ID 及 `index.m3u8`、`init.mp4`、`segment-*.m4s` 的媒体响应。

- [x] 校验路径段并拒绝目录穿越和未知扩展。
- [x] 按文件类型返回正确 Content-Type、Content-Length 与 CORS 响应头。
- [x] 在 Tauri Builder 注册 `local-replay` 自定义协议。

### 任务 3：接入本地录像列表与 hls.js

**文件：**
- 新建：`client/src/features/recording/model.ts`
- 新建：`client/src/features/recording/recordingService.ts`
- 新建：`client/src/features/recording/useLocalRecordings.ts`
- 新建：`client/src/pages/replay/components/HlsVideo.tsx`
- 修改：`client/package.json`
- 修改：`client/package-lock.json`

**接口：**
- `recordingService.list(): Promise<LocalRecording[]>`
- `useLocalRecordings()` 返回录像、加载、错误和刷新状态。
- `HlsVideo` 接收清单 URL，并向父组件报告播放时间、时长和错误。

- [x] 固定安装 hls.js 1.7.2。
- [x] 浏览器开发预览返回空列表，Tauri 环境调用真实命令并按开始时间倒序。
- [x] 页面挂载时加载并每 2 秒刷新；组件卸载时销毁 hls.js 实例。

### 任务 4：替换回放 fixture 并接通时间轴

**文件：**
- 修改：`client/src/pages/replay/model.ts`
- 修改：`client/src/pages/replay/ReplayPage.tsx`
- 修改：`client/src/pages/replay/components/ReplayHeader.tsx`
- 修改：`client/src/pages/replay/components/ReplayPlayer.tsx`
- 修改：`client/src/pages/replay/components/EventTimeline.tsx`
- 删除：`client/src/pages/replay/components/MemberPanel.tsx`
- 删除：`client/src/pages/replay/replayFixtures.ts`

**接口：**
- 页面展示真实 Boss、难度、结果、处理状态、时间和错误。
- 时间轴使用 `videoZeroMs` 定位开战点，使用 Encounter 起止时间定位结束点。

- [x] 覆盖加载、空数据、命令失败、处理中、失败、缺片和可播放状态。
- [x] 点击开战或结束标记时修改当前原生视频元素的 `currentTime`。
- [x] 删除所有虚构成员、技能事件和演示时间。

### 任务 5：静态验证与项目交接

**文件：**
- 修改：`.agents/CONTEXT.md`
- 修改：`.agents/HANDOFF.md`
- 修改：`.agents/conversations/2026/2026-09.md`

- [x] 使用 `rg` 检查 fixture、相对导入和旧占位文案是否残留。
- [x] 使用 `git diff --check` 检查差异格式。
- [x] 记录未运行测试和构建，以及需要桌面端验证的 HLS 播放路径。
