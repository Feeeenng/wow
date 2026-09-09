use serde::{Deserialize, Serialize};

use crate::combat_log::model::CombatLogCursor;
use std::path::PathBuf;

pub const RECORDING_INDEX_VERSION: u32 = 1;

/// 表示 OBS 持续录像产生的一段源文件及其墙钟范围。
#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceRecording {
    pub path: PathBuf,
    pub started_at_unix_ms: i64,
    pub ended_at_unix_ms: Option<i64>,
}

/// 描述最终 Boss 视频使用的一个源文件区间。
#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceSlice {
    pub path: PathBuf,
    pub offset_ms: u64,
    pub duration_ms: u64,
}

/// 描述裁切窗口映射结果及日志零点在视频内的位置。
#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipMapping {
    pub slices: Vec<SourceSlice>,
    pub actual_start_unix_ms: i64,
    pub actual_end_unix_ms: i64,
    pub video_zero_ms: u64,
    pub has_gap: bool,
}

/// 保存本地录制领域可恢复的最小业务状态。
#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingIndex {
    pub schema_version: u32,
    #[serde(default)]
    pub combat_log_cursor: CombatLogCursor,
    pub active_pull: Option<BossPull>,
    #[serde(default)]
    pub pulls: Vec<BossPull>,
    #[serde(default)]
    pub sources: Vec<SourceRecording>,
    #[serde(default)]
    pub diagnostics: Vec<String>,
}

impl Default for RecordingIndex {
    fn default() -> Self {
        Self {
            schema_version: RECORDING_INDEX_VERSION,
            combat_log_cursor: CombatLogCursor::default(),
            active_pull: None,
            pulls: Vec::new(),
            sources: Vec::new(),
            diagnostics: Vec::new(),
        }
    }
}

/// 描述一个 Boss Pull 当前所处的本地处理阶段。
#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PullState {
    Recording,
    WaitingForTail,
    WaitingForSource,
    WaitingForPlayback,
    Processing,
    Ready,
    Partial,
    Failed,
    Interrupted,
}

/// 描述 Pull 正常或异常结束的原因。
#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PullEndReason {
    EncounterEnd,
    InterruptedByNextPull,
}

/// 区分时间轴事件属于 Boss 还是本机玩家。
#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TimelineOwner {
    Boss,
    Player,
}

/// 区分施法开始与施法成功，供回放悬停说明使用。
#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TimelineEventKind {
    CastStart,
    CastSuccess,
}

/// 保存 CombatLog 中可映射到战斗时间轴的真实技能事件。
#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineEvent {
    pub pull_time_ms: u64,
    pub owner: TimelineOwner,
    pub kind: TimelineEventKind,
    pub source_name: String,
    pub spell_id: u32,
    pub spell_name: String,
}

/// 保存从本地 CombatLog 识别出的参战玩家基础身份。
#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingPlayer {
    pub actor_id: Option<u32>,
    pub guid: String,
    pub name: String,
    pub server_name: Option<String>,
    pub full_type: Option<String>,
}

/// 保存 Boss Pull 与原始日志字节范围之间的稳定关联。
#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BossPull {
    pub pull_id: String,
    pub encounter_id: u32,
    pub encounter_name: String,
    pub difficulty_id: u32,
    pub group_size: u32,
    pub success: Option<bool>,
    pub encounter_start_unix_ms: i64,
    pub encounter_end_unix_ms: Option<i64>,
    pub clip_start_unix_ms: i64,
    pub clip_end_unix_ms: Option<i64>,
    pub log_file_id: String,
    pub log_start_offset: u64,
    pub log_end_offset: Option<u64>,
    pub state: PullState,
    pub end_reason: Option<PullEndReason>,
    #[serde(default)]
    pub player_name: Option<String>,
    #[serde(default)]
    pub timeline_events: Vec<TimelineEvent>,
    #[serde(default)]
    pub players: Vec<RecordingPlayer>,
    #[serde(default)]
    pub timeline_indexed: bool,
    #[serde(default)]
    pub mapping: Option<ClipMapping>,
    #[serde(default)]
    pub video_path: Option<PathBuf>,
    #[serde(default)]
    pub playback_path: Option<PathBuf>,
    #[serde(default)]
    pub error: Option<String>,
}

/// 保存 metadata.json 中带名称的数字标识。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetadataNamedId {
    pub id: u32,
    pub name: String,
}

/// 保存 metadata.json 中的内容分类。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetadataContentType {
    pub id: &'static str,
    pub name: &'static str,
}

/// 保存与 Archon 本地录像相近、但不伪造服务端字段的回放元信息。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingMetadata<'a> {
    pub id: &'a str,
    pub actor_id: Option<u32>,
    pub source: &'static str,
    pub key: &'a str,
    pub start_time_offset_ms: u64,
    pub name: String,
    pub content_type: MetadataContentType,
    pub zone: Option<MetadataNamedId>,
    pub difficulty: MetadataNamedId,
    pub size: MetadataNamedId,
    pub encounter: MetadataNamedId,
    pub level: Option<u32>,
    pub start_time: i64,
    pub end_time: Option<i64>,
    pub is_kill: Option<bool>,
    pub players: &'a [RecordingPlayer],
    pub server_fight: Option<()>,
    pub server_fight_last_updated: Option<i64>,
    pub server_video: Option<()>,
    pub server_video_last_updated: Option<i64>,
    pub other_videos: &'a [()],
    pub other_videos_last_updated: Option<i64>,
    pub is_favorited: bool,
}

/// 保存回放时间轴所需的 CombatLog 摘要，避免前端重新读取原始日志。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullCombatLog<'a> {
    pub schema_version: u32,
    pub pull_id: &'a str,
    pub log_file_id: &'a str,
    pub log_start_offset: u64,
    pub log_end_offset: Option<u64>,
    pub player_name: &'a Option<String>,
    pub players: &'a [RecordingPlayer],
    pub events: &'a [TimelineEvent],
}
