use obws::Client;
use tauri::State;
use tokio::sync::RwLock;

use super::model::{validate_connect_request, ObsConnectRequest, ObsStatus};

/// 保存当前唯一 OBS WebSocket 连接和最近一次输出路径。
#[derive(Default)]
pub struct ObsState {
    client: RwLock<Option<Client>>,
    output_path: RwLock<Option<String>>,
}

/// 将第三方连接错误转换为不包含密码的用户可读信息。
fn connection_error(error: impl std::fmt::Display) -> String {
    format!("连接 OBS WebSocket 失败：{error}")
}

/// 查询已连接 OBS 的版本和录制状态。
async fn read_status(client: &Client, output_path: Option<String>) -> Result<ObsStatus, String> {
    let version = client
        .general()
        .version()
        .await
        .map_err(connection_error)?;
    let recording = client
        .recording()
        .status()
        .await
        .map_err(connection_error)?;

    Ok(ObsStatus {
        connected: true,
        obs_version: Some(version.obs_studio_version.to_string()),
        websocket_version: Some(version.obs_web_socket_version.to_string()),
        recording_active: recording.active,
        recording_paused: recording.paused,
        output_path,
        error: None,
    })
}

/// 连接本机 OBS WebSocket 并返回真实运行状态。
#[tauri::command]
pub async fn connect_obs(
    request: ObsConnectRequest,
    state: State<'_, ObsState>,
) -> Result<ObsStatus, String> {
    validate_connect_request(&request)?;

    let mut guard = state.client.write().await;
    if let Some(mut previous) = guard.take() {
        previous.disconnect().await;
    }

    let password = (!request.password.is_empty()).then_some(request.password.as_str());
    let client = Client::connect(request.host.trim(), request.port, password)
        .await
        .map_err(connection_error)?;
    let status = read_status(&client, state.output_path.read().await.clone()).await?;
    *guard = Some(client);
    Ok(status)
}

/// 主动断开 OBS WebSocket 并清空连接状态。
#[tauri::command]
pub async fn disconnect_obs(state: State<'_, ObsState>) -> Result<ObsStatus, String> {
    if let Some(mut client) = state.client.write().await.take() {
        client.disconnect().await;
    }
    Ok(ObsStatus::default())
}

/// 返回当前 OBS 连接摘要，未连接时返回稳定的默认状态。
#[tauri::command]
pub async fn get_obs_status(state: State<'_, ObsState>) -> Result<ObsStatus, String> {
    let guard = state.client.read().await;
    let Some(client) = guard.as_ref() else {
        return Ok(ObsStatus::default());
    };

    read_status(client, state.output_path.read().await.clone()).await
}

/// 通过 OBS WebSocket 开始录制并返回更新后的状态。
#[tauri::command]
pub async fn start_obs_recording(state: State<'_, ObsState>) -> Result<ObsStatus, String> {
    let guard = state.client.read().await;
    let client = guard
        .as_ref()
        .ok_or_else(|| "请先连接 OBS WebSocket".to_string())?;
    client
        .recording()
        .start()
        .await
        .map_err(connection_error)?;
    read_status(client, state.output_path.read().await.clone()).await
}

/// 停止 OBS 录制，保存 OBS 返回的最终文件路径并返回状态。
#[tauri::command]
pub async fn stop_obs_recording(state: State<'_, ObsState>) -> Result<ObsStatus, String> {
    let guard = state.client.read().await;
    let client = guard
        .as_ref()
        .ok_or_else(|| "请先连接 OBS WebSocket".to_string())?;
    let output_path = client
        .recording()
        .stop()
        .await
        .map_err(connection_error)?;
    *state.output_path.write().await = Some(output_path.clone());
    read_status(client, Some(output_path)).await
}
