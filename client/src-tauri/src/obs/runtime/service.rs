use std::{
    collections::HashMap,
    process::Child,
    sync::{
        atomic::{AtomicBool, AtomicU8},
        Arc, Mutex,
    },
    time::Instant,
};

use futures_util::StreamExt;
use obws::{
    client::{ConnectConfig, DEFAULT_BROADCAST_CAPACITY},
    events::{Event, OutputState},
    requests::{config::SetVideoSettings, profiles::SetParameter, EventSubscription},
    Client,
};
use tauri::State;
use tokio::sync::{broadcast, RwLock};

use crate::obs::{
    common::{obs_error, MANAGED_SCENE},
    runtime::config::OBS_CONNECTION_TIMEOUT_SECONDS,
    settings::{
        audio::{
            ensure_audio_sources, start_audio_meter_listener, DESKTOP_AUDIO_INPUT, MICROPHONE_INPUT,
        },
        capture::{
            ensure_capture_source, find_wow_window, is_wow_process_running, read_capture_settings,
            GAME_CAPTURE_INPUT,
        },
    },
};

use super::model::ObsStatus;

#[derive(Debug, PartialEq, Eq)]
enum ContinuousRecordingAction {
    Start,
    SplitForAnchor,
    Wait,
}

/// 根据捕捉与录像瞬时状态决定是否需要启动持续录像。
fn continuous_recording_action(
    capture_ready: bool,
    recording_active: bool,
    anchor_initialized: bool,
) -> ContinuousRecordingAction {
    if capture_ready && !recording_active {
        ContinuousRecordingAction::Start
    } else if capture_ready && !anchor_initialized {
        ContinuousRecordingAction::SplitForAnchor
    } else {
        ContinuousRecordingAction::Wait
    }
}

fn recording_split_configured(output_mode: &str, enabled: &str, split_type: &str) -> bool {
    output_mode == "Advanced" && enabled.eq_ignore_ascii_case("true") && split_type == "Manual"
}

fn advanced_encoder_id(simple_encoder_id: &str) -> &str {
    match simple_encoder_id {
        "nvenc" => "obs_nvenc_h264_tex",
        "qsv" => "obs_qsv11_v2",
        "amd" => "h264_texture_amf",
        "x264" => "obs_x264",
        value => value,
    }
}

/// 保存唯一 OBS 连接、安装任务状态以及实时音量表缓存。
pub struct ObsState {
    pub(crate) client: RwLock<Option<Client>>,
    pub(crate) connected_at: RwLock<Option<Instant>>,
    pub(crate) last_error: RwLock<Option<String>>,
    pub(crate) audio_levels: Arc<RwLock<HashMap<String, f32>>>,
    pub(crate) installing: AtomicBool,
    pub(crate) install_progress: AtomicU8,
    pub(crate) install_phase: RwLock<String>,
    pub(crate) launching: AtomicBool,
    pub(crate) shutting_down: AtomicBool,
    pub(crate) managed_process: Mutex<Option<Child>>,
    pub(crate) recording_events: broadcast::Sender<ObsRecordingEvent>,
    recording_anchor_initialized: AtomicBool,
    current_recording_file: Arc<RwLock<Option<ObsRecordingFile>>>,
}

/// 保存当前 OBS 输出文件的路径与可靠开始时间。
#[derive(Clone, Debug)]
pub struct ObsRecordingFile {
    pub path: String,
    pub started_at_unix_ms: i64,
}

/// 转发给录制领域的 OBS 文件生命周期事件。
#[derive(Clone, Debug)]
pub enum ObsRecordingEvent {
    FileChanged {
        path: String,
        occurred_at_unix_ms: i64,
    },
    Stopped {
        path: Option<String>,
        occurred_at_unix_ms: i64,
    },
}

