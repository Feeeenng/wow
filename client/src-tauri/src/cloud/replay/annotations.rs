use tauri::State;

use super::transport::ReplayClient;
use crate::{
    cloud::state::CloudState,
    recording::annotations::model::{validate, SaveRequest, Snapshot},
};

/// 团队标注与媒体共用当前身份；每次操作由后端重新校验团队和编辑权限。
async fn execute(
    state: &CloudState,
    pull_id: &str,
    request: Option<SaveRequest>,
) -> Result<Snapshot, String> {
    let recording = uuid::Uuid::parse_str(pull_id).map_err(|_| "团队标注对应录像身份无效")?;
    if let Some(request) = &request {
        validate(&request.items, i64::MAX)?;
    }
    let client = ReplayClient::current(state).await?;
    let team = client.settings.team_id.as_deref().ok_or("请先选择团队")?;
    let body = request
        .map(serde_json::to_value)
        .transpose()
        .map_err(|_| "团队标注参数编码失败")?;
    let bytes = client
        .request(
            if body.is_some() {
                reqwest::Method::PUT
            } else {
                reqwest::Method::GET
            },
            &format!("/teams/{team}/recordings/{recording}/annotations"),
            false,
            body.as_ref(),
        )
        .await?;
    if !client.still_current(state).await {
        return Err("云端连接已更新，请重新读取团队标注".into());
    }
    let snapshot: Snapshot = serde_json::from_slice(&bytes).map_err(|_| "团队标注响应格式无效")?;
    validate(&snapshot.items, i64::MAX)?;
    Ok(snapshot)
}

#[tauri::command]
pub async fn get_cloud_replay_annotations(
    pull_id: String,
    state: State<'_, CloudState>,
) -> Result<Snapshot, String> {
    execute(&state, &pull_id, None).await
}

#[tauri::command]
pub async fn save_cloud_replay_annotations(
    pull_id: String,
    request: SaveRequest,
    state: State<'_, CloudState>,
) -> Result<Snapshot, String> {
    execute(&state, &pull_id, Some(request)).await
}
