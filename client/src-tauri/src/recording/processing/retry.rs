use std::path::Path;

use tauri::{AppHandle, State};

use crate::recording::{
    capture::state::RecordingState,
    model::{BossPull, PullState},
};

/// 只重试已封闭任务，已验证的 MP4 可复用，但重新生成播放产物前仍需严格解码检查。
fn retry_state(pull: &BossPull, reusable_video: bool) -> Result<PullState, String> {
    match pull.state {
        PullState::Recording | PullState::WaitingForTail => {
            Err("战斗或尾帧录制尚未结束，不能重试".into())
        }
        PullState::Failed | PullState::Interrupted => {
            if pull.encounter_end_unix_ms.is_none() || pull.clip_end_unix_ms.is_none() {
                return Err("缺少完整战斗结束边界，不能自动生成录像".into());
            }
            Ok(if reusable_video {
                PullState::WaitingForPlayback
            } else {
                PullState::WaitingForSource
            })
        }
        _ => Ok(pull.state.clone()),
    }
}

/// 只有完整解码成功的成片才复用；损坏成片改从原源录像重建。
pub(crate) fn reusable_video(ffmpeg: &Path, pull: &BossPull) -> bool {
    pull.video_path.as_ref().is_some_and(|path| {
        if pull.imported_source.is_some() {
            return path.is_file()
                && super::probe::validate_external_video(ffmpeg, path, &pull.pull_id).is_ok();
        }
        path.is_file()
            && super::command::run_ffmpeg(
                ffmpeg,
                &super::command::build_validate_args(path),
                &pull.pull_id,
                None,
            )
            .is_ok()
    })
}

/// 按稳定 Pull ID 幂等重排处理，不创建新录像或修改原始视频。
#[tauri::command]
pub async fn retry_recording_processing(
    app: AppHandle,
    pull_id: String,
    state: State<'_, RecordingState>,
) -> Result<(), String> {
    let selected = state
        .index
        .lock()
        .await
        .pulls
        .iter()
        .find(|pull| pull.pull_id == pull_id)
        .cloned()
        .ok_or("找不到要重试的本地录像")?;
    retry_state(&selected, false)?;
    if !matches!(selected.state, PullState::Failed | PullState::Interrupted) {
        return Ok(());
    }
    let ffmpeg = crate::recording::capture::runtime::ffmpeg_path(&app)?;
    let imported = selected.imported_source.is_some();
    let reusable = tauri::async_runtime::spawn_blocking(move || reusable_video(&ffmpeg, &selected))
        .await
        .map_err(|error| format!("等待成片校验失败：{error}"))?;
    if imported && !reusable {
        return Err(
            "导入原片不存在或媒体预检失败，请恢复原片后重试；不会修改或重建外部原片".into(),
        );
    }
    {
        let mut index = state.index.lock().await;
        let pull = index
            .pulls
            .iter_mut()
            .find(|pull| pull.pull_id == pull_id)
            .ok_or("找不到要重试的本地录像")?;
        pull.state = retry_state(pull, reusable)?;
        pull.error = None;
    }
    state.save().await
}

#[cfg(test)]
mod tests {
    use super::retry_state;
    use crate::recording::model::{BossPull, PullState};

    #[test]
    fn retries_are_idempotent_and_incomplete_boundaries_are_rejected() {
        let mut pull: BossPull = serde_json::from_value(serde_json::json!({
            "pullId":"pull", "encounterId":1,"encounterName":"测试","difficultyId":16,"groupSize":20,
            "encounterStartUnixMs":0,"encounterEndUnixMs":10,"clipStartUnixMs":0,"clipEndUnixMs":15,
            "logFileId":"file","logStartOffset":0,"logEndOffset":10,"state":"failed"
        })).unwrap();
        assert_eq!(
            retry_state(&pull, true).unwrap(),
            PullState::WaitingForPlayback
        );
        pull.state = retry_state(&pull, false).unwrap();
        assert_eq!(pull.state, PullState::WaitingForSource);
        assert_eq!(
            retry_state(&pull, true).unwrap(),
            PullState::WaitingForSource
        );
        pull.state = PullState::Interrupted;
        pull.encounter_end_unix_ms = None;
        assert!(retry_state(&pull, false).is_err());
    }
}
