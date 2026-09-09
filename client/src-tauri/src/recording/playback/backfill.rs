use std::{path::Path, sync::atomic::Ordering};

use tauri::{AppHandle, Manager};

use crate::recording::{
    ffmpeg_path, model::PullState, processor::process_playback, RecordingState,
};

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
            let video_path = pull.video_path.clone()?;
            pull.state = PullState::Processing;
            Some((pull.clone(), video_path))
        })
    };
    let Some((pull, video_path)) = selected else {
        state.processing.store(false, Ordering::SeqCst);
        return Ok(false);
    };
    if let Err(error) = state.save().await {
        state.processing.store(false, Ordering::SeqCst);
        return Err(error);
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let ffmpeg = ffmpeg_path(&app);
        let result = match ffmpeg {
            Ok(ffmpeg) => {
                let pull_id = pull.pull_id.clone();
                match video_path.parent().map(Path::to_path_buf) {
                    Some(pull_directory) => tauri::async_runtime::spawn_blocking(move || {
                        process_playback(&ffmpeg, &pull_directory, &pull_id, &video_path)
                    })
                    .await
                    .map_err(|error| {
                        format!("等待 Pull {} 播放文件任务失败：{error}", pull.pull_id)
                    })
                    .and_then(|result| result),
                    None => Err(format!("Pull {} 的视频路径无效", pull.pull_id)),
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
