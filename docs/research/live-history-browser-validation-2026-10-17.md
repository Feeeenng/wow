# 直播回看与 RTC 故障边界验证

日期：2026-10-17，时区：Asia/Shanghai。

## 修复范围

直播会话存在时，WebRTC 连接失败不再卸载整个播放器。实时错误由 LiveMediaPlayer 局部显示，历史清单、时间轴和 HLS 能力继续保留；用户可直接回看或显式重试直播。重试仅重建当前 WHEP 媒体实例，旧实例继续走原有资源释放路径，保持音量和播放意图。

人物卡片只读 Tooltip 增加不接收指针事件的样式，避免遮挡相邻视角。事件详情 Popover 保持可交互。该处由独立原生云端验收去除移鼠标绕行后验证普通直接点击，未使用 force。

## 实际验证

- `npm run build`：退出码 0，TypeScript 和 Vite 成功，仍有现有大于 500kB 的 chunk 提示。
- `node tests/browser-live-history.cjs --fixture <合成媒体目录> --output <RTC恢复证据目录> --playwright <本机既有playwright-core>`：画笔 Provider／覆盖层整合后对 `index-CcoSgOm5.js` 再次回归，退出码 0，14 项通过，页面异常为 0；本次没有重新构建或改写产物。
- `npm run test:replay`：退出码 0，30 项通过、0 失败、0 跳过，包含直播窗口、媒体 PTS 定位和会话隔离纯逻辑测试。
- `git diff --check` 对两个直播组件、人物卡 Tooltip 和浏览器脚本执行：退出码 0，仅有现有换行提示。

测试启动独立本机 MediaMTX，以 FFmpeg 发布合成 H.264/Opus，真实使用 WebRTC、HLS.js 及逐渐滚动的历史清单。新增两项通过真实 DELETE 当前 MediaMTX WHEP 会话使浏览器 RTC 断开：一次确认历史控件仍可使用，HLS 解码并实际推进播放；一次确认点击重试可恢复 LIVE，历史窗口继续保留。没有伪造连接失败事件，也没有替换真实媒体播放器。

其余十二项覆盖首帧、暂停切历史的音量、返回 LIVE 的暂停与倍速、切页静音和连接复用、窗口过期、重复同一事件定位、首帧前快速双次定位、末端处理、已结束战斗选择、停止后本地书签续接、会话隔离和停止清理。最终创建及释放 WHEP 均为 8 次；本地续接书签为 3013ms。

最新证据目录 `%TEMP%/wow-replay-phase2-20261017/live-browser-final-annotations` 包含 `report.json`、`rtc-recovered.png`、`event-history.png` 和 `expired-history.png`，结果仍为创建／释放 WHEP 8／8 次、本地续接书签 3013ms。已查看此前恢复后的画面截图。人物 Tooltip 的独立原生证据位于 `%TEMP%/wow-replay-phase2-20261017/native-cloud`，由对应验收记录说明。

## 边界

媒体节点和浏览器是真实运行，Tauri IPC 是转接本机节点的测试适配，战斗事件和归档录像使用合成夹具。这覆盖前端故障隔离与媒体行为，不替代真实 OBS WHIP、真实游戏画面同步、网络硬件和正式部署验收。未上传用户日志或录像。
