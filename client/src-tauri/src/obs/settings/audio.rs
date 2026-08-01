use std::{collections::HashMap, sync::Arc};

use futures_util::StreamExt;
use obws::{
    events::Event,
    requests::inputs::{Create, InputId, SetSettings, Volume},
    Client,
};
use serde_json::json;
use tauri::State;
use tokio::sync::RwLock;

use crate::obs::{
    common::{obs_error, MANAGED_SCENE},
    runtime::service::ObsState,
};

use super::model::{ObsAudioInput, ObsAudioSettings, ObsAudioSourceOption};

const LEGACY_AUDIO_INPUTS: [&str; 2] = ["WoW 游戏声音", "电脑声音"];
pub(crate) const DESKTOP_AUDIO_INPUT: &str = "扬声器";
pub(crate) const MICROPHONE_INPUT: &str = "麦克风";
const DEFAULT_DEVICE_ID: &str = "default";

/// 确保专属场景内存在 OBS 管理的扬声器和麦克风来源。
pub(crate) async fn ensure_audio_sources(client: &Client) -> Result<(), String> {
    let inputs = client
        .inputs()
        .list(None)
        .await
        .map_err(|error| obs_error("读取 OBS 输入源失败", error))?;
    let kinds = client.inputs().list_kinds(true).await.unwrap_or_default();
    for input_name in LEGACY_AUDIO_INPUTS {
        if inputs.iter().any(|input| input_name == input.id) {
            client
                .inputs()
                .remove(InputId::Name(input_name))
                .await
                .map_err(|error| obs_error("清理旧版声音来源失败", error))?;
        }
    }

    let audio_sources = [
        (DESKTOP_AUDIO_INPUT, "wasapi_output_capture"),
        (MICROPHONE_INPUT, "wasapi_input_capture"),
    ];
    for (name, kind) in audio_sources {
        if kinds.iter().any(|value| value == kind)
            && !inputs.iter().any(|input| name == input.id)
        {
            client
                .inputs()
                .create(Create {
                    scene: MANAGED_SCENE.into(),
                    input: name,
                    kind,
                    settings: Some(json!({ "device_id": DEFAULT_DEVICE_ID })),
                    enabled: Some(true),
                })
                .await
                .map_err(|error| obs_error("创建 OBS 声音来源失败", error))?;
        }
    }
    Ok(())
}

/// 监听 OBS 高频音量表事件，并缓存每个输入的实际峰值 dB。
pub(crate) fn start_audio_meter_listener(
    client: &Client,
    levels: Arc<RwLock<HashMap<String, f32>>>,
) -> Result<(), String> {
    let mut events = client
        .events()
        .map_err(|error| obs_error("订阅 OBS 音量表失败", error))?;
    tauri::async_runtime::spawn(async move {
        while let Some(event) = events.next().await {
            if let Event::InputVolumeMeters { inputs } = event {
                let mut current = levels.write().await;
                for input in inputs {
                    let peak = input
                        .levels
                        .iter()
                        .map(|channel| channel[1])
                        .fold(0.0_f32, f32::max);
                    current.insert(input.name, multiplier_to_db(peak));
                }
            }
        }
    });
    Ok(())
}

fn multiplier_to_db(value: f32) -> f32 {
    if value > 0.0 {
        (20.0 * value.log10()).clamp(-100.0, 0.0)
    } else {
        -100.0
    }
}

/// 读取 OBS 专属场景中的声音设备、推子和实时音量表数据。
#[tauri::command]
pub async fn get_obs_audio_inputs(
    state: State<'_, ObsState>,
) -> Result<Vec<ObsAudioInput>, String> {
    let guard = state.client.read().await;
    let client = guard
        .as_ref()
        .ok_or_else(|| "请先启动并连接 OBS".to_string())?;
    let existing = client
        .inputs()
        .list(None)
        .await
        .map_err(|error| obs_error("读取 OBS 音频输入失败", error))?;
    let candidates = [
        (DESKTOP_AUDIO_INPUT, "desktop", "device_id"),
        (MICROPHONE_INPUT, "microphone", "device_id"),
    ];
    let mut inputs = Vec::new();
    for (name, kind, property) in candidates {
        if !existing.iter().any(|input| name == input.id) {
            continue;
        }
        let id = InputId::Name(name);
        let muted = client
            .inputs()
            .muted(id)
            .await
            .map_err(|error| obs_error("读取 OBS 音频静音状态失败", error))?;
        let volume = client
            .inputs()
            .volume(id)
            .await
            .map_err(|error| obs_error("读取 OBS 音量失败", error))?;
        let settings = client
            .inputs()
            .settings::<serde_json::Value>(id)
            .await
            .map_err(|error| obs_error("读取 OBS 音源设置失败", error))?;
        let mut sources: Vec<ObsAudioSourceOption> = client
            .inputs()
            .properties_list_property_items(id, property)
            .await
            .unwrap_or_default()
            .into_iter()
            .filter(|item| item.enabled)
            .filter_map(|item| {
                item.value.as_str().map(|value| ObsAudioSourceOption {
                    id: value.to_string(),
                    name: item.name,
                })
            })
            .collect();
        let configured_source = settings
            .settings
            .get(property)
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default();
        let source_id = if configured_source.is_empty() {
            DEFAULT_DEVICE_ID
        } else {
            configured_source
        };
        if source_id == DEFAULT_DEVICE_ID
            && !sources.iter().any(|source| source.id == DEFAULT_DEVICE_ID)
        {
            sources.insert(
                0,
                ObsAudioSourceOption {
                    id: DEFAULT_DEVICE_ID.to_string(),
                    name: "默认".to_string(),
                },
            );
        }
        let meter_db = state.audio_levels.read().await.get(name).copied();
        inputs.push(ObsAudioInput {
            name: name.to_string(),
            enabled: !muted,
            volume_percent: (volume.mul.clamp(0.0, 1.0) * 100.0).round() as u8,
            meter_db,
            kind: kind.to_string(),
            source_id: source_id.to_string(),
            sources,
        });
    }
    Ok(inputs)
}

/// 将设备和推子设置写回指定的受管 OBS 音频输入。
#[tauri::command]
pub async fn set_obs_audio_settings(
    settings: ObsAudioSettings,
    state: State<'_, ObsState>,
) -> Result<(), String> {
    let guard = state.client.read().await;
    let client = guard
        .as_ref()
        .ok_or_else(|| "请先启动并连接 OBS".to_string())?;
    let input_name = settings.input_name.trim();
    if ![DESKTOP_AUDIO_INPUT, MICROPHONE_INPUT].contains(&input_name) {
        return Err("不支持修改该 OBS 音频输入".to_string());
    }
    if let Some(source_id) = settings.source_id.as_deref() {
        client
            .inputs()
            .set_settings(SetSettings {
                input: InputId::Name(input_name),
                settings: &json!({ "device_id": source_id }),
                overlay: Some(true),
            })
            .await
            .map_err(|error| obs_error("更新 OBS 音源失败", error))?;
    }
    client
        .inputs()
        .set_muted(InputId::Name(input_name), !settings.enabled)
        .await
        .map_err(|error| obs_error("更新 OBS 音频状态失败", error))?;
    client
        .inputs()
        .set_volume(
            InputId::Name(input_name),
            Volume::Mul(f32::from(settings.volume_percent.min(100)) / 100.0),
        )
        .await
        .map_err(|error| obs_error("更新 OBS 音量失败", error))
}
