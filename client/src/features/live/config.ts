/** 等待浏览器收集完整 ICE 候选的最长时间。 */
export const ICE_GATHERING_TIMEOUT_MS = 10_000;

/** WHEP 发布路径暂未就绪时，播放器首次重新建连的等待时间。 */
export const WHEP_RECONNECT_INITIAL_DELAY_MS = 500;

/** 限制 WHEP 重连退避上限，避免长时间无画面时高频请求。 */
export const WHEP_RECONNECT_MAX_DELAY_MS = 4_000;
