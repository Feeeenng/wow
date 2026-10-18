use serde::{Deserialize, Serialize};
use std::{collections::HashSet, path::PathBuf};
use tauri::{AppHandle, Manager, State};

use super::{paths, transaction};
use crate::{
    cloud::{state::CloudState, upload::model::UploadIntent},
    local_state::LocalStateStore,
    recording::{
        capture::state::RecordingState, config::RECORDING_MANAGEMENT_SECTION, model::PullState,
    },
};

#[derive(Default, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
struct Preferences {
    favorites: HashSet<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedRecordingSummary {
    pull_id: String,
    bytes: u64,
    is_favorited: bool,
    can_delete: bool,
    can_open_directory: bool,
    blocked_reason: Option<String>,
}

fn root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("recordings"))
        .map_err(|error| format!("无法定位录像管理目录：{error}"))
}

/// 管理摘要不读取媒体内容，也不将导入原片体积算作可回收空间。
#[tauri::command]
pub async fn list_managed_recordings(
    app: AppHandle,
    state: State<'_, RecordingState>,
    cloud: State<'_, CloudState>,
    store: State<'_, LocalStateStore>,
) -> Result<Vec<ManagedRecordingSummary>, String> {
    let root = root(&app)?;
    let _guard = state.management.lock().await;
    let preferences = store
        .get::<Preferences>(RECORDING_MANAGEMENT_SECTION)
        .await?
        .unwrap_or_default();
    let jobs = cloud.jobs.lock().await;
    let active = cloud.active.lock().await;
    let index = state.index.lock().await;
    Ok(index
        .active_pull
        .iter()
        .chain(index.pulls.iter())
        .map(|pull| {
            let is_active = index
                .active_pull
                .as_ref()
                .is_some_and(|active| active.pull_id == pull.pull_id);
            let inspected = paths::artifacts(&root, pull, &index);
            let bytes = inspected.as_ref().map(|(_, _, bytes)| *bytes).unwrap_or(0);
            let reason = if is_active
                || !matches!(
                    pull.state,
                    PullState::Ready
                        | PullState::Partial
                        | PullState::Failed
                        | PullState::Interrupted
                ) {
                Some("录像正在录制、等待或处理中".into())
            } else if cloud.recovery_error.is_some() {
                Some("上传队列无法核验，暂不能删除".into())
            } else if jobs.iter().any(|job| {
                job.pull_id == pull.pull_id
                    && (!matches!(
                        job.intent,
                        UploadIntent::Completed | UploadIntent::Cancelled
                    ) || active.as_ref().is_some_and(|(id, _)| id == &job.job_id))
            }) {
                Some("录像有未结束的上传任务，请先取消上传".into())
            } else {
                match &inspected {
                    Err(error) => Some(error.clone()),
                    Ok((_, targets, _)) if targets.is_empty() => {
                        Some("没有可删除的客户端成片，保留原片与日志".into())
                    }
                    _ => None,
                }
            };
            ManagedRecordingSummary {
                pull_id: pull.pull_id.clone(),
                bytes,
                is_favorited: preferences.favorites.contains(&pull.pull_id),
                can_delete: reason.is_none(),
                can_open_directory: paths::directory(&root, pull).is_ok(),
                blocked_reason: reason,
            }
        })
        .collect())
}

/// 按稳定录像身份保存收藏，禁止对不存在的记录创建偏好。
#[tauri::command]
pub async fn set_recording_favorite(
    pull_id: String,
    is_favorited: bool,
    state: State<'_, RecordingState>,
    store: State<'_, LocalStateStore>,
) -> Result<(), String> {
    save_favorite(&pull_id, is_favorited, &state, &store).await
}

/// 收藏变更先保存再发布，失败时保留原偏好及其他业务区段。
pub(super) async fn save_favorite(
    pull_id: &str,
    is_favorited: bool,
    state: &RecordingState,
    store: &LocalStateStore,
) -> Result<(), String> {
    let _guard = state.management.lock().await;
    let index = state.index.lock().await;
    if !index
        .active_pull
        .iter()
        .chain(index.pulls.iter())
        .any(|pull| pull.pull_id == pull_id)
    {
        return Err("本地录像不存在".into());
    }
    let mut preferences = store
        .get::<Preferences>(RECORDING_MANAGEMENT_SECTION)
        .await?
        .unwrap_or_default();
    if is_favorited {
        preferences.favorites.insert(pull_id.to_string());
    } else {
        preferences.favorites.remove(pull_id);
    }
    store.set(RECORDING_MANAGEMENT_SECTION, &preferences).await
}

/// 只打开后端核验的受管理目录，不允许任意路径或 Shell 参数。
#[tauri::command]
pub async fn open_recording_directory(
    app: AppHandle,
    pull_id: String,
    state: State<'_, RecordingState>,
) -> Result<(), String> {
    let _guard = state.management.lock().await;
    let index = state.index.lock().await;
    let pull = index
        .active_pull
        .iter()
        .chain(index.pulls.iter())
        .find(|pull| pull.pull_id == pull_id)
        .ok_or("本地录像不存在")?;
    let directory = paths::directory(&root(&app)?, pull)?;
    #[cfg(windows)]
    {
        std::process::Command::new("explorer.exe")
            .arg(directory)
            .spawn()
            .map_err(|error| format!("打开录像目录失败：{error}"))?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = directory;
        Err("当前平台暂不支持打开录像目录".into())
    }
}

/// 删除仅作用于客户端派生成片，未完成或已暂停的上传仍保护其媒体源。
#[tauri::command]
pub async fn delete_recording(
    app: AppHandle,
    pull_id: String,
    state: State<'_, RecordingState>,
    cloud: State<'_, CloudState>,
) -> Result<(), String> {
    let _guard = state.management.lock().await;
    if cloud.recovery_error.is_some() {
        return Err("上传队列无法核验，暂不能删除".into());
    }
    let jobs = cloud.jobs.lock().await;
    let active = cloud.active.lock().await;
    if jobs.iter().any(|job| {
        job.pull_id == pull_id
            && (!matches!(
                job.intent,
                UploadIntent::Completed | UploadIntent::Cancelled
            ) || active.as_ref().is_some_and(|(id, _)| id == &job.job_id))
    }) {
        return Err("录像有未结束的上传任务，请先取消上传".into());
    }
    transaction::delete(&state, &root(&app)?, &pull_id).await
}
