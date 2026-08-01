use serde::{Deserialize, Serialize};

/// 提供给前端的 OBS 连接与录制摘要。
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObsStatus {
    pub connected: bool,
    pub obs_version: Option<String>,
    pub recording_active: bool,
    pub recording_paused: bool,
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

/// 可由客户端修改的 OBS 视频参数。
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObsVideoSettings {
    pub base_width: u32,
    pub base_height: u32,
    pub output_width: u32,
    pub output_height: u32,
    pub fps_numerator: u32,
    pub fps_denominator: u32,
    pub encoder_id: String,
    pub encoder_name: String,
    pub encoders: Vec<ObsSelectOption>,
}

/// OBS 下拉选项。
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObsSelectOption {
    pub id: String,
    pub name: String,
}

/// OBS 游戏画面捕捉源的当前设置和可选项。
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObsCaptureSettings {
    pub input_kind: String,
    pub auto_capture: bool,
    pub window: Option<String>,
    pub capture_cursor: bool,
    pub input_kinds: Vec<ObsSelectOption>,
    pub windows: Vec<ObsSelectOption>,
}

/// OBS 音频输入的音量和静音参数。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObsAudioSettings {
    pub input_name: String,
    pub enabled: bool,
    pub volume_percent: u8,
    pub source_id: Option<String>,
}

/// OBS 音频源提供的可选设备或应用程序。
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObsAudioSourceOption {
    pub id: String,
    pub name: String,
}

/// OBS 专属场景中的声音通道及其可选音源。
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObsAudioInput {
    pub name: String,
    pub enabled: bool,
    pub volume_percent: u8,
    pub meter_db: Option<f32>,
    pub kind: String,
    pub source_id: String,
    pub sources: Vec<ObsAudioSourceOption>,
}

/// 校验视频尺寸和帧率，避免向 OBS 发送无效参数。
pub fn validate_video_settings(settings: &ObsVideoSettings) -> Result<(), String> {
    if [
        settings.base_width,
        settings.base_height,
        settings.output_width,
        settings.output_height,
    ]
    .contains(&0)
    {
        return Err("OBS 视频分辨率必须大于 0".to_string());
    }
    if settings.fps_numerator == 0 || settings.fps_denominator == 0 {
        return Err("OBS 帧率必须大于 0".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{validate_video_settings, ObsVideoSettings};

    #[test]
    fn rejects_invalid_video_size() {
        let settings = ObsVideoSettings {
            base_width: 1920,
            base_height: 1080,
            output_width: 0,
            output_height: 1080,
            fps_numerator: 60,
            fps_denominator: 1,
            encoder_id: "nvenc".to_string(),
            encoder_name: "NVIDIA NVENC H.264".to_string(),
            encoders: Vec::new(),
        };
        assert_eq!(
            validate_video_settings(&settings),
            Err("OBS 视频分辨率必须大于 0".to_string())
        );
    }
}
