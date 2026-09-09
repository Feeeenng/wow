# 本地 Boss 自动录像设计

## 目标

在现有 OBS Studio WebSocket 录制能力之上，实现纯本地的 Boss 自动录像闭环。客户端运行期间由 OBS 持续录制，Rust 增量读取正式服 CombatLog，以 `ENCOUNTER_START` 和 `ENCOUNTER_END` 确定 Pull 边界，并在战斗结束后自动生成一段包含开战前 5 秒和结束后 5 秒的独立 MP4。

本阶段只完成单机录像生成和本地记录，不实现技能 Tooltip、事件时间轴、HLS、云端上传或多人同步。

## 已有能力与复用边界

- 复用 `obs/runtime/` 已有的便携 OBS 安装、进程守护、WebSocket 鉴权、专属场景、WoW 捕捉、音频、录像目录和录制状态查询。
- 复用 `obws 0.15` 的 `StartRecord`、`StopRecord`、`SplitRecordFile`、`RecordStateChanged` 和 `RecordFileChanged` 能力。
- 不重新实现采集和编码，不引入 `libobs` 或独立 Recorder Host。
- 现有直播会话只管理 Streaming，不再拥有录像生命周期；直播复用已经持续运行的 OBS 录像，停止直播不得停止持续录像。
- 现有“开始测试录制”不能继续直接启停正式录像，应调整为只读持续录像状态，避免用户误停自动录制。

## 用户可见行为

1. 客户端启动后继续沿用现有 OBS 守护流程。
2. OBS 连接且专属捕捉场景就绪后，Rust 自动确保录像处于运行状态；不要求用户打开直播页或点击录制按钮。
3. CombatLog 路径优先从 WoW 安装位置和常见正式服目录自动发现。无法唯一确定时由用户手动选择，结果保存到 `client-state.json` 的独立业务区段。
4. 读取到 `ENCOUNTER_START` 时创建当前 Pull，只记录日志和录像时间锚点，不启停 OBS。
5. 读取到匹配的 `ENCOUNTER_END` 时结束当前 Pull，并继续保留 5 秒尾帧。
6. 尾帧完成后封闭所需源录像，后台生成正式 Boss MP4 和同名 manifest。
7. 正式视频从 `ENCOUNTER_START` 前 5 秒开始；manifest 中的 `videoZeroMs` 指向视频内真正的 `ENCOUNTER_START`。
8. 处理完成后录像进入本地回放目录。普通小怪和待机录像不生成正式回放。

## 录制与文件轮转

OBS 录像在应用生命周期内持续运行，CombatLog 不控制编码器启停。Rust 监听 OBS 输出事件并维护每个源文件的开始时间、结束时间和路径。

为避免单个源文件无限增长，录像协调器使用 `SplitRecordFile` 周期性轮转；Pull 尾帧完成时也可请求轮转，以尽快得到可读取的封闭文件。轮转只更换输出文件，不停止录像。具体轮转周期统一放入 Rust 录制配置模块，不允许散落魔法值。

每个 Pull 的裁切窗口为：

```text
clip_start = encounter_start - 5 秒
clip_end   = encounter_end + 5 秒
video_zero_ms = encounter_start - actual_clip_start
```

一个裁切窗口可以跨越多个源文件。快速连续 Pull 允许引用相同源文件或产生重叠窗口；日志读取和新 Pull 创建不得等待上一个视频处理完成。

## CombatLog 处理

### 路径发现

- 只处理中国区正式服 `_retail_\Logs`。
- 自动发现得到一个有效目录时直接使用。
- 未找到或存在多个候选时，设置页显示真实状态并允许选择目录。
- React 只调用 Tauri command，不直接访问文件系统。

### 增量读取

- 监听最新的 `WoWCombatLog*.txt`，同时使用定时文件状态检查兜底。
- 保存文件标识、已确认字节位置和未完整尾行，任意字节边界写入都不得产生半行事件。
- 文件轮转、截断或同名重建后重新建立正确游标。
- 日志时间按本地中国标准时间解析并保留毫秒精度，再转换为统一 Unix 毫秒用于录像映射。

### 第一版事件范围

只解析：

- `ENCOUNTER_START`：Boss ID、Boss 名称、难度 ID、团队人数和开始时间。
- `ENCOUNTER_END`：Boss ID、Boss 名称、难度 ID、团队人数、成功标记和结束时间。

不解析技能、伤害、治疗、Buff、Debuff 或死亡事件。

## Pull 状态规则

- Pull ID 由日志文件标识、`ENCOUNTER_START` 时间和 `encounterId` 稳定生成。
- 重复的开始事件不得重复创建 Pull。
- 结束事件只有在 `encounterId` 与当前 Pull 匹配时才结束 Pull；错配事件记录诊断信息。
- 新开始事件到来但旧 Pull 尚未结束时，旧 Pull 标记为 `interruptedByNextPull`，新 Pull 正常建立。
- 客户端退出、OBS 断开或 WoW 退出导致缺少结束事件时，保留已有锚点和源文件引用，状态标记为异常，不静默删除。
- 异常 Pull 可以生成已有范围内的部分录像，但必须在本地列表明确标识异常，不能显示为完整击杀或灭团录像。

## 时间映射

录像协调器同时保存系统 UTC 毫秒和 Rust 单调时钟锚点，避免系统时间在录制期间跳变破坏源文件内部的相对时间。CombatLog 事件保存日志时间和实际读取时间，两者分开记录，不能用日志到达时间替代事件时间。

