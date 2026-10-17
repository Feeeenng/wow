use serde::{Deserialize, Serialize};

use crate::combat_log::model::CombatLogCursor;
use std::path::PathBuf;

pub const RECORDING_INDEX_VERSION: u32 = 2;

/// 表示 OBS 持续录像产生的一段源文件及其墙钟范围。
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceRecording {
    pub path: PathBuf,
    pub started_at_unix_ms: i64,
    pub ended_at_unix_ms: Option<i64>,
    #[serde(default)]
    pub clock_sample: Option<RecordingClockSample>,
    #[serde(default)]
    pub clock_start_sample: Option<RecordingClockSample>,
    #[serde(default)]
    pub clock_discontinuous: bool,
}

/// 同一进程内的墙钟／单调时钟／OBS 输出进度观测，不跨进程比较单调值。
#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingClockSample {
    pub process_clock_id: String,
    pub output_epoch_id: String,
    pub unix_ms: i64,
    pub monotonic_ns: u64,
    pub output_duration_ms: u64,
    pub uncertainty_ms: u64,
    pub paused: bool,
}

/// 描述最终 Boss 视频使用的一个源文件区间。
#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceSlice {
    pub path: PathBuf,
    pub offset_ms: u64,
    pub duration_ms: u64,
    #[serde(default)]
    pub source_start_unix_ms: Option<i64>,
}

/// 保存有画面的连续战斗区间；缺失区间不以拼接后的媒体时间冒充。
#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipInterval {
    pub pull_start_ms: i64,
    pub pull_end_ms: i64,
    pub video_start_ms: i64,
    pub video_end_ms: i64,
}

/// 描述裁切窗口映射结果及日志零点在视频内的位置。
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipMapping {
    pub slices: Vec<SourceSlice>,
    pub actual_start_unix_ms: i64,
    pub actual_end_unix_ms: i64,
    pub video_zero_ms: i64,
    pub has_gap: bool,
    #[serde(default)]
    pub intervals: Vec<ClipInterval>,
    #[serde(default)]
    pub media_duration_ms: Option<u64>,
    #[serde(default)]
    pub media_calibrated: bool,
    #[serde(default)]
    pub calibration_error: Option<String>,
    #[serde(default)]
    pub clock_discontinuous: bool,
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
    LogUnavailable,
}

/// 区分时间轴事件属于 Boss 还是本机玩家。
#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TimelineOwner {
    Boss,
    Player,
    Team,
}

/// 区分实际日志事件，刷新、蓄力和复活不冒充普通施法或叠层。
#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TimelineEventKind {
    CastStart,
    CastSuccess,
    EmpowerStart,
    EmpowerEnd,
    EmpowerInterrupt,
    Resurrect,
    Death,
    BuffApply,
    BuffRefresh,
    BuffRemove,
    BuffStack,
    DebuffApply,
    DebuffRefresh,
    DebuffRemove,
    DebuffStack,
    Interrupt,
    Dispel,
}

/// 保存 CombatLog 中可映射到战斗时间轴的真实技能事件。
#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineEvent {
    #[serde(default)]
    pub event_id: String,
    pub pull_time_ms: u64,
    pub owner: TimelineOwner,
    pub kind: TimelineEventKind,
    pub source_name: String,
    #[serde(default)]
    pub source_guid: String,
    #[serde(default)]
    pub target_guid: String,
    #[serde(default)]
    pub target_name: String,
    #[serde(default)]
    pub extra_spell_id: Option<u32>,
    #[serde(default)]
    pub stack_count: Option<u32>,
    /// 只保存日志明确给出的蓄力等级，旧索引和非蓄力事件为 None。
    #[serde(default)]
    pub empower_level: Option<u32>,
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
    /// 仅当前进程内的事件变更序号，用于复用分页缓存，不写入持久索引。
    #[serde(skip)]
    pub(crate) event_generation: u64,
    #[serde(default)]
    pub players: Vec<RecordingPlayer>,
    #[serde(default)]
    pub timeline_indexed: bool,
    #[serde(default)]
    pub timeline_version: u32,
    #[serde(default)]
    pub timeline_parse_errors: u32,
    #[serde(default)]
    pub mapping: Option<ClipMapping>,
    #[serde(default)]
    pub video_path: Option<PathBuf>,
    /// 外部导入原片仅只读引用，所有派生产物必须写入应用目录。
    #[serde(default)]
    pub imported_source: Option<PathBuf>,
    /// 当前录像观看者 GUID；为空时保持本机日志 SELF 语义。
    #[serde(default)]
    pub recording_player_guid: Option<String>,
    /// 只有明确报告战斗或完全一致的日志边界才用于多视角归组。
    #[serde(default)]
    pub battle_key: Option<String>,
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
    pub schema_version: u32,
    pub mapping: &'a ClipMapping,
    pub id: &'a str,
    pub actor_id: Option<u32>,
    pub source: &'static str,
    pub key: &'a str,
    pub start_time_offset_ms: i64,
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

#[cfg(test)]
mod tests {
    use super::ClipMapping;

    #[test]
    fn legacy_gap_is_not_migrated_into_invented_intervals() {
        let mapping: ClipMapping = serde_json::from_str(
            r#"{
            "slices":[], "actualStartUnixMs":10000, "actualEndUnixMs":60000,
            "videoZeroMs":5000, "hasGap":true
        }"#,
        )
        .unwrap();
        assert!(mapping.has_gap);
        assert!(!mapping.media_calibrated);
        assert!(mapping.intervals.is_empty());
        assert_eq!(mapping.media_duration_ms, None);
    }
}
