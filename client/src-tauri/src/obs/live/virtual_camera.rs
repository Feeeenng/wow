use serde::Serialize;
use tauri::State;

use crate::obs::{
    common::obs_error,
    runtime::service::{read_status, ObsState},
};

const VIRTUAL_CAMERA_DEVICE_LABEL: &str = "OBS Virtual Camera";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VirtualCameraPreview {
    pub device_label: String,
}

/// 启动 OBS 虚拟摄像头并等待输出进入活动状态。
#[tauri::command]
pub async fn start_virtual_camera_preview(
    state: State<'_, ObsState>,
) -> Result<VirtualCameraPreview, String> {
    let guard = state.client.read().await;
    let client = guard
        .as_ref()
        .ok_or_else(|| "请先启动并连接 OBS".to_string())?;
    let status = read_status(client, &state).await?;
    if !status.capture_ready {
        return Err("未检测到魔兽世界窗口，无法开始直播".to_string());
    }
    match client.virtual_cam().start().await {
        Ok(())
        | Err(obws::error::Error::Api {
            code: obws::responses::StatusCode::OutputRunning,
            ..
        }) => {}
        Err(error) => return Err(obs_error("启动 OBS 本地预览失败", error)),
    }

    Ok(VirtualCameraPreview {
        device_label: VIRTUAL_CAMERA_DEVICE_LABEL.to_string(),
    })
}

/// 停止仅用于客户端本地画面的 OBS 虚拟摄像头输出。
#[tauri::command]
pub async fn stop_virtual_camera_preview(state: State<'_, ObsState>) -> Result<(), String> {
    let guard = state.client.read().await;
    let Some(client) = guard.as_ref() else {
        return Ok(());
    };
    match client.virtual_cam().stop().await {
        Ok(())
        | Err(obws::error::Error::Api {
            code: obws::responses::StatusCode::OutputNotRunning,
            ..
        }) => Ok(()),
        Err(error) => Err(obs_error("停止 OBS 本地预览失败", error)),
    }
}