正式 manifest 至少包含：

- schema 版本、Pull ID 和处理状态；
- `encounterId`、Boss 名称、难度、团队人数和成功标记；
- CombatLog 文件标识、开始/结束字节位置和事件时间；
- 实际视频开始/结束时间、`videoZeroMs` 和总时长；
- 使用的源文件及各自区间；
- 最终 MP4 路径、错误信息和异常结束原因。

## 本地状态与恢复

不使用 SQLite。

- `client-state.json` 只保存日志目录等可恢复用户设置。
- 录制业务状态保存到应用数据目录的 `recording-index.json`，包括日志游标、当前 Pull、源文件、待处理任务和本地回放索引。
- `recording-index.json` 使用 schema 版本，并通过同目录临时文件写入后原子替换，避免进程中断留下半个 JSON。
- 无法解析状态文件时保留损坏文件并显示可定位错误，不静默用空状态覆盖。
- 客户端重启后重新检测 OBS 瞬时状态，并恢复未完成的日志读取和视频处理任务。
- 临时源文件只有在所有引用它的任务都成功后才能删除；处理失败时必须保留源文件以便重试。

## FFmpeg 边界

客户端内置固定版本的 Windows x64 LGPL FFmpeg 共享构建，记录下载来源、版本、SHA-256、许可证和 NOTICE。运行时不依赖系统 PATH，也不从不固定地址临时下载可执行文件。

第一版使用 FFmpeg stream copy 裁切 H.264 和全部音轨，不重新编码：

- 显式映射全部输入流；
- 避免负时间戳；
- 输出 MP4 faststart；
- 失败时保留源文件和任务状态。

stream copy 的实际起点受关键帧边界影响。OBS 继续使用 1 秒关键帧间隔，处理后记录实际起点与 `videoZeroMs`，使后续时间轴仍能定位真实战斗零点。

FFmpeg 路径、超时、轮转周期、前置 5 秒和尾帧 5 秒统一由 Rust 录制配置模块提供。

## 模块边界

新增领域按以下职责组织：

```text
client/src-tauri/src/
├─ combat_log/
│  ├─ discovery.rs    # 正式服日志目录发现
│  ├─ reader.rs       # 增量读取、游标和不完整尾行
│  ├─ parser.rs       # Encounter 事件解析
│  ├─ model.rs        # 日志领域契约
│  └─ mod.rs
└─ recording/
   ├─ config.rs       # 前后尾帧、轮转、FFmpeg 和文件名配置
   ├─ coordinator.rs  # 持续录像、OBS 文件事件和源片段锚点
   ├─ pull_tracker.rs # Pull 状态转换
   ├─ processor.rs    # FFmpeg 串行裁切
   ├─ store.rs        # recording-index.json 原子持久化
   ├─ model.rs        # 录制、Pull、任务和 manifest 契约
   └─ mod.rs
```

依赖方向为应用入口 → 录制编排 → CombatLog/OBS/媒体处理 → 文件系统。CombatLog 模块不依赖 OBS，OBS 模块不反向依赖 Pull 或页面。

React 第一阶段只需要把战斗日志设置页从静态 fixture 接到 Rust，并把 OBS 区域的测试录制按钮改为持续录像状态展示。回放页面的数据接入留到后续独立阶段。

## 错误处理

- 日志目录不可用：持续录像不停止，界面显示日志未监控，不生成新 Pull。
- OBS 未连接或捕捉未就绪：由现有守护流程恢复，录制协调器不得忙循环调用开始录制。
- OBS 意外停止录像：记录错误并由协调器重新启动；跨中断的 Pull 标记异常。
- 文件轮转未收到 `RecordFileChanged`：任务保持等待并显示超时错误，不猜测文件路径。
- FFmpeg 退出非零或目标文件校验失败：任务标记失败并保留源文件。
- 状态写入失败：停止清理源文件，避免丢失唯一可恢复依据。

## 验收标准

- 客户端启动且 OBS 捕捉就绪后自动持续录像，无需点击直播或测试录制。
- 不打开直播也能完成 Boss 自动录像；停止直播不会停止持续录像。
- 使用真实或受控样本连续识别至少 3 场 Boss Pull，每场生成独立 MP4 和 manifest。
- 每段正式视频覆盖开战前 5 秒和结束后 5 秒，`videoZeroMs` 指向 `ENCOUNTER_START`。
- 快速连续 Pull 不互相覆盖，也不阻塞日志读取。
- 日志半行、文件轮转、截断和重复事件不会生成重复视频。
- 视频处理期间退出客户端，重启后可以恢复任务。
- FFmpeg 失败、OBS 中断和缺少结束事件均保留源文件并产生可诊断状态。
- 普通小怪战斗不生成正式视频。

## 验证策略

实现采用测试优先：

- Parser 单元测试覆盖开始、结束、非法字段、中文 Boss 名称和毫秒时间。
- Reader 单元测试覆盖半行、追加、截断和轮转。
- Pull 状态测试覆盖正常结束、重复开始、错配结束、新 Pull 中断旧 Pull。
- 时间映射测试覆盖前 5 秒、后 5 秒、跨源文件和快速连续 Pull。
- Store 测试覆盖原子写入、重启恢复和损坏文件保留。
- Processor 命令构造测试覆盖 stream copy、全部音轨和安全参数；真实 FFmpeg 与 OBS 由桌面集成验证覆盖。

按照仓库授权规则，只有用户明确指定后才执行测试、静态检查、前端构建、Cargo 检查或打包。
