use super::{
    model::{validate, SaveRequest, Snapshot},
    store::AnnotationState,
};
use crate::{local_state::LocalStateStore, recording::capture::state::RecordingState};
use tauri::State;

/// 标注绑定已有本地录像，不能借任意文件路径或云端 ID 写入本地区段。
async fn duration(recordings: &RecordingState, pull_id: &str) -> Result<i64, String> {
    let index = recordings.index.lock().await;
    let pull = index
        .pulls
        .iter()
        .find(|pull| pull.pull_id == pull_id)
        .ok_or("本地标注对应录像不存在")?;
    let end = pull
        .encounter_end_unix_ms
        .ok_or("战斗尚未结束，暂不能保存录像标注")?;
    end.checked_sub(pull.encounter_start_unix_ms)
        .filter(|duration| *duration >= 0)
        .ok_or("录像战斗时长无效".into())
}

#[tauri::command]
pub async fn get_local_replay_annotations(
    pull_id: String,
    state: State<'_, AnnotationState>,
    store: State<'_, LocalStateStore>,
    recordings: State<'_, RecordingState>,
) -> Result<Snapshot, String> {
    let duration = duration(&recordings, &pull_id).await?;
    let snapshot = state.get(&store, &pull_id).await?;
    validate(&snapshot.items, duration)?;
    Ok(snapshot)
}

#[tauri::command]
pub async fn save_local_replay_annotations(
    pull_id: String,
    request: SaveRequest,
    state: State<'_, AnnotationState>,
    store: State<'_, LocalStateStore>,
    recordings: State<'_, RecordingState>,
) -> Result<Snapshot, String> {
    let duration = duration(&recordings, &pull_id).await?;
    state.save(&store, &pull_id, request, duration).await
}
