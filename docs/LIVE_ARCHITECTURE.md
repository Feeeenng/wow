# 直播、录像与战斗时间轴架构

## 1. 唯一技术路线

直播、桌面播放、网页播放和录像回放使用同一套媒体标识与时间模型，不保留本地虚拟摄像头、截图轮询或本机 HLS 等替代链路。

```text
OBS WoW Recorder 场景
  -> WHIP/WebRTC 发布
  -> 云端媒体服务
       -> WHEP/WebRTC 实时播放
       -> 云端分片录像

OBS 本地录像
  -> Pull 结束后可靠上传
  -> CMAF/fMP4 HLS
  -> hls.js 历史回放
```

- Rust 负责直播会话、OBS WebSocket、WHIP 发布配置、WHEP HTTP 信令、凭证和本地录像。
- React 只创建浏览器原生 `RTCPeerConnection`、挂载远端 `MediaStream` 并组合播放器界面。
- Media Chrome 统一提供直播与回放控件，不承担媒体传输或解码。
- hls.js 只用于 CMAF/fMP4 HLS 录像回放，不参与低延迟直播。

## 2. 直播发布

用户在 OBS 设置中点击“开始直播”后，Rust 按以下顺序执行：

1. 校验 OBS 已连接、`WoW Recorder` 场景完整且真实检测到 WoW 窗口。
2. 获取短期 WHIP/WHEP 接入信息；当前客户端集成阶段由部署环境注入，正式环境改为 FastAPI 控制面签发。
3. 通过 OBS WebSocket `SetStreamServiceSettings` 配置 `whip_custom`，只在 Rust 内保存 WHIP 地址和 Bearer Token。
4. 如果当前没有录像，启动 OBS 本地录像并记录录像归属。
5. 通过 OBS WebSocket `StartStream` 启动 WHIP 输出，并等待 `GetStreamStatus` 确认已运行。
6. 任一步失败都回滚本会话新启动的录像和直播输出。

停止直播只允许操作当前客户端拥有的会话。Rust 先释放 WHEP 播放资源，再停止 OBS Streaming；只有本会话启动了录像时才停止录像，不误停用户原有录制任务。

## 3. WHEP 实时播放

桌面端和网页端使用同一套 WHEP 播放流程：

1. React 创建只接收音频和视频的 `RTCPeerConnection`。
2. 浏览器生成 SDP Offer 并完成 ICE 候选收集。
3. Offer 通过 Tauri command 交给 Rust；React 不读取 WHEP 地址或 Bearer Token。
4. Rust 向 WHEP 端点发送 `application/sdp` 请求，校验 `201 Created`、`Location` 和 SDP Answer。
5. React 设置远端 SDP，将远端 `MediaStream` 挂载到 Media Chrome 管理的原生 `<video>`。
6. 页面离开、视角切换或直播停止时，Rust 请求 WHEP `Location` 资源完成释放。

普通模式只建立当前成员的一路连接；切换成员时先释放旧连接。后续指挥视角最多并行四路，不预订阅全部团员。

### 3.1 当前接入配置

在 FastAPI 直播控制面落地前，开发和部署环境通过以下配置向 Rust 注入媒体服务接入信息：

| 配置项 | 用途 |
| --- | --- |
| `WOW_RECORDER_LIVE_WHIP_URL` | OBS 发布地址 |
| `WOW_RECORDER_LIVE_WHEP_URL` | 当前成员播放地址 |
| `WOW_RECORDER_LIVE_BEARER_TOKEN` | 可选短期发布/播放令牌 |
| `WOW_RECORDER_LIVE_ICE_SERVERS` | 逗号分隔的 STUN/TURN 地址 |
| `WOW_RECORDER_LIVE_ICE_USERNAME` | 可选 TURN 用户名 |
| `WOW_RECORDER_LIVE_ICE_CREDENTIAL` | 可选 TURN 短期凭证 |

这些值不进入 React 本地存储，也不展示在用户界面。正式环境必须由 FastAPI 根据登录用户、团队和成员签发短期会话，不能依赖长期静态令牌。

## 4. 播放器分层

```text
LiveMediaPlayer / ReplayMediaPlayer
  -> Media Chrome 控件
  -> HTMLVideoElement
       -> WHEP RTCPeerConnection（直播）
       -> hls.js（回放）
```