impl Default for ObsState {
    fn default() -> Self {
        let (recording_events, _) = broadcast::channel(64);
        Self {
            client: RwLock::new(None),
            connected_at: RwLock::new(None),
            last_error: RwLock::new(None),
            audio_levels: Arc::new(RwLock::new(HashMap::new())),
            installing: AtomicBool::new(false),
            install_progress: AtomicU8::new(0),
            install_phase: RwLock::new(String::new()),
            launching: AtomicBool::new(false),
            shutting_down: AtomicBool::new(false),
            managed_process: Mutex::new(None),
            recording_events,
            recording_anchor_initialized: AtomicBool::new(false),
            current_recording_file: Arc::new(RwLock::new(None)),
        }
    }
}

fn unix_time_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn start_recording_event_listener(client: &Client, state: &ObsState) -> Result<(), String> {
    let mut events = client
        .events()
        .map_err(|error| obs_error("订阅 OBS 录像事件失败", error))?;
    let sender = state.recording_events.clone();
    let current_file = Arc::clone(&state.current_recording_file);
    tauri::async_runtime::spawn(async move {
        while let Some(event) = events.next().await {
            let forwarded = match event {
                Event::RecordFileChanged { path } => {
                    let occurred_at_unix_ms = unix_time_ms();
                    *current_file.write().await = Some(ObsRecordingFile {
                        path: path.clone(),
                        started_at_unix_ms: occurred_at_unix_ms,
                    });
                    Some(ObsRecordingEvent::FileChanged {
                        path,
                        occurred_at_unix_ms,
                    })
                }
                Event::RecordStateChanged {
                    active: false,
                    state: OutputState::Stopped,
                    path,
                } => {
                    current_file.write().await.take();
                    Some(ObsRecordingEvent::Stopped {
                        path,
                        occurred_at_unix_ms: unix_time_ms(),
                    })
                }
                _ => None,
            };
            if let Some(event) = forwarded {
                let _ = sender.send(event);
            }
        }
    });
    Ok(())
}

fn is_recording_file(path: &std::path::Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "mp4" | "mkv" | "mov" | "flv" | "ts"
            )
        })
}

async fn latest_recording_file(
    client: &Client,
) -> Result<Option<(std::path::PathBuf, i64)>, String> {
    let directory = client
        .config()
        .record_directory()
        .await
        .map_err(|error| obs_error("读取 OBS 录像目录失败", error))?;
    let mut entries = tokio::fs::read_dir(&directory)
        .await
        .map_err(|error| format!("读取 OBS 录像目录 {directory} 失败：{error}"))?;
    let mut files = Vec::new();
    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|error| format!("读取 OBS 录像目录项失败：{error}"))?
    {
        let path = entry.path();
        if !is_recording_file(&path) {
            continue;
        }
        let metadata = entry
            .metadata()
            .await
            .map_err(|error| format!("读取 OBS 录像文件状态失败：{error}"))?;
        let created = metadata
            .created()
            .or_else(|_| metadata.modified())
            .unwrap_or(std::time::SystemTime::UNIX_EPOCH);
        let created_at_unix_ms = created
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;
        files.push((created, path, created_at_unix_ms));
    }
    files.sort_by(|left, right| left.0.cmp(&right.0).then_with(|| left.1.cmp(&right.1)));
    Ok(files.pop().map(|(_, path, created)| (path, created)))
}

async fn split_and_confirm_recording_file(client: &Client, state: &ObsState) -> Result<(), String> {
    let previous = latest_recording_file(client).await?.map(|(path, _)| path);
    client
        .recording()
        .split_file()
        .await
        .map_err(|error| obs_error("轮转 OBS 录像文件失败", error))?;
    for _ in 0..50 {
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        if let Some((path, created_at_unix_ms)) = latest_recording_file(client).await? {
            if previous.as_ref() != Some(&path) {
                *state.current_recording_file.write().await = Some(ObsRecordingFile {
                    path: path.to_string_lossy().into_owned(),
                    started_at_unix_ms: created_at_unix_ms,
                });
                let _ = state.recording_events.send(ObsRecordingEvent::FileChanged {
                    path: path.to_string_lossy().into_owned(),
                    occurred_at_unix_ms: created_at_unix_ms,
                });
                return Ok(());
            }
        }
    }
    Err("OBS 已请求轮转录像，但 5 秒内未发现新文件".to_string())
}

