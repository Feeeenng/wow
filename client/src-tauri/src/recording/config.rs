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
