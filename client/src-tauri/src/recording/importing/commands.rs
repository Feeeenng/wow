use std::{
    collections::BTreeSet,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};

use tauri::{AppHandle, Manager, State};

use crate::{
    local_state::LocalStateStore,
    recording::{
        capture::{runtime::ffmpeg_path, state::RecordingState},
        importing::{
            assemble::{assemble, pull_id},
            config::{MAX_ISSUES, MAX_LOG_FILES, PREFERENCES_SECTION},
            model::{ImportPreferences, ImportProgress, ImportRequest, ImportStatus},
            source::{logs, metadata},
        },
    },
};

struct ImportTask {
    progress: Mutex<ImportProgress>,
    cancelled: AtomicBool,
}

impl ImportTask {
    fn update(&self, change: impl FnOnce(&mut ImportProgress)) {
        change(
            &mut self
                .progress
                .lock()
                .unwrap_or_else(|error| error.into_inner()),
        );
    }

    fn snapshot(&self) -> ImportProgress {
        self.progress
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clone()
    }

    fn issue(&self, message: String) {
        self.update(|progress| {
            if progress.issues.len() < MAX_ISSUES {
                progress.issues.push(message);
            }
        });
    }
}

/// 单进程只保留一个导入任务；重启后重新导入会按稳定身份跳过已有记录。
#[derive(Default)]
pub struct RecordingImportState {
    current: Mutex<Option<Arc<ImportTask>>>,
}

/// 读取用户选择的导入路径，不恢复扫描、媒体进程或运行中状态。
#[tauri::command]
pub async fn get_recording_import_preferences(
    state: State<'_, LocalStateStore>,
) -> Result<ImportPreferences, String> {
    Ok(state.get(PREFERENCES_SECTION).await?.unwrap_or_default())
}

/// 导入路径由 Rust 统一持久化，空值表示尚未选择。
#[tauri::command]
pub async fn set_recording_import_preferences(
    preferences: ImportPreferences,
    state: State<'_, LocalStateStore>,
) -> Result<(), String> {
    if preferences.log_paths.len() > MAX_LOG_FILES {
        return Err("选择的日志文件过多".into());
    }
    state.set(PREFERENCES_SECTION, &preferences).await
}

/// 返回当前任务进度，媒体处理完成情况由录像列表的状态继续反映。
#[tauri::command]
pub fn get_recording_import(state: State<'_, RecordingImportState>) -> ImportProgress {
    state
        .current
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .as_ref()
        .map(|task| task.snapshot())
        .unwrap_or_default()
}

/// 取消尚未完成的日志扫描与索引，已经导入的录像及队列任务予以保留。
#[tauri::command]
pub fn cancel_recording_import(
    task_id: String,
    state: State<'_, RecordingImportState>,
) -> Result<(), String> {
    let current = state
        .current
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let task = current.as_ref().ok_or("当前没有导入任务")?;
    if task.snapshot().task_id.as_deref() != Some(task_id.as_str()) {
        return Err("导入任务已变化，请刷新进度".into());
    }
    task.cancelled.store(true, Ordering::Relaxed);
    Ok(())
}

/// 启动后台只读导入，目录与日志必须由调用方明确指定。
#[tauri::command]
pub fn start_recording_import(
    app: AppHandle,
    request: ImportRequest,
    state: State<'_, RecordingImportState>,
) -> Result<ImportProgress, String> {
    if request.directory.trim().is_empty()
        || request.log_paths.is_empty()
        || request.log_paths.len() > MAX_LOG_FILES
    {
        return Err("请选择录像目录及有效数量的 CombatLog 文件".into());
    }
    let mut current = state
        .current
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    if current
        .as_ref()
        .is_some_and(|task| task.snapshot().status.running())
    {
        return Err("已有录像导入任务正在运行".into());
    }
    let task = Arc::new(ImportTask {
        cancelled: AtomicBool::new(false),
        progress: Mutex::new(ImportProgress {
            task_id: Some(uuid::Uuid::new_v4().to_string()),
            status: ImportStatus::Scanning,
            ..ImportProgress::default()
        }),
    });
    let initial = task.snapshot();
    *current = Some(task.clone());
    tauri::async_runtime::spawn(async move {
        let result = run_import(&app, request, task.clone()).await;
        task.update(|progress| {
            progress.current_file = None;
            if task.cancelled.load(Ordering::Relaxed) {
                progress.status = ImportStatus::Cancelled;
            } else if let Err(error) = result {
                progress.status = ImportStatus::Failed;
                progress.error = Some(error);
            } else {
                progress.status = ImportStatus::Completed;
            }
        });
    });
    Ok(initial)
}

