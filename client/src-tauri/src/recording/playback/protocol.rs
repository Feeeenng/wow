use std::path::Path;

use tauri::{
    http::{header, Method, Request, Response, StatusCode},
    AppHandle, Manager,
};

use crate::recording::capture::state::RecordingState;

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
            .is_some_and(|value| {
                value.len() == 5 && value.bytes().all(|byte| byte.is_ascii_digit())
            });
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
        .header(header::CACHE_CONTROL, "no-store")
        .body(body)
        .expect("本地回放协议响应头固定有效")
}

fn error_response(status: StatusCode, message: &str) -> Response<Vec<u8>> {
    let body = message.as_bytes().to_vec();
    response(status, "text/plain; charset=utf-8", body.len(), body)
}

/// 异步等待索引快照，不把正常分页／索引升级的锁竞争误报为媒体损坏。
pub async fn handle(app: AppHandle, request: Request<Vec<u8>>) -> Response<Vec<u8>> {
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
    let recording = app.state::<RecordingState>();
    serve_file(
        &recording,
        &app_data.join("recordings"),
        pull_id,
        file_name,
        request.method() == Method::HEAD,
    )
    .await
}

/// 获取最小路径快照后释放业务锁，磁盘读取不占用窗口线程或录像索引锁。
async fn serve_file(
    recording: &RecordingState,
    recordings_directory: &Path,
    pull_id: &str,
    file_name: &str,
    head: bool,
) -> Response<Vec<u8>> {
    let index = recording.index.lock().await;
    let Some(playback_path) = index
        .pulls
        .iter()
        .find(|pull| pull.pull_id == pull_id)
        .and_then(|pull| pull.playback_path.as_ref())
        .cloned()
    else {
        return error_response(StatusCode::NOT_FOUND, "本地回放记录不存在");
    };
    drop(index);
    let Some(directory) = playback_path.parent() else {
        return error_response(StatusCode::INTERNAL_SERVER_ERROR, "本地回放路径无效");
    };
    if !directory.starts_with(recordings_directory) {
        return error_response(StatusCode::FORBIDDEN, "本地回放路径超出录像目录");
    }
    let path = directory.join(file_name);
    let Ok(bytes) = tokio::fs::read(path).await else {
        return error_response(StatusCode::NOT_FOUND, "本地回放文件不存在");
    };
    let content_type = match file_name.rsplit_once('.').map(|(_, extension)| extension) {
        Some("m3u8") => "application/vnd.apple.mpegurl",
        Some("mp4") => "video/mp4",
        Some("m4s") => "video/iso.segment",
        _ => "application/octet-stream",
    };
    let content_length = bytes.len();
    let body = if head { Vec::new() } else { bytes };
    response(StatusCode::OK, content_type, content_length, body)
}

#[cfg(test)]
mod tests {
    use super::{parse_path, serve_file};
    use crate::recording::capture::state::RecordingState;
    use tauri::http::{header, StatusCode};

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

    #[test]
    fn media_waits_for_index_contention_and_reads_after_lock_is_released() {
        tauri::async_runtime::block_on(async {
            let root =
                std::env::temp_dir().join(format!("wow-replay-protocol-{}", uuid::Uuid::new_v4()));
            let recordings = root.join("recordings");
            let pull_id = "a".repeat(64);
            let directory = recordings.join(&pull_id).join("hls");
            std::fs::create_dir_all(&directory).unwrap();
            let bytes = b"#EXTM3U\n#EXT-X-ENDLIST\n";
            std::fs::write(directory.join("index.m3u8"), bytes).unwrap();
            let state = RecordingState::isolated(root.join("recording-index.json"));
            let mut guard = state.index.lock().await;
            guard.pulls.push(serde_json::from_value(serde_json::json!({
                "pullId":pull_id,"encounterId":1,"encounterName":"测试","difficultyId":16,"groupSize":20,
                "encounterStartUnixMs":0,"clipStartUnixMs":0,"logFileId":"fixture","logStartOffset":0,
                "state":"ready","playbackPath":directory.join("index.m3u8")
            })).unwrap());
            let mut reply = Box::pin(serve_file(
                &state,
                &recordings,
                &pull_id,
                "index.m3u8",
                false,
            ));
            assert!(
                tokio::time::timeout(std::time::Duration::from_millis(20), &mut reply)
                    .await
                    .is_err()
            );
            drop(guard);
            let response = reply.await;
            assert_eq!(response.status(), StatusCode::OK);
            assert_eq!(response.body(), bytes);
            assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
            let head = serve_file(&state, &recordings, &pull_id, "index.m3u8", true).await;
            assert_eq!(head.status(), StatusCode::OK);
            assert!(head.body().is_empty());
            assert_eq!(
                head.headers()[header::CONTENT_LENGTH],
                bytes.len().to_string()
            );
            assert_eq!(
                serve_file(&state, &recordings, &pull_id, "init.mp4", false)
                    .await
                    .status(),
                StatusCode::NOT_FOUND
            );
            assert_eq!(
                serve_file(&state, &root.join("outside"), &pull_id, "index.m3u8", false)
                    .await
                    .status(),
                StatusCode::FORBIDDEN
            );
            std::fs::remove_dir_all(root).unwrap();
        });
    }
}
