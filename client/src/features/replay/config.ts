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
/** 默认每秒占64px，逐秒文字和技能留足距离，长战斗通过平移浏览。 */
export const REPLAY_TIMELINE_SECOND_WIDTH = 64;
/** 固定技能轴的最小图标、行高及同排间距，不受旧紧凑外观偏好影响。 */
export const REPLAY_TIMELINE_ICON_SIZE = 30;
export const REPLAY_TIMELINE_LANE_HEIGHT = 52;
export const REPLAY_TIMELINE_MARKER_GAP = 12;
/** 时间标签至少间隔64px，随缩放选择整秒主刻度，避免文字重叠。 */
export const REPLAY_TIMELINE_LABEL_WIDTH = 64;
/** 带毫秒的末端标签更长，预留80px避免与相邻整秒标签重叠。 */
export const REPLAY_TIMELINE_EDGE_LABEL_WIDTH = 80;
export const REPLAY_TIMELINE_LABEL_STEPS = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];
/** 缩放按比例连续变化，最细窗口对应日志的1毫秒精度，不再限制为4倍。 */
export const REPLAY_TIMELINE_ZOOM_FACTOR = 1.25;
export const REPLAY_TIMELINE_MIN_WINDOW_SECONDS = 0.001;
/** 时间轴左侧标签列88px与12px间隙，仅用于计算可用绘图区。 */
export const REPLAY_TIMELINE_LABEL_GUTTER = 100;
/** 滚轮缩放灵敏度；普通滚轮平移，Ctrl／触控板捏合以鼠标位置为锚点缩放。 */
export const REPLAY_TIMELINE_WHEEL_SCALE = 0.002;
/** Boss名称最多占120px；图标边缘预留4px，防止计数和文字撑出可见窗口。 */
export const REPLAY_BOSS_LABEL_MAX_WIDTH = 120;
export const REPLAY_MARKER_EDGE_MARGIN = 4;
