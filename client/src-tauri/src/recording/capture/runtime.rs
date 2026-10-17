use std::{
    path::{Path, PathBuf},
    time::{Instant, SystemTime, UNIX_EPOCH},
};

use crate::{
    combat_log::{discovery::latest_combat_log, load_settings, parser::parse_encounter_line},
    local_state::LocalStateStore,
    obs::runtime::service::{
        current_recording_file, detect_current_recording_file, split_recording_file,
        ObsRecordingEvent, ObsState,
    },
};
use tauri::{AppHandle, Manager};

use crate::recording::{
    capture::{sources::apply_obs_event, state::RecordingState},
    config::{MONITOR_INTERVAL_MS, SOURCE_ROTATION_SECONDS},
    events::index::populate_missing_timelines,
    model::PullState,
    playback,
    processing::queue::start_next_processing,
};

fn unix_time_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn log_year(path: &Path) -> Option<i32> {
    let name = path.file_name()?.to_str()?;
    let date = name.strip_prefix("WoWCombatLog-")?.split('_').next()?;
    if date.len() != 6 {
        return None;
    }
    let year = date.get(4..6)?.parse::<i32>().ok()?;
    Some(if year >= 70 { 1900 + year } else { 2000 + year })
}

async fn poll_combat_log(app: &AppHandle, state: &RecordingState) -> Result<bool, String> {
    let local_state = app.state::<LocalStateStore>();
    let settings = load_settings(&local_state).await?;
    let Some(directory) = settings.directory else {
        return Ok(false);
    };
    if !settings.monitoring {
        return Ok(false);
    }
    let Some(path) = latest_combat_log(&directory)? else {
        return Ok(false);
    };
    let year = log_year(&path)
        .ok_or_else(|| format!("无法从 CombatLog 文件名确定年份：{}", path.display()))?;
    let mut reader = state.reader.lock().await;
    if reader.cursor().file.is_none() {
        reader.follow_from_end(&path).await?;
        state.index.lock().await.combat_log_cursor = reader.cursor().clone();
        return Ok(true);
    }
    let previous_cursor = reader.cursor().clone();
    let lines = reader.poll(&path).await?;
    let cursor = reader.cursor().clone();
    let file_id = cursor
        .file
        .as_ref()
        .map(|file| format!("{}#{}", file.canonical_path, file.created_at_unix_ms))
        .ok_or_else(|| "CombatLog 读取后缺少文件标识".to_string())?;
    drop(reader);
    let log_changed =
        previous_cursor.file != cursor.file || cursor.byte_offset < previous_cursor.byte_offset;
    if lines.is_empty() && !log_changed {
        return Ok(false);
    }
    let mut tracker = state.tracker.lock().await;
    let mut completed = Vec::new();
    let mut diagnostics = Vec::new();
    if log_changed {
        if let Some(interrupted) = tracker.interrupt_log(previous_cursor.byte_offset) {
            completed.push(interrupted);
        }
    }
    for line in lines {
        match parse_encounter_line(&line.text, year) {
            Ok(Some(event)) => {
                completed.extend(tracker.handle(
                    event,
                    &file_id,
                    line.start_offset,
                    line.end_offset,
                ));
            }
            Ok(None) => {
                if let Some(active) = tracker.active_mut() {
                    crate::recording::events::index::append_line(active, &line, &file_id, year);
                }
            }
            Err(error) => diagnostics.push(format!(
                "解析 {} 字节 {} 的 Boss 事件失败：{}",
                path.display(),
                line.start_offset,
                error
            )),
        }
    }
    let active = tracker.active().cloned();
    drop(tracker);
    let (_, timeline_diagnostics) = populate_missing_timelines(&mut completed, year);
    diagnostics.extend(timeline_diagnostics);
    let mut index = state.index.lock().await;
    index.combat_log_cursor = cursor;
    index.active_pull = active;
    index.pulls.extend(completed);
    index.diagnostics.extend(diagnostics);
    if index.diagnostics.len() > crate::recording::config::MAX_DIAGNOSTICS {
        let overflow = index.diagnostics.len() - crate::recording::config::MAX_DIAGNOSTICS;
        index.diagnostics.drain(..overflow);
    }
    Ok(true)
}

