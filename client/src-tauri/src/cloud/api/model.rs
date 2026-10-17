use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

use crate::recording::model::ClipInterval;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Player {
    pub guid: String,
    pub name: String,
    pub server_name: Option<String>,
    pub full_type: Option<String>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Registration {
    pub team_id: String,
    pub device_id: String,
    pub local_pull_id: String,
    pub artifact_version: String,
    pub file_size_bytes: u64,
    pub file_sha256: String,
    pub character_guid: String,
    pub character_name: String,
    pub server_name: Option<String>,
    pub encounter_id: u32,
    pub encounter_name: String,
    pub difficulty_id: u32,
    pub encounter_start_unix_ms: i64,
    pub encounter_end_unix_ms: i64,
    pub video_zero_ms: i64,
    pub video_duration_ms: u64,
    pub wcl_report_code: Option<String>,
    pub wcl_fight_id: Option<u32>,
    pub team_pull_id: Option<String>,
    pub players: Vec<Player>,
    pub intervals: Vec<ClipInterval>,
    #[serde(default)]
    pub media_calibrated: bool,
    #[serde(default)]
    pub clock_discontinuous: bool,
    pub calibration_error: Option<String>,
    #[serde(default)]
    pub has_gap: bool,
    pub success: Option<bool>,
    pub group_size: Option<u32>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmedPart {
    pub part_number: u32,
    pub size_bytes: u64,
    pub checksum_sha256: String,
    pub etag: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadStatus {
    pub recording_id: String,
    pub team_pull_id: String,
    pub upload_id: String,
    pub upload_status: String,
    pub recording_status: String,
    pub part_size_bytes: u64,
    pub total_parts: u32,
    pub confirmed_parts: Vec<ConfirmedPart>,
    pub uploaded_bytes: u64,
    pub file_size_bytes: u64,
    #[serde(default)]
    pub full_file_sha256_verified: bool,
    #[serde(default)]
    pub verification: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresignedPart {
    pub part_number: u32,
    pub size_bytes: u64,
    pub url: String,
    pub headers: BTreeMap<String, String>,
    pub expires_in_seconds: u64,
}
