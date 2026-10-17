/** 技能标记大小与最小间隔，用于同一位置事件分组。 */
export const REPLAY_ICON_SIZE = 24;
export const REPLAY_ICON_GAP = 3;
/** 仅标准事件面板打开且任务运行时轮询，不遍历团队历史。 */
export const WCL_REPORT_POLL_MS = 2_000;
/** 报告输入和GraphQL Int场次编号边界，供两端关联表单使用。 */
export const WCL_REPORT_REFERENCE_MAX_CHARS = 2_048;
export const WCL_FIGHT_ID_MAX = 2_147_483_647;
/** 时间轴外观及个人轨道边界，与桌面Rust持久化契约一致。 */
export const REPLAY_TRACK_HEIGHT = 30;
export const REPLAY_ICON_PERCENT = 80;
export const REPLAY_TIMELINE_ZOOM = 1;
export const REPLAY_TRACK_HEIGHT_MIN = 20;
export const REPLAY_TRACK_HEIGHT_MAX = 50;
export const REPLAY_ICON_PERCENT_MIN = 50;
export const REPLAY_ICON_PERCENT_MAX = 100;
export const REPLAY_TIMELINE_ZOOM_MAX = 4;
export const REPLAY_CUSTOM_TRACK_LIMIT = 8;
export const REPLAY_CUSTOM_TRACK_NAME_MAX = 32;
/** 输入框按UTF-16计数，允许32个非BMP字符，提交仍按Unicode字符数校验。 */
export const REPLAY_CUSTOM_TRACK_INPUT_MAX_CHARS = REPLAY_CUSTOM_TRACK_NAME_MAX * 2;
export const REPLAY_CUSTOM_TRACK_ID_PREFIX = "custom-";
/** 拖拽只携带当前显示规则键，不接受原事件或时间值。 */
export const REPLAY_TRACK_DRAG_TYPE = "application/x-wow-replay-track";
/** 时间轴密集分组每页20项，限制详情控件数量，后续页仍可逐事件定位及移轨。 */
export const REPLAY_EVENT_DETAILS_PAGE_SIZE = 20;
