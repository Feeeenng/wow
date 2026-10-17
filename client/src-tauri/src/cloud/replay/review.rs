use std::collections::HashSet;
use tauri::State;

use super::{config, transport::ReplayClient};
use crate::cloud::{config::API_PREFIX, state::CloudState};
use crate::recording::review::model::{DeathReview, ReviewEvent};

/// WCL始终保留独立actor命名空间，不接受远端伪造游戏GUID或无效数值。
fn valid_event(event: &ReviewEvent) -> bool {
    let report = event.identity_namespace.as_deref().and_then(|value| value.strip_prefix("wcl:")).unwrap_or("");
    report.len() == 16 && report.bytes().all(|byte| byte.is_ascii_alphanumeric())
        && event.source_guid.is_empty() && event.target_guid.is_empty()
        && !event.event_id.is_empty()
        && [event.amount, event.absorbed, event.overkill, event.overheal, event.health, event.max_health]
            .iter().flatten().all(|value| value.is_finite() && *value >= 0.0 && *value <= 9_007_199_254_740_991.0)
        && match (event.health, event.max_health) { (None, None) => true, (Some(health), Some(maximum)) => maximum > 0.0 && health <= maximum, _ => false }
        && (matches!(event.kind.as_str(), "damage" | "heal" | "absorb" | "healAbsorb")
            || serde_json::from_value::<crate::recording::model::TimelineEventKind>(serde_json::json!(&event.kind)).is_ok())
}

/// 页大小、死亡身份、同源actor和时间范围均先校验，再交给React保留快照。
fn decode(bytes: &[u8], event_id: &str, limit: u32) -> Result<DeathReview, String> {
    let review: DeathReview = serde_json::from_slice(bytes).map_err(|_| "团队死亡明细格式无效")?;
    if limit == 0 || limit > config::REVIEW_PAGE_LIMIT || review.source_kind != "wcl" || review.death.event_id != event_id || review.death.kind != "death"
        || !valid_event(&review.death) || !review.death.target_is_player || review.death.target_actor_id.unwrap_or(0) <= 0
        || !matches!(review.availability.as_str(), "ready" | "notConfigured" | "reportChanged")
        || review.events.len() > limit as usize || review.total > config::REVIEW_MAX_ROWS || review.events.len() > review.total
        || review.observed_count < review.total || review.truncated != (review.observed_count > review.total)
        || review.prior_auras.len() > config::REVIEW_PRIOR_AURA_LIMIT
        || review.window_start_ms < 0 || review.window_end_ms != review.death.pull_time_ms
        || review.window_end_ms < review.window_start_ms || review.window_end_ms - review.window_start_ms > config::REVIEW_WINDOW_MAX_MS
        || review.next_cursor.as_ref().is_some_and(|value| value.len() > config::EVENT_CURSOR_MAX_BYTES)
        || review.availability == "ready" && (review.revision.len() != 64 || !review.revision.bytes().all(|byte| byte.is_ascii_hexdigit()))
        || review.has_more && (review.events.is_empty() || review.next_cursor.as_ref().is_none_or(|value| value.is_empty()))
    {
        return Err("团队死亡明细超出快照边界".into());
    }
    let mut ids = HashSet::new();
    let mut previous = review.window_start_ms;
    for event in &review.events {
        if !valid_event(event) || event.identity_namespace != review.death.identity_namespace
            || !ids.insert(&event.event_id) || event.pull_time_ms < previous || event.pull_time_ms > review.window_end_ms
            || event.target_actor_id != review.death.target_actor_id && (event.health.is_some() || event.max_health.is_some())
        {
            return Err("团队死亡分页含混源、乱序或无效数值".into());
        }
        previous = event.pull_time_ms;
    }
    for event in &review.prior_auras {
        if !valid_event(event) || event.identity_namespace != review.death.identity_namespace
            || event.target_actor_id != review.death.target_actor_id || event.pull_time_ms >= review.window_start_ms
            || !event.kind.starts_with("buff") && !event.kind.starts_with("debuff")
        {
            return Err("团队死亡前置光环来源无效".into());
        }
    }
    Ok(review)
}

