/// Boss 战开始前保留的录像毫秒数。
pub const PRE_ROLL_MS: i64 = 5_000;
/// Boss 战结束后保留的录像毫秒数。
pub const POST_ROLL_MS: i64 = 5_000;
/// CombatLog 与录像任务轮询间隔。
pub const MONITOR_INTERVAL_MS: u64 = 500;
/// 无 Boss 触发时 OBS 单个源文件的最大持续时间。
pub const SOURCE_ROTATION_SECONDS: u64 = 60 * 60;
/// 忽略 OBS 重启或输出模式切换时产生的无音视频流容器头文件。
pub const MIN_SOURCE_FILE_BYTES: u64 = 4 * 1024;
/// 单个 FFmpeg 调用的最长执行时间，超时后终止以释放后续 Pull 队列。
pub const FFMPEG_TIMEOUT_SECONDS: u64 = 5 * 60;
/// 本地回放 HLS 分片目标时长，实际边界由关键帧决定。
pub const HLS_SEGMENT_SECONDS: u64 = 4;
/// 单次媒体包探测的超时秒数，避免阻塞录制处理队列。
pub const MEDIA_PROBE_TIMEOUT_SECONDS: u64 = 30;
/// 探测每个源位置的起始视频包数量，仅用于定位裁切首帧。
pub const MEDIA_PROBE_PACKET_LIMIT: u32 = 128;
/// 限制探测 JSON 体积，防止异常输入占满内存或磁盘。
pub const MEDIA_PROBE_MAX_BYTES: u64 = 2 * 1024 * 1024;
/// 探测运行时相对于 FFmpeg 资源根目录的路径，隔离不同构建的共享库。
pub const MEDIA_PROBE_RELATIVE_PATH: &str = "probe/bin/ffprobe.exe";
/// 媒体探测进程状态轮询间隔。
pub const MEDIA_PROBE_POLL_INTERVAL_MS: u64 = 50;
/// UI／旁车诊断中保留的媒体错误字符上限。
pub const MEDIA_PROBE_ERROR_CHAR_LIMIT: usize = 500;
/// 正常录制时的时钟采样间隔，新源文件出现时立即采样。
pub const CLOCK_SAMPLE_INTERVAL_MS: u64 = 5_000;
/// 墙钟／输出进度与单调时钟差值超过此阈值时标记不连续。
pub const CLOCK_DISCONTINUITY_MS: u64 = 250;
/// 录制索引保留的最近诊断数量，避免历史日志缺失时轮询无限累积。
pub const MAX_DIAGNOSTICS: usize = 100;
/// 单页关键事件上限，限制每次 IPC 的序列化体积。
pub const REPLAY_EVENT_PAGE_LIMIT: usize = 1_000;
/// 外部原片只做有界解码预检，避免导入大量录像时重复完整解码。
pub const IMPORT_VALIDATION_SECONDS: u64 = 3;
/// 仅保留最近选中的三场排序及前缀摘要，限制大事件索引的额外内存。
pub const REPLAY_EVENT_QUERY_CACHE_SIZE: usize = 3;
/// 时间轴外观默认值及允许范围，仅影响复盘显示和持久偏好。
pub const REPLAY_TRACK_HEIGHT_DEFAULT: u32 = 30;
pub const REPLAY_TRACK_HEIGHT_RANGE: std::ops::RangeInclusive<u32> = 20..=50;
pub const REPLAY_ICON_PERCENT_DEFAULT: u32 = 80;
pub const REPLAY_ICON_PERCENT_RANGE: std::ops::RangeInclusive<u32> = 50..=100;
pub const REPLAY_TIMELINE_ZOOM_DEFAULT: f64 = 1.0;
/// 客户端缩放不再限定4倍；可见窗口按日志毫秒精度限制，持久化只拒绝非法数值。
pub const REPLAY_TIMELINE_ZOOM_MIN: f64 = 1.0;
/// 技能显示轨道覆盖上限，避免异常偏好无限增长。
pub const REPLAY_TRACK_OVERRIDE_LIMIT: usize = 1_024;
pub const REPLAY_TRACK_OVERRIDE_KEY_LIMIT: usize = 160;
/// 个人显示轨道边界，不修改日志或云端团队布局。
pub const REPLAY_CUSTOM_TRACK_LIMIT: usize = 8;
pub const REPLAY_CUSTOM_TRACK_NAME_MAX: usize = 32;
pub const REPLAY_CUSTOM_TRACK_ID_PREFIX: &str = "custom-";
/// 死亡明细按需读取，限制单个窗口、窗口前光环、缓存和单页的额外内存。
pub const DEATH_REVIEW_WINDOW_MS: i64 = 15_000;
pub const DEATH_REVIEW_MAX_ROWS: usize = 5_000;
pub const DEATH_REVIEW_MAX_PRIOR_AURAS: usize = 2_000;
pub const DEATH_REVIEW_CACHE_SIZE: usize = 3;
pub const DEATH_REVIEW_PAGE_LIMIT: usize = 1_000;
pub const DEATH_REVIEW_PAGE_DEFAULT: usize = 250;
pub const DEATH_REVIEW_CURSOR_MAX_BYTES: usize = 256;
/// 明细只支持已核对的22版高级日志，不按尾部长度猜测其他版本。
pub const DEATH_REVIEW_LOG_VERSION: &str = "22";
