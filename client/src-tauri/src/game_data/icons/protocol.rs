use tauri::{
    http::{header, Method, Request, Response, StatusCode},
    AppHandle, Manager,
};

use crate::game_data::{
    catalog::GameDataState,
    icons::cache::{image_content_type, valid_icon},
};

pub const SCHEME: &str = "spell-icon";

/// 只响应有效图标文件名，不读取调用方指定的任意路径，也不由协议请求触发网络。
pub fn handle(app: &AppHandle, request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let name = request.uri().path().trim_start_matches('/');
    let response = |status, kind: &str, body: Vec<u8>| {
        Response::builder()
            .status(status)
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .header(header::CONTENT_TYPE, kind)
            .header(header::CACHE_CONTROL, "public, max-age=86400")
            .body(body)
            .expect("固定图标响应有效")
    };
    if request.method() != Method::GET && request.method() != Method::HEAD {
        return response(StatusCode::METHOD_NOT_ALLOWED, "text/plain", Vec::new());
    }
    if !valid_icon(name) {
        return response(StatusCode::BAD_REQUEST, "text/plain", Vec::new());
    }
    let state = app.state::<GameDataState>();
    let Some(bytes) = state.icons.read(name) else {
        return response(StatusCode::NOT_FOUND, "text/plain", Vec::new());
    };
    let kind = image_content_type(&bytes).expect("读取时已验证图片");
    response(
        StatusCode::OK,
        kind,
        if request.method() == Method::HEAD {
            Vec::new()
        } else {
            bytes
        },
    )
}
