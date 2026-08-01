use std::process::Command;
use std::{sync::atomic::AtomicBool, time::Instant};

use obws::{
    requests::{
        config::SetVideoSettings,
        inputs::{Create, InputId, SetSettings, Volume},
    },
    Client,
};
use serde_json::json;
use tauri::{AppHandle, State};
use tokio::sync::RwLock;

use super::config::{load_or_create_config, read_obs_encoder};
use super::model::{
    validate_video_settings, ObsAudioInput, ObsAudioSettings, ObsAudioSourceOption,
    ObsCaptureSettings, ObsStatus, ObsVideoSettings,
};

const GAME_CAPTURE_INPUT: &str = "WoW 游戏画面";
const MANAGED_SCENE: &str = "WoW Recorder";
const GAME_AUDIO_INPUT: &str = "WoW 游戏声音";
const DESKTOP_AUDIO_INPUT: &str = "电脑声音";
const MICROPHONE_INPUT: &str = "麦克风";

/// 保存当前唯一 OBS WebSocket 连接和安装任务状态。
#[derive(Default)]
pub struct ObsState {
    pub(crate) client: RwLock<Option<Client>>,
    pub(crate) connected_at: RwLock<Option<Instant>>,
    pub(crate) installing: AtomicBool,
    pub(crate) launching: AtomicBool,
}

fn obs_error(context: &str, error: impl std::fmt::Display) -> String {
    format!("{context}：{error}")
}

/// 查询已连接 OBS 的版本和录制状态。
async fn read_status(client: &Client, state: &ObsState) -> Result<ObsStatus, String> {
    let version = client
        .general()
        .version()
        .await
        .map_err(|error| obs_error("读取 OBS 版本失败", error))?;
    let recording = client
        .recording()
        .status()
        .await
        .map_err(|error| obs_error("读取 OBS 录制状态失败", error))?;
    let video = client
        .config()
        .video_settings()
        .await
        .map_err(|error| obs_error("读取 OBS 视频设置失败", error))?;
    let output_directory = client.config().record_directory().await.ok();
    let scenes = client
        .scenes()
        .list()
        .await
        .map_err(|error| obs_error("读取 OBS 场景失败", error))?;
    let inputs = client
        .inputs()
        .list(None)
        .await
        .map_err(|error| obs_error("读取 OBS 输入源失败", error))?;
    let scene_ready = scenes.scenes.iter().any(|scene| MANAGED_SCENE == scene.id);
    let capture_ready = inputs.iter().any(|input| GAME_CAPTURE_INPUT == input.id);
    let audio_ready = [GAME_AUDIO_INPUT, DESKTOP_AUDIO_INPUT, MICROPHONE_INPUT]
        .iter()
        .all(|name| inputs.iter().any(|input| *name == input.id));
    let video_ready = video.output_width >= 1920 && video.output_height >= 1080;
    let ready = scene_ready && capture_ready && audio_ready && video_ready;
    let readiness_message = if ready {
        "可以开始录制或直播".to_string()
    } else if !video_ready {
        "请将输出分辨率设置为 1080p 或更高".to_string()
    } else if !capture_ready {
        "请完成游戏画面捕捉设置".to_string()
    } else if !audio_ready {
        "请完成声音来源设置".to_string()
    } else {
        "正在准备 OBS 专属场景".to_string()
    };
    let runtime_seconds = state
        .connected_at
        .read()
        .await
        .as_ref()
        .map(|started| started.elapsed().as_secs())
        .unwrap_or(0);
    Ok(ObsStatus {
        connected: true,
        obs_version: Some(version.obs_studio_version.to_string()),
        recording_active: recording.active,
        recording_paused: recording.paused,
        runtime_seconds,
        output_directory,
        scene_ready,
        video_ready,
        capture_ready,
        audio_ready,
        ready,
        readiness_message,
        error: None,
    })
}