实时流提供播放、LIVE、真实音轨音量、画中画和全屏。进度条、任意时间跳转和倍速只在 HLS 回放中启用。播放器框架不维护业务时间，成员切换和战斗事件跳转由页面上层传入统一 Pull 时间。

## 5. 直播录像

直播开始时同时保留两类资产：

1. OBS 本地高质量录像，用于断网补传和正式高质量资产。
2. 云端媒体服务分片录像，用于快速生成回放和覆盖客户端上传前的等待时间。

直播结束后媒体任务将有效区间重封装为 CMAF/fMP4 HLS，并保存到私有 MinIO/S3。PostgreSQL 只保存会话、成员、对象键、覆盖区间、时间映射和处理状态，不保存视频二进制。

本地录像和云端录像分别记录来源及缺失区间，不静默拼接时间戳不连续的内容。

## 6. 统一时间模型

客户端为每个直播会话保存：

- 会话 ID、成员和角色 GUID。
- UTC Unix 毫秒与 Rust 单调时钟原点。
- OBS Streaming 与本地录像开始、结束边界。
- CombatLog 文件标识、读取位置和 `ENCOUNTER_START`、`ENCOUNTER_END` 等锚点。

云端以 Pull 开始为零点，为每个成员保存独立映射：

```text
video_time_ms = scale * pull_time_ms + offset_ms
```

`offset_ms` 修正开始差异，`scale` 修正长时间录制时钟漂移。映射由多个共同事件拟合，并保存锚点数量、误差与可信度。

## 7. HLS 回放与战斗时间轴

历史录像统一使用 CMAF/fMP4 HLS 和 hls.js。点击 CombatLog 或 WCL 事件时：

1. 服务端将事件归一化为 `pull_time_ms`。
2. 页面根据当前成员映射计算 `video_time_ms`。
3. 设置原生视频元素 `currentTime = video_time_ms / 1000`。
4. hls.js 加载对应分片，Media Chrome 同步更新进度和播放状态。

切换成员时保留 `pull_time_ms`，再计算新成员的目标秒数。跳转精度主要由时间映射、关键帧间隔和 HLS 分片长度决定；建议关键帧与分片控制在约 1 至 2 秒，并通过真实团本样本确定最终值。

WCL API v2 GraphQL 由服务端适配，浏览器不直接持有 OAuth 凭证。Wowhead 没有受支持的通用公开数据 API，仅在取得稳定授权接口后用于元数据补充，不作为事件事实或视频定位来源。

## 8. 安全与错误边界

- WHIP/WHEP 地址和 Bearer Token 由 Rust 或 FastAPI 控制面管理，不写入浏览器存储。
- TURN 凭证必须短期有效，并限制到当前成员和会话。
- WHEP 信令限制 SDP 大小与请求超时，页面退出后必须释放远端资源。
- OBS 已存在非本客户端拥有的 Streaming 输出时拒绝覆盖或停止。
- 没有媒体服务配置时明确提示“直播服务尚未配置”，不回退到本地伪直播。
- 云端播放失败不影响 OBS 本地录像；网络恢复后由上传队列补交录像。

## 9. 当前实现与后续工作

客户端当前已经实现：

- Rust 配置并启停 OBS `whip_custom` Streaming。
- WHIP 发布与 OBS 本地录像原子编排。
- Rust WHEP SDP 信令和播放资源释放。
- React `RTCPeerConnection` 接收远端音视频。
- Media Chrome 直播播放器控件。
- 客户端不再内置 FFmpeg；OBS 直接负责直播发布和本地录像，后续录像转码与切片由云端媒体任务负责。

尚未实现的端云能力：

- FastAPI 登录、团队权限和短期直播会话签发。
- 媒体服务、TURN 和云端分片录像部署。
- 成员直播目录和最多四路的指挥视角。
- hls.js 回放组件、对象存储、WCL 任务和跨成员时间映射。

## 10. 验收标准

- 两名客户端可以使用独立会话同时 WHIP 发布，并按选择只播放一路 WHEP 画面。
- 开始直播后 OBS 本地录像与云端录像同时存在。
- 页面切换和停止直播不会遗留 WHEP 资源。
- 断网期间本地录像不中断，恢复后能够补传。
- 同一战斗事件可以映射并跳转到不同成员录像的对应画面。
- 切换成员后保持相同 `pull_time_ms`，缺失区间和低可信度同步必须明确提示。
