use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use tauri::State;

use super::transport::ReplayClient;
use crate::cloud::state::CloudState;

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActorBinding {
    recording_id: uuid::Uuid,
    actor_id: u32,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportRequest {
    report_code: String,
    fight_id: u32,
    actor_bindings: Vec<ActorBinding>,
    #[serde(default)]
    refresh: bool,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportActor {
    actor_id: u32,
    name: String,
    #[serde(rename = "type")]
    actor_type: Option<String>,
    sub_type: Option<String>,
    game_id: Option<f64>,
}

/// 视频、报告导入和事件发布分别展示，旧版完整事件可在重试期间继续读取。
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportStatus {
    configured: bool,
    can_import: bool,
    status: String,
    job_id: Option<uuid::Uuid>,
    report_code: Option<String>,
    fight_id: Option<u32>,
    revision: Option<String>,
    event_count: u64,
    actors: Vec<ReportActor>,
    actor_bindings: Vec<ActorBinding>,
    error: Option<String>,
    published_report_code: Option<String>,
    published_fight_id: Option<u32>,
    published_report_revision: Option<i64>,
    raw_event_count: Option<u64>,
}

fn validate(request: &ImportRequest) -> Result<(), String> {
    if request.report_code.len() != 16
        || !request
            .report_code
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric())
        || request.fight_id == 0
        || request.fight_id > super::config::WCL_FIGHT_ID_MAX
        || request.actor_bindings.len() > super::config::WCL_BINDING_LIMIT
    {
        return Err("WCL 报告、战斗或人物绑定参数无效".into());
    }
    let mut recordings = HashSet::new();
    for binding in &request.actor_bindings {
        if binding.actor_id == 0
            || binding.actor_id > super::config::WCL_FIGHT_ID_MAX
            || !recordings.insert(binding.recording_id)
        {
            return Err("WCL 人物绑定存在重复录像或无效人物".into());
        }
    }
    Ok(())
}

async fn request_status(
    state: &CloudState,
    pull_id: &str,
    body: Option<&ImportRequest>,
) -> Result<ImportStatus, String> {
    let pull = uuid::Uuid::parse_str(pull_id).map_err(|_| "团队战斗身份无效")?;
    let client = ReplayClient::current(state).await?;
    let team = client.settings.team_id.as_deref().ok_or("请先选择团队")?;
    let route = format!(
        "/teams/{team}/pulls/{pull}/wcl{}",
        if body.is_some() { "/imports" } else { "" }
    );
    let body = body
        .map(serde_json::to_value)
        .transpose()
        .map_err(|_| "WCL 导入参数编码失败")?;
    let bytes = client
        .request(
            if body.is_some() {
                reqwest::Method::POST
            } else {
                reqwest::Method::GET
            },
            &route,
            false,
            body.as_ref(),
        )
        .await?;
    if !client.still_current(state).await {
        return Err("云端连接已更新，请重新读取标准事件状态".into());
    }
    let status: ImportStatus =
        serde_json::from_slice(&bytes).map_err(|_| "WCL 导入状态格式无效")?;
    if !matches!(
        status.status.as_str(),
        "unbound" | "pending" | "importing" | "ready" | "failed"
    ) {
        return Err("WCL 导入状态无效".into());
    }
    Ok(status)
}

/// 读取当前团队的标准事件导入状态，不在客户端存放 WCL 应用密钥。
#[tauri::command]
pub async fn get_cloud_wcl_status(
    pull_id: String,
    state: State<'_, CloudState>,
) -> Result<ImportStatus, String> {
    request_status(&state, &pull_id, None).await
}

/// 仅提交用户显式选择的报告、fight 和人物对应关系，平台权限由服务端再次核对。
#[tauri::command]
pub async fn start_cloud_wcl_import(
    pull_id: String,
    request: ImportRequest,
    state: State<'_, CloudState>,
) -> Result<ImportStatus, String> {
    validate(&request)?;
    request_status(&state, &pull_id, Some(&request)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refuses_urls_invalid_report_ids_and_duplicate_recording_bindings() {
        let mut request = ImportRequest {
            report_code: "abcdefghijklmnop".into(),
            fight_id: 1,
            actor_bindings: vec![],
            refresh: false,
        };
        assert!(validate(&request).is_ok());
        request.report_code = "https://example.com".into();
        assert!(validate(&request).is_err());
        request.report_code = "abcdefghijklmnop".into();
        let recording_id = uuid::Uuid::new_v4();
        request.actor_bindings = vec![
            ActorBinding {
                recording_id,
                actor_id: 1,
            },
            ActorBinding {
                recording_id,
                actor_id: 2,
            },
        ];
        assert!(validate(&request).is_err());
    }

    #[test]
    fn status_accepts_numeric_report_revision_and_nullable_actor_type() {
        let status: ImportStatus = serde_json::from_value(serde_json::json!({
            "configured":true,"canImport":true,"status":"ready","jobId":null,
            "reportCode":"abcdefghijklmnop","fightId":1,"revision":"snapshot","eventCount":2,
            "actors":[{"actorId":1,"name":"未知类型角色","type":null,"subType":null,"gameId":null}],
            "actorBindings":[],"error":null,"publishedReportRevision":7,"rawEventCount":5
        }))
        .unwrap();
        assert_eq!(status.published_report_revision, Some(7));
        assert!(status.actors[0].actor_type.is_none());
    }
}