/// 确保 OBS 中存在客户端独占使用的场景和基础采集源。
async fn ensure_managed_scene(client: &Client) -> Result<(), String> {
    let scenes = client
        .scenes()
        .list()
        .await
        .map_err(|error| obs_error("读取 OBS 场景失败", error))?;
    let created = !scenes.scenes.iter().any(|scene| MANAGED_SCENE == scene.id);
    if created {
        client
            .scenes()
            .create(MANAGED_SCENE)
            .await
            .map_err(|error| obs_error("创建 OBS 专属场景失败", error))?;
        client
            .config()
            .set_video_settings(SetVideoSettings {
                base_width: Some(1920),
                base_height: Some(1080),
                output_width: Some(1920),
                output_height: Some(1080),
                fps_numerator: Some(60),
                fps_denominator: Some(1),
            })
            .await
            .map_err(|error| obs_error("初始化 1080p 视频设置失败", error))?;
    }
    client
        .scenes()
        .set_current_program_scene(MANAGED_SCENE)
        .await
        .map_err(|error| obs_error("切换 OBS 专属场景失败", error))?;

    let inputs = client
        .inputs()
        .list(None)
        .await
        .map_err(|error| obs_error("读取 OBS 输入源失败", error))?;
    if !inputs.iter().any(|input| GAME_CAPTURE_INPUT == input.id) {
        client
            .inputs()
            .create(Create {
                scene: MANAGED_SCENE.into(),
                input: GAME_CAPTURE_INPUT,
                kind: "game_capture",
                settings: Some(json!({ "capture_mode": "any_fullscreen", "capture_cursor": false })),
                enabled: Some(true),
            })
            .await
            .map_err(|error| obs_error("创建游戏捕捉源失败", error))?;
    }

    let kinds = client.inputs().list_kinds(true).await.unwrap_or_default();
    let audio_sources = [
        (GAME_AUDIO_INPUT, "wasapi_process_output_capture"),
        (DESKTOP_AUDIO_INPUT, "wasapi_output_capture"),
        (MICROPHONE_INPUT, "wasapi_input_capture"),
    ];
    for (name, kind) in audio_sources {
        if kinds.iter().any(|value| value == kind)
            && !inputs.iter().any(|input| name == input.id)
        {
            client
                .inputs()
                .create(Create::<serde_json::Value> {
                    scene: MANAGED_SCENE.into(),
                    input: name,
                    kind,
                    settings: None,
                    enabled: Some(true),
                })
                .await
                .map_err(|error| obs_error("创建 OBS 声音来源失败", error))?;
        }
    }
    Ok(())
}

/// 等待 OBS 输出状态切换，避免命令刚返回时读取到上一帧状态。
async fn wait_for_recording_state(client: &Client, expected: bool) -> Result<(), String> {
    for _ in 0..20 {
        let status = client
            .recording()
            .status()
            .await
            .map_err(|error| obs_error("确认 OBS 录制状态失败", error))?;
        if status.active == expected {
            return Ok(());
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    Err("OBS 录制状态切换超时".to_string())
}

/// 使用给定的本机凭据替换当前 OBS WebSocket 连接。
pub async fn connect_with_credentials(
    host: &str,
    port: u16,
    password: &str,
    state: &ObsState,
) -> Result<ObsStatus, String> {
    let client = Client::connect(host, port, (!password.is_empty()).then_some(password))
        .await
        .map_err(|error| obs_error("连接 OBS WebSocket 失败", error))?;
    ensure_managed_scene(&client).await?;
    let mut guard = state.client.write().await;
    if let Some(mut previous) = guard.take() {
        previous.disconnect().await;
    }
    *guard = Some(client);
    if state.connected_at.read().await.is_none() {
        *state.connected_at.write().await = Some(Instant::now());
    }
    read_status(guard.as_ref().expect("OBS 连接刚写入"), state).await
}

/// 返回当前 OBS 连接摘要，连接失效时返回未连接状态。
#[tauri::command]
pub async fn get_obs_status(state: State<'_, ObsState>) -> Result<ObsStatus, String> {
    let result = {
        let guard = state.client.read().await;
        let Some(client) = guard.as_ref() else {
            return Ok(ObsStatus {
                readiness_message: "等待 OBS 启动".to_string(),
                ..ObsStatus::default()
            });
        };
        read_status(client, &state).await
    };
    if result.is_err() {
        state.client.write().await.take();
        *state.connected_at.write().await = None;
        return Ok(ObsStatus {
            readiness_message: "OBS 正在重新启动".to_string(),
            ..ObsStatus::default()
        });
    }
    result
}

/// 读取 OBS 当前画布、输出分辨率和帧率。
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
    let encoder = read_obs_encoder(&load_or_create_config(&app, None).await?).await;
    Ok(ObsVideoSettings {
        base_width: value.base_width,
        base_height: value.base_height,
        output_width: value.output_width,
        output_height: value.output_height,
        fps_numerator: value.fps_numerator,
        fps_denominator: value.fps_denominator,
        encoder_id: encoder.id,
        encoder_name: encoder.name,
    })
}

/// 读取 OBS 当前录制文件目录。
#[tauri::command]
pub async fn get_obs_record_directory(state: State<'_, ObsState>) -> Result<String, String> {
    let guard = state.client.read().await;
    let client = guard
        .as_ref()
        .ok_or_else(|| "请先启动并连接 OBS".to_string())?;
    client
        .config()
        .record_directory()
        .await
        .map_err(|error| obs_error("读取 OBS 录制目录失败", error))
}

/// 使用资源管理器打开 OBS 当前录像输出目录。
#[tauri::command]
pub async fn open_obs_record_directory(state: State<'_, ObsState>) -> Result<(), String> {
    let directory = get_obs_record_directory(state).await?;
    std::fs::create_dir_all(&directory)
        .map_err(|error| format!("创建录像输出目录失败：{error}"))?;
    Command::new("explorer")
        .arg(directory)
        .spawn()
        .map_err(|error| format!("打开录像输出目录失败：{error}"))?;
    Ok(())
}

/// 读取专属场景中的声音通道、当前选择和 OBS 提供的可选音源。
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
        (GAME_AUDIO_INPUT, "game", "window"),
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
        let source_id = settings
            .settings
            .get(property)
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default()
            .to_string();
        let sources = client
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
        inputs.push(ObsAudioInput {
            name: name.to_string(),
            enabled: !muted,
            volume_percent: (volume.mul.clamp(0.0, 1.0) * 100.0).round() as u8,
            volume_db: volume.db,
            kind: kind.to_string(),
            source_id,
            sources,
        });
    }
    Ok(inputs)
}

