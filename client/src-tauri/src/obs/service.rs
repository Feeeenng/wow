use std::{
    collections::HashMap,
    process::{Child, Command},
    sync::{
        atomic::{AtomicBool, AtomicU8},
        Arc, Mutex,
    },
    time::Instant,
};

use obws::{
    requests::{config::SetVideoSettings, EventSubscription},
    Client,
};
use tauri::State;
use tokio::sync::RwLock;

use super::{
    audio::{
        ensure_audio_sources, start_audio_meter_listener, DESKTOP_AUDIO_INPUT,
        MICROPHONE_INPUT,
    },
    capture::{
        ensure_capture_source, find_wow_window, is_wow_process_running, read_capture_settings,
        GAME_CAPTURE_INPUT,
    },
    common::{obs_error, MANAGED_SCENE},
    model::ObsStatus,
};

/// 保存唯一 OBS 连接、安装任务状态以及实时音量表缓存。
#[derive(Default)]
pub struct ObsState {
    pub(crate) client: RwLock<Option<Client>>,
    pub(crate) connected_at: RwLock<Option<Instant>>,
    pub(crate) audio_levels: Arc<RwLock<HashMap<String, f32>>>,
    pub(crate) installing: AtomicBool,
    pub(crate) install_progress: AtomicU8,
    pub(crate) install_phase: RwLock<String>,
    pub(crate) launching: AtomicBool,
    pub(crate) shutting_down: AtomicBool,
    pub(crate) managed_process: Mutex<Option<Child>>,
}

/// 查询 OBS 版本、录制状态和开始录制所需的完整条件。
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
    let scene_items = client
        .scene_items()
        .list(MANAGED_SCENE.into())
        .await
        .unwrap_or_default();
    let capture_settings = read_capture_settings(client).await.ok();
    let capture_item = scene_items
        .iter()
        .find(|item| GAME_CAPTURE_INPUT == item.source_name);
    let capture_enabled = if let Some(item) = capture_item {
        client
            .scene_items()
            .enabled(MANAGED_SCENE.into(), item.id)
            .await
            .unwrap_or(false)
    } else {
        false
    };
    let detected_wow_window = find_wow_window(client).await;
    let capture_targets_wow = capture_settings.as_ref().is_some_and(|settings| {
        settings.auto_capture
            || settings
                .window
                .as_deref()
                .is_some_and(|window| window.to_lowercase().contains("wow.exe"))
    });
    let capture_ready = capture_enabled
        && is_wow_process_running()
        && detected_wow_window.is_some()
        && capture_targets_wow;
    let audio_ready = [DESKTOP_AUDIO_INPUT, MICROPHONE_INPUT]
        .iter()
        .all(|name| inputs.iter().any(|input| *name == input.id));
    let video_ready = video.output_width >= 1920 && video.output_height >= 1080;
    let ready = scene_ready && capture_ready && audio_ready && video_ready;
    let readiness_message = if ready {
        "可以开始录制或直播".to_string()
    } else if !video_ready {
        "请将输出分辨率设置为 1080p 或更高".to_string()
    } else if !capture_ready {
        "未检测到魔兽世界窗口，请先启动游戏".to_string()
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

/// 确保 OBS 中存在客户端专属场景及基础画面、声音来源。
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
    ensure_capture_source(client).await?;
    ensure_audio_sources(client).await
}

/// 等待 OBS 输出状态完成切换，避免读取到上一帧状态。
async fn wait_for_recording_state(client: &Client, expected: bool) -> Result<(), String> {
    for _ in 0..75 {
        let status = client
            .recording()
            .status()
            .await
            .map_err(|error| obs_error("确认 OBS 录制状态失败", error))?;
        if status.active == expected {
            return Ok(());
        }
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }
    Err("OBS 录制状态切换超时".to_string())
}

/// 使用本地凭据建立 OBS 连接并初始化受管业务资源。
pub async fn connect_with_credentials(
    host: &str,
    port: u16,
    password: &str,
    state: &ObsState,
) -> Result<ObsStatus, String> {
    let client = Client::connect(host, port, (!password.is_empty()).then_some(password))
        .await
        .map_err(|error| obs_error("连接 OBS WebSocket 失败", error))?;
    client
        .reidentify(EventSubscription::ALL | EventSubscription::INPUT_VOLUME_METERS)
        .await
        .map_err(|error| obs_error("启用 OBS 音量表事件失败", error))?;
    ensure_managed_scene(&client).await?;
    state.audio_levels.write().await.clear();
    start_audio_meter_listener(&client, Arc::clone(&state.audio_levels))?;
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

/// 返回当前 OBS 连接摘要，失效时让后台守护流程重新连接。
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
        state.audio_levels.write().await.clear();
        return Ok(ObsStatus {
            readiness_message: "OBS 正在重新启动".to_string(),
            ..ObsStatus::default()
        });
    }
    result
}

/// 读取 OBS 当前录像输出目录。
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

/// 设置 OBS 录像输出目录。
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

/// 通过 OBS WebSocket 开始录制，并在返回前确认状态。
#[tauri::command]
pub async fn start_obs_recording(state: State<'_, ObsState>) -> Result<ObsStatus, String> {
    let guard = state.client.read().await;
    let client = guard
        .as_ref()
        .ok_or_else(|| "请先启动并连接 OBS".to_string())?;
    let status = read_status(client, &state).await?;
    if !status.capture_ready {
        return Err("未检测到魔兽世界窗口，无法开始测试录制".to_string());
    }
    client
        .recording()
        .start()
        .await
        .map_err(|error| obs_error("开始 OBS 录制失败", error))?;
    wait_for_recording_state(client, true).await?;
    read_status(client, &state).await
}

/// 停止 OBS 录制并返回最新状态。
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
