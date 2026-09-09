pub(crate) mod config;
pub(crate) mod coordinator;
pub(crate) mod model;
pub(crate) mod playback;
pub(crate) mod pull_tracker;
pub(crate) mod processor;
mod recovery;
pub(crate) mod store;

use std::{
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
    time::{Instant, SystemTime, UNIX_EPOCH},
};

use tauri::{AppHandle, Manager, State};
use tokio::sync::{Mutex, RwLock};

use crate::{
    combat_log::{
        discovery::latest_combat_log,
        load_settings,
        parser::parse_encounter_line,
        reader::CombatLogReader,
    },
    local_state::LocalStateStore,
    obs::runtime::service::{
        current_recording_file, detect_current_recording_file, split_recording_file,
        ObsRecordingEvent, ObsState,
    },
};

use self::{
    coordinator::{map_clip_sources, source_window_is_closed},
    config::{MIN_SOURCE_FILE_BYTES, MONITOR_INTERVAL_MS, SOURCE_ROTATION_SECONDS},
    model::{BossPull, PullState, RecordingIndex, SourceRecording},
    processor::process_clip,
    pull_tracker::PullTracker,
    recovery::recover_interrupted_processing,
    store::RecordingStore,
};

/// 保存唯一日志读取器、Pull 状态机、处理队列和业务索引。
pub struct RecordingState {
    index: Mutex<RecordingIndex>,
    reader: Mutex<CombatLogReader>,
    tracker: Mutex<PullTracker>,
    store: RecordingStore,
    persistence: Mutex<()>,
    processing: AtomicBool,
    last_error: RwLock<Option<String>>,
    last_rotation: Mutex<Instant>,
}

impl RecordingState {
    /// 从应用数据目录恢复录制业务状态，损坏索引保留后以空状态启动。
    pub fn load(app: &AppHandle) -> Result<Self, String> {
        let directory = app
            .path()
            .app_data_dir()
            .map_err(|error| format!("无法定位录制业务目录：{error}"))?;
        let store = RecordingStore::new(directory.join("recording-index.json"));
        let loaded = tauri::async_runtime::block_on(store.load());
        let (mut index, last_error) = match loaded {
            Ok(index) => (index, None),
            Err(error) => (RecordingIndex::default(), Some(error)),
        };
        recover_interrupted_processing(&mut index);
        Ok(Self {
            reader: Mutex::new(CombatLogReader::from_cursor(index.combat_log_cursor.clone())),
            tracker: Mutex::new(PullTracker::from_active(index.active_pull.clone())),
            index: Mutex::new(index),
            store,
            persistence: Mutex::new(()),
            processing: AtomicBool::new(false),
            last_error: RwLock::new(last_error),
            last_rotation: Mutex::new(Instant::now()),
        })
    }

    async fn save(&self) -> Result<(), String> {
        let _guard = self.persistence.lock().await;
        let snapshot = self.index.lock().await.clone();
        self.store.save(&snapshot).await
    }
}

fn unix_time_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn system_time_ms(time: SystemTime) -> Option<i64> {
    time.duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_millis() as i64)
}

fn choose_source_end(started_at_unix_ms: i64, fallback_unix_ms: i64, modified_unix_ms: Option<i64>) -> i64 {
    modified_unix_ms
        .filter(|modified| *modified >= started_at_unix_ms && *modified <= fallback_unix_ms)
        .unwrap_or(fallback_unix_ms)
}

