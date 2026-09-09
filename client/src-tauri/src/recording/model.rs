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
    pub mapping: Option<ClipMapping>,
    #[serde(default)]
    pub video_path: Option<PathBuf>,
    #[serde(default)]
    pub playback_path: Option<PathBuf>,
    #[serde(default)]
    pub error: Option<String>,
}

/// 与最终 MP4 同名保存的本地回放时间映射。
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullManifest<'a> {
    pub schema_version: u32,
    pub pull: &'a BossPull,
    pub mapping: &'a ClipMapping,
}
