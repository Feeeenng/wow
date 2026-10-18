/** 书签采样间隔，避免每帧刷新应用状态和写磁盘。 */
export const REPLAY_CHECKPOINT_MS = 1_000;
/** 合并快速偏好修改后再由 Rust 持久化。 */
export const REPLAY_SAVE_DELAY_MS = 500;
/** 媒体加载与跳转等待上限，超时后允许用户重新加载。 */
export const REPLAY_SEEK_TIMEOUT_MS = 12_000;
/** 判断媒体 seek 是否到达目标的秒数容差，不表示日志同步精度。 */
export const REPLAY_SEEK_TOLERANCE_SECONDS = 0.1;
/** 跳转末端时保留一毫秒，避免定位到不存在的下一帧。 */
export const REPLAY_END_MARGIN_SECONDS = 0.001;
/** 视频帧回调向 React 回写游标的最短间隔。 */
export const REPLAY_PROGRESS_INTERVAL_MS = 50;
/** 技能回看默认保留事件前的上下文秒数。 */
export const REPLAY_EVENT_LEAD_SECONDS = 3;
/** 手动微调控件每次增减的毫秒数。 */
export const REPLAY_OFFSET_STEP_MS = 100;
/** 战斗时间轴方向键每次移动的秒数。 */
export const REPLAY_KEY_STEP_SECONDS = 1;
/** 死亡回看使用产品约定的前文秒数。 */
export const REPLAY_DEATH_LEAD_SECONDS = 15;
/** 每个批次补齐的图标数量，分批查询避免一次阻塞整个事件列表。 */
export const REPLAY_ICON_BATCH_SIZE = 256;
/** 团队目录单页仅取元数据，不预加载录像媒体。 */
export const CLOUD_REPLAY_PAGE_SIZE = 100;
/** 每秒至少占8px，让逐秒刻度可辨认，长战斗在时间轴内部横向滚动。 */
export const REPLAY_TIMELINE_SECOND_WIDTH = 8;
/** 时间标签至少间隔64px，随缩放选择整秒主刻度，避免文字重叠。 */
export const REPLAY_TIMELINE_LABEL_WIDTH = 64;
export const REPLAY_TIMELINE_LABEL_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];
