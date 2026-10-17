use std::sync::atomic::Ordering;

use tauri::{AppHandle, Manager};

use crate::recording::{
    capture::{runtime::ffmpeg_path, state::RecordingState},
    config::MIN_SOURCE_FILE_BYTES,
    model::PullState,
    processing::{
        clip::process_clip,
        mapping::{map_clip_sources, source_window_is_closed},
    },
};

/// 串行领取成片任务，将媒体处理结果和实际映射一并发布到索引。
pub(crate) async fn start_next_processing(
    app: &AppHandle,
    state: &RecordingState,
) -> Result<bool, String> {
    if state
        .processing
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Ok(false);
    }
    let (selected, mapping_failed) = {
        let mut index = state.index.lock().await;
        let all_sources = index.sources.clone();
        let sources = index
            .sources
            .iter()
            .filter(|source| {
                source.ended_at_unix_ms.is_some()
                    && std::fs::metadata(&source.path)
                        .is_ok_and(|metadata| metadata.len() >= MIN_SOURCE_FILE_BYTES)
            })
            .cloned()
            .collect::<Vec<_>>();
        let mut mapping_failed = false;
        let selected = index.pulls.iter_mut().find_map(|pull| {
            if pull.state != PullState::WaitingForSource {
                return None;
            }
            let clip_end = pull.clip_end_unix_ms?;
            if !source_window_is_closed(&all_sources, clip_end) {
                return None;
            }
            let mapping = match map_clip_sources(
                &sources,
                pull.clip_start_unix_ms,
                clip_end,
                pull.encounter_start_unix_ms,
            ) {
                Ok(mapping) => mapping,
                Err(error) => {
                    pull.state = PullState::Failed;
                    pull.error = Some(error);
                    mapping_failed = true;
                    return None;
                }
            };
            pull.mapping = Some(mapping.clone());
            pull.state = PullState::Processing;
            Some((pull.clone(), mapping))
        });
        (selected, mapping_failed)
    };
    let Some((pull, mapping)) = selected else {
        state.processing.store(false, Ordering::SeqCst);
        if mapping_failed {
            state.save().await?;
        }
        return Ok(mapping_failed);
    };
    state.persist_processing_claim(&pull.pull_id).await?;
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let ffmpeg = ffmpeg_path(&app);
        let output_directory = app
            .path()
            .app_data_dir()
            .map(|path| path.join("recordings"));
        let result = match (ffmpeg, output_directory) {
            (Ok(ffmpeg), Ok(output_directory)) => {
                let pull_for_task = pull.clone();
                let mapping_for_task = mapping.clone();
                tauri::async_runtime::spawn_blocking(move || {
                    process_clip(
                        &ffmpeg,
                        &output_directory,
                        &pull_for_task,
                        &mapping_for_task,
                    )
                })
                .await
                .map_err(|error| format!("等待 Pull {} 处理任务失败：{error}", pull.pull_id))
                .and_then(|result| result)
            }
            (Err(error), _) => Err(error),
            (_, Err(error)) => Err(error.to_string()),
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
                    Ok(processed) => {
                        stored.mapping = Some(processed.mapping);
                        stored.video_path = Some(processed.video_path);
                        stored.playback_path = processed.playback_path;
                        stored.state = if processed.playback_error.is_some() {
                            PullState::Failed
                        } else if mapping.has_gap {
                            PullState::Partial
                        } else {
                            PullState::Ready
                        };
                        stored.error = processed.playback_error;
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