async fn request_due_splits(app: &AppHandle, state: &RecordingState) -> Result<bool, String> {
    let now = unix_time_ms();
    let due = {
        let index = state.index.lock().await;
        index.pulls.iter().position(|pull| {
            pull.state == PullState::WaitingForTail
                && pull.clip_end_unix_ms.is_some_and(|end| end <= now)
        })
    };
    let Some(position) = due else {
        return Ok(false);
    };
    let obs_state = app.state::<ObsState>();
    split_recording_file(&obs_state).await?;
    *state.last_rotation.lock().await = Instant::now();
    state.index.lock().await.pulls[position].state = PullState::WaitingForSource;
    Ok(true)
}

async fn rotate_long_source(app: &AppHandle, state: &RecordingState) -> Result<bool, String> {
    if state.last_rotation.lock().await.elapsed().as_secs() < SOURCE_ROTATION_SECONDS {
        return Ok(false);
    }
    let has_open_source = state
        .index
        .lock()
        .await
        .sources
        .iter()
        .any(|source| source.ended_at_unix_ms.is_none());
    if !has_open_source {
        *state.last_rotation.lock().await = Instant::now();
        return Ok(false);
    }
    let obs_state = app.state::<ObsState>();
    split_recording_file(&obs_state).await?;
    *state.last_rotation.lock().await = Instant::now();
    Ok(false)
}

pub(crate) fn ffmpeg_path(app: &AppHandle) -> Result<PathBuf, String> {
    let bundled = app
        .path()
        .resource_dir()
        .map_err(|error| format!("无法定位客户端资源目录：{error}"))?
        .join(r"ffmpeg-runtime\bin\ffmpeg.exe");
    if bundled.is_file() {
        return Ok(bundled);
    }
    Ok(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(r"resources\ffmpeg-runtime\bin\ffmpeg.exe"))
}

/// 在应用生命周期内持续关联 CombatLog、OBS 源文件和本地成片任务。
pub async fn maintain(app: AppHandle) {
    let state = app.state::<RecordingState>();
    let obs_state = app.state::<ObsState>();
    let mut obs_events = obs_state.recording_events.subscribe();
    if let Err(error) = playback::catalog::refresh_local_recordings(&app, &state).await {
        *state.last_error.write().await = Some(error);
    }
    loop {
        tokio::time::sleep(std::time::Duration::from_millis(MONITOR_INTERVAL_MS)).await;
        let mut changed = false;
        let mut detection_error = None;
        let observed_file = match current_recording_file(&obs_state).await {
            Some(file) => Some(file),
            None => match detect_current_recording_file(&obs_state).await {
                Ok(file) => file,
                Err(error) => {
                    detection_error = Some(error);
                    None
                }
            },
        };
        if let Some(file) = observed_file {
            changed |= apply_obs_event(
                &state,
                ObsRecordingEvent::FileChanged {
                    path: file.path,
                    occurred_at_unix_ms: file.started_at_unix_ms,
                },
            )
            .await;
        }
        while let Ok(event) = obs_events.try_recv() {
            changed |= apply_obs_event(&state, event).await;
        }
        let result = async {
            if changed {
                state.save().await?;
                changed = false;
            }
            changed |= poll_combat_log(&app, &state).await?;
            changed |= crate::recording::capture::clock::sample_clock(&app, &state).await?;
            if changed {
                state.save().await?;
                changed = false;
            }
            changed |= request_due_splits(&app, &state).await?;
            changed |= rotate_long_source(&app, &state).await?;
            changed |= start_next_processing(&app, &state).await?;
            changed |= playback::backfill::start_next(&app, &state).await?;
            if changed {
                state.save().await?;
            }
            Ok::<(), String>(())
        }
        .await;
        match result {
            Ok(()) => *state.last_error.write().await = detection_error,
            Err(error) => *state.last_error.write().await = Some(error),
        }
    }
}
