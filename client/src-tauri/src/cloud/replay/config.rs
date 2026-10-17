/// 团队目录只分页读取元数据，不预加载其他成员的视频。
pub const PAGE_LIMIT: u32 = 100;
/// 单片回放的响应上限，避免异常服务返回无限媒体流。
pub const MAX_MEDIA_BYTES: usize = 64 * 1024 * 1024;
/// 私有媒体网络等待上限，不无限阻塞 WebView 协议。
pub const MEDIA_TIMEOUT_SECONDS: u64 = 30;
pub const PLAYBACK_ORIGIN: &str = "http://cloud-replay.localhost";
/// 标准事件分页和游标边界，与服务端契约一致，不整场下载到单次 IPC。
pub const EVENT_PAGE_LIMIT: u32 = 1000;
pub const EVENT_CURSOR_MAX_BYTES: usize = 4096;
/// 一次只绑定有界数量的录像人物，后台仍校验录像属于当前团队战斗。
pub const WCL_BINDING_LIMIT: usize = 100;
/// WCL fight 编号使用 GraphQL 有符号 Int，原生入口与表单共用该协议边界。
pub const WCL_FIGHT_ID_MAX: u32 = i32::MAX as u32;