/// Rust持有当前平台凭证，每页重查连接代次，网页不接触WCL或平台令牌。
#[tauri::command]
pub async fn get_cloud_death_review(pull_id: String, event_id: String, cursor: Option<String>, limit: u32,
    refresh: Option<bool>, state: State<'_, CloudState>) -> Result<DeathReview, String> {
    let recording = uuid::Uuid::parse_str(&pull_id).map_err(|_| "团队录像身份无效")?;
    if event_id.is_empty() || event_id.len() > config::REVIEW_EVENT_ID_MAX_BYTES || limit == 0 || limit > config::REVIEW_PAGE_LIMIT
        || cursor.as_ref().is_some_and(|value| value.len() > config::EVENT_CURSOR_MAX_BYTES)
    {
        return Err("团队死亡明细参数无效".into());
    }
    let client = ReplayClient::current(&state).await?;
    let team = client.settings.team_id.as_deref().ok_or("请先选择团队")?;
    let route = format!("/teams/{team}/recordings/{recording}/death-review");
    let mut url = reqwest::Url::parse(&format!("{}{API_PREFIX}{route}", client.settings.endpoint)).map_err(|_| "死亡明细地址无效")?;
    url.query_pairs_mut().append_pair("event_id", &event_id).append_pair("limit", &limit.to_string());
    if let Some(cursor) = cursor.as_deref() { url.query_pairs_mut().append_pair("cursor", cursor); }
    if refresh.unwrap_or(false) { url.query_pairs_mut().append_pair("refresh", "true"); }
    let bytes = client.request(reqwest::Method::GET, &format!("{route}?{}", url.query().unwrap_or("")), false, None).await?;
    if !client.still_current(&state).await { return Err("云端连接已变化，请重新读取死亡明细".into()); }
    decode(&bytes, &event_id, limit)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn page() -> serde_json::Value {
        let death = json!({"eventId":"death-1","pullTimeMs":1000,"kind":"death","sourceName":"未知来源","sourceGuid":"",
            "targetName":"死者","targetGuid":"","sourceIsPlayer":false,"targetIsPlayer":true,"identityNamespace":"wcl:abcdefghijklmnop",
            "sourceActorId":null,"targetActorId":1,"spellId":0,"spellName":"","rawType":"death"});
        let mut damage = death.clone();
        damage["eventId"] = json!("damage-1"); damage["pullTimeMs"] = json!(900); damage["kind"] = json!("damage"); damage["amount"] = json!(0);
        json!({"revision":"a".repeat(64),"sourceKind":"wcl","availability":"ready","death":death,
            "windowStartMs":0,"windowEndMs":1000,"events":[damage],"priorAuras":[],"total":1,"observedCount":1,
            "truncated":false,"priorAurasTruncated":false,"parseErrors":0,"pairedRowsRemoved":0,
            "victimRecordingIds":[],"relatedRecordingIds":[],"hasMore":false})
    }

    #[test]
    fn cloud_death_keeps_report_actor_and_unknown_values() {
        let bytes = serde_json::to_vec(&page()).unwrap();
        let document = decode(&bytes, "death-1", 250).unwrap();
        assert_eq!(document.events[0].amount, Some(0.0));
        assert_eq!(document.events[0].health, None);
        assert_eq!(document.death.target_actor_id, Some(1));
        assert!(decode(&bytes, "another-death", 250).is_err());
        assert!(decode(&bytes, "death-1", 0).is_err());
        let mut unavailable = page();
        unavailable["availability"] = json!("notConfigured"); unavailable["revision"] = json!("");
        unavailable["events"] = json!([]); unavailable["total"] = json!(0); unavailable["observedCount"] = json!(0);
        assert!(decode(&serde_json::to_vec(&unavailable).unwrap(), "death-1", 250).is_ok());
    }

    #[test]
    fn cloud_death_rejects_mixed_scope_and_invalid_resources() {
        for (key, value) in [("sourceGuid", json!("Player-invented")), ("identityNamespace", json!("wcl:otherreport00000")),
            ("amount", json!(-1)), ("pullTimeMs", json!(1001)), ("kind", json!("unrecognized"))] {
            let mut document = page(); document["events"][0][key] = value;
            assert!(decode(&serde_json::to_vec(&document).unwrap(), "death-1", 250).is_err(), "{key}");
        }
        let mut document = page();
        document["events"][0]["health"] = json!(100); document["events"][0]["maxHealth"] = json!(50);
        assert!(decode(&serde_json::to_vec(&document).unwrap(), "death-1", 250).is_err());
        document["events"][0]["health"] = json!(10); document["events"][0]["targetActorId"] = json!(2);
        assert!(decode(&serde_json::to_vec(&document).unwrap(), "death-1", 250).is_err());
    }
}
