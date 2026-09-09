use crate::recording::model::{ClipMapping, SourceRecording, SourceSlice};

/// 把绝对 Boss 裁切窗口映射为一个或多个封闭 OBS 源文件区间。
pub fn map_clip_sources(
    sources: &[SourceRecording],
    clip_start_unix_ms: i64,
    clip_end_unix_ms: i64,
    encounter_start_unix_ms: i64,
) -> Result<ClipMapping, String> {
    if clip_end_unix_ms <= clip_start_unix_ms {
        return Err("Boss 裁切窗口结束时间必须晚于开始时间".to_string());
    }
    let mut ordered = sources
        .iter()
        .filter_map(|source| source.ended_at_unix_ms.map(|end| (source, end)))
        .collect::<Vec<_>>();
    ordered.sort_by_key(|(source, _)| source.started_at_unix_ms);
    let mut slices = Vec::new();
    let mut absolute_ranges = Vec::new();
    for (source, source_end) in ordered {
        let start = clip_start_unix_ms.max(source.started_at_unix_ms);
        let end = clip_end_unix_ms.min(source_end);
        if end <= start {
            continue;
        }
        slices.push(SourceSlice {
            path: source.path.clone(),
            offset_ms: (start - source.started_at_unix_ms) as u64,
            duration_ms: (end - start) as u64,
        });
        absolute_ranges.push((start, end));
    }
    let Some((actual_start, _)) = absolute_ranges.first().copied() else {
        return Err("没有覆盖 Boss 裁切窗口的封闭源录像".to_string());
    };
    let actual_end = absolute_ranges.last().expect("至少存在一个源区间").1;
    let mut covered_until = actual_start;
    let mut has_gap = actual_start > clip_start_unix_ms;
    for (start, end) in &absolute_ranges {
        if *start > covered_until {
            has_gap = true;
        }
        covered_until = covered_until.max(*end);
    }
    if actual_end < clip_end_unix_ms {
        has_gap = true;
    }
    Ok(ClipMapping {
        slices,
        actual_start_unix_ms: actual_start,
        actual_end_unix_ms: actual_end,
        video_zero_ms: encounter_start_unix_ms.saturating_sub(actual_start).max(0) as u64,
        has_gap,
    })
}

/// 判断是否已经观察到裁切结束点之后的封闭源文件边界。
pub fn source_window_is_closed(sources: &[SourceRecording], clip_end_unix_ms: i64) -> bool {
    sources.iter().any(|source| {
        source
            .ended_at_unix_ms
            .is_some_and(|end| end >= clip_end_unix_ms)
            || source.started_at_unix_ms > clip_end_unix_ms
    })
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use crate::recording::model::SourceRecording;

    use super::{map_clip_sources, source_window_is_closed};

    fn source(name: &str, start: i64, end: i64) -> SourceRecording {
        SourceRecording {
            path: PathBuf::from(name),
            started_at_unix_ms: start,
            ended_at_unix_ms: Some(end),
        }
    }

    #[test]
    fn maps_single_source_window() {
        let mapping =
            map_clip_sources(&[source("a.mp4", 10_000, 70_000)], 15_000, 60_000, 20_000).unwrap();
        assert_eq!(mapping.slices.len(), 1);
        assert_eq!(mapping.slices[0].offset_ms, 5_000);
        assert_eq!(mapping.slices[0].duration_ms, 45_000);
        assert_eq!(mapping.video_zero_ms, 5_000);
        assert!(!mapping.has_gap);
    }

    #[test]
    fn maps_window_across_adjacent_sources() {
        let sources = [
            source("a.mp4", 10_000, 30_000),
            source("b.mp4", 30_000, 70_000),
        ];
        let mapping = map_clip_sources(&sources, 15_000, 60_000, 20_000).unwrap();
        assert_eq!(mapping.slices.len(), 2);
        assert_eq!(mapping.slices[0].duration_ms, 15_000);
        assert_eq!(mapping.slices[1].offset_ms, 0);
        assert_eq!(mapping.slices[1].duration_ms, 30_000);
        assert!(!mapping.has_gap);
    }

    #[test]
    fn marks_gap_without_inventing_video_time() {
        let sources = [
            source("a.mp4", 10_000, 25_000),
            source("b.mp4", 30_000, 70_000),
        ];
        let mapping = map_clip_sources(&sources, 15_000, 60_000, 20_000).unwrap();
        assert!(mapping.has_gap);
    }

    #[test]
    fn video_zero_is_zero_when_recording_starts_after_encounter() {
        let mapping =
            map_clip_sources(&[source("a.mp4", 30_000, 70_000)], 15_000, 60_000, 20_000).unwrap();
        assert_eq!(mapping.video_zero_ms, 0);
        assert!(mapping.has_gap);
    }

    #[test]
    fn later_source_closes_window_even_when_tail_is_missing() {
        let sources = [
            source("a.mp4", 10_000, 20_000),
            source("b.mp4", 40_000, 50_000),
        ];
        assert!(source_window_is_closed(&sources, 30_000));
        assert!(!source_window_is_closed(&sources[..1], 30_000));
    }
}
