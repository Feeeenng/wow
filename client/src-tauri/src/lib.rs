mod local_state;
mod obs;

use tauri::Manager;

/// 启动桌面客户端并注册 Rust OBS 后端命令。
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(obs::runtime::service::ObsState::default())
        .setup(|app| {
            let local_state =
                local_state::LocalStateStore::load(app.handle()).map_err(std::io::Error::other)?;
            app.manage(local_state);
            tauri::async_runtime::spawn(obs::runtime::installer::maintain_obs(
                app.handle().clone(),
            ));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            obs::runtime::installer::get_obs_installation,
            obs::runtime::installer::install_portable_obs,
            obs::runtime::installer::launch_portable_obs,
            obs::runtime::installer::open_obs_install_directory,
            obs::runtime::service::get_obs_status,
            obs::live::virtual_camera::start_virtual_camera_preview,
            obs::live::virtual_camera::stop_virtual_camera_preview,
            obs::settings::video::get_obs_video_settings,
            obs::settings::capture::get_obs_capture_settings,
            obs::settings::audio::get_obs_audio_inputs,
            obs::settings::snapshot::get_cached_obs_settings,
            obs::settings::snapshot::get_obs_settings_snapshot,
            obs::runtime::service::get_obs_record_directory,
            obs::runtime::service::open_obs_record_directory,
            obs::settings::video::set_obs_video_settings,
            obs::runtime::service::set_obs_record_directory,
            obs::settings::capture::configure_obs_game_capture,
            obs::settings::audio::set_obs_audio_settings,
            obs::runtime::service::start_obs_recording,
            obs::runtime::service::stop_obs_recording,
        ])
        .build(tauri::generate_context!())
        .expect("构建 WoW Recorder 客户端失败");

    app.run(|app_handle, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            let state = app_handle.state::<obs::runtime::service::ObsState>();
            obs::runtime::installer::shutdown_managed_obs(&state);
        }
    });
}
