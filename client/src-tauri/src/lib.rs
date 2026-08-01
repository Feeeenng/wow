mod obs;

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

/// 创建或聚焦独立 OBS 控制子窗口。
#[tauri::command]
async fn open_obs_control_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("obs-control") {
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
        return Ok(());
    }

    WebviewWindowBuilder::new(
        &app,
        "obs-control",
        WebviewUrl::App("index.html?window=obs".into()),
    )
    .title("OBS 连接与录制")
    .inner_size(760.0, 640.0)
    .min_inner_size(680.0, 580.0)
    .resizable(true)
    .decorations(false)
    .center()
    .build()
    .map_err(|error| error.to_string())?;

    Ok(())
}

/// 启动桌面客户端并注册 Rust OBS WebSocket 命令。
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(obs::ObsState::default())
        .invoke_handler(tauri::generate_handler![
            open_obs_control_window,
            obs::service::connect_obs,
            obs::service::disconnect_obs,
            obs::service::get_obs_status,
            obs::service::start_obs_recording,
            obs::service::stop_obs_recording,
        ])
        .run(tauri::generate_context!())
        .expect("启动 WoW Recorder 客户端失败");
}
