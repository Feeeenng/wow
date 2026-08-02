use serde::Serialize;

/// 浏览器建立 WebRTC 连接所需的 ICE 服务信息。
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveIceServer {
    pub urls: Vec<String>,
    pub username: Option<String>,
    pub credential: Option<String>,
}

/// 描述当前正式直播会话及其本地录像归属。
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveSession {
    pub session_id: String,
    pub started_at_unix_ms: u64,
    pub recording_active: bool,
    pub recording_started_by_session: bool,
    pub ice_servers: Vec<LiveIceServer>,
}

/// 返回 WHEP 应答以及后续释放远端资源所需的本地标识。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WhepAnswer {
    pub playback_id: String,
    pub answer_sdp: String,
}
