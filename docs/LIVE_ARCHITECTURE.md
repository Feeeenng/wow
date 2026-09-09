# 直播、录像与战斗时间轴架构

## 1. 当前唯一技术路线

当前阶段只实现本机个人视角直播，不依赖云端服务：

```text
OBS WoW Recorder 场景
  -> WHIP/WebRTC 发布
  -> 本机 MediaMTX
  -> WHEP/WebRTC 播放
  -> React HTMLVideoElement
  -> Media Chrome 控件

OBS 本地录像
  -> CombatLog Pull 边界生成本地 MP4 与 CMAF/fMP4 HLS
  -> 后续可靠上传和云端 HLS
  -> hls.js 历史回放
```

本机与未来云端使用相同的 WHIP、WHEP、WebRTC 和播放器边界。迁移云端时只替换媒体节点与会话凭证，不更换 OBS 发布协议或 React 播放组件。

不保留虚拟摄像头、截图轮询和自研播放器控制栏等替代路线。本机 HLS 仅用于历史回放，不参与直播。

## 2. 职责边界

### 2.1 Rust

- 安装、校验、启动和关闭本机 MediaMTX。
- 通过 OBS WebSocket 配置 `whip_custom` 并启停 Streaming。
- 将直播与 OBS 本地录像作为同一会话编排，失败时回滚。
- 代理 WHEP HTTP 信令，保存并释放 WHEP 资源。
- 保证 React 不直接读取媒体服务地址、进程路径或后续云端凭证。

### 2.2 React

- 创建只接收音频和视频的原生 `RTCPeerConnection`。
- 将 SDP Offer 交给 Rust，并应用 Rust 返回的 SDP Answer。
- 将远端 `MediaStream` 挂载到原生 `<video>`。
- 使用 Media Chrome 组合真实可用的播放器控件。

React 不下载或启动媒体组件，不直接连接 OBS，也不承担 WHIP 发布。

### 2.3 MediaMTX

MediaMTX 仅作为本机 WebRTC 媒体节点，接收 OBS WHIP 发布并提供 WHEP 订阅。它不承担业务状态、用户权限、录像文件管理或界面逻辑。

## 3. 本机媒体运行时

客户端固定使用 MediaMTX `1.18.2` Windows x64 官方发布包：

- `mediamtx.exe`、原始许可证和组件说明直接随 NSIS 安装包内置，用户不需要额外下载。
- 无参数打包脚本在构建前校验内置可执行文件的固定 SHA-256，校验失败时拒绝生成安装包。
- Rust 从 Tauri 资源目录定位只读可执行文件，可写运行配置保存到应用本地数据目录。
- 运行配置由 Rust 每次生成，不使用发布包默认配置。
- 直播会话存在期间由 Rust 每 2 秒守护，进程异常退出后自动重启。
- 客户端退出时关闭由自身启动的 MediaMTX 进程。

运行时只启用 WebRTC，并绑定本机回环地址：

| 能力 | 地址 |
| --- | --- |
| WHIP 发布 | `http://127.0.0.1:18889/wow-recorder/whip` |
| WHEP 播放 | `http://127.0.0.1:18889/wow-recorder/whep` |
| WebRTC 媒体 | `127.0.0.1:18189/UDP` |

RTSP、RTMP、HLS、SRT、API、Metrics、pprof 和远程网卡候选全部关闭。当前不需要 STUN、TURN 或 Bearer Token。

HTTP 只承载本机 WHIP/WHEP 信令；WebRTC 音视频本身仍通过 DTLS-SRTP 加密。监听地址不允许外部设备访问。

## 4. 开始直播

用户在 OBS 设置中点击“开始直播”后，Rust 按以下顺序执行：

1. 校验 OBS 已连接、`WoW Recorder` 场景完整且真实检测到 WoW 窗口。
2. 定位安装包内置的本机媒体运行时，缺失时提示重新安装客户端。
3. 启动 MediaMTX，并等待本机 WHIP/WHEP HTTP 端点就绪。
4. 通过 OBS WebSocket `SetStreamServiceSettings` 配置本机 `whip_custom` 地址。
5. 校准简单和高级输出模式的直播音频编码器为 Opus；首次修正旧配置时由 Rust 重启一次空闲的受管 OBS，使编码器立即生效，录像音频编码器保持用户原有配置。
6. 如果当前没有录像，启动 OBS 本地录像并记录录像归属。
7. 启动 OBS Streaming，并等待 `GetStreamStatus` 确认 WHIP 输出已运行。
8. 创建客户端拥有的直播会话。

任一步失败都停止本会话新启动的 Streaming 和录像，不返回虚假的直播状态。

本机 MediaMTX 的 WebRTC 建轨等待时间为 15 秒。该窗口只用于等待 OBS 首批音视频轨道，不改变正常直播延迟；不能使用默认 2 秒，否则 OBS 编码器尚未输出首批数据时媒体节点会提前关闭 WHIP 会话。媒体节点优先使用回环 UDP，并在 `127.0.0.1:18190` 提供 TCP ICE 备用通道，兼容本机 WebView2 无法建立 UDP 候选连接的环境。直播音频统一使用 Opus，录像音频仍使用 OBS 原有录像配置；OBS 全局桌面音频和麦克风输入会在初始化时移除，直播与录像只使用 `WoW Recorder` 场景中的“扬声器”和“麦克风”，避免同一设备被重复采集。播放器默认静音自动播放，用户可在控制栏恢复声音。