/// 扫描日志只做一次；每场逐项组装并持久化后才计入已导入数量。
async fn run_import(
    app: &AppHandle,
    request: ImportRequest,
    task: Arc<ImportTask>,
) -> Result<(), String> {
    let scanning = task.clone();
    let (candidates, encounters) = tauri::async_runtime::spawn_blocking(move || {
        let paths = request
            .log_paths
            .iter()
            .map(std::fs::canonicalize)
            .collect::<Result<BTreeSet<PathBuf>, _>>()
            .map_err(|error| format!("导入日志不可用：{error}"))?
            .into_iter()
            .collect::<Vec<_>>();
        let total_bytes = paths
            .iter()
            .map(|path| std::fs::metadata(path).map(|metadata| metadata.len()))
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?
            .into_iter()
            .sum();
        let (candidates, issues) = metadata::candidates(&request)?;
        scanning.update(|progress| {
            progress.total_recordings = candidates.len();
            progress.total_bytes = total_bytes;
        });
        for issue in issues {
            scanning.issue(issue);
        }
        let encounters = logs::scan(&paths, &scanning.cancelled, |bytes, path| {
            scanning.update(|progress| {
                progress.bytes_read = bytes;
                progress.current_file = Some(path.display().to_string());
            })
        })?;
        Ok::<_, String>((candidates, encounters))
    })
    .await
    .map_err(|error| format!("等待导入日志扫描失败：{error}"))??;
    let encounters = Arc::new(encounters);
    let ffmpeg = ffmpeg_path(app)?;
    let recording = app.state::<RecordingState>();
    task.update(|progress| progress.status = ImportStatus::Indexing);
    let mut unmatched = 0;
    for candidate in candidates {
        if task.cancelled.load(Ordering::Relaxed) {
            break;
        }
        let id = pull_id(&candidate);
        let duplicate = recording
            .index
            .lock()
            .await
            .pulls
            .iter()
            .any(|pull| pull.pull_id == id);
        if duplicate {
            task.update(|progress| {
                progress.skipped_count += 1;
                progress.processed_recordings += 1;
            });
            continue;
        }
        let label = candidate.video_path.display().to_string();
        task.update(|progress| progress.current_file = Some(label.clone()));
        let scan = encounters.clone();
        let media = ffmpeg.clone();
        let result =
            tauri::async_runtime::spawn_blocking(move || assemble(&candidate, &scan, &media))
                .await
                .map_err(|error| format!("等待录像事件索引失败：{error}"))?;
        if task.cancelled.load(Ordering::Relaxed) {
            break;
        }
        match result {
            Ok(Some(pull)) => {
                let inserted = recording.insert_imported(pull).await?;
                if inserted {
                    task.update(|progress| {
                        progress.imported_count += 1;
                        progress.pull_ids.push(id);
                    });
                } else {
                    task.update(|progress| progress.skipped_count += 1);
                }
            }
            Ok(None) => {
                unmatched += 1;
                task.update(|progress| progress.skipped_count += 1);
            }
            Err(error) => {
                task.issue(format!("{label}：{error}"));
                task.update(|progress| progress.failed_count += 1);
            }
        }
        task.update(|progress| progress.processed_recordings += 1);
    }
    if unmatched > 0 {
        task.issue(format!(
            "{unmatched} 条录像与所选日志没有完全一致的战斗边界，已跳过"
        ));
    }
    Ok(())
}
