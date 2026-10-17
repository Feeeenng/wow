use serde::{Deserialize, Serialize};
use tauri::State;

use super::{config, transport::ReplayClient};
use crate::cloud::{config::API_PREFIX, state::CloudState};
use crate::recording::model::{TimelineEventKind, TimelineOwner};

/// WCL 事件保留有符号公共战斗时间及报告内人物身份，不改变本地日志契约。
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudTimelineEvent {
    event_id: String,
    pull_time_ms: i64,
    owner: TimelineOwner,
    kind: TimelineEventKind,
    source_name: String,
    source_guid: String,
    target_name: String,
    target_guid: String,
    spell_id: u32,
    spell_name: String,
    extra_spell_id: Option<u32>,
    stack_count: Option<u32>,
    #[serde(default)]
    empower_level: Option<u32>,
    identity_namespace: String,
    source_actor_id: Option<i64>,
    target_actor_id: Option<i64>,
    source_is_player: bool,
    target_is_player: bool,
    raw_type: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudEventPage {
    revision: String,
    events: Vec<CloudTimelineEvent>,
    total: u64,
    next_cursor: String,
    has_more: bool,
    reset: bool,
}

/// 校验分页边界与独立身份，避免将远端 actorID 当作本地游戏 GUID。
fn decode_page(bytes: &[u8], limit: u32) -> Result<CloudEventPage, String> {
    let page: CloudEventPage = serde_json::from_slice(bytes).map_err(|_| "标准事件分页格式无效")?;
    if page.events.len() > limit as usize
        || page.events.len() as u64 > page.total
        || page.revision.is_empty()
        || page.revision.len() > config::EVENT_CURSOR_MAX_BYTES
        || page.next_cursor.len() > config::EVENT_CURSOR_MAX_BYTES
    {
        return Err("标准事件分页超过请求限制".into());
    }
    for event in &page.events {
        let report = event.identity_namespace.strip_prefix("wcl:").unwrap_or("");
        if report.len() != 16
            || !report.bytes().all(|byte| byte.is_ascii_alphanumeric())
            || !event.source_guid.is_empty()
            || !event.target_guid.is_empty()
        {
            return Err("标准事件缺少独立报告人物身份".into());
        }
    }
    Ok(page)
}

/// 每页从 Rust 当前凭证发起团队授权请求，令牌不进入网页及游标 URL。
#[tauri::command]
pub async fn list_cloud_replay_events(
    pull_id: String,
    cursor: Option<String>,
    limit: u32,
    state: State<'_, CloudState>,
) -> Result<CloudEventPage, String> {
    let recording = uuid::Uuid::parse_str(&pull_id).map_err(|_| "团队录像身份无效")?;
    if limit == 0
        || limit > config::EVENT_PAGE_LIMIT
        || cursor
            .as_ref()
            .is_some_and(|value| value.len() > config::EVENT_CURSOR_MAX_BYTES)
    {
        return Err("标准事件分页参数无效".into());
    }
    let client = ReplayClient::current(&state).await?;
    let team = client.settings.team_id.as_deref().ok_or("请先选择团队")?;
    let route = format!("/teams/{team}/recordings/{recording}/events");
    let mut url = reqwest::Url::parse(&format!("{}{API_PREFIX}{route}", client.settings.endpoint))
        .map_err(|_| "云端事件地址无效")?;
    url.query_pairs_mut()
        .append_pair("limit", &limit.to_string());
    if let Some(cursor) = cursor.as_deref() {
        url.query_pairs_mut().append_pair("cursor", cursor);
    }
    let bytes = client
        .request(
            reqwest::Method::GET,
            &format!("{route}?{}", url.query().unwrap_or("")),
            false,
            None,
        )
        .await?;
    if !client.still_current(&state).await {
        return Err("云端连接已更新，请重新读取标准事件".into());
    }
    decode_page(&bytes, limit)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn standard_events_keep_signed_time_and_report_identity() {
        let event = json!({"eventId":"event-1","pullTimeMs":-300,"owner":"team","kind":"castSuccess",
            "sourceName":"同名角色","sourceGuid":"","targetName":"目标","targetGuid":"","spellId":17,"spellName":"盾",
            "extraSpellId":null,"stackCount":null,"identityNamespace":"wcl:abcdefghijklmnop","sourceActorId":1,"targetActorId":2,
            "sourceIsPlayer":true,"targetIsPlayer":true,"rawType":"cast"});
        let mut page = json!({"revision":"version-1","events":[event],"total":1,"nextCursor":"next","hasMore":false,"reset":true});
        let parsed = decode_page(&serde_json::to_vec(&page).unwrap(), 1).unwrap();
        assert_eq!(parsed.events[0].pull_time_ms, -300);
        assert_eq!(parsed.events[0].source_actor_id, Some(1));
        page["events"][0]["sourceActorId"] = json!(-1);
        let environment = decode_page(&serde_json::to_vec(&page).unwrap(), 1).unwrap();
        assert_eq!(environment.events[0].source_actor_id, Some(-1));
        assert!(decode_page(&serde_json::to_vec(&page).unwrap(), 0).is_err());
        page["events"][0]["sourceGuid"] = json!("Player-invented");
        assert!(decode_page(&serde_json::to_vec(&page).unwrap(), 1).is_err());
        page["events"][0]["sourceGuid"] = json!("");
        page["events"][0]["identityNamespace"] = json!("wcl:invalid");
        assert!(decode_page(&serde_json::to_vec(&page).unwrap(), 1).is_err());
    }
}
