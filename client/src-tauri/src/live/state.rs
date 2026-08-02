use std::collections::HashMap;

use reqwest::Url;
use tokio::sync::{Mutex, RwLock};

use super::{config::LiveTransportConfig, model::LiveSession};

#[derive(Clone)]
/// 组合可返回前端的会话与仅 Rust 可见的发布凭证。
pub struct ActiveLiveSession {
    pub public: LiveSession,
    pub transport: LiveTransportConfig,
}

#[derive(Clone)]
/// 保存媒体服务返回的 WHEP 资源地址及释放凭证。
pub struct PlaybackResource {
    pub resource_url: Url,
    pub bearer_token: Option<String>,
}

/// 保存唯一发布会话和由客户端创建的 WHEP 播放资源。
#[derive(Default)]
pub struct LiveState {
    pub operation: Mutex<()>,
    pub session: RwLock<Option<ActiveLiveSession>>,
    pub playback_resources: RwLock<HashMap<String, PlaybackResource>>,
}
