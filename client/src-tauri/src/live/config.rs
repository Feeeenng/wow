use reqwest::Url;

use super::model::LiveIceServer;

/// OBS 发布当前成员画面的 WHIP 端点。
const WHIP_URL_ENV: &str = "WOW_RECORDER_LIVE_WHIP_URL";
/// 客户端订阅当前成员画面的 WHEP 端点。
const WHEP_URL_ENV: &str = "WOW_RECORDER_LIVE_WHEP_URL";
/// WHIP 与 WHEP 请求共用的可选短期令牌。
const BEARER_TOKEN_ENV: &str = "WOW_RECORDER_LIVE_BEARER_TOKEN";
/// 浏览器 WebRTC 连接使用的逗号分隔 STUN/TURN 地址。
const ICE_SERVERS_ENV: &str = "WOW_RECORDER_LIVE_ICE_SERVERS";
/// TURN 服务的可选短期用户名。
const ICE_USERNAME_ENV: &str = "WOW_RECORDER_LIVE_ICE_USERNAME";
/// TURN 服务的可选短期凭证。
const ICE_CREDENTIAL_ENV: &str = "WOW_RECORDER_LIVE_ICE_CREDENTIAL";

/// WHEP 信令请求的最长等待时间。
pub const SIGNAL_TIMEOUT_SECONDS: u64 = 15;
/// 防止异常信令响应占用过多客户端内存。
pub const MAX_SDP_BYTES: usize = 256 * 1024;

#[derive(Clone, Debug)]
pub struct LiveTransportConfig {
    pub whip_url: Url,
    pub whep_url: Url,
    pub bearer_token: Option<String>,
    pub ice_servers: Vec<LiveIceServer>,
}

/// 读取必需的直播环境配置。
fn read_required(name: &str) -> Result<String, String> {
    std::env::var(name)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .map(|value| value.trim().to_string())
        .ok_or_else(|| "直播服务尚未配置，请稍后重试".to_string())
}

/// 校验直播信令端点仅使用 HTTP 或 HTTPS。
fn parse_http_url(value: &str) -> Result<Url, String> {
    let url = Url::parse(value).map_err(|_| "直播服务配置无效，请稍后重试".to_string())?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("直播服务配置无效，请稍后重试".to_string());
    }
    Ok(url)
}

/// 读取浏览器建立 WebRTC 连接所需的 ICE 服务列表。
fn read_ice_servers() -> Vec<LiveIceServer> {
    let urls = std::env::var(ICE_SERVERS_ENV)
        .unwrap_or_default()
        .split(',')
        .map(str::trim)
        .filter(|value| {
            value.starts_with("stun:")
                || value.starts_with("stuns:")
                || value.starts_with("turn:")
                || value.starts_with("turns:")
        })
        .map(str::to_string)
        .collect::<Vec<_>>();
    if urls.is_empty() {
        return Vec::new();
    }
    vec![LiveIceServer {
        urls,
        username: std::env::var(ICE_USERNAME_ENV).ok(),
        credential: std::env::var(ICE_CREDENTIAL_ENV).ok(),
    }]
}

/// 读取由部署环境或后续控制面注入的短期直播接入信息。
pub fn load_transport_config() -> Result<LiveTransportConfig, String> {
    let whip_url = read_required(WHIP_URL_ENV)?;
    let whep_url = read_required(WHEP_URL_ENV)?;
    Ok(LiveTransportConfig {
        whip_url: parse_http_url(&whip_url)?,
        whep_url: parse_http_url(&whep_url)?,
        bearer_token: std::env::var(BEARER_TOKEN_ENV)
            .ok()
            .filter(|value| !value.trim().is_empty()),
        ice_servers: read_ice_servers(),
    })
}
