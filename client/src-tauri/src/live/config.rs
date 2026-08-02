use reqwest::Url;

use super::{
    model::LiveIceServer,
    runtime::config::{MEDIA_HTTP_PORT, MEDIA_PATH},
};

/// WHEP 信令请求的最长等待时间。
pub const SIGNAL_TIMEOUT_SECONDS: u64 = 15;
/// 防止异常信令响应占用过多客户端内存。
pub const MAX_SDP_BYTES: usize = 256 * 1024;
/// 等待 OBS 发布轨道出现在本机 WHEP 端点的重试次数。
pub const PLAYBACK_READY_RETRIES: usize = 20;
/// WHEP 播放端点尚未就绪时的重试间隔。
pub const PLAYBACK_READY_RETRY_MILLISECONDS: u64 = 250;

#[derive(Clone, Debug)]
/// 保存当前直播会话内部使用的 WHIP/WHEP 传输参数。
pub struct LiveTransportConfig {
    pub whip_url: Url,
    pub whep_url: Url,
    pub bearer_token: Option<String>,
    pub ice_servers: Vec<LiveIceServer>,
}

/// 生成仅绑定本机回环地址的 WHIP/WHEP 接入信息。
pub fn local_transport_config() -> Result<LiveTransportConfig, String> {
    let base = format!("http://127.0.0.1:{MEDIA_HTTP_PORT}/{MEDIA_PATH}");
    Ok(LiveTransportConfig {
        whip_url: Url::parse(&format!("{base}/whip"))
            .map_err(|error| format!("生成本地 WHIP 地址失败：{error}"))?,
        whep_url: Url::parse(&format!("{base}/whep"))
            .map_err(|error| format!("生成本地 WHEP 地址失败：{error}"))?,
        bearer_token: None,
        ice_servers: Vec::<LiveIceServer>::new(),
    })
}
