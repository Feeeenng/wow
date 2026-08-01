mod obs;

/// 启动桌面客户端并注册 Rust OBS 后端命令。
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(obs::ObsState::default())
        .setup(|app| {
            tauri::async_runtime::spawn(obs::installer::maintain_obs(app.handle().clone()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            obs::installer::get_obs_installation,
            obs::installer::install_portable_obs,
            obs::installer::launch_portable_obs,
            obs::installer::open_obs_install_directory,
            obs::service::get_obs_status,
            obs::service::get_obs_video_settings,
            obs::service::get_obs_audio_inputs,
            obs::service::get_obs_record_directory,
            obs::service::open_obs_record_directory,
            obs::service::set_obs_video_settings,
            obs::service::set_obs_record_directory,
            obs::service::configure_obs_game_capture,
            obs::service::set_obs_audio_settings,
            obs::service::start_obs_recording,
            obs::service::stop_obs_recording,
        ])
        .run(tauri::generate_context!())
        .expect("启动 WoW Recorder 客户端失败");
}
