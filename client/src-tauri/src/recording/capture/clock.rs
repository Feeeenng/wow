use std::{
    path::PathBuf,
    time::{Instant, SystemTime, UNIX_EPOCH},
};

use tauri::{AppHandle, Manager};

use crate::{
    obs::runtime::service::ObsState,
    recording::{
        capture::state::RecordingState,
        config::{CLOCK_DISCONTINUITY_MS, CLOCK_SAMPLE_INTERVAL_MS},
        model::RecordingClockSample,
    },
};

/// 只跟踪本进程的采样时钟域；重启后的原点不能与历史单调值拼接。
pub struct ClockTracker {
    process_id: String,
    epoch_id: String,
    origin: Instant,
    last: Option<RecordingClockSample>,
    path: Option<PathBuf>,
}

impl ClockTracker {
    pub fn new() -> Self {
        Self {
            process_id: uuid::Uuid::new_v4().to_string(),
            epoch_id: uuid::Uuid::new_v4().to_string(),
            origin: Instant::now(),
            last: None,
            path: None,
        }
    }

    /// 检测跳时、暂停与输出归零，不能将这些区间解释为连续录像。
    fn observe(
        &mut self,
        path: PathBuf,
        wall: i64,
        mono: u64,
        output: u64,
        uncertainty: u64,
        paused: bool,
    ) -> (RecordingClockSample, bool) {
        let discontinuous = self.last.as_ref().is_some_and(|last| {
            let elapsed = mono.saturating_sub(last.monotonic_ns) / 1_000_000;
            let wall_elapsed = wall.saturating_sub(last.unix_ms);
            let allowance = CLOCK_DISCONTINUITY_MS + uncertainty + last.uncertainty_ms;
            output < last.output_duration_ms
                || wall_elapsed < 0
                || (wall_elapsed - elapsed as i64).unsigned_abs() > allowance
                || (output.saturating_sub(last.output_duration_ms) as i64 - elapsed as i64)
                    .unsigned_abs()
                    > allowance
        }) || paused;
        if discontinuous {
            self.epoch_id = uuid::Uuid::new_v4().to_string();
        }
        let sample = RecordingClockSample {
            process_clock_id: self.process_id.clone(),
            output_epoch_id: self.epoch_id.clone(),
            unix_ms: wall,
            monotonic_ns: mono,
            output_duration_ms: output,
            uncertainty_ms: uncertainty,
            paused,
        };
        self.path = Some(path);
        self.last = Some(sample.clone());
        (sample, discontinuous)
    }
}

/// 使用真实 GetRecordStatus 采样，在源文件变化或到期时写入观测证据。
pub async fn sample_clock(app: &AppHandle, state: &RecordingState) -> Result<bool, String> {
    let path = state
        .index
        .lock()
        .await
        .sources
        .iter()
        .rev()
        .find(|source| source.ended_at_unix_ms.is_none())
        .map(|source| source.path.clone());
    let Some(path) = path else {
        return Ok(false);
    };
    let mut clock = state.clock.lock().await;
    let now = clock.origin.elapsed().as_nanos() as u64;
    if clock.path.as_ref() == Some(&path)
        && clock.last.as_ref().is_some_and(|last| {
            now.saturating_sub(last.monotonic_ns) / 1_000_000 < CLOCK_SAMPLE_INTERVAL_MS
        })
    {
        return Ok(false);
    }
    let obs = app.state::<ObsState>();
    let guard = obs.client.read().await;
    let Some(client) = guard.as_ref() else {
        return Ok(false);
    };
    let before = clock.origin.elapsed().as_nanos() as u64;
    let status = client
        .recording()
        .status()
        .await
        .map_err(|error| format!("读取录制时钟失败：{error}"))?;
    let after = clock.origin.elapsed().as_nanos() as u64;
    if !status.active {
        clock.last = None;
        clock.path = None;
        return Ok(false);
    }
    let wall = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;
    let previous = clock.path.clone();
    let sample_mid = before + (after - before) / 2;
    let uncertainty = (after - before) / 2_000_000;
    let (sample, discontinuous) = clock.observe(
        path.clone(),
        wall - uncertainty as i64,
        sample_mid,
        status.duration.whole_milliseconds().max(0) as u64,
        uncertainty,
        status.paused,
    );
    drop(clock);
    let mut index = state.index.lock().await;
    for source in &mut index.sources {
        if discontinuous && (source.path == path || previous.as_ref() == Some(&source.path)) {
            source.clock_discontinuous = true;
        }
        if source.path == path {
            if source.clock_start_sample.is_none() {
                source.clock_start_sample = Some(sample.clone());
            }
            source.clock_sample = Some(sample.clone());
        }
    }
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::ClockTracker;

    #[test]
    fn continuous_output_keeps_epoch_but_wall_jumps_and_pauses_do_not() {
        let mut clock = ClockTracker::new();
        let (a, bad) = clock.observe("a".into(), 1000, 0, 0, 1, false);
        assert!(!bad);
        let (b, bad) = clock.observe("a".into(), 6000, 5_000_000_000, 5000, 1, false);
        assert!(!bad);
        assert_eq!(a.output_epoch_id, b.output_epoch_id);
        let (c, bad) = clock.observe("a".into(), 17000, 10_000_000_000, 10000, 1, false);
        assert!(bad);
        assert_ne!(b.output_epoch_id, c.output_epoch_id);
        assert!(
            clock
                .observe("a".into(), 22000, 15_000_000_000, 10000, 1, true)
                .1
        );
    }
}
