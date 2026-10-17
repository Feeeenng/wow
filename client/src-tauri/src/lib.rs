mod cloud;
mod combat_log;
mod game_data;
mod live;
mod local_state;
mod obs;
mod recording;
mod storage;

use tauri::Manager;

/// 启动桌面客户端并注册 Rust OBS 后端命令。
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .register_asynchronous_uri_scheme_protocol(
            cloud::replay::protocol::SCHEME,
            |context, request, responder| {
                let app = context.app_handle().clone();
                tauri::async_runtime::spawn(async move {
                    responder.respond(cloud::replay::protocol::handle(app, request).await);
                });
            },
        )
        .register_asynchronous_uri_scheme_protocol(
            live::history::protocol::SCHEME,
            |context, request, responder| {
                let app = context.app_handle().clone();
                tauri::async_runtime::spawn(async move {
                    responder.respond(live::history::protocol::handle(app, request).await);
                });
            },
        )
        .register_asynchronous_uri_scheme_protocol(
            recording::playback::protocol::SCHEME,
            |context, request, responder| {
                let app = context.app_handle().clone();
                tauri::async_runtime::spawn(async move {
                    responder.respond(recording::playback::protocol::handle(app, request).await);
                });
            },
        )
        .register_uri_scheme_protocol(game_data::icons::protocol::SCHEME, |context, request| {
            game_data::icons::protocol::handle(context.app_handle(), request)
        })
        .plugin(tauri_plugin_dialog::init())
        .manage(obs::runtime::service::ObsState::default())
        .manage(live::state::LiveState::default())
        .manage(recording::importing::commands::RecordingImportState::default())
        .manage(recording::annotations::store::AnnotationState::default())
        .manage(recording::review::local::DeathReviewState::default())
        .manage(live::runtime::state::LocalMediaState::default())
        .setup(|app| {
            let local_state =
                local_state::LocalStateStore::load(app.handle()).map_err(std::io::Error::other)?;
            app.manage(local_state);
            app.manage(
                game_data::catalog::GameDataState::load(app.handle())
                    .map_err(std::io::Error::other)?,
            );
            let recording_state = recording::capture::state::RecordingState::load(app.handle())
                .map_err(std::io::Error::other)?;
            app.manage(recording_state);
            app.manage(
                cloud::state::CloudState::load(app.handle()).map_err(std::io::Error::other)?,
            );
            tauri::async_runtime::spawn(cloud::upload::worker::maintain(app.handle().clone()));
            tauri::async_runtime::spawn(obs::runtime::installer::maintain_obs(
                app.handle().clone(),
            ));
            tauri::async_runtime::spawn(live::runtime::process::maintain(app.handle().clone()));
            tauri::async_runtime::spawn(recording::capture::runtime::maintain(
                app.handle().clone(),
            ));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            cloud::auth::commands::get_cloud_settings,
            cloud::replay::catalog::list_cloud_replays,
            cloud::replay::calibration::get_cloud_replay_calibration,
            cloud::replay::calibration::save_cloud_replay_calibration,
            cloud::replay::events::list_cloud_replay_events,
            cloud::replay::wcl::get_cloud_wcl_status,
            cloud::replay::wcl::start_cloud_wcl_import,
            cloud::replay::annotations::get_cloud_replay_annotations,
            cloud::replay::annotations::save_cloud_replay_annotations,
            cloud::replay::catalog::retry_cloud_replay_processing,
            cloud::auth::commands::set_cloud_settings,
            cloud::auth::commands::verify_cloud_connection,
            cloud::upload::commands::get_cloud_uploads,
            cloud::upload::commands::enqueue_cloud_upload,
            cloud::upload::commands::retry_cloud_upload,
            cloud::upload::commands::pause_cloud_upload,
            cloud::upload::commands::cancel_cloud_upload,
            obs::runtime::installer::get_obs_installation,
            obs::runtime::installer::install_portable_obs,
            obs::runtime::installer::launch_portable_obs,
            obs::runtime::installer::open_obs_install_directory,
            obs::runtime::service::get_obs_status,
            combat_log::get_combat_log_status,
            combat_log::set_combat_log_directory,
            combat_log::set_combat_log_monitoring,
            recording::playback::catalog::list_local_recordings,
            recording::events::query::list_replay_events,
            recording::review::local::get_local_death_review,
            recording::importing::commands::get_recording_import_preferences,
            recording::importing::commands::set_recording_import_preferences,
            recording::importing::commands::start_recording_import,
            recording::importing::commands::get_recording_import,
            recording::importing::commands::cancel_recording_import,
            recording::playback::preferences::get_replay_preferences,
            recording::playback::preferences::set_replay_preferences,
            recording::annotations::commands::get_local_replay_annotations,
            recording::annotations::commands::save_local_replay_annotations,
            recording::processing::retry::retry_recording_processing,
            game_data::catalog::get_spell_metadata,
            game_data::catalog::import_spell_metadata,
            live::session::start_live_session,
            live::session::get_live_session,
            live::history::catalog::get_live_replay_manifest,
            live::session::stop_live_session,
            live::whep::negotiate_live_playback,
            live::whep::release_live_playback,
            obs::settings::video::get_obs_video_settings,
            obs::settings::capture::get_obs_capture_settings,
            obs::settings::audio::get_obs_audio_inputs,
            obs::settings::snapshot::get_cached_obs_settings,
            obs::settings::snapshot::get_obs_settings_snapshot,
            obs::runtime::service::get_obs_record_directory,
            obs::settings::video::set_obs_video_settings,
            obs::runtime::service::set_obs_record_directory,
            obs::settings::capture::configure_obs_game_capture,
            obs::settings::audio::set_obs_audio_settings,
        ])
        .build(tauri::generate_context!())
        .expect("构建 WoW Recorder 客户端失败");

    app.run(|app_handle, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            let obs_state = app_handle.state::<obs::runtime::service::ObsState>();
            obs::runtime::installer::shutdown_managed_obs(&obs_state);
            let media_state = app_handle.state::<live::runtime::state::LocalMediaState>();
            live::runtime::process::shutdown(&media_state);
        }
    });
}