/// 返回最新已确认的 OBS 输出文件锚点。
pub(crate) async fn current_recording_file(state: &ObsState) -> Option<ObsRecordingFile> {
    state.current_recording_file.read().await.clone()
}

/// 在事件锚点缺失时，根据 OBS 实时状态与输出目录识别当前文件。
pub(crate) async fn detect_current_recording_file(
    state: &ObsState,
) -> Result<Option<ObsRecordingFile>, String> {
    let guard = state.client.read().await;
    let Some(client) = guard.as_ref() else {
        return Ok(None);
    };
    let recording = client
        .recording()
        .status()
        .await
        .map_err(|error| obs_error("读取 OBS 录制状态失败", error))?;
    if !recording.active {
        return Ok(None);
    }
    Ok(latest_recording_file(client)
        .await?
        .map(|(path, started_at_unix_ms)| ObsRecordingFile {
            path: path.to_string_lossy().into_owned(),
            started_at_unix_ms,
        }))
}

/// 确保 OBS 两种输出模式的直播音频均使用 Opus，并返回是否修改了配置。
pub(crate) async fn ensure_whip_audio_encoder(client: &Client) -> Result<bool, String> {
    let simple_opus = client
        .profiles()
        .parameter("SimpleOutput", "StreamAudioEncoder")
        .await
        .ok()
        .and_then(|parameter| parameter.value)
        .is_some_and(|value| value == "opus");
    let advanced_opus = client
        .profiles()
        .parameter("AdvOut", "AudioEncoder")
        .await
        .ok()
        .and_then(|parameter| parameter.value)
        .is_some_and(|value| value == "ffmpeg_opus");
    if simple_opus && advanced_opus {
        return Ok(false);
    }

    if !simple_opus {
        client
            .profiles()
            .set_parameter(SetParameter {
                category: "SimpleOutput",
                name: "StreamAudioEncoder",
                value: Some("opus"),
            })
            .await
            .map_err(|error| obs_error("配置 OBS 简单输出的 WHIP 音频编码器失败", error))?;
    }
    if !advanced_opus {
        client
            .profiles()
            .set_parameter(SetParameter {
                category: "AdvOut",
                name: "AudioEncoder",
                value: Some("ffmpeg_opus"),
            })
            .await
            .map_err(|error| obs_error("配置 OBS 高级输出的 WHIP 音频编码器失败", error))?;
    }

    Ok(true)
}

async fn profile_parameter(client: &Client, category: &str, name: &str) -> Result<String, String> {
    client
        .profiles()
        .parameter(category, name)
        .await
        .map_err(|error| obs_error(&format!("读取 OBS 配置 {category}.{name} 失败"), error))
        .map(|parameter| parameter.value.unwrap_or_default())
}

async fn set_profile_parameter(
    client: &Client,
    category: &str,
    name: &str,
    value: &str,
) -> Result<(), String> {
    client
        .profiles()
        .set_parameter(SetParameter {
            category,
            name,
            value: Some(value),
        })
        .await
        .map_err(|error| obs_error(&format!("更新 OBS 配置 {category}.{name} 失败"), error))
}

/// 确保录像输出支持由战斗时间点触发的手动文件分割。
async fn ensure_recording_file_splitting(client: &Client) -> Result<bool, String> {
    let output_mode = profile_parameter(client, "Output", "Mode").await?;
    let split_enabled = profile_parameter(client, "AdvOut", "RecSplitFile").await?;
    let split_type = profile_parameter(client, "AdvOut", "RecSplitFileType").await?;
    if recording_split_configured(&output_mode, &split_enabled, &split_type) {
        return Ok(false);
    }

    if output_mode != "Advanced" {
        let stream_encoder = profile_parameter(client, "SimpleOutput", "StreamEncoder").await?;
        let recording_encoder = profile_parameter(client, "SimpleOutput", "RecEncoder").await?;
        let recording_audio = profile_parameter(client, "SimpleOutput", "RecAudioEncoder").await?;
        set_profile_parameter(
            client,
            "AdvOut",
            "Encoder",
            advanced_encoder_id(&stream_encoder),
        )
        .await?;
        set_profile_parameter(
            client,
            "AdvOut",
            "RecEncoder",
            advanced_encoder_id(&recording_encoder),
        )
        .await?;
        set_profile_parameter(
            client,
            "AdvOut",
            "RecAudioEncoder",
            if recording_audio == "opus" {
                "ffmpeg_opus"
            } else {
                "ffmpeg_aac"
            },
        )
        .await?;
        set_profile_parameter(client, "Output", "Mode", "Advanced").await?;
    }
    set_profile_parameter(client, "AdvOut", "RecSplitFile", "true").await?;
    set_profile_parameter(client, "AdvOut", "RecSplitFileType", "Manual").await?;

    let recording = client
        .recording()
        .status()
        .await
        .map_err(|error| obs_error("读取 OBS 录制状态失败", error))?;
    if recording.active {
        client
            .recording()
            .stop()
            .await
            .map_err(|error| obs_error("结束 OBS 旧输出模式录像失败", error))?;
        wait_for_recording_state(client, false).await?;
    }
    Ok(true)
}

