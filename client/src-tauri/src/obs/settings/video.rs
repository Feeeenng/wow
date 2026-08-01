use obws::requests::{config::SetVideoSettings, profiles::SetParameter};
use tauri::{AppHandle, State};

use crate::obs::{
    common::obs_error,
    runtime::{
        config::{load_or_create_config, read_obs_encoder, read_obs_encoders, ObsEncoder},
        service::ObsState,
    },
};

use super::model::{validate_video_settings, ObsSelectOption, ObsVideoSettings};

/// 读取 OBS 当前视频参数及 OBS 实际提供的编码器列表。
#[tauri::command]
pub async fn get_obs_video_settings(
    app: AppHandle,
    state: State<'_, ObsState>,
) -> Result<ObsVideoSettings, String> {
    let guard = state.client.read().await;
    let client = guard
        .as_ref()
        .ok_or_else(|| "请先启动并连接 OBS".to_string())?;
    let value = client
        .config()
        .video_settings()
        .await
        .map_err(|error| obs_error("读取 OBS 视频设置失败", error))?;
    let config = load_or_create_config(&app, None).await?;
    let fallback_encoder = read_obs_encoder(&config).await;
    let output_mode = client
        .profiles()
        .parameter("Output", "Mode")
        .await
        .ok()
        .and_then(|parameter| parameter.value)
        .unwrap_or_else(|| "Simple".to_string());
    let (encoder_category, encoder_key) = encoder_profile_key(&output_mode);
    let encoder_id = client
        .profiles()
        .parameter(encoder_category, encoder_key)
        .await
        .ok()
        .and_then(|parameter| parameter.value)
        .filter(|value| value != "none")
        .unwrap_or_else(|| fallback_encoder.id.clone());
    let mut encoders = read_obs_encoders(&config).await;
    if !encoders.iter().any(|encoder| encoder.id == encoder_id) {
        encoders.push(ObsEncoder {
            id: encoder_id.clone(),
            name: fallback_encoder.name,
        });
    }
    let encoder_name = encoders
        .iter()
        .find(|encoder| encoder.id == encoder_id)
        .map(|encoder| encoder.name.clone())
        .unwrap_or_else(|| encoder_id.clone());
    Ok(ObsVideoSettings {
        base_width: value.base_width,
        base_height: value.base_height,
        output_width: value.output_width,
        output_height: value.output_height,
        fps_numerator: value.fps_numerator,
        fps_denominator: value.fps_denominator,
        encoder_id,
        encoder_name,
        encoders: encoders
            .into_iter()
            .map(|encoder| ObsSelectOption {
                id: encoder.id,
                name: encoder.name,
            })
            .collect(),
    })
}

/// 将编码器、分辨率和帧率写回 OBS 当前配置。
#[tauri::command]
pub async fn set_obs_video_settings(
    settings: ObsVideoSettings,
    state: State<'_, ObsState>,
) -> Result<(), String> {
    validate_video_settings(&settings)?;
    let guard = state.client.read().await;
    let client = guard
        .as_ref()
        .ok_or_else(|| "请先启动并连接 OBS".to_string())?;
    let output_mode = client
        .profiles()
        .parameter("Output", "Mode")
        .await
        .ok()
        .and_then(|parameter| parameter.value)
        .unwrap_or_else(|| "Simple".to_string());
    let (encoder_category, encoder_key) = encoder_profile_key(&output_mode);
    if !settings.encoder_id.trim().is_empty() {
        client
            .profiles()
            .set_parameter(SetParameter {
                category: encoder_category,
                name: encoder_key,
                value: Some(settings.encoder_id.trim()),
            })
            .await
            .map_err(|error| obs_error("更新 OBS 编码器失败", error))?;
    }
    client
        .config()
        .set_video_settings(SetVideoSettings {
            fps_numerator: Some(settings.fps_numerator),
            fps_denominator: Some(settings.fps_denominator),
            base_width: Some(settings.base_width),
            base_height: Some(settings.base_height),
            output_width: Some(settings.output_width),
            output_height: Some(settings.output_height),
        })
        .await
        .map_err(|error| obs_error("更新 OBS 视频设置失败", error))
}

fn encoder_profile_key(output_mode: &str) -> (&'static str, &'static str) {
    if output_mode == "Advanced" {
        ("AdvOut", "RecEncoder")
    } else {
        ("SimpleOutput", "RecEncoder")
    }
}
