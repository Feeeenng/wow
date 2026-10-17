use serde_json::Value;
use tauri::State;

use super::{model::CloudReplayEntry, transport::ReplayClient};
use crate::cloud::state::CloudState;

/// 只返回授权团队的有界元数据，其他视角的媒体仅在选中播放后请求。
#[tauri::command]
pub async fn list_cloud_replays(
    offset: u32,
    limit: u32,
    state: State<'_, CloudState>,
) -> Result<Vec<Value>, String> {
    if limit == 0 || limit > super::config::PAGE_LIMIT {
        return Err("团队录像分页数量超出限制".into());
    }
    let client = ReplayClient::current(&state).await?;
    let team = client.settings.team_id.as_deref().ok_or("请先选择团队")?;
    let bytes = client
        .request(
            reqwest::Method::GET,
            &format!("/teams/{team}/recordings?offset={offset}&limit={limit}"),
            false,
            None,
        )
        .await?;
    if !client.still_current(&state).await {
        return Err("云端连接已更新，请重新读取团队目录".into());
    }
    let entries: Vec<CloudReplayEntry> =
        serde_json::from_slice(&bytes).map_err(|_| "团队目录响应格式无效")?;
    if entries.len() > limit as usize {
        return Err("团队目录超过请求数量限制".into());
    }
    entries
        .into_iter()
        .map(|entry| entry.normalize(&client.connection, team))
        .collect()
}

/// 只重排当前授权团队内录像的媒体处理，是否允许重试由服务端再次校验。
#[tauri::command]
pub async fn retry_cloud_replay_processing(
    recording_id: String,
    state: State<'_, CloudState>,
) -> Result<(), String> {
    let recording = uuid::Uuid::parse_str(&recording_id).map_err(|_| "团队录像身份无效")?;
    let client = ReplayClient::current(&state).await?;
    let team = client.settings.team_id.as_deref().ok_or("请先选择团队")?;
    client
        .request(
            reqwest::Method::POST,
            &format!("/teams/{team}/recordings/{recording}/processing/retry"),
            false,
            None,
        )
        .await?;
    if !client.still_current(&state).await {
        return Err("云端连接已更新，请重新读取团队目录".into());
    }
    Ok(())
}
