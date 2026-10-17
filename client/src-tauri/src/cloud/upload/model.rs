use crate::cloud::api::model::Registration;
use serde::{Deserialize, Serialize};

/// 持久化用户意图；上传进程、连接和已传字节必须重新向服务器核验。
#[derive(Clone, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum UploadIntent {
    Queued,
    Paused,
    CancelRequested,
    Cancelled,
    Completed,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredJob {
    pub job_id: String,
    pub pull_id: String,
    pub origin: String,
    pub user_id: String,
    pub team_id: String,
    pub device_id: String,
    #[serde(default)]
    pub encounter_name: String,
    /// 用户显式选择的既有团队场次，服务器必须重新核验团队范围。
    #[serde(default)]
    pub team_pull_id: Option<String>,
    pub intent: UploadIntent,
    pub file_size_bytes: u64,
    pub registration: Option<Registration>,
    pub upload_id: Option<String>,
    #[serde(default)]
    pub restart_requested: bool,
}

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Observation {
    pub status: JobStatus,
    pub uploaded_bytes: u64,
    pub recording_status: Option<String>,
    pub verification: Option<String>,
    pub full_file_sha256_verified: bool,
    pub error: Option<String>,
}

#[derive(Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum JobStatus {
    #[default]
    Unverified,
    Queued,
    Checking,
    Hashing,
    Registering,
    Uploading,
    Paused,
    Cancelling,
    Cancelled,
    Uploaded,
    Failed,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobView {
    pub team_pull_id: Option<String>,
    pub job_id: String,
    pub pull_id: String,
    pub origin: String,
    pub team_id: String,
    pub intent: UploadIntent,
    pub encounter_name: String,
    pub status: JobStatus,
    pub uploaded_bytes: u64,
    pub file_size_bytes: u64,
    pub recording_status: Option<String>,
    pub verification: Option<String>,
    pub full_file_sha256_verified: bool,
    pub error: Option<String>,
}
