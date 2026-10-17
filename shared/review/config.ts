/** 默认死亡前15秒；详情按页读取，不改变主时间轴事件规模。 */
export const DEATH_REVIEW_WINDOW_MS = 15_000;
export const DEATH_REVIEW_PAGE_SIZE = 250;
export const DEATH_REVIEW_MAX_ROWS = 5_000;
export const DEATH_REVIEW_MAX_PRIOR_AURAS = 2_000;
/** 客户端仅保留当前进程最近三份死亡快照，避免跨场累计内存。 */
export const DEATH_REVIEW_CACHE_SIZE = 3;
/** 明细展示每页25条，筛选基于已读取窗口，不改变来源事件。 */
export const DEATH_REVIEW_DISPLAY_PAGE_SIZE = 25;
