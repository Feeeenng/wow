# 独立原生 OBS WHIP 验收（2026-10-17）

## 范围

本次真实启动现有 OBS Studio 32.2.1，使用 obs-websocket 5.7.4 控制 `whip_custom`，发布到独立 MediaMTX 1.18.2，通过真实 Edge 浏览器播放 WHEP 和 HLS，同时执行 OBS 原生本地录像、暂停、恢复、手动分片和停止。

唯一输入是本轮生成的 640×360、30fps 测试色条／正弦音频 MP4，经 `ffmpeg_source` 循环播放。编码使用软件 x264；WHIP 为 H.264／Opus，本地 MKV 为 H.264／AAC。没有启动游戏、捕捉屏幕或真实麦克风，没有用真实用户视频作输入，也不代表真实 WoW、1080p／硬件编码或发行安装矩阵已经验收。

这是 OBS 官方二进制和协议链路验收，未启动正式 Tauri 用户应用；没有绕过产品的 WoW 捕捉就绪保护去修改生产代码。

## 隔离措施

- 启动前确认没有 OBS／WoW 进程；TEMP 所在磁盘有约 40.6GB 空余，满足公共运行时副本和测试产物预算。
- 只复制现有 OBS 的 `bin`、`data`、`obs-plugins` 三个公共目录，合计 488588251 字节。没有读取、复制或改写源运行时的 `config`、用户账号配置或凭证。
- 在唯一 TEMP 目录预建独立 portable 标记、profile、scene 和随机认证 WebSocket；所有音频设备槽明确为空，first-run 标志避免默认设备创建。运行后 GetSpecialInputs 全部 null，GetInputList 只有 ffmpeg_source。
- MediaMTX 的 WHIP／WHEP、UDP／TCP 和 HLS 使用独立随机回环端口；浏览器用临时无账号上下文、无外部 ICE server。没有登录、下载升级、安装服务或修改正式应用配置。
- 对三个公共目录逐文件 SHA-256 校验：复制后摘要一致，验收后源目录摘要仍一致。WS 随机密码只存该独立临时配置，不写报告或命令行。
- 结束先通过 WebSocket 停止输出，再关闭自己的浏览器、媒体节点和 OBS；另外查询临时目录下的进程，确认无遗留。

官方便携和启动参数依据：[OBS 便携模式](https://obsproject.com/kb/portable-mode)、[启动参数](https://obsproject.com/kb/launch-parameters)。场景缺失音频槽不会创建音频源的行为按官方 32.2.1 源码核对：[场景集合实现](https://github.com/obsproject/obs-studio/blob/32.2.1/frontend/widgets/OBSBasic_SceneCollections.cpp)。控制协议依据：[obs-websocket 官方协议](https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md)。

## 可复现脚本

脚本为 `client/tests/native-obs-whip.cjs`，不修改生产代码或依赖。需要既有 OBS 便携目录、仓库已内置的 FFmpeg／ffprobe／MediaMTX，以及已安装的 Playwright Core 和 Edge：

```powershell
node client/tests/native-obs-whip.cjs --playwright 'C:/Users/Admin/AppData/Local/npm-cache/_npx/ad9a3fdbcad992c6/node_modules/playwright-core' --output "$env:TEMP/wow-obs-whip-独立新目录"
```

输出目录必须在系统 TEMP 且尚未存在；脚本拒绝覆盖已有现场。默认只从 `client/src-tauri/target/debug/obs` 复制上述三个公共子目录，可通过 `--obs` 指定另一份既有官方便携运行时。不会自动下载缺失程序。

## 实际结果

最终完整运行 **8 项通过、0 项失败，命令退出码 0**。证据目录为 `%TEMP%/wow-replay-phase2-20261017/native-obs-whip-complete`，其中 `report.json` 的 errors 为空、ownProcessesExited 和 originalRuntimeUnchanged 均为 true。运行时间为中国标准时间 2026-10-17 04:04:01～04:04:36，约 35 秒。

最终 WHEP 实际 codec 为 video/H264、audio/opus，接收 74 个音频包，抽样亮度差 203.75。两份实际本地分片分别为 18.047 秒和 3.306 秒，总计 21.353 秒；两份都通过完整 H.264／AAC 解码并保存 SHA-256。运行时 2112 个公共文件的摘要与源目录完全一致。

结束后 Win32 进程查询确认该独立目录进程数为 0，OBS／WoW／MediaMTX 进程数为 0。`node --check client/tests/native-obs-whip.cjs`、限定文件的 `git diff --check` 以及新增脚本／文档尾空白检查均退出 0。没有重新启动已结束的 PG／S3／Redis 验收服务。

最终八项覆盖如下：

| 用例 | 验证事实 |
|---|---|
| 独立版本与输入 | OBS 32.2.1、WebSocket 5.7.4、没有特殊设备、唯一 ffmpeg_source |
| WHIP 和同时录像 | OBS 自身 whip_custom 实际输出字节增长，StartRecord 同时处于 active |
| WHEP 解码 | 实际协商 video/H264 与 audio/opus，视频时钟增长，有音频 RTP 包，抽样亮度差排除黑画面；计算不含 alpha |
| HLS 回看 | 真实 HLS.js 播放 640×360；HLS 存档含 H.264／Opus 并完整解码 |
| PauseRecord／ResumeRecord | 暂停本地录像 2.2 秒期间 WHIP 字节继续增长，恢复后录像不再 paused |
| 节点断流与重建 | 终止自己的 MediaMTX 时本地录像仍增长；重建后 WHIP 与新 WHEP 会话恢复 |
| SplitRecordFile | 手动分片后至少两份真实文件，首片完整解码，直播和录像保持 active |
| 停止／再次直播与最终解码 | 停止直播保留录像，再次直播成功；最后逐片完整解码全部本地 MKV，确认 H.264／AAC |

OBS 手动分片后 StopRecord 响应可能仍返回首片路径，因此最终验证必须枚举独立录像目录，逐片解码；不能仅解码该响应中的文件。脚本已显式实现这个约束。

本轮的失败现场完整保留：首轮最后一步因 OBS 返回正斜杠路径、脚本采用 Windows 原始字符串前缀而误拒；修为规范路径和相对目录边界判断。加强验收时又观察到 WebSocket 已认证而 OBS 前端尚未初始化的 207，已增加有界 readiness 等待。它们不是插件不支持或登录失败，也没有据此修改生产应用。

尚未覆盖真实 WoW 进程／窗口捕捉、真实音频设备、长时间负载、NVENC／QSV／AMF、不同显卡／驱动、安装程序实际交互。当前历史 HLS 测试片长 2 秒，产品默认 4 秒及约十分钟窗口已有其他 MediaMTX 测试，不能把本轮短时样本等同长时窗口压力测试。
