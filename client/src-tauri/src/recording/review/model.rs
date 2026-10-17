use crate::recording::model::TimelineEvent;
use serde::{Deserialize, Serialize};

/// 明细数值为来源记录口径；None表示缺失，不能由邻接采样补零。
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewEvent {
    pub event_id: String,
    pub pull_time_ms: i64,
    pub kind: String,
    pub source_name: String,
    pub source_guid: String,
    pub target_name: String,
    pub target_guid: String,
    pub spell_id: u32,
    pub spell_name: String,
    pub extra_spell_id: Option<u32>,
    pub stack_count: Option<u32>,
    pub empower_level: Option<u32>,
    pub identity_namespace: Option<String>,
    pub source_actor_id: Option<i64>,
    pub target_actor_id: Option<i64>,
    pub source_is_player: bool,
    pub target_is_player: bool,
    pub raw_type: String,
    pub amount: Option<f64>,
    pub absorbed: Option<f64>,
    pub overkill: Option<f64>,
    pub overheal: Option<f64>,
    pub health: Option<f64>,
    pub max_health: Option<f64>,
    pub related_source_guid: Option<String>,
    pub related_source_name: Option<String>,
    /// 仅内部配对采集／落地两份近战记录，不进入IPC或持久内容。
    #[serde(skip)]
    pub pairing_key: Option<String>,
}

impl ReviewEvent {
    /// 关键事件身份沿用原字节位置，数值字段保持未知。
    pub fn from_timeline(event: &TimelineEvent, raw_type: &str) -> Self {
        Self {
            event_id: event.event_id.clone(),
            pull_time_ms: event.pull_time_ms as i64,
            kind: serde_json::to_value(&event.kind)
                .expect("固定枚举可序列化")
                .as_str()
                .expect("枚举为字符串")
                .to_string(),
            source_name: event.source_name.clone(),
            source_guid: event.source_guid.clone(),
            target_name: event.target_name.clone(),
            target_guid: event.target_guid.clone(),
            source_is_player: event.source_guid.starts_with("Player-"),
            target_is_player: event.target_guid.starts_with("Player-"),
            spell_id: event.spell_id,
            spell_name: event.spell_name.clone(),
            extra_spell_id: event.extra_spell_id,
            stack_count: event.stack_count,
            empower_level: event.empower_level,
            identity_namespace: None,
            source_actor_id: None,
            target_actor_id: None,
            raw_type: raw_type.to_string(),
            amount: None,
            absorbed: None,
            overkill: None,
            overheal: None,
            health: None,
            max_health: None,
            related_source_guid: None,
            related_source_name: None,
            pairing_key: None,
        }
    }
}

/// 来源缺失与完整空窗口分开表达，页游标限定同一死亡和数据版本。
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeathReview {
    pub revision: String,
    pub source_kind: String,
    pub availability: String,
    pub message: Option<String>,
    pub death: ReviewEvent,
    pub window_start_ms: i64,
    pub window_end_ms: i64,
    pub events: Vec<ReviewEvent>,
    pub prior_auras: Vec<ReviewEvent>,
    pub total: usize,
    pub observed_count: usize,
    pub truncated: bool,
    pub prior_auras_truncated: bool,
    pub parse_errors: usize,
    pub paired_rows_removed: usize,
    pub victim_recording_ids: Vec<String>,
    pub related_recording_ids: Vec<String>,
    pub next_cursor: Option<String>,
    pub has_more: bool,
}