/// 更新 OBS 画布、输出分辨率和帧率。
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

/// 设置 OBS 录制文件输出目录。
#[tauri::command]
pub async fn set_obs_record_directory(
    directory: String,
    state: State<'_, ObsState>,
) -> Result<(), String> {
    if directory.trim().is_empty() {
        return Err("录制目录不能为空".to_string());
    }
    let guard = state.client.read().await;
    let client = guard
        .as_ref()
        .ok_or_else(|| "请先启动并连接 OBS".to_string())?;
    client
        .config()
        .set_record_directory(directory.trim())
        .await
        .map_err(|error| obs_error("更新 OBS 录制目录失败", error))
}

/// 创建或更新专用于魔兽世界的游戏捕捉源。
#[tauri::command]
pub async fn configure_obs_game_capture(
    settings: ObsCaptureSettings,
    state: State<'_, ObsState>,
) -> Result<(), String> {
    let guard = state.client.read().await;
    let client = guard
        .as_ref()
        .ok_or_else(|| "请先启动并连接 OBS".to_string())?;
    let exists = client
        .inputs()
        .list(None)
        .await
        .map_err(|error| obs_error("读取 OBS 输入源失败", error))?
        .iter()
        .any(|input| GAME_CAPTURE_INPUT == input.id);
    if !exists {
        client.inputs().create(Create {
            scene: MANAGED_SCENE.into(),
            input: GAME_CAPTURE_INPUT,
            kind: "game_capture",
            settings: Some(json!({ "capture_mode": "any_fullscreen", "capture_cursor": settings.capture_cursor })),
            enabled: Some(true),
        }).await.map_err(|error| obs_error("创建游戏捕捉源失败", error))?;
    }

    let window = if settings.capture_any_fullscreen {
        String::new()
    } else {
        let target = settings
            .window
            .unwrap_or_else(|| "Wow.exe".to_string())
            .to_lowercase();
        client
            .inputs()
            .properties_list_property_items(InputId::Name(GAME_CAPTURE_INPUT), "window")
            .await
            .map_err(|error| obs_error("读取可捕捉窗口失败", error))?
            .into_iter()
            .find(|item| {
                item.name.to_lowercase().contains(&target)
                    || item
                        .value
                        .as_str()
                        .is_some_and(|value| value.to_lowercase().contains(&target))
            })
            .and_then(|item| item.value.as_str().map(str::to_string))
            .ok_or_else(|| "未找到正在运行的魔兽世界窗口，请先启动游戏".to_string())?
    };
    let capture_settings = json!({
        "capture_mode": if settings.capture_any_fullscreen { "any_fullscreen" } else { "window" },
        "window": window,
        "capture_cursor": settings.capture_cursor,
    });
    client
        .inputs()
        .set_settings(SetSettings {
            input: InputId::Name(GAME_CAPTURE_INPUT),
            settings: &capture_settings,
            overlay: Some(true),
        })
        .await
        .map_err(|error| obs_error("更新游戏捕捉源失败", error))
}

/// 更新指定 OBS 音频输入的启用状态和音量。
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
    if let Some(source_id) = settings.source_id.as_deref() {
        let property = if input_name == GAME_AUDIO_INPUT {
            "window"
        } else {
            "device_id"
        };
        client
            .inputs()
            .set_settings(SetSettings {
                input: InputId::Name(input_name),
                settings: &json!({ (property): source_id }),
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

/// 通过 OBS WebSocket 开始录制并返回更新后的状态。
#[tauri::command]
pub async fn start_obs_recording(state: State<'_, ObsState>) -> Result<ObsStatus, String> {
    let guard = state.client.read().await;
    let client = guard
        .as_ref()
        .ok_or_else(|| "请先启动并连接 OBS".to_string())?;
    client
        .recording()
        .start()
        .await
        .map_err(|error| obs_error("开始 OBS 录制失败", error))?;
    wait_for_recording_state(client, true).await?;
    read_status(client, &state).await
}

/// 停止 OBS 录制并保存最终输出路径。
#[tauri::command]
pub async fn stop_obs_recording(state: State<'_, ObsState>) -> Result<ObsStatus, String> {
    let guard = state.client.read().await;
    let client = guard
        .as_ref()
        .ok_or_else(|| "请先启动并连接 OBS".to_string())?;
    client
        .recording()
        .stop()
        .await
        .map_err(|error| obs_error("停止 OBS 录制失败", error))?;
    wait_for_recording_state(client, false).await?;
    read_status(client, &state).await
}
