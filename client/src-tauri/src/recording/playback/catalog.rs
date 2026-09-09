use std::collections::HashSet;

use tauri::{AppHandle, Manager, State};

use crate::recording::{
    model::BossPull, processor::ensure_artifact_layout, timeline::populate_missing_timelines,
    RecordingState,
};

/// 刷新真实 CombatLog 时间轴和本地 Pull 目录，供启动任务与回放命令复用。
pub(crate) async fn refresh_local_recordings(
    app: &AppHandle,
    state: &RecordingState,
) -> Result<Vec<BossPull>, String> {
    let output_directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法定位本地录像目录：{error}"))?
        .join("recordings");
    let (pulls, changed) = {
        let mut index = state.index.lock().await;
        let (updated_pull_ids, diagnostics) = populate_missing_timelines(&mut index.pulls, 0);
        index.diagnostics.extend(diagnostics);
        let updated_pull_ids = updated_pull_ids.into_iter().collect::<HashSet<_>>();
        let mut layout_changed = false;
        for pull in &mut index.pulls {
            layout_changed |= ensure_artifact_layout(
                &output_directory,
                pull,
                updated_pull_ids.contains(&pull.pull_id),
            )?;
        }
        let changed = !updated_pull_ids.is_empty() || layout_changed;
        (index.pulls.clone(), changed)
    };
    if changed {
        state.save().await?;
    }
    Ok(pulls)
}

/// 返回真实 CombatLog 已识别的本地 Boss 录像，并按需迁移旧版产物。
#[tauri::command]
pub async fn list_local_recordings(
    app: AppHandle,
    state: State<'_, RecordingState>,
) -> Result<Vec<BossPull>, String> {
    refresh_local_recordings(&app, &state).await
}
