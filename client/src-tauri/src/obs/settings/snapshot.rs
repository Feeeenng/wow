use tauri::{AppHandle, State};

use crate::local_state::LocalStateStore;
use crate::obs::runtime::service::ObsState;

use super::{
    audio::read_audio_inputs, capture::read_capture_settings, model::ObsSettingsSnapshot,
    video::read_video_settings,
};

const OBS_SETTINGS_SECTION: &str = "obsSettings";

/// 返回上次成功同步的 OBS 用户设置，供界面启动时快速恢复。
#[tauri::command]
pub async fn get_cached_obs_settings(
    store: State<'_, LocalStateStore>,
) -> Result<Option<ObsSettingsSnapshot>, String> {
    store.get(OBS_SETTINGS_SECTION).await
}

/// 从 OBS 读取完整设置快照，并将稳定设置保存到 Rust 本地状态文件。
#[tauri::command]
pub async fn get_obs_settings_snapshot(
    app: AppHandle,
    obs_state: State<'_, ObsState>,
    store: State<'_, LocalStateStore>,
) -> Result<ObsSettingsSnapshot, String> {
    let guard = obs_state.client.read().await;
    let client = guard
        .as_ref()
        .ok_or_else(|| "请先启动并连接 OBS".to_string())?;
    let video = read_video_settings(&app, client).await?;
    let capture = read_capture_settings(client).await?;
    let audio_inputs = read_audio_inputs(client, &obs_state).await?;
    let snapshot = ObsSettingsSnapshot {
        video,
        capture,
        audio_inputs,
    };
    let mut persisted = snapshot.clone();
    for input in &mut persisted.audio_inputs {
        input.meter_db = None;
    }
    store.set(OBS_SETTINGS_SECTION, &persisted).await?;
    Ok(snapshot)
}
