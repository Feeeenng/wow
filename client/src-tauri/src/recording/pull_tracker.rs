use sha2::{Digest, Sha256};

use crate::{
    combat_log::model::EncounterEvent,
    recording::config::{POST_ROLL_MS, PRE_ROLL_MS},
    recording::model::{BossPull, PullEndReason, PullState},
};

/// 维护唯一活动 Pull，并把日志边界转换为待成片窗口。
#[derive(Default)]
pub struct PullTracker {
    active: Option<BossPull>,
    diagnostics: Vec<String>,
}

impl PullTracker {
    /// 从持久化的活动 Pull 恢复状态机。
    pub fn from_active(active: Option<BossPull>) -> Self {
        Self {
            active,
            diagnostics: Vec::new(),
        }
    }

    /// 返回当前尚未收到匹配结束事件的 Pull。
    pub fn active(&self) -> Option<&BossPull> {
        self.active.as_ref()
    }

    /// 返回不改变 Pull 状态的事件诊断。
    pub fn diagnostics(&self) -> &[String] {
        &self.diagnostics
    }

    /// 应用一条 Boss 边界事件，返回本次被封闭或中断的 Pull。
    pub fn handle(
        &mut self,
        event: EncounterEvent,
        log_file_id: &str,
        line_start_offset: u64,
        line_end_offset: u64,
    ) -> Vec<BossPull> {
        match event {
            EncounterEvent::Start(start) => {
                let pull_id =
                    stable_pull_id(log_file_id, start.occurred_at_unix_ms, start.encounter_id);
                if self
                    .active
                    .as_ref()
                    .is_some_and(|active| active.pull_id == pull_id)
                {
                    return Vec::new();
                }
                let mut changed = Vec::new();
                if let Some(mut interrupted) = self.active.take() {
                    interrupted.encounter_end_unix_ms = Some(start.occurred_at_unix_ms);
                    interrupted.clip_end_unix_ms = Some(start.occurred_at_unix_ms);
                    interrupted.log_end_offset = Some(line_start_offset);
                    interrupted.state = PullState::Interrupted;
                    interrupted.end_reason = Some(PullEndReason::InterruptedByNextPull);
                    changed.push(interrupted);
                }
                self.active = Some(BossPull {
                    pull_id,
                    encounter_id: start.encounter_id,
                    encounter_name: start.encounter_name,
                    difficulty_id: start.difficulty_id,
                    group_size: start.group_size,
                    success: None,
                    encounter_start_unix_ms: start.occurred_at_unix_ms,
                    encounter_end_unix_ms: None,
                    clip_start_unix_ms: start.occurred_at_unix_ms.saturating_sub(PRE_ROLL_MS),
                    clip_end_unix_ms: None,
                    log_file_id: log_file_id.to_string(),
                    log_start_offset: line_start_offset,
                    log_end_offset: None,
                    state: PullState::Recording,
                    end_reason: None,
                    player_name: None,
                    timeline_events: Vec::new(),
                    players: Vec::new(),
                    timeline_indexed: false,
                    mapping: None,
                    video_path: None,
                    playback_path: None,
                    error: None,
                });
                changed
            }
            EncounterEvent::End(end) => {
                let Some(active) = self.active.as_ref() else {
                    self.diagnostics.push(format!(
                        "收到 Boss {} 的结束事件，但当前没有活动 Pull",
                        end.encounter_id
                    ));
                    return Vec::new();
                };
                if active.encounter_id != end.encounter_id {
                    self.diagnostics.push(format!(
                        "Boss 结束事件不匹配：当前 {}，收到 {}",
                        active.encounter_id, end.encounter_id
                    ));
                    return Vec::new();
                }
                let mut completed = self.active.take().expect("已确认存在活动 Pull");
                completed.encounter_end_unix_ms = Some(end.occurred_at_unix_ms);
                completed.clip_end_unix_ms = Some(end.occurred_at_unix_ms + POST_ROLL_MS);
                completed.log_end_offset = Some(line_end_offset);
                completed.success = Some(end.success);
                completed.state = PullState::WaitingForTail;
                completed.end_reason = Some(PullEndReason::EncounterEnd);
                vec![completed]
            }
        }
    }
}

fn stable_pull_id(log_file_id: &str, started_at_unix_ms: i64, encounter_id: u32) -> String {
    let mut hasher = Sha256::new();
    hasher.update(log_file_id.as_bytes());
    hasher.update([0]);
    hasher.update(started_at_unix_ms.to_le_bytes());
    hasher.update(encounter_id.to_le_bytes());
    hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

#[cfg(test)]
mod tests {
    use crate::{
        combat_log::model::{EncounterEnd, EncounterEvent, EncounterStart},
        recording::model::{PullEndReason, PullState},
    };

    use super::PullTracker;

    fn start(id: u32, time: i64) -> EncounterEvent {
        EncounterEvent::Start(EncounterStart {
            encounter_id: id,
            encounter_name: format!("Boss {id}"),
            difficulty_id: 16,
            group_size: 20,
            occurred_at_unix_ms: time,
        })
    }

    fn end(id: u32, time: i64) -> EncounterEvent {
        EncounterEvent::End(EncounterEnd {
            encounter_id: id,
            encounter_name: format!("Boss {id}"),
            difficulty_id: 16,
            group_size: 20,
            success: false,
            occurred_at_unix_ms: time,
        })
    }

    #[test]
    fn ignores_duplicate_start() {
        let mut tracker = PullTracker::default();
        assert!(tracker
            .handle(start(100, 20_000), "log-a", 10, 20)
            .is_empty());
        let pull_id = tracker.active().unwrap().pull_id.clone();

        assert!(tracker
            .handle(start(100, 20_000), "log-a", 10, 20)
            .is_empty());
        assert_eq!(tracker.active().unwrap().pull_id, pull_id);
    }

    #[test]
    fn matching_end_creates_buffered_clip_window() {
        let mut tracker = PullTracker::default();
        tracker.handle(start(100, 20_000), "log-a", 10, 20);

        let completed = tracker.handle(end(100, 50_000), "log-a", 30, 40);

        assert!(tracker.active().is_none());
        assert_eq!(completed.len(), 1);
        assert_eq!(completed[0].clip_start_unix_ms, 15_000);
        assert_eq!(completed[0].clip_end_unix_ms, Some(55_000));
        assert_eq!(completed[0].state, PullState::WaitingForTail);
        assert_eq!(completed[0].end_reason, Some(PullEndReason::EncounterEnd));
    }

    #[test]
    fn ignores_mismatched_end() {
        let mut tracker = PullTracker::default();
        tracker.handle(start(100, 20_000), "log-a", 10, 20);

        assert!(tracker.handle(end(200, 50_000), "log-a", 30, 40).is_empty());
        assert_eq!(tracker.active().unwrap().encounter_id, 100);
        assert_eq!(tracker.diagnostics().len(), 1);
    }

    #[test]
    fn next_start_interrupts_active_pull() {
        let mut tracker = PullTracker::default();
        tracker.handle(start(100, 20_000), "log-a", 10, 20);

        let interrupted = tracker.handle(start(200, 30_000), "log-a", 30, 40);

        assert_eq!(interrupted.len(), 1);
        assert_eq!(
            interrupted[0].end_reason,
            Some(PullEndReason::InterruptedByNextPull)
        );
        assert_eq!(interrupted[0].clip_end_unix_ms, Some(30_000));
        assert_eq!(tracker.active().unwrap().encounter_id, 200);
    }
}
