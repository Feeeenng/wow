/** 历史窗口和活动战斗状态轮询间隔，不按视频帧请求 Rust。 */
export const HISTORY_REFRESH_MS = 1_000;
/** 靠近直播末端时恢复 WebRTC 的阈值，与历史分片可用边缘分开计算。 */
export const HISTORY_LIVE_EDGE_MS = 8_000;
/** 媒体切换等待上限，避免无反馈停在过渡画面。 */
export const HISTORY_LOAD_TIMEOUT_MS = 15_000;
/** HLS 分片时间差的容差，仅处理毫秒舍入，不覆盖真实断流缺口。 */
export const HISTORY_CONTINUITY_TOLERANCE_MS = 2;
/** 历史播放缓冲只保留当前定位附近内容，完整窗口由媒体节点负责。 */
export const HISTORY_BACK_BUFFER_SECONDS = 30;
export const HISTORY_FORWARD_BUFFER_SECONDS = 12;
export const HISTORY_MAX_BUFFER_SECONDS = 32;
