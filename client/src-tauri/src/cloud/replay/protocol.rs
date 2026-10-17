use tauri::{
    http::{header, Method, Request, Response, StatusCode},
    AppHandle, Manager,
};

use super::transport::ReplayClient;
use crate::cloud::state::CloudState;

pub const SCHEME: &str = "cloud-replay";

pub fn valid_file(file: &str) -> bool {
    matches!(file, "index.m3u8" | "init.mp4")
        || file
            .strip_prefix("segment-")
            .and_then(|name| name.strip_suffix(".m4s"))
            .is_some_and(|number| {
                number.len() == 5 && number.bytes().all(|byte| byte.is_ascii_digit())
            })
}

fn path_fields(path: &str) -> Option<Vec<&str>> {
    let parts = path.trim_start_matches('/').split('/').collect::<Vec<_>>();
    if parts.len() != 5
        || parts[0].len() != 64
        || !parts[0].bytes().all(|byte| byte.is_ascii_hexdigit())
        || !parts[1..4]
            .iter()
            .all(|id| uuid::Uuid::parse_str(id).is_ok())
        || !valid_file(parts[4])
    {
        return None;
    }
    Some(parts)
}

/// 本地协议永不接受远端 URL 或任意路径，也不把长期 Bearer 返回网页。
pub async fn handle(app: AppHandle, request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    if request.method() == Method::OPTIONS {
        return response(StatusCode::NO_CONTENT, "text/plain", Vec::new(), false);
    }
    if request.method() != Method::GET && request.method() != Method::HEAD {
        return response(
            StatusCode::METHOD_NOT_ALLOWED,
            "text/plain",
            Vec::new(),
            false,
        );
    }
    let Some(parts) = path_fields(request.uri().path()) else {
        return response(StatusCode::BAD_REQUEST, "text/plain", Vec::new(), false);
    };
    if request.uri().query().is_some() {
        return response(StatusCode::BAD_REQUEST, "text/plain", Vec::new(), false);
    }
    let state = app.state::<CloudState>();
    let result = async {
        let client = ReplayClient::current(&state).await?;
        if parts[0] != client.connection || client.settings.team_id.as_deref() != Some(parts[1]) {
            return Err("团队回放连接已更新，请刷新目录".to_string());
        }
        let bytes = client
            .request(
                reqwest::Method::GET,
                &format!(
                    "/teams/{}/recordings/{}/media/{}?version={}",
                    parts[1], parts[2], parts[4], parts[3]
                ),
                true,
                None,
            )
            .await?;
        if !client.still_current(&state).await {
            return Err("团队回放连接已失效".into());
        }
        if parts[4] == "index.m3u8" {
            validate_playlist(&bytes)?;
        }
        Ok::<_, String>(bytes)
    }
    .await;
    match result {
        Ok(bytes) => response(
            StatusCode::OK,
            if parts[4] == "index.m3u8" {
                "application/vnd.apple.mpegurl"
            } else {
                "video/mp4"
            },
            bytes,
            request.method() == Method::HEAD,
        ),
        Err(error) => response(
            StatusCode::SERVICE_UNAVAILABLE,
            "text/plain; charset=utf-8",
            error.into_bytes(),
            false,
        ),
    }
}

fn response(status: StatusCode, mime: &str, bytes: Vec<u8>, head: bool) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, mime)
        .header(header::CONTENT_LENGTH, bytes.len().to_string())
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::ACCESS_CONTROL_ALLOW_METHODS, "GET, HEAD, OPTIONS")
        .header(header::CACHE_CONTROL, "no-store")
        .body(if head { Vec::new() } else { bytes })
        .expect("团队回放固定响应头有效")
}

pub fn validate_playlist(bytes: &[u8]) -> Result<(), String> {
    let playlist = std::str::from_utf8(bytes).map_err(|_| "团队回放清单编码无效")?;
    if !playlist.starts_with("#EXTM3U") {
        return Err("团队回放清单格式无效".into());
    }
    for line in playlist.lines().map(str::trim) {
        if !line.is_empty() && !line.starts_with('#') && !valid_file(line) {
            return Err("团队清单包含越界分片".into());
        }
        for reference in line.split("URI=\"").skip(1) {
            if !reference.split('"').next().is_some_and(valid_file) {
                return Err("团队清单包含越界媒体引用".into());
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_paths_remote_references_and_unversioned_private_media() {
        assert!(validate_playlist(b"#EXTM3U\n#EXT-X-MAP:URI=\"init.mp4\"\n#EXTINF:4,\nsegment-00000.m4s\n#EXT-X-ENDLIST\n").is_ok());
        assert!(validate_playlist(b"#EXTM3U\nhttps://evil.example/segment-00000.m4s").is_err());
        assert!(validate_playlist(b"#EXTM3U\n#EXT-X-MAP:URI=\"../init.mp4\"").is_err());
        assert!(!valid_file("segment-00000.m4s?grant=secret"));
        assert!(path_fields("/short/team/recording/version/index.m3u8").is_none());
        let good = format!("/{}/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333/index.m3u8", "a".repeat(64));
        assert!(path_fields(&good).is_some());
        assert!(path_fields(&good.replace("index.m3u8", "../client-state.json")).is_none());
    }
}
