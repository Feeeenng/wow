use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// 描述自动发现 CombatLog 目录的确定性结果。
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DiscoveryResult {
    NotFound,
    Found(PathBuf),
    Multiple(Vec<PathBuf>),
}

/// 保存用户确认的 CombatLog 目录与监控开关。
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CombatLogSettings {
    pub directory: Option<PathBuf>,
    pub monitoring: bool,
}

impl Default for CombatLogSettings {
    fn default() -> Self {
        Self {
            directory: None,
            monitoring: true,
        }
    }
}

/// 提供给设置页的 CombatLog 实时状态。
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CombatLogStatus {
    pub directory: Option<String>,
    pub current_file: Option<String>,
    pub monitoring: bool,
    pub discovery_state: String,
    pub candidates: Vec<String>,
    pub error: Option<String>,
}

/// 标识正在增量读取的 CombatLog 文件。
#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CombatLogFileIdentity {
    pub canonical_path: String,
    pub created_at_unix_ms: u64,
}

/// 保存可恢复的 CombatLog 字节读取位置。
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CombatLogCursor {
    pub file: Option<CombatLogFileIdentity>,
    pub byte_offset: u64,
    pub incomplete_tail: Vec<u8>,
}

/// 携带原始字节范围的一行完整 CombatLog。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LogLine {
    pub text: String,
    pub start_offset: u64,
    pub end_offset: u64,
}

/// 描述 CombatLog 中一次 Boss 战开始事件。
#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EncounterStart {
    pub encounter_id: u32,
    pub encounter_name: String,
    pub difficulty_id: u32,
    pub group_size: u32,
    pub occurred_at_unix_ms: i64,
}

/// 描述 CombatLog 中一次 Boss 战结束事件。
#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EncounterEnd {
    pub encounter_id: u32,
    pub encounter_name: String,
    pub difficulty_id: u32,
    pub group_size: u32,
    pub success: bool,
    pub occurred_at_unix_ms: i64,
}

/// 第一阶段需要识别的 Boss 战边界事件。
#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum EncounterEvent {
    Start(EncounterStart),
    End(EncounterEnd),
}
