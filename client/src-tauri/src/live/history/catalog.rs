use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::{live::{runtime::config::{HISTORY_HTTP_PORT, HISTORY_PLAYLIST_MAX_BYTES, HISTORY_REQUEST_TIMEOUT_SECONDS, HISTORY_SEGMENT_MAX_BYTES, MEDIA_PATH}, state::LiveState}, recording::capture::state::RecordingState};
use super::playlist::{media_playlist, segments, HistorySegment};

/// 活跃战斗仅返回索引摘要，事件由分页接口读取。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryBattle {
    pull_id: String,
    encounter_name: String,
    started_at_unix_ms: i64,
    event_count: usize,
    event_revision: String,
    player_name: Option<String>,
    ended_at_unix_ms: Option<i64>,
    index_complete: bool,
}

impl From<&crate::recording::model::BossPull> for HistoryBattle {
    fn from(pull: &crate::recording::model::BossPull) -> Self {
        Self { pull_id: pull.pull_id.clone(), encounter_name: pull.encounter_name.clone(), started_at_unix_ms: pull.encounter_start_unix_ms,
            ended_at_unix_ms: pull.encounter_end_unix_ms, event_count: pull.timeline_events.len(), event_revision: crate::recording::events::query::revision(pull),
            player_name: pull.player_name.clone(), index_complete: pull.timeline_indexed && pull.timeline_parse_errors == 0 }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveHistoryManifest {
    session_id: String,
    session_started_at_unix_ms: u64,
    playlist_url: String,
    segments: Vec<HistorySegment>,
    active_battle: Option<HistoryBattle>,
    recent_battles: Vec<HistoryBattle>,
    timing_basis: &'static str,
}

/// 读取固定回环媒体服务，限制重定向、时限和响应体积。
pub async fn fetch(file: &str) -> Result<(Vec<u8>, String), String> {
    if !super::playlist::valid_reference(file) { return Err("无效的直播历史资源".into()); }
    let playlist = file.split('?').next().unwrap_or_default().ends_with(".m3u8");
    let client = reqwest::Client::builder().redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(HISTORY_REQUEST_TIMEOUT_SECONDS)).build().map_err(|e| e.to_string())?;
    let mut response = client.get(format!("http://127.0.0.1:{HISTORY_HTTP_PORT}/{MEDIA_PATH}/{file}"))
        .send().await.map_err(|e| format!("直播历史服务尚未就绪：{e}"))?;
    if !response.status().is_success() { return Err(format!("直播历史资源不可用：HTTP {}", response.status())); }
    let maximum = if playlist { HISTORY_PLAYLIST_MAX_BYTES } else { HISTORY_SEGMENT_MAX_BYTES };
    if response.content_length().is_some_and(|length| length > maximum as u64) { return Err("直播历史资源超过大小限制".into()); }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        if bytes.len() + chunk.len() > maximum { return Err("直播历史资源超过大小限制".into()); }
        bytes.extend_from_slice(&chunk);
    }
    let content_type = if playlist {
        super::playlist::validate_references(std::str::from_utf8(&bytes).map_err(|_| "历史清单编码无效")?)?;
        "application/vnd.apple.mpegurl"
    } else { "video/mp4" };
    Ok((bytes, content_type.into()))
}

/// 会话校验贯穿每次清单／分片请求，停止或换会话后旧地址立即失效。
pub async fn validate_session(state: &LiveState, session_id: &str) -> Result<(), String> {
    if state.session.read().await.as_ref().is_some_and(|active| active.public.session_id == session_id) { Ok(()) }
    else { Err("直播会话已结束或更新，历史窗口已失效".into()) }
}

#[tauri::command]
pub async fn get_live_replay_manifest(app: AppHandle, session_id: String, state: State<'_, LiveState>) -> Result<LiveHistoryManifest, String> {
    validate_session(&state, &session_id).await?;
    let (master, _) = fetch("index.m3u8").await?;
    let media_file = media_playlist(std::str::from_utf8(&master).map_err(|_| "历史清单编码无效")?)?;
    let (media, _) = fetch(&media_file).await?;
    let segments = segments(std::str::from_utf8(&media).map_err(|_| "历史清单编码无效")?)?;
    validate_session(&state, &session_id).await?;
    let session_started_at_unix_ms = state.session.read().await.as_ref().map(|active| active.public.started_at_unix_ms).ok_or("直播已结束")?;
    let recording = app.state::<RecordingState>();
    let index = recording.index.lock().await;
    let active_battle = index.active_pull.as_ref().map(HistoryBattle::from);
    let recent_battles = index.pulls.iter().rev().filter(|pull| pull.encounter_end_unix_ms.is_some_and(|end| end >= session_started_at_unix_ms as i64))
        .take(crate::live::runtime::config::HISTORY_BATTLE_LIMIT).map(HistoryBattle::from).collect();
    Ok(LiveHistoryManifest { playlist_url: format!("http://live-history.localhost/{session_id}/index.m3u8"), session_id, session_started_at_unix_ms, segments, active_battle, recent_battles, timing_basis: "serverReceptionClock" })
}
