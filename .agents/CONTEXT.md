# 长期项目上下文

本文件只保存跨任务、跨设备仍然有效的事实和决定。失效内容应及时替换，具体讨论过程保留在月度历史中。

## 开发者与工作方式

- 项目由个人开发者维护，会在多台 Windows 设备上使用不同 AI 编程助手。
- 项目级 AI 上下文使用本目录中的 Markdown 文件保存，并通过 Git 同步。
- 不为 AI 上下文引入数据库、Redis 或额外云服务。
- 优先保证新设备能快速恢复当前状态，同时控制多年历史的文件体积和上下文读取量。

## 项目依据

- 技术栈、目录架构、开发方式和测试约定以根目录 `CLAUDE.md` 为准。
- 产品行为和验收范围以 `docs/PRODUCT.md` 为准。
- Agent 工作与交付规则以根目录 `AGENTS.md` 为准。

## 上下文管理决定

- `.agents/CONTEXT.md` 保存长期稳定信息。
- `.agents/HANDOFF.md` 保存当前交接状态。
- `.agents/INDEX.md` 提供历史定位入口。
- 对话历史按年、月拆分保存在 `.agents/conversations/`。
- 对话历史采用结构化摘要，不保存逐字聊天和敏感信息。

## 当前产品方向

- 产品定位为魔兽世界中国区正式服团队的多视角云端战斗复盘平台。
- Windows 桌面 Agent 使用 Rust、Tauri 2 和 React/TypeScript WebView；Rust 负责系统能力与业务编排，React 只负责客户端界面。Agent 增量读取 CombatLog，并通过 S3 Multipart 可靠上传到 MinIO。
- 桌面 UI 不采用 GPUI。P0 的 OBS 预览使用独立原生窗口，避免在 WebView 中直接嵌入 D3D 原生表面；只有出现确定的 WebView 性能瓶颈或编辑器级自绘需求时才重新评估 GPUI。
- OBS 生态已确定为录制技术路线，但不再建设独立 Recorder Host，也不采用 noobs 或 Rust 直接链接 libobs。客户端已使用 Rust `obws` 建立 OBS Studio WebSocket 5.x 的最小连接、状态查询和录制控制链路。
- React 只负责桌面 UI，所有系统和后端能力必须由 Rust 承担，包括 OBS WebSocket 连接、录制控制、配置持久化、文件访问、CombatLog 和上传。
- 产品使用方式是每名参战团员安装本项目客户端，由客户端自动录制并上传该团员自己的第一视角和完整 CombatLog；云端按团队和 Pull 汇总所有可用成员数据，Web 端统一查看和切换视角。OBS 只作为客户端内部实现，不是要求用户接入外部 OBS 的产品流程。
- `client/` 已建立 Tauri 2、React 19 和 Ant Design 6.5 客户端骨架；OBS 配置仅位于设置中心，React 通过 Tauri command 调用 Rust `obws`，不再使用独立 `obs-control` 子窗口。
- 前端 `client/src` 内所有项目模块、组件、类型和样式统一通过 `@/` 别名导入，不使用相对路径；CSS 规则块必须使用多行格式，每条声明单独占行。
- Windows 客户端通过无参数 `client/package.ps1` 自动执行依赖安装、Rust release 构建和 NSIS 打包；脚本会兼容 Rustup 安装后终端 `PATH` 尚未刷新的情况，release 可执行文件使用 Windows GUI 子系统，不显示额外控制台窗口。
- 云端使用 FastAPI、PostgreSQL、Celery、Redis 和 FFmpeg，负责日志解析、Pull 关联、视频处理和跨成员时间对齐。
- 团队实时直播由 OBS 通过 WHIP/WebRTC 发布到云端，桌面端和网页端共用 WHEP/WebRTC 播放器；普通视角只订阅当前选择的一路，后续指挥视角最多四路。历史回放使用 HLS.js 和 CMAF/fMP4 HLS，切换成员时保持统一 Pull 时间。
- 所有参与活动且运行桌面 Agent 的成员都上传自己的完整原始 CombatLog 和第一视角录像；云端汇总多份日志，完成事件去重、缺失补全、统一分析和录像时间映射。
- 团队内私有直播已进入第一版范围：开始直播时 OBS 同时进行本地录像，云端媒体服务保存直播分片；本地录像用于断网补传和高质量正式资产。Pull 结束后仍上传完整原始 CombatLog，并生成可按时间轴跳转的回放产物。
- 平台登录用户 ID 用于鉴权、团队归属和上传审计；CombatLog 中的角色 GUID 用于识别游戏角色和关联第一视角，不能替代平台身份。
- `reviewtool.gg` 作为产品体验参考，`aza547/wow-recorder` 作为客户端技术路线参考；复用前必须完成许可证和兼容性评估。
- 已核对 `wow-recorder` 主分支源码：其 Electron 客户端通过原生 `noobs` 模块直接封装 `libobs`，在 WoW 运行期间持续录制缓冲区，由 CombatLog 事件将缓冲区转换为单场录像，结束后用 FFmpeg 无重新编码剪切/重封装，再上传完整 MP4 和精简元数据。
- `wow-recorder` 不上传原始 CombatLog，也不提供完整战斗事件解析或边录边传；它只能作为录制缓冲、日志触发、快速剪切和预签名上传的实现参考，不能直接满足本项目的云端日志聚合与近实时复盘目标。
- 第一版实施顺序以 `docs/DEVELOPMENT_PLAN.md` 为准：先验证 Rust 后端通过 OBS Studio WebSocket 控制录制和 CombatLog 本地状态，再开发账号、可靠上传、云端解析与 Web 复盘；录制和双视角同步未通过前不扩展非核心功能。
- WCL 导入、团本排轴、STT 和 NSRT 不再属于第一阶段核心闭环。
- 客户端视觉规范统一记录在根目录 `DESIGN.md`：Ant Design 6 提供基础组件，Tailwind CSS 负责布局与间距，Ant Design Icons 作为图标体系，界面使用扁平化风格；全局版本主题由 `client/src/app/theme.ts` 同步 Ant Design Token 与 CSS 变量。
- 客户端一级导航固定为首页、回放、直播、个人中心、设置；OBS 和战斗日志配置仅位于设置二级导航，不再使用独立 `obs-control` 子窗口或首页配置面板。
- 内置 OBS 采用 Rust 从 GitHub Release 下载官方 `OBS-Studio-32.2.1-Windows-x64.zip`、校验 SHA-256、解压并创建 `portable_mode.txt` 的方式安装；PDB 仅为调试符号，不作为可运行安装包。Rust 启动便携 OBS、配置本机 WebSocket 鉴权并通过 `obws` 控制视频参数、游戏捕捉、音频、录制目录和开始/停止录制。
- OBS 安装进度由 Rust 后端维护：下载阶段按已接收字节计算真实百分比，界面同时显示准备、下载、校验、解压、配置、完成或失败阶段；React 只轮询并展示状态。
- OBS 默认安装到客户端可执行文件同级 `obs` 目录；客户端存活期间 Rust 每 2 秒检查连接，OBS 被用户关闭后自动重新启动。OBS 使用固定 `WoW Recorder` 专属场景，首次创建时默认设置为 1920×1080。
- 客户端正常退出时同步关闭由自身启动的 OBS：先请求 Windows 正常关闭并等待，超时后才强制结束；退出阶段停止 OBS 守护。便携 OBS 新进程启动前清理自身 `.sentinel` 异常退出标记，兼容 OBS 32 的目录格式和旧版文件格式；受管进程长时间无法提供 WebSocket 时结束并在下一轮重启，避免安全模式对话框持续阻塞。
- OBS 专属场景固定维护“魔兽世界游戏画面”来源并按 1920×1080 等比填充。用户只选择“窗口捕捉”或“屏幕捕捉”：窗口捕捉使用 `game_capture` 且只绑定 WoW，屏幕捕捉使用 `monitor_capture` 录制整个屏幕；自动捕捉默认开启。两种模式都要求 `Wow.exe` 真实运行，窗口捕捉还要求 OBS 实时枚举到 WoW 窗口，满足条件后才允许测试录制。
- OBS 设置选择后立即生效，不设置独立保存按钮。编码器读取 OBS profile 与本次启动实际加载的编码器；声音只包含扬声器和麦克风两个监听设备，设备、推子和实时 dB 均读取 OBS，其中 dB 来自 `InputVolumeMeters` 事件；用户界面不展示 WebSocket 地址、协议版本、鉴权和便携模式等技术信息。
- Rust OBS 代码固定按领域分层：`obs/runtime/` 承担安装、配置、连接和进程生命周期，`obs/settings/` 承担音频、画面捕捉和视频设置；不得继续把不同职责的文件平铺到 `obs/` 根目录。
- 桌面客户端稳定设置统一由 Rust `LocalStateStore` 按业务区段保存到应用配置目录的 `client-state.json`，React 不直接使用浏览器存储；跨页面状态使用应用级 Provider。外部连接、录制、安装进度、实时电平和运行时长不作为持久化真值，启动后重新检测。
- 直播、录像与时间轴正式架构记录在 `docs/LIVE_ARCHITECTURE.md`：唯一正式链路为 OBS WHIP 发布、云端媒体服务、WHEP/WebRTC 播放，桌面端和网页端统一使用 Media Chrome 控件。Rust 负责 OBS、直播会话和 WHEP HTTP 信令，React 只负责 `RTCPeerConnection` 与媒体展示；不保留虚拟摄像头、截图轮询或本机 HLS 回退。直播与 OBS 本地录像原子编排，直播页导航不会自动开播。
- 战斗时间轴以客户端 CombatLog 和 WCL API 为事实源，通过多事件锚点建立 `video_time_ms = scale * pull_time_ms + offset_ms` 映射。Wowhead 当前没有受支持的通用公开数据 API，只预留取得稳定接口或授权后的服务端元数据适配器；第三方元数据不得影响事件事实和视频定位。
- 直播与回放统一使用开源 `Media Chrome` React 控件框架，业务代码只维护原生视频、WebRTC 和 HLS 媒体源适配及能力组合，不自研播放控制栏。实时流只组合真实可用的播放、LIVE、画中画和全屏；存在音轨后再组合音量，HLS 回放才组合进度条、任意时间跳转和倍速。
- 根目录 `AGENTS.md` 已将模块化设为全项目强制规则：按业务域和共同变化关系组织目录，入口只做注册组合，禁止平铺多职责实现、单文件深目录、聚合转发包装和循环依赖；达到文件数、职责数或 500 行阈值时必须先评估拆分。
- 客户端默认窗口为 1440×900，最小尺寸为 1080×720，不默认全屏或最大化。OBS 设置页进入时自动检测安装状态，不显示安装目录；安装后下载卡片切换为状态检测。OBS 未连接时声音通道使用灰色空状态，连接后设备、音量和检测状态全部读取 OBS。
