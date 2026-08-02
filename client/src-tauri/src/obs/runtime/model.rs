use serde::Serialize;

/// 提供给前端的 OBS 连接与录制摘要。
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObsStatus {
    pub connected: bool,
    pub obs_version: Option<String>,
    pub recording_active: bool,
    pub recording_paused: bool,
    pub live_active: bool,
    pub runtime_seconds: u64,
    pub output_directory: Option<String>,
    pub scene_ready: bool,
    pub video_ready: bool,
    pub capture_ready: bool,
    pub audio_ready: bool,
    pub ready: bool,
    pub readiness_message: String,
    pub error: Option<String>,
}

/// OBS 便携运行时的安装状态。
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObsInstallationStatus {
    pub expected_version: String,
    pub installed: bool,
    pub installing: bool,
    pub install_dir: String,
    pub progress_percent: u8,
    pub install_phase: String,
}
