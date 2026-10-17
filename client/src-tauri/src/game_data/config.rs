/// 已知图标的可信下载源；元数据不得指定任意网络地址。
pub const ICON_ORIGIN: &str = "https://assets.rpglogs.com/img/warcraft/abilities/";
/// 前端只消费受限本地图片协议。
pub const ICON_LOCAL_ORIGIN: &str = "http://spell-icon.localhost";
/// 图片下载超时，图标不可用不阻塞视频播放。
pub const ICON_TIMEOUT_SECONDS: u64 = 5;
/// 单张小图最大长度，限制下载和内存占用。
pub const ICON_MAX_BYTES: usize = 256 * 1024;
/// 同时补齐的图标数量，避免大量事件造成连接风暴。
pub const ICON_CONCURRENCY: usize = 4;
/// 一次技能查询的最大数量。
pub const SPELL_BATCH_LIMIT: usize = 512;
/// 本地导入的技能资料包最大长度。
pub const METADATA_MAX_BYTES: u64 = 2 * 1024 * 1024;
