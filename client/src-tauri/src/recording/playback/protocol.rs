use std::fs;

use tauri::{
    http::{header, Method, Request, Response, StatusCode},
    AppHandle, Manager,
};

pub const SCHEME: &str = "local-replay";

fn parse_path(path: &str) -> Option<(&str, &str)> {
    let mut segments = path.trim_start_matches('/').split('/');
    let pull_id = segments.next()?;
    let file_name = segments.next()?;
    if segments.next().is_some()
        || pull_id.len() != 64
        || !pull_id.bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return None;
    }
    let valid_file = matches!(file_name, "index.m3u8" | "init.mp4")
        || file_name
            .strip_prefix("segment-")
            .and_then(|value| value.strip_suffix(".m4s"))
            .is_some_and(|value| value.len() == 5 && value.bytes().all(|byte| byte.is_ascii_digit()));
    valid_file.then_some((pull_id, file_name))
}

fn response(
    status: StatusCode,
    content_type: &str,
    content_length: usize,
    body: Vec<u8>,
) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::ACCESS_CONTROL_ALLOW_METHODS, "GET, HEAD, OPTIONS")
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CONTENT_LENGTH, content_length.to_string())
        .body(body)
        .expect("本地回放协议响应头固定有效")
}

fn error_response(status: StatusCode, message: &str) -> Response<Vec<u8>> {
    let body = message.as_bytes().to_vec();
    response(status, "text/plain; charset=utf-8", body.len(), body)
}

/// 仅提供应用录像目录内由固定 Pull ID 和文件名定位的 HLS 文件。
pub fn handle(app: &AppHandle, request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    if request.method() == Method::OPTIONS {
        return response(StatusCode::NO_CONTENT, "text/plain", 0, Vec::new());
    }
    if request.method() != Method::GET && request.method() != Method::HEAD {
        return error_response(StatusCode::METHOD_NOT_ALLOWED, "不支持该请求方法");
    }
    let Some((pull_id, file_name)) = parse_path(request.uri().path()) else {
        return error_response(StatusCode::BAD_REQUEST, "无效的本地回放路径");
    };
    let Ok(app_data) = app.path().app_data_dir() else {
        return error_response(StatusCode::INTERNAL_SERVER_ERROR, "无法定位本地录像目录");
    };
    let path = app_data
        .join("recordings")
        .join("hls")
        .join(pull_id)
        .join(file_name);
    let Ok(bytes) = fs::read(path) else {
        return error_response(StatusCode::NOT_FOUND, "本地回放文件不存在");
    };
    let content_type = match file_name.rsplit_once('.').map(|(_, extension)| extension) {
        Some("m3u8") => "application/vnd.apple.mpegurl",
        Some("mp4") => "video/mp4",
        Some("m4s") => "video/iso.segment",
        _ => "application/octet-stream",
    };
    let content_length = bytes.len();
    let body = if request.method() == Method::HEAD { Vec::new() } else { bytes };
    response(StatusCode::OK, content_type, content_length, body)
}

#[cfg(test)]
mod tests {
    use super::parse_path;

    #[test]
    fn accepts_only_fixed_hls_files_below_a_sha256_pull_directory() {
        let pull_id = "a".repeat(64);
        assert_eq!(
            parse_path(&format!("/{pull_id}/segment-00012.m4s")),
            Some((pull_id.as_str(), "segment-00012.m4s"))
        );
        assert!(parse_path(&format!("/{pull_id}/../recording-index.json")).is_none());
        assert!(parse_path("/short/index.m3u8").is_none());
    }
}
