use serde::{Deserialize, Serialize};
use tauri::State;

use super::transport::ReplayClient;
use crate::cloud::state::CloudState;

/// 团队偏移独立于原始映射及个人偏好，必须绑定实际发布版本。
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedCalibration {
    pub version: u32,
    pub playback_version: Option<String>,
    pub saved_playback_version: Option<String>,
    pub offset_ms: i64,
    pub active: bool,
    pub stale: bool,
    pub can_edit: bool,
    pub updated_at: Option<String>,
    pub min_offset_ms: i64,
    pub max_offset_ms: i64,
}

impl SharedCalibration {
    /// 不将矛盾状态、非法UUID或超出网页精确整数范围的数值传给播放器。
    pub fn validate(&self) -> Result<(), String> {
        for version in [&self.playback_version, &self.saved_playback_version]
            .into_iter()
            .flatten()
        {
            uuid::Uuid::parse_str(version).map_err(|_| "团队对齐发布版本无效")?;
        }
        if i32::try_from(self.offset_ms).is_err()
            || self.min_offset_ms > 0
            || self.max_offset_ms < 0
            || i32::try_from(self.min_offset_ms).is_err()
            || i32::try_from(self.max_offset_ms).is_err()
            || self.active
                && (self.stale
                    || self.version == 0
                    || self.playback_version.is_none()
                    || self.playback_version != self.saved_playback_version)
        {
            return Err("团队对齐响应格式无效".into());
        }
        Ok(())
    }
}

/// 通用传输层不回显服务器正文；校准操作将固定状态码转换为可操作的提示。
fn operation_error(error: String) -> String {
    match error.strip_prefix("团队回放返回 HTTP ") {
        Some("409") => "团队对齐或录像版本已变化，请读取最新值并复核。".into(),
        Some("403") => "当前账号没有该团队对齐的操作权限，请重新验证账号。".into(),
        Some("422") => "偏移没有可用战斗画面或超过允许范围，请调整后再保存。".into(),
        Some("404") => "团队录像不存在，或服务器尚未支持共享对齐。".into(),
        _ => error,
    }
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveCalibration {
    pub expected_version: u32,
    pub playback_version: String,
    pub offset_ms: i64,
}

async fn execute(
    state: &CloudState,
    pull_id: &str,
    request: Option<SaveCalibration>,
) -> Result<SharedCalibration, String> {
    let recording = uuid::Uuid::parse_str(pull_id).map_err(|_| "团队对齐对应录像身份无效")?;
    if let Some(request) = &request {
        uuid::Uuid::parse_str(&request.playback_version).map_err(|_| "团队对齐媒体版本无效")?;
    }
    let client = ReplayClient::current(state).await?;
    let team = client.settings.team_id.as_deref().ok_or("请先选择团队")?;
    let body = request
        .map(serde_json::to_value)
        .transpose()
        .map_err(|_| "团队对齐参数无效")?;
    let bytes = client
        .request(
            if body.is_some() {
                reqwest::Method::PUT
            } else {
                reqwest::Method::GET
            },
            &format!("/teams/{team}/recordings/{recording}/calibration"),
            false,
            body.as_ref(),
        )
        .await
        .map_err(operation_error)?;
    if !client.still_current(state).await {
        return Err("云端连接已更新，请重新读取团队对齐".into());
    }
    let snapshot: SharedCalibration =
        serde_json::from_slice(&bytes).map_err(|_| "团队对齐响应格式无效")?;
    snapshot.validate()?;
    Ok(snapshot)
}

#[tauri::command]
pub async fn get_cloud_replay_calibration(
    pull_id: String,
    state: State<'_, CloudState>,
) -> Result<SharedCalibration, String> {
    execute(&state, &pull_id, None).await
}

#[tauri::command]
pub async fn save_cloud_replay_calibration(
    pull_id: String,
    request: SaveCalibration,
    state: State<'_, CloudState>,
) -> Result<SharedCalibration, String> {
    execute(&state, &pull_id, Some(request)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn shared_snapshot_preserves_stale_values_but_rejects_contradictory_active_state() {
        let first = "11111111-1111-4111-8111-111111111111";
        let second = "22222222-2222-4222-8222-222222222222";
        let mut value = json!({"version":1,"playbackVersion":first,"savedPlaybackVersion":first,"offsetMs":500,
            "active":true,"stale":false,"canEdit":false,"updatedAt":null,"minOffsetMs":-300000,"maxOffsetMs":300000});
        let snapshot: SharedCalibration = serde_json::from_value(value.clone()).unwrap();
        assert!(snapshot.validate().is_ok());
        assert_eq!(serde_json::to_value(snapshot).unwrap()["offsetMs"], 500);
        value["playbackVersion"] = json!(second);
        assert!(serde_json::from_value::<SharedCalibration>(value.clone())
            .unwrap()
            .validate()
            .is_err());
        value["active"] = json!(false);
        value["stale"] = json!(true);
        assert!(serde_json::from_value::<SharedCalibration>(value.clone())
            .unwrap()
            .validate()
            .is_ok());
        value["playbackVersion"] = json!("invalid-version");
        assert!(serde_json::from_value::<SharedCalibration>(value)
            .unwrap()
            .validate()
            .is_err());
    }

    #[test]
    fn operation_failures_explain_conflict_without_echoing_remote_body() {
        assert!(operation_error("团队回放返回 HTTP 409".into()).contains("读取最新"));
        assert!(operation_error("团队回放返回 HTTP 403".into()).contains("权限"));
        assert!(operation_error("团队回放返回 HTTP 422".into()).contains("战斗画面"));
        assert_eq!(
            operation_error("读取团队回放超时".into()),
            "读取团队回放超时"
        );
    }
}
