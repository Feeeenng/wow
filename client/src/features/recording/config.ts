/** 录像目录及选中战斗事件的刷新间隔。 */
export const RECORDING_REFRESH_INTERVAL_MS = 2_000;
/** 每页事件与 Rust 上限一致，避免一次 IPC 携带整场日志。 */
export const REPLAY_EVENT_PAGE_SIZE = 1_000;