fn closed_source_end(source: &SourceRecording, fallback_unix_ms: i64) -> i64 {
    let modified = std::fs::metadata(&source.path)
        .ok()
        .and_then(|metadata| metadata.modified().ok())
        .and_then(system_time_ms);
    choose_source_end(source.started_at_unix_ms, fallback_unix_ms, modified)
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

async fn apply_obs_event(state: &RecordingState, event: ObsRecordingEvent) -> bool {
    let mut index = state.index.lock().await;
    match event {
        ObsRecordingEvent::FileChanged {
            path,
            occurred_at_unix_ms,
        } => {
            if index
                .sources
                .last()
                .is_some_and(|source| source.path == PathBuf::from(&path) && source.ended_at_unix_ms.is_none())
            {
                return false;
            }
            for source in index.sources.iter_mut().filter(|source| source.ended_at_unix_ms.is_none()) {
                source.ended_at_unix_ms = Some(closed_source_end(source, occurred_at_unix_ms));
            }
            index.sources.push(SourceRecording {
                path: PathBuf::from(path),
                started_at_unix_ms: occurred_at_unix_ms,
                ended_at_unix_ms: None,
            });
            true
        }
        ObsRecordingEvent::Stopped {
            path,
            occurred_at_unix_ms,
        } => {
            let mut changed = false;
            for source in index.sources.iter_mut().filter(|source| source.ended_at_unix_ms.is_none()) {
                if path.as_ref().is_none_or(|value| source.path == PathBuf::from(value)) {
                    source.ended_at_unix_ms = Some(closed_source_end(source, occurred_at_unix_ms));
                    changed = true;
                }
            }
            changed
        }
    }
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
    let year = log_year(&path).ok_or_else(|| {
        format!("无法从 CombatLog 文件名确定年份：{}", path.display())
    })?;
    let mut reader = state.reader.lock().await;
    if reader.cursor().file.is_none() {
        reader.follow_from_end(&path).await?;
        state.index.lock().await.combat_log_cursor = reader.cursor().clone();
        return Ok(true);
    }
    let lines = reader.poll(&path).await?;
    let cursor = reader.cursor().clone();
    let file_id = cursor
        .file
        .as_ref()
        .map(|file| format!("{}#{}", file.canonical_path, file.created_at_unix_ms))
        .ok_or_else(|| "CombatLog 读取后缺少文件标识".to_string())?;
    drop(reader);
    if lines.is_empty() {
        return Ok(false);
    }
    let mut tracker = state.tracker.lock().await;
    let mut completed = Vec::new();
    let mut diagnostics = Vec::new();
    for line in lines {
        match parse_encounter_line(&line.text, year) {
            Ok(Some(event)) => {
                completed.extend(tracker.handle(event, &file_id, line.start_offset, line.end_offset));
            }
            Ok(None) => {}
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
    let mut index = state.index.lock().await;
    index.combat_log_cursor = cursor;
    index.active_pull = active;
    index.pulls.extend(completed);
    index.diagnostics.extend(diagnostics);
    if index.diagnostics.len() > 100 {
        let overflow = index.diagnostics.len() - 100;
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

fn ffmpeg_path(app: &AppHandle) -> Result<PathBuf, String> {
    let bundled = app
        .path()
        .resource_dir()
        .map_err(|error| format!("无法定位客户端资源目录：{error}"))?
        .join(r"ffmpeg-runtime\bin\ffmpeg.exe");
    if bundled.is_file() {
        return Ok(bundled);
    }
    Ok(PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join(r"resources\ffmpeg-runtime\bin\ffmpeg.exe"))
}

async fn start_next_processing(app: &AppHandle, state: &RecordingState) -> Result<bool, String> {
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
        let selected = index
            .pulls
            .iter_mut()
            .find_map(|pull| {
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
    if let Err(error) = state.save().await {
        state.processing.store(false, Ordering::SeqCst);
        return Err(error);
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let ffmpeg = ffmpeg_path(&app);
        let output_directory = app.path().app_data_dir().map(|path| path.join("recordings"));
        let result = match (ffmpeg, output_directory) {
            (Ok(ffmpeg), Ok(output_directory)) => {
                let pull_for_task = pull.clone();
                let mapping_for_task = mapping.clone();
                tauri::async_runtime::spawn_blocking(move || {
                    process_clip(&ffmpeg, &output_directory, &pull_for_task, &mapping_for_task)
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
            if let Some(stored) = index.pulls.iter_mut().find(|item| item.pull_id == pull.pull_id) {
                match result {
                    Ok(processed) => {
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

/// 在应用生命周期内持续关联 CombatLog、OBS 源文件和本地成片任务。
pub async fn maintain(app: AppHandle) {
    let state = app.state::<RecordingState>();
    let obs_state = app.state::<ObsState>();
    let mut obs_events = obs_state.recording_events.subscribe();
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

/// 返回本地已经识别的 Boss Pull，供后续回放页消费。
#[tauri::command]
pub async fn list_local_recordings(
    state: State<'_, RecordingState>,
) -> Result<Vec<BossPull>, String> {
    Ok(state.index.lock().await.pulls.clone())
}

#[cfg(test)]
mod tests {
    use super::choose_source_end;

    #[test]
    fn closed_source_prefers_valid_file_modified_time() {
        assert_eq!(choose_source_end(1_000, 5_000, Some(3_000)), 3_000);
        assert_eq!(choose_source_end(1_000, 5_000, Some(500)), 5_000);
        assert_eq!(choose_source_end(1_000, 5_000, Some(6_000)), 5_000);
    }
}