快速重复点击由 Rust 串行锁保护，不允许并发启动或停止同一直播会话。

## 5. WHEP 本机播放

1. 直播页只读取已经存在的直播会话，不因进入页面自动开播。
2. React 创建 `RTCPeerConnection`，添加音频和视频 `recvonly` Transceiver。
3. React 完成非 Trickle ICE 收集，将 SDP Offer 通过 Tauri command 交给 Rust。
4. Rust 向本机 WHEP 端点发送 `application/sdp` 请求。
5. OBS 轨道尚未到达时，Rust 在有限时间内重试单次 WHEP 请求；若仍返回 `404`、`409` 或 `503`，React 在当前直播会话有效期间按有上限的退避重新创建 `RTCPeerConnection`、ICE 候选和 SDP，避免重复开播时永久停留在错误状态。
6. Rust 校验 `201 Created`、`Location` 和 SDP Answer 后返回本地播放标识。
7. React 应用远端 SDP，将媒体轨挂载到 Media Chrome 管理的 `<video>`。
8. 直播页在应用生命周期内常驻；一级页面切换只隐藏页面，保持当前 WHEP 和 `RTCPeerConnection`，隐藏期间临时静音但继续接收和解码。
9. 停止直播、直播会话切换或客户端退出时，Rust 释放对应 WHEP 资源。

只有收到真实音轨后才显示静音和音量控件。直播没有可回放区间，因此不显示录像进度条或倍速。

## 6. 停止与退出

停止直播只允许操作当前客户端拥有的会话：

1. 释放当前客户端创建的全部 WHEP 资源。
2. 停止 OBS Streaming。
3. 只有本会话启动了录像时才停止录像，不误停原有录制任务。
4. Streaming 和录像都确认停止后再清除直播会话。

MediaMTX 在客户端存活期间保持运行，方便再次开播；客户端退出时先关闭受管 OBS，再关闭受管 MediaMTX。

## 7. 本地录像与历史回放

客户端由 OBS 持续生成本地高质量源录像，Rust 根据 CombatLog 的 `ENCOUNTER_START/END` 定义战斗边界，截取开战前 5 秒至结束后 5 秒，并调用内置 FFmpeg 以 stream copy 方式生成最终 MP4。每个 Pull 使用“`YYYY-MM-DD HH-mm-ss - Boss - 难度 - 人物`”命名的独立目录，MP4 使用相同基础名称；目录内同时包含 `metadata.json`、`combat-log.json` 和 `hls/`。最终 MP4 继续作为后续上传及断网补传的正式视频资产。

为保持本地与未来云端回放的媒体分层一致，客户端同时从最终 MP4 无重新编码生成 CMAF/fMP4 HLS。Rust 的受限本地协议只提供应用录像目录中的播放清单和分片，hls.js 将媒体挂载到原生视频元素，Media Chrome 提供播放控件。未来迁移云端后只替换 HLS 地址和授权方式，不改变播放器组件与时间轴接口。

## 8. 战斗时间轴

客户端为每个本地 Pull 保存：

- 会话 ID、成员和角色 GUID。
- UTC Unix 毫秒与 Rust 单调时钟原点。
- OBS Streaming 与本地录像开始、结束边界。
- CombatLog 文件标识、字节区间、人物身份，以及从该区间解析出的 Boss 与本机玩家施法事件。

本地时间轴以 `ENCOUNTER_START` 为 `0ms`，只展示到 `ENCOUNTER_END`。视频中的开战位置由 `startTimeOffsetMs`/`videoZeroMs` 表示，因此时间轴点击使用 `video_time_ms = pull_time_ms + videoZeroMs` 定位；前后 5 秒画面保留在视频中，但不扩展战斗时间轴。

云端以 Pull 开始为零点，为每个成员保存：

```text
video_time_ms = scale * pull_time_ms + offset_ms
```

点击 CombatLog 或 WCL 事件时，业务层计算 `video_time_ms`，设置原生视频元素 `currentTime`。hls.js 负责加载对应分片，播放器框架不推断战斗时间。

## 9. 未来云端迁移

云端阶段增加控制面、媒体节点、TURN、短期凭证和云端录像，但不改变客户端媒体分层：

```text
当前：OBS -> 本机 WHIP -> 本机 MediaMTX -> 本机 WHEP -> 播放器
未来：OBS -> 云端 WHIP -> 云端媒体节点 -> 云端 WHEP -> 同一播放器
```

普通模式只订阅当前选择的一路成员画面；指挥视角最多四路，不预订阅全部团员。

## 10. 当前验收标准

- 未配置任何云端环境变量时可以开始本机直播。
- 安装客户端后无需联网即可启动内置 MediaMTX。
- OBS WHIP Streaming 与本地录像同时启动，任一启动失败时正确回滚。
- 直播页通过 WHEP/WebRTC 显示 OBS 的真实音视频画面。
- 直播重复启停时，WHEP 路径短暂返回 `404`、`409` 或 `503` 不进入永久错误状态，并在新发布轨道就绪后自动恢复。
- 一级页面切换后返回直播不重新建立 WHEP；停止直播和客户端退出不会遗留 WHEP 资源。
- 停止直播不会误停用户在直播前已经开始的录像。
- 客户端退出后受管 OBS 和 MediaMTX 都被关闭。
