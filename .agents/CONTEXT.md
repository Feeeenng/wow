# 长期项目上下文

- 2026-10-17用户再次明确授权将当前全部修改按工作模块提交Git；本批覆盖分类资料、团队死亡API、客户端面板、原生拖放、验收脚本及文档，已有导入排序单独提交。仅本地提交，不推送；后续新改动继续按阶段提醒，不自动延续本批提交授权。

- 2026-10-17用户要求后续优先实现客户端；再次明确授权将全部现有修改按工作模块提交Git。本批已按资源、日志解析、客户端复盘、退出保存、验收脚本、验收文档与项目交接拆分本地提交，不推送；后续仍按阶段提醒而非自动提交。
- 用户随后明确更新目标：优先客户端，Web暂不考虑；客户端UI必须统一使用自身主题和组件规范，不与ReviewTool完全相同。回放及死亡面板继承全局版本主题，历史黑红局部调色不再作为当前约束。
- 客户端本地死亡窗口已接通：默认死前15秒、来源数值与本人生命离散采样、已观测光环、分页及视角定位，应用级三份快照；缺失／不支持／换源区别空窗口并可重新读取。致死及减伤／耗材分类缺少明确事实时不推测。资源目录使用局部.gitattributes禁止行尾转换，以保证随包逐字节摘要。
- 客户端轨道密集详情按20项分页，混合规则组不整体拖动，逐项选择目标支持键盘；未识别来源不创建新覆盖。正常关闭会排空最新回放偏好及在途保存，失败提示并取消关闭；只使用现有close权限，不新增destroy能力，强杀／断电不保证最后未落盘修改。原生RPC测试用显式await轮询，不能用waitForFunction的异步谓词当就绪保证。
- 客户端死亡分类使用独立固定版本DB2证据，当前84项样本技能、4种治疗耗材技能；个人／外部按真实身份区分，团队范围只认明确效果。物品复用职业技能不能直接当耗材，已排除治疗链1064关联杂项39163的误判。成功施法与治疗分别展示，不计成两次使用；资料分类不等于实际减伤量、完整覆盖、冷却或未使用结论。
- 客户端团队死亡窗口通过Rust读取已授权的WCL公共报告快照，沿用既有表结构，按需读取伤害／治疗／目标生命采样。Redis快照有TTL，游标绑定团队／录像／来源快照／死亡及内容摘要；每页重新鉴权。换账号／团队／凭证清除云端快照，报告actor与空GUID保持独立，关联视角只认显式绑定；WCL不套用本地版本减伤分类。
- Windows主窗口dragDropEnabled:false允许HTML5技能移轨；CDP模拟成功不能代替OS鼠标结果。原生OS验收窗口必须真实可见，按实际元素物理坐标发送输入并读取DOM／Rust落盘；Node进程终止同时认exitCode与signalCode。WCL死亡窗口必须显式includeResources:true，默认关键事件导入不扩大资源查询。

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
- 产品使用方式是每名参战团员安装本项目客户端，自动录制自己的第一视角；经用户显式发起上传，云端按明确团队和 Pull 汇总可用录像及 Archon/WCL 标准事件。OBS 是客户端内部实现，不要求用户接入外部 OBS。
- `client/` 已建立 Tauri 2、React 19 和 Ant Design 6.5 客户端骨架；OBS 配置仅位于设置中心，React 通过 Tauri command 调用 Rust `obws`，不再使用独立 `obs-control` 子窗口。
- 前端 `client/src` 内所有项目模块、组件、类型和样式统一通过 `@/` 别名导入，不使用相对路径；CSS 规则块必须使用多行格式，每条声明单独占行。
- Windows 客户端通过无参数 `client/package.ps1` 自动执行依赖安装、Rust release 构建和 NSIS 打包；脚本会兼容 Rustup 安装后终端 `PATH` 尚未刷新的情况，release 可执行文件使用 Windows GUI 子系统，不显示额外控制台窗口。
- 云端使用 FastAPI、PostgreSQL、Celery、Redis 和 FFmpeg，负责日志解析、Pull 关联、视频处理和跨成员时间对齐。
- 当前直播先完成本机闭环：OBS 通过 WHIP/WebRTC 发布到 Rust 管理且随安装包内置的本机 MediaMTX，桌面端通过 WHEP/WebRTC 播放，用户不需要额外下载直播组件。未来迁移云端媒体节点时保持协议和播放器不变；普通视角只订阅当前选择的一路，指挥视角最多四路。历史回放使用 HLS.js 和 CMAF/fMP4 HLS，切换成员时保持统一 Pull 时间。
- CombatLog 由 Archon App 负责分段增量上传并最终形成 WCL Report；本项目客户端不再向自有云端重复上传原始 CombatLog。Rust 仍以只读方式监听本地日志，提取 Pull 边界、角色 GUID、事件锚点和日志位置，用于录像切分及后续与 WCL Report 对齐。
- 当前阶段不建设云端实时直播。开始本机直播时 OBS 同时进行本地录像；本地录像后续用于上传和高质量正式资产。Pull 结束后上传录像与本地元数据，云端在 WCL Report 可用后导入标准事件并生成可按时间轴跳转的回放产物。
- 平台登录用户 ID 用于鉴权、团队归属和上传审计；CombatLog 中的角色 GUID 用于识别游戏角色和关联第一视角，不能替代平台身份。
- `reviewtool.gg` 作为产品体验参考，`aza547/wow-recorder` 作为客户端技术路线参考；复用前必须完成许可证和兼容性评估。
- 已用 REA 静态分析本机 ReviewTool.gg 1.0.14 发布包：Peek 播放器使用 WebRTC/WHEP 实时观看、HLS 历史回看；战斗时间通过报告/Pull 绝对起点及每路录像 `startTime/offset` 映射为视频秒数，并另行修正 HLS 首片 `deltaPTS`。前端为 Svelte 5／SvelteKit、Tailwind CSS、Bits UI，普通操作图标使用 Lucide；技能轨道使用 DOM 图片，按动态报告／配置的技能 ID 和图标字段加载 RPGLogs 图片，完整技能名单不能从安装包静态枚举。证据及边界见 `docs/research/reviewtool-timeline-seek.md`；未运行目标或验证其服务端存储与实际定位精度。
- 已核对 `wow-recorder` 主分支源码：其 Electron 客户端通过原生 `noobs` 模块直接封装 `libobs`，在 WoW 运行期间持续录制缓冲区，由 CombatLog 事件将缓冲区转换为单场录像，结束后用 FFmpeg 无重新编码剪切/重封装，再上传完整 MP4 和精简元数据。
- `wow-recorder` 不上传原始 CombatLog，也不提供完整战斗事件解析或边录边传；它只能作为录制缓冲、日志触发、快速剪切和预签名上传的实现参考，不能直接满足本项目的云端日志聚合与近实时复盘目标。
- 第一版实施顺序以 `docs/DEVELOPMENT_PLAN.md` 为准：先验证 Rust 后端通过 OBS Studio WebSocket 控制录制和 CombatLog 本地状态，再开发账号、可靠上传、云端解析与 Web 复盘；录制和双视角同步未通过前不扩展非核心功能。
- 当前已接入公共 WCL Report 的显式标准事件导入；私有用户 OAuth 与线上报告仍待配置和验收。团本排轴、STT 和 NSRT 不属于当前录制复盘核心。
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
- 直播、录像与时间轴架构记录在 `docs/LIVE_ARCHITECTURE.md`：OBS WHIP 发布到本机 MediaMTX，实时用 WHEP/WebRTC、历史用持续 fMP4 HLS，Media Chrome 提供统一控件。Rust 负责运行时、OBS、会话及受限信令／历史协议，React 负责媒体展示；禁用虚拟摄像头和截图轮询。直播与本地录像原子编排，导航不自动开播。
- 战斗边界和录像锚点以客户端只读监听的 CombatLog 为本地依据，完整标准事件以 Archon 最终生成的 WCL Report 为云端事实源，通过多事件锚点建立 `video_time_ms = scale * pull_time_ms + offset_ms` 映射。Wowhead 只用于技能、物品等链接的悬停 Tooltip，不参与战斗解析、事件事实、人物识别或视频定位；Tooltip 不可用时不得影响回放。
- 本地 Boss 录像采用 OBS 持续录像、CombatLog `ENCOUNTER_START/END` 定义边界、开战前 5 秒和结束后 5 秒裁切的方案；OBS 使用高级输出的手动文件分割，不因单场战斗启停编码器。业务游标、Pull、源文件和处理状态保存在版本化 `recording-index.json`，不使用 SQLite。
- 客户端随包携带固定版本 Windows x64 LGPL FFmpeg 运行时，Rust 使用参数数组调用 stream copy 裁切；每个 Pull 的目录和 MP4 使用“`YYYY-MM-DD HH-mm-ss - Boss - 难度 - 人物`”命名，目录内同时保存 Archon 风格 `metadata.json`、真实事件摘要 `combat-log.json` 与 `hls/`。最终成片严格解码校验后保留为正式本地资产，并继续无重新编码生成 CMAF/fMP4 HLS。受限 Tauri 本地协议通过内部 Pull ID 解析索引中的真实 HLS 路径，hls.js 1.7.2 挂载原生视频，Media Chrome 提供控制栏；缺失源区间在映射中标记 `hasGap`。
- 本地战斗时间轴以ENCOUNTER_START为0，到ENCOUNTER_END结束；索引v3从真实CombatLog区间保留施法、死亡、光环刷新／叠层、打断／驱散、蓄力生命周期／原始等级及复活，事件ID继续用原字节位置。光环／死亡／复活按受影响人物分类，施法／蓄力按施法者分类，来源和目标GUID不改。Archon/WCL标准字段不在本地伪造。媒体协议异步等待索引快照并在锁外读盘，正常索引竞争不得返回503冒充录像损坏。
- 回放最初缺口见 `docs/research/replay-gap-and-plan.md`，最新实现及验收入口为 `docs/plans/2026-10-17-reviewtool-parity.md`。本地实战导入、事件分页、资料覆盖、直播DVR和多人私有回放均有真实分层验证；线上WCL、真实游戏画面精度、硬件／发行安装与更广目标功能仍待补全，不能声称完全复刻。
- 录制代码按 `recording/capture/`、`recording/processing/`、`recording/events/` 拆分，根 mod.rs 仅声明模块；索引 v1 先备份再迁移 v2，旧缺片不补造区间。回放偏好由应用级 ReplayProvider 维持，经 Rust LocalStateStore 的 replay 区段保存，写盘失败不更新存储快照；媒体运行状态不持久化恢复。
- 当前保留原 `ffmpeg-runtime/bin` 负责裁切／HLS／解码，另将用户提供且校验过官方摘要的 2026-09-30 共享版 ffprobe 和完整 DLL 依赖隔离到 `ffmpeg-runtime/probe/bin`，禁止混用不同 libav ABI。原始 ZIP 不参与运行时加载；以后可换成同构建或独立静态 ffprobe 减少重复 DLL，作为独立资源任务验证。
- `game_data/` 管理技能资料与图标，现有随包 1029 项技能和 741 图片，支持 WCL masterData 导入。真实17场样本1036技能中1025有图，11项仍明确缺图，不能称全量正式服覆盖。技能资料只供展示，不改变日志事实。OBS 时钟可识别不连续，实战画面与日志仍有采集/UI延迟的不确定性，保留估算和微调。
- ReviewTool对照本机第二阶段入口为 `docs/plans/2026-10-17-reviewtool-parity.md`。本地外部录像导入只读原片，HLS/新旁车写应用目录；真多视角只按明确battleKey，不用近似Boss/时间归组。事件目录为摘要，选中后分页与追加续读。复盘工作台使用客户端统一主题，支持持久化图标/轨高/缩放/显示轨道覆盖，拖轨不改原始时间。
- 本机DVR保留WHEP实时源，新增持续fMP4 HLS和受限live-history协议；窗口以已发布分片为真值，PDT只在连续区段插值，歧义/缺口/淘汰时拒绝跳错画面。切源保留播放意图和声音参数，当前媒体连接和直播状态不持久化恢复。
- 云端已有FastAPI/PostgreSQL私有Multipart、任务／outbox／租约、Redis/Celery和HLS发布，客户端使用DPAPI凭证、恢复队列和受限媒体协议。真实服务在隔离临时实例验收，不能将其等同正式部署或WCL标准事件验收；只有用户显式启动才允许上传，不能在连接服务后自动外发历史录像。团队归组只认显式团队Pull或明确报告fight，成员各自日志零点需换算到共同战斗基准。
- 个人自定义显示轨道支持稳定UUID、改名／删除与来源技能覆盖；两端直接使用shared/replay/tracks.ts及config中的布局契约、名称与分轨规则。桌面保存在Rust replay偏好，Web按账号／团队隔离。用户已于2026-10-17授权的偏好表及第五版迁移已实现并通过隔离验证，显式保存可跨刷新恢复，失败／冲突及在途编辑保留草稿；未执行正式生产迁移，不再重复请求该授权。名称最多32个Unicode字符，拖轨不改事件；WCL人物按报告命名空间／actor区分，空GUID不合并同名人物，SELF仅显式绑定。
- Web混合不同规则分组禁止整体拖动，每个事件详情提供目标轨道选择供触屏／键盘，详情每页20项以限制控件规模。两端正式回放禁用Media Chrome的浏览器偏好，由各端领域状态恢复声音等媒体参数，不通过控件隐式绕过存储约定。
- 视频标注支持六种受限SVG图形及属性／移动／撤销／重做，按每路视频的归一化坐标与战斗时段保存。草稿在应用级Provider保留，显式保存经本地LocalStateStore replayAnnotations或团队API版本CAS；成员可读，本人上传者或leader/analyst可写。冲突保留草稿，文本只作字面节点，NUL统一拒绝。
- 独立web/入口已实现令牌验证／授权团队、目录／职业筛选、单路私有HLS、完整事件分页、保时切视角、共享微调、团队标注、公开WCL导入面板及授权时间点链接；令牌和网页草稿只驻留当前账号工作台内存，刷新后重新登录，不用localStorage。原始现场日志与录像不自动上传。
- WCL纯数据和官方链接解析直接位于shared/replay/reports.ts，表单／轮询限制在shared/replay/config.ts；两端无旧模型转发。Web显式report／fight／actor绑定由既有团队API及独立worker处理，面板关闭只停止观察，不取消任务；完整发布只刷新元数据，保留原视频和HLS连接，失败继续展示完整旧快照。用户WCL应用凭证只在服务端。
- 桌面与Web直接共用shared/replay纯数据／映射／事件／偏移／分组；shared/annotations根部是纯契约及限制，editor子目录是React/SVG编辑器与媒体几何，注入各端文档操作，不依赖Tauri／HTTP。迁移没有旧路径包装；共享React模块使用各端相同依赖实例。切视角／换版／重载重绑实际视频，画布裁切到内容范围，不进入控制栏。
- 正负校准偏移的前向目标和反向原视频必须留在同一原始拼接段；后端有效覆盖也按段物理边界限制，不能用另一段画面填补缺口。Web清单损坏后的重试会重新读媒体版本，并保留尚未播放的链接战斗时间。
- 团队共享人工偏移保存在既有Recording.manifest的sharedCalibration区段，原始映射及媒体事实不改，不新增表；上传者／leader／analyst写、成员读，编辑版本及发布版本双校验。播放器统一使用共享值加本机值，已过期的团队值和云端本机非零偏移不应用，保留供明确复核。本机绑定通过LocalStateStore replay.offsetVersions保存，本地录像旧偏好兼容；其他成员刷新读取后应用，尚无实时推送或多锚点自动漂移拟合。
- 直播与回放统一使用开源 `Media Chrome` React 控件框架，业务代码只维护原生视频、WebRTC 和 HLS 媒体源适配及能力组合，不自研播放控制栏。实时流只组合真实可用的播放、LIVE、画中画和全屏；存在音轨后再组合音量，HLS 回放才组合进度条、任意时间跳转和倍速。
- 根目录 `AGENTS.md` 已将模块化设为全项目强制规则：按业务域和共同变化关系组织目录，入口只做注册组合，禁止平铺多职责实现、单文件深目录、聚合转发包装和循环依赖；达到文件数、职责数或 500 行阈值时必须先评估拆分。
- 客户端默认窗口为 1440×900，最小尺寸为 1080×720，不默认全屏或最大化。OBS 设置页进入时自动检测安装状态，不显示安装目录；安装后下载卡片切换为状态检测。OBS 未连接时声音通道使用灰色空状态，连接后设备、音量和检测状态全部读取 OBS。
