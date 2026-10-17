/// 导入偏好只保存用户选择的目录和日志路径，不恢复运行任务。
pub const PREFERENCES_SECTION: &str = "replayImport";
/// 限制一次导入的日志文件数量，避免误选整个磁盘。
pub const MAX_LOG_FILES: usize = 16;
/// 限制单层录像目录内可处理的旁车数量。
pub const MAX_RECORDINGS: usize = 1_000;
/// 单个外部旁车大小上限，不读取未知大文件。
pub const MAX_METADATA_BYTES: u64 = 2 * 1024 * 1024;
/// 进度每读取约一兆字节更新一次，不逐行发送状态。
pub const PROGRESS_BYTES: u64 = 1024 * 1024;
/// 只保留少量可定位问题的摘要，避免大批失败撑大 IPC。
pub const MAX_ISSUES: usize = 20;
