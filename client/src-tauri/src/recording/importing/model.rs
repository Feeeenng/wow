use serde::{Deserialize, Serialize};

/// 只持久化用户明确选定的路径，首次使用不默认访问任何日志。
#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreferences {
    pub directory: String,
    pub log_paths: Vec<String>,
}

/// 可通过旁车 ID 限定本次导入；空列表代表扫描目录内全部候选。
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportRequest {
    pub directory: String,
    pub log_paths: Vec<String>,
    #[serde(default)]
    pub recording_ids: Vec<String>,
}

/// 导入阶段仅指日志与索引任务，成片处理状态继续由录像列表提供。
#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportProgress {
    pub task_id: Option<String>,
    pub status: ImportStatus,
    pub total_recordings: usize,
    pub processed_recordings: usize,
    pub imported_count: usize,
    pub skipped_count: usize,
    pub failed_count: usize,
    pub bytes_read: u64,
    pub total_bytes: u64,
    pub current_file: Option<String>,
    pub error: Option<String>,
    pub issues: Vec<String>,
    pub pull_ids: Vec<String>,
}

#[derive(Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ImportStatus {
    #[default]
    Idle,
    Scanning,
    Indexing,
    Completed,
    Cancelled,
    Failed,
}

impl ImportStatus {
    /// 只有扫描与索引阶段允许取消，不取消已经持久化的录像。
    pub fn running(&self) -> bool {
        matches!(self, Self::Scanning | Self::Indexing)
    }
}
