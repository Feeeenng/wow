use std::{path::Path, sync::atomic::Ordering};

use tauri::{AppHandle, Manager};

use crate::recording::{
    capture::{runtime::ffmpeg_path, state::RecordingState},
    model::{BossPull, PullState},
    processing::{artifacts::imported_directory, clip::process_playback},
};

/// 外部原片仅作为输入，派生 HLS 只能创建在应用录像目录内。
pub(crate) fn process_existing_playback(
    ffmpeg: &Path,
    recordings_directory: &Path,
    pull: &BossPull,
) -> Result<std::path::PathBuf, String> {
    let video = pull.video_path.as_ref().ok_or("录像缺少原片路径")?;
    let directory = if let Some(source) = &pull.imported_source {
        if std::fs::canonicalize(source).ok() != std::fs::canonicalize(video).ok()
            || !video.is_file()
        {
            return Err("导入录像原片不存在或路径不一致".into());
        }
        crate::recording::processing::probe::validate_external_video(ffmpeg, video, &pull.pull_id)?;
        imported_directory(recordings_directory, pull)?
    } else {
        crate::recording::processing::command::run_ffmpeg(
            ffmpeg,
            &crate::recording::processing::command::build_validate_args(video),
            &pull.pull_id,
            None,
        )?;
        video.parent().ok_or("录像缺少父目录")?.to_path_buf()
    };
    process_playback(ffmpeg, &directory, &pull.pull_id, video)
}

/// 为升级前已经完成的 MP4 异步补充 HLS 播放产物。
pub async fn start_next(app: &AppHandle, state: &RecordingState) -> Result<bool, String> {
    if state
        .processing
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Ok(false);
    }
    let selected = {
        let mut index = state.index.lock().await;
        index.pulls.iter_mut().find_map(|pull| {
            if pull.state != PullState::WaitingForPlayback {
                return None;
            }
            pull.video_path.as_ref()?;
            pull.state = PullState::Processing;
            Some(pull.clone())
        })
    };
    let Some(pull) = selected else {
        state.processing.store(false, Ordering::SeqCst);
        return Ok(false);
    };
    state.persist_processing_claim(&pull.pull_id).await?;
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let ffmpeg = ffmpeg_path(&app);
        let directory = app
            .path()
            .app_data_dir()
            .map(|root| root.join("recordings"))
            .map_err(|error| error.to_string());
        let result = match ffmpeg {
            Ok(ffmpeg) => {
                let selected_pull = pull.clone();
                match directory {
                    Ok(pull_directory) => tauri::async_runtime::spawn_blocking(move || {
                        process_existing_playback(&ffmpeg, &pull_directory, &selected_pull)
                    })
                    .await
                    .map_err(|error| {
                        format!("等待 Pull {} 播放文件任务失败：{error}", pull.pull_id)
                    })
                    .and_then(|result| result),
                    Err(error) => Err(format!("Pull {} 的播放目录无效：{error}", pull.pull_id)),
                }
            }
            Err(error) => Err(error),
        };
        let recording = app.state::<RecordingState>();
        {
            let mut index = recording.index.lock().await;
            if let Some(stored) = index
                .pulls
                .iter_mut()
                .find(|item| item.pull_id == pull.pull_id)
            {
                match result {
                    Ok(path) => {
                        stored.playback_path = Some(path);
                        stored.state = if stored
                            .mapping
                            .as_ref()
                            .is_some_and(|mapping| mapping.has_gap)
                        {
                            PullState::Partial
                        } else {
                            PullState::Ready
                        };
                        stored.error = None;
                    }
                    Err(error) => {
                        stored.state = PullState::Failed;
                        stored.error = Some(error.clone());
                        *recording.last_error.write().await = Some(error);
                    }
                }
            }
        }
        let _ = recording.save().await;
        recording.processing.store(false, Ordering::SeqCst);
    });
    Ok(true)
}
