use std::collections::HashSet;
use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::recording::{
    capture::state::RecordingState,
    events::{
        index::{populate_missing_timelines, TIMELINE_VERSION},
        query::revision,
    },
    model::{BossPull, ClipMapping, PullState, RecordingPlayer},
    processing::artifacts::ensure_artifact_layout,
};

/// 刷新真实 CombatLog 时间轴和本地 Pull 目录，供启动任务与回放命令复用。
pub(crate) async fn refresh_local_recordings(
    app: &AppHandle,
    state: &RecordingState,
) -> Result<(), String> {
    let output_directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法定位本地录像目录：{error}"))?
        .join("recordings");
    let changed = {
        let mut index = state.index.lock().await;
        let (updated_pull_ids, diagnostics) = populate_missing_timelines(&mut index.pulls, 0);
        for diagnostic in diagnostics {
            if !index.diagnostics.contains(&diagnostic) {
                index.diagnostics.push(diagnostic);
            }
        }
        let overflow = index
            .diagnostics
            .len()
            .saturating_sub(crate::recording::config::MAX_DIAGNOSTICS);
        index.diagnostics.drain(..overflow);
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
        changed
    };
    if changed {
        state.save().await?;
    }
    Ok(())
}

/// 录像目录只传递摘要；整场关键事件通过选中战斗的分页查询获取。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalRecordingSummary {
    pull_id: String,
    encounter_id: u32,
    encounter_name: String,
    difficulty_id: u32,
    group_size: u32,
    success: Option<bool>,
    encounter_start_unix_ms: i64,
    encounter_end_unix_ms: Option<i64>,
    clip_start_unix_ms: i64,
    clip_end_unix_ms: Option<i64>,
    state: PullState,
    player_name: Option<String>,
    timeline_event_count: usize,
    timeline_revision: String,
    timeline_complete: bool,
    timeline_parse_errors: u32,
    players: Vec<RecordingPlayer>,
    mapping: Option<ClipMapping>,
    video_path: Option<PathBuf>,
    imported_source: Option<PathBuf>,
    recording_player_guid: Option<String>,
    battle_key: Option<String>,
    playback_path: Option<PathBuf>,
    error: Option<String>,
}

impl LocalRecordingSummary {
    fn new(pull: &BossPull, timeline_revision: String) -> Self {
        Self {
            pull_id: pull.pull_id.clone(),
            encounter_id: pull.encounter_id,
            encounter_name: pull.encounter_name.clone(),
            difficulty_id: pull.difficulty_id,
            group_size: pull.group_size,
            success: pull.success,
            encounter_start_unix_ms: pull.encounter_start_unix_ms,
            encounter_end_unix_ms: pull.encounter_end_unix_ms,
            clip_start_unix_ms: pull.clip_start_unix_ms,
            clip_end_unix_ms: pull.clip_end_unix_ms,
            state: pull.state.clone(),
            player_name: pull.player_name.clone(),
            timeline_event_count: pull.timeline_events.len(),
            timeline_revision,
            timeline_complete: pull.timeline_indexed
                && pull.timeline_version >= TIMELINE_VERSION
                && pull.timeline_parse_errors == 0,
            timeline_parse_errors: pull.timeline_parse_errors,
            players: pull.players.clone(),
            mapping: pull.mapping.clone(),
            video_path: pull.video_path.clone(),
            imported_source: pull.imported_source.clone(),
            recording_player_guid: pull.recording_player_guid.clone(),
            battle_key: pull.battle_key.clone(),
            playback_path: pull.playback_path.clone(),
            error: pull.error.clone(),
        }
    }
}

/// 返回真实 CombatLog 已识别的本地 Boss 录像，并按需迁移旧版产物。
#[tauri::command]
pub async fn list_local_recordings(
    app: AppHandle,
    state: State<'_, RecordingState>,
) -> Result<Vec<LocalRecordingSummary>, String> {
    refresh_local_recordings(&app, &state).await?;
    let index = state.index.lock().await;
    let mut cache = state.event_queries.lock().await;
    cache.retain(&index);
    Ok(index
        .active_pull
        .iter()
        .chain(index.pulls.iter())
        .map(|pull| LocalRecordingSummary::new(pull, revision(pull)))
        .collect())
}

#[cfg(test)]
mod tests {
    use super::LocalRecordingSummary;
    use crate::recording::model::BossPull;

    #[test]
    fn summary_omits_events_and_retains_manifest_fields_for_legacy_records() {
        let pull: BossPull = serde_json::from_value(serde_json::json!({"pullId":"pull", "encounterId":1,
            "encounterName":"测试", "difficultyId":16,"groupSize":20,"encounterStartUnixMs":0,
            "clipStartUnixMs":0,"logFileId":"file","logStartOffset":0,"state":"ready",
            "timelineEvents":[{"pullTimeMs":100,"owner":"player","kind":"castSuccess","sourceName":"玩家","spellId":17,"spellName":"盾"}]})).unwrap();
        let summary =
            serde_json::to_value(LocalRecordingSummary::new(&pull, "revision".into())).unwrap();
        assert!(summary.get("timelineEvents").is_none());
        assert_eq!(summary["timelineEventCount"], 1);
        assert_eq!(summary["timelineComplete"], false);
        assert_eq!(summary["encounterName"], "测试");
        assert_eq!(pull.timeline_events.len(), 1);
    }
}
