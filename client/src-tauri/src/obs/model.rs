use serde::{Deserialize, Serialize};

/// OBS WebSocket 本机连接参数，密码只在本次连接中使用。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObsConnectRequest {
    pub host: String,
    pub port: u16,
    pub password: String,
}

/// 提供给前端的 OBS 连接与录制摘要。
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObsStatus {
    pub connected: bool,
    pub obs_version: Option<String>,
    pub websocket_version: Option<String>,
    pub recording_active: bool,
    pub recording_paused: bool,
    pub output_path: Option<String>,
    pub error: Option<String>,
}

/// 限制连接到本机 OBS，避免桌面客户端控制远程实例。
pub fn validate_connect_request(request: &ObsConnectRequest) -> Result<(), String> {
    if !matches!(request.host.trim(), "127.0.0.1" | "localhost" | "::1" | "[::1]") {
        return Err("OBS WebSocket 仅允许连接本机地址".to_string());
    }

    if request.port == 0 {
        return Err("OBS WebSocket 端口必须在 1 到 65535 之间".to_string());
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{validate_connect_request, ObsConnectRequest};

    #[test]
    fn accepts_local_obs_websocket_endpoint() {
        let request = ObsConnectRequest {
            host: "127.0.0.1".to_string(),
            port: 4455,
            password: "secret".to_string(),
        };

        assert!(validate_connect_request(&request).is_ok());
    }

    #[test]
    fn rejects_remote_obs_websocket_endpoint() {
        let request = ObsConnectRequest {
            host: "192.168.1.12".to_string(),
            port: 4455,
            password: String::new(),
        };

        assert_eq!(
            validate_connect_request(&request),
            Err("OBS WebSocket 仅允许连接本机地址".to_string())
        );
    }

    #[test]
    fn rejects_zero_port_without_exposing_password() {
        let request = ObsConnectRequest {
            host: "localhost".to_string(),
            port: 0,
            password: "do-not-log".to_string(),
        };

        let error = validate_connect_request(&request).unwrap_err();
        assert_eq!(error, "OBS WebSocket 端口必须在 1 到 65535 之间");
        assert!(!error.contains("do-not-log"));
    }
}
