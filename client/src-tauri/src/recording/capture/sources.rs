use std::{
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

use crate::{
    obs::runtime::service::ObsRecordingEvent,
    recording::{capture::state::RecordingState, model::SourceRecording},
};

fn system_time_ms(time: SystemTime) -> Option<i64> {
    time.duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_millis() as i64)
}

fn choose_source_end(
    started_at_unix_ms: i64,
    fallback_unix_ms: i64,
    modified_unix_ms: Option<i64>,
) -> i64 {
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

/// 只合并源文件观测，不将事件接收时间解释为已验证媒体起点。
pub(crate) async fn apply_obs_event(state: &RecordingState, event: ObsRecordingEvent) -> bool {
    let mut index = state.index.lock().await;
    match event {
        ObsRecordingEvent::FileChanged {
            path,
            occurred_at_unix_ms,
        } => {
            if index.sources.last().is_some_and(|source| {
                source.path == PathBuf::from(&path) && source.ended_at_unix_ms.is_none()
            }) {
                return false;
            }
            for source in index
                .sources
                .iter_mut()
                .filter(|source| source.ended_at_unix_ms.is_none())
            {
                source.ended_at_unix_ms = Some(closed_source_end(source, occurred_at_unix_ms));
            }
            index.sources.push(SourceRecording {
                path: PathBuf::from(path),
                started_at_unix_ms: occurred_at_unix_ms,
                ended_at_unix_ms: None,
                ..SourceRecording::default()
            });
            true
        }
        ObsRecordingEvent::Stopped {
            path,
            occurred_at_unix_ms,
        } => {
            let mut changed = false;
            for source in index
                .sources
                .iter_mut()
                .filter(|source| source.ended_at_unix_ms.is_none())
            {
                if path
                    .as_ref()
                    .is_none_or(|value| source.path == PathBuf::from(value))
                {
                    source.ended_at_unix_ms = Some(closed_source_end(source, occurred_at_unix_ms));
                    changed = true;
                }
            }
            changed
        }
    }
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
