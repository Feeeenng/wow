use crate::recording::model::{PullState, RecordingIndex};

/// 恢复中断任务，并为旧版已完成 MP4 排入 HLS 补处理队列。
pub fn recover_interrupted_processing(index: &mut RecordingIndex) {
    for pull in &mut index.pulls {
        if pull.state == PullState::Processing {
            pull.state = if pull.video_path.as_ref().is_some_and(|path| path.is_file()) {
                PullState::WaitingForPlayback
            } else {
                PullState::WaitingForSource
            };
            pull.error = None;
        } else if matches!(pull.state, PullState::Ready | PullState::Partial | PullState::Failed)
            && pull.video_path.as_ref().is_some_and(|path| path.is_file())
            && pull.playback_path.as_ref().is_none_or(|path| !path.is_file())
        {
            pull.state = PullState::WaitingForPlayback;
            pull.error = None;
        } else if pull.state == PullState::Ready
            && pull.mapping.as_ref().is_some_and(|mapping| mapping.has_gap)
        {
            pull.state = PullState::Partial;
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::recording::model::{BossPull, ClipMapping, PullState, RecordingIndex};

    use super::recover_interrupted_processing;

    fn pull(state: PullState, has_gap: bool) -> BossPull {
        BossPull {
            pull_id: "pull".to_string(),
            encounter_id: 1,
            encounter_name: "Boss".to_string(),
            difficulty_id: 8,
            group_size: 5,
            success: Some(true),
            encounter_start_unix_ms: 10_000,
            encounter_end_unix_ms: Some(20_000),
            clip_start_unix_ms: 5_000,
            clip_end_unix_ms: Some(30_000),
            log_file_id: "log".to_string(),
            log_start_offset: 1,
            log_end_offset: Some(2),
            state,
            end_reason: None,
            mapping: Some(ClipMapping {
                slices: Vec::new(),
                actual_start_unix_ms: 5_000,
                actual_end_unix_ms: 30_000,
                video_zero_ms: 5_000,
                has_gap,
            }),
            video_path: None,
            playback_path: Some("playback.m3u8".into()),
            error: Some("旧错误".to_string()),
        }
    }

    #[test]
    fn restart_requeues_processing_and_marks_gapped_ready_as_partial() {
        let mut playback = pull(PullState::Processing, false);
        playback.video_path = Some(std::env::current_exe().expect("测试进程路径应存在"));
        let mut failed_playback = pull(PullState::Failed, false);
        failed_playback.video_path = playback.video_path.clone();
        failed_playback.playback_path = None;
        let mut index = RecordingIndex {
            pulls: vec![
                pull(PullState::Processing, false),
                playback,
                failed_playback,
                pull(PullState::Ready, true),
            ],
            ..RecordingIndex::default()
        };
        recover_interrupted_processing(&mut index);
        assert_eq!(index.pulls[0].state, PullState::WaitingForSource);
        assert_eq!(index.pulls[0].error, None);
        assert_eq!(index.pulls[1].state, PullState::WaitingForPlayback);
        assert_eq!(index.pulls[2].state, PullState::WaitingForPlayback);
        assert_eq!(index.pulls[2].error, None);
        assert_eq!(index.pulls[3].state, PullState::Partial);
    }
}
