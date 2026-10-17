use tauri::{http::{header, Method, Request, Response, StatusCode}, AppHandle, Manager};

use crate::live::state::LiveState;

pub const SCHEME: &str = "live-history";

fn reply(status: StatusCode, content_type: &str, bytes: Vec<u8>, head: bool) -> Response<Vec<u8>> {
    Response::builder().status(status).header(header::CONTENT_TYPE, content_type)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::ACCESS_CONTROL_ALLOW_METHODS, "GET, HEAD, OPTIONS")
        .header(header::CACHE_CONTROL, "no-store")
        .header(header::CONTENT_LENGTH, bytes.len().to_string())
        .body(if head { Vec::new() } else { bytes }).expect("受控直播历史响应头有效")
}

/// 异步代理固定媒体路径；前端不能选择远端主机或任意文件。
pub async fn handle(app: AppHandle, request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    if request.method() == Method::OPTIONS { return reply(StatusCode::NO_CONTENT, "text/plain", Vec::new(), false); }
    if request.method() != Method::GET && request.method() != Method::HEAD { return reply(StatusCode::METHOD_NOT_ALLOWED, "text/plain", Vec::new(), false); }
    let fields = request.uri().path().trim_start_matches('/').split('/').collect::<Vec<_>>();
    if fields.len() != 2 || uuid::Uuid::parse_str(fields[0]).is_err() || !super::playlist::valid_file(fields[1]) {
        return reply(StatusCode::BAD_REQUEST, "text/plain; charset=utf-8", "无效的直播历史路径".as_bytes().into(), false);
    }
    let state = app.state::<LiveState>();
    if let Err(error) = super::catalog::validate_session(&state, fields[0]).await {
        return reply(StatusCode::GONE, "text/plain; charset=utf-8", error.into_bytes(), false);
    }
    let reference = match request.uri().query() { Some(query) => format!("{}?{query}", fields[1]), None => fields[1].to_string() };
    match super::catalog::fetch(&reference).await {
        Ok((bytes, content_type)) => {
            if super::catalog::validate_session(&state, fields[0]).await.is_err() { return reply(StatusCode::GONE, "text/plain", Vec::new(), false); }
            reply(StatusCode::OK, &content_type, bytes, request.method() == Method::HEAD)
        }
        Err(error) => reply(StatusCode::SERVICE_UNAVAILABLE, "text/plain; charset=utf-8", error.into_bytes(), false),
    }
}