/// 查询 OBS 版本、录制状态和开始录制所需的完整条件。
pub(crate) async fn read_status(client: &Client, state: &ObsState) -> Result<ObsStatus, String> {
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
    let live_active = client
        .streaming()
        .status()
        .await
        .map(|status| status.active)
        .unwrap_or(false);
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
        settings.input_kind == "monitor_capture"
            || settings
                .window
                .as_deref()
                .is_some_and(|window| window.to_lowercase().contains("wow.exe"))
    });
    let capture_target_available = capture_settings.as_ref().is_some_and(|settings| {
        settings.input_kind == "monitor_capture" || detected_wow_window.is_some()
    });
    let capture_ready = capture_enabled
        && is_wow_process_running()
        && capture_target_available
        && capture_targets_wow;
    let audio_ready = [DESKTOP_AUDIO_INPUT, MICROPHONE_INPUT]
        .iter()
        .all(|name| inputs.iter().any(|input| *name == input.id));
    let video_ready = video.output_width >= 1920 && video.output_height >= 1080;
    let ready = scene_ready && capture_ready && audio_ready && video_ready;
    let live_ready = ready;
    let readiness_message = if ready {
        "可以开始录制".to_string()
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
        live_active,
        live_ready,
        live_readiness_message: if live_ready {
            "可以开始直播".to_string()
        } else {
            readiness_message.clone()
        },
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
pub(crate) async fn wait_for_recording_state(
    client: &Client,
    expected: bool,
) -> Result<(), String> {
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

/// 在 OBS 捕捉就绪后确保持续录像已经运行。
pub(crate) async fn ensure_continuous_recording(state: &ObsState) -> Result<(), String> {
    let guard = state.client.read().await;
    let Some(client) = guard.as_ref() else {
        return Ok(());
    };
    let status = read_status(client, state).await?;
    match continuous_recording_action(
        status.capture_ready,
        status.recording_active,
        state
            .recording_anchor_initialized
            .load(std::sync::atomic::Ordering::Relaxed),
    ) {
        ContinuousRecordingAction::Start => {
            client
                .recording()
                .start()
                .await
                .map_err(|error| obs_error("启动 OBS 持续录像失败", error))?;
            wait_for_recording_state(client, true).await?;
            split_and_confirm_recording_file(client, state)
                .await
                .map_err(|error| format!("建立 OBS 录像文件锚点失败：{error}"))?;
            state
                .recording_anchor_initialized
                .store(true, std::sync::atomic::Ordering::Relaxed);
        }
        ContinuousRecordingAction::SplitForAnchor => {
            split_and_confirm_recording_file(client, state)
                .await
                .map_err(|error| format!("建立 OBS 录像文件锚点失败：{error}"))?;
            state
                .recording_anchor_initialized
                .store(true, std::sync::atomic::Ordering::Relaxed);
        }
        ContinuousRecordingAction::Wait => {}
    }
    Ok(())
}

/// 使用本地凭据建立 OBS 连接并初始化受管业务资源。
pub async fn connect_with_credentials(
    host: &str,
    port: u16,
    password: &str,
    state: &ObsState,
) -> Result<(ObsStatus, bool), String> {
    let client = Client::connect_with_config(ConnectConfig {
        host,
        port,
        dangerous: None,
        password: (!password.is_empty()).then_some(password),
        event_subscriptions: Some(EventSubscription::ALL | EventSubscription::INPUT_VOLUME_METERS),
        broadcast_capacity: DEFAULT_BROADCAST_CAPACITY,
        connect_timeout: std::time::Duration::from_secs(OBS_CONNECTION_TIMEOUT_SECONDS),
    })
    .await
    .map_err(|error| obs_error("连接 OBS WebSocket 失败", error))?;
    let audio_restart_required = ensure_whip_audio_encoder(&client).await?;
    let split_restart_required = ensure_recording_file_splitting(&client).await?;
    let restart_required = audio_restart_required || split_restart_required;
    ensure_managed_scene(&client).await?;
    state
        .recording_anchor_initialized
        .store(false, std::sync::atomic::Ordering::Relaxed);
    start_recording_event_listener(&client, state)?;
    state.audio_levels.write().await.clear();
    start_audio_meter_listener(&client, Arc::clone(&state.audio_levels))?;
    let mut guard = state.client.write().await;
    if let Some(mut previous) = guard.take() {
        previous.disconnect().await;
    }
    *guard = Some(client);
    *state.last_error.write().await = None;
    if state.connected_at.read().await.is_none() {
        *state.connected_at.write().await = Some(Instant::now());
    }
    let status = read_status(guard.as_ref().expect("OBS 连接刚写入"), state).await?;
    Ok((status, restart_required))
}

/// 请求 OBS 在不中断持续录像的情况下切换到新文件。
pub(crate) async fn split_recording_file(state: &ObsState) -> Result<(), String> {
    let guard = state.client.read().await;
    let client = guard
        .as_ref()
        .ok_or_else(|| "OBS 尚未连接，无法轮转录像文件".to_string())?;
    split_and_confirm_recording_file(client, state).await
}

/// 返回当前 OBS 连接摘要，失效时让后台守护流程重新连接。
#[tauri::command]
pub async fn get_obs_status(state: State<'_, ObsState>) -> Result<ObsStatus, String> {
    let result = {
        let guard = state.client.read().await;
        let Some(client) = guard.as_ref() else {
            return Ok(ObsStatus {
                readiness_message: "等待 OBS 启动".to_string(),
                error: state.last_error.read().await.clone(),
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

#[cfg(test)]
mod tests {
    use super::{
        advanced_encoder_id, continuous_recording_action, recording_split_configured,
        ContinuousRecordingAction,
    };

    #[test]
    fn continuous_recording_starts_only_when_capture_is_ready() {
        assert_eq!(
            continuous_recording_action(true, false, false),
            ContinuousRecordingAction::Start
        );
        assert_eq!(
            continuous_recording_action(false, false, false),
            ContinuousRecordingAction::Wait
        );
        assert_eq!(
            continuous_recording_action(true, true, true),
            ContinuousRecordingAction::Wait
        );
        assert_eq!(
            continuous_recording_action(true, true, false),
            ContinuousRecordingAction::SplitForAnchor
        );
    }

    #[test]
    fn recording_split_requires_advanced_manual_mode() {
        assert!(recording_split_configured("Advanced", "true", "Manual"));
        assert!(!recording_split_configured("Simple", "true", "Manual"));
        assert!(!recording_split_configured("Advanced", "false", "Manual"));
        assert!(!recording_split_configured("Advanced", "true", "Time"));
    }

    #[test]
    fn simple_encoder_is_mapped_to_advanced_encoder_id() {
        assert_eq!(advanced_encoder_id("nvenc"), "obs_nvenc_h264_tex");
        assert_eq!(advanced_encoder_id("qsv"), "obs_qsv11_v2");
        assert_eq!(advanced_encoder_id("amd"), "h264_texture_amf");
        assert_eq!(advanced_encoder_id("x264"), "obs_x264");
        assert_eq!(advanced_encoder_id("custom_encoder"), "custom_encoder");
    }
}
