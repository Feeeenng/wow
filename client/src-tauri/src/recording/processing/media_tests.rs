use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};

use crate::recording::{
    model::{ClipMapping, SourceRecording},
    processing::{clip::process_clip, mapping::map_clip_sources, probe::executable_path},
};

struct MediaFixture {
    root: PathBuf,
    ffmpeg: PathBuf,
}

impl MediaFixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("wow-replay-media-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let ffmpeg = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources/ffmpeg-runtime/bin/ffmpeg.exe");
        assert!(ffmpeg.is_file());
        assert!(executable_path(&ffmpeg).unwrap().is_file());
        Self { root, ffmpeg }
    }

    fn source(&self, name: &str, wall_start: i64, duration: u32) -> SourceRecording {
        let path = self.root.join(name);
        let result = Command::new(&self.ffmpeg)
            .args([
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "testsrc2=size=320x180:rate=25",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:sample_rate=48000",
                "-t",
                &duration.to_string(),
                "-c:v",
                "libopenh264",
                "-g",
                "50",
                "-b:v",
                "500k",
                "-c:a",
                "aac",
                "-movflags",
                "+faststart",
            ])
            .arg(&path)
            .output()
            .unwrap();
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
        SourceRecording {
            path,
            started_at_unix_ms: wall_start,
            ended_at_unix_ms: Some(wall_start + duration as i64 * 1_000),
            ..SourceRecording::default()
        }
    }

    fn pull(
        &self,
        mapping: &ClipMapping,
        start: i64,
        end: i64,
    ) -> crate::recording::model::BossPull {
        serde_json::from_value(serde_json::json!({
            "pullId": uuid::Uuid::new_v4().simple().to_string(), "encounterId": 1,
            "encounterName": "媒体验证", "difficultyId": 16, "groupSize": 20,
            "success": true, "encounterStartUnixMs": start, "encounterEndUnixMs": end,
            "clipStartUnixMs": mapping.actual_start_unix_ms, "clipEndUnixMs": mapping.actual_end_unix_ms,
            "logFileId": "fixture", "logStartOffset": 0, "logEndOffset": 1,
            "state": "processing", "endReason": "encounterEnd"
        })).unwrap()
    }

    fn frame_hash(&self, file: &Path, seconds: f64) -> String {
        let result = Command::new(&self.ffmpeg)
            .args([
                "-hide_banner",
                "-loglevel",
                "error",
                "-ss",
                &format!("{seconds:.6}"),
                "-i",
            ])
            .arg(file)
            .args(["-map", "0:v:0", "-frames:v", "1", "-f", "framehash", "-"])
            .output()
            .unwrap();
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
        String::from_utf8(result.stdout)
            .unwrap()
            .lines()
            .filter(|line| !line.starts_with('#'))
            .filter_map(|line| line.rsplit(',').next())
            .next()
            .unwrap()
            .trim()
            .to_string()
    }
}

impl Drop for MediaFixture {
    fn drop(&mut self) {
        // 只清理本用例创建的 UUID 目录，不接触用户录像。
        let _ = fs::remove_dir_all(&self.root);
    }
}

#[test]
fn h264_aac_preroll_mapping_matches_decoded_source_frame_and_hls() {
    let fixture = MediaFixture::new();
    let source = fixture.source("single.mp4", 10_000, 8);
    let mapping = map_clip_sources(&[source.clone()], 12_350, 17_000, 14_000).unwrap();
    let pull = fixture.pull(&mapping, 14_000, 16_000);
    let processed = process_clip(
        &fixture.ffmpeg,
        &fixture.root.join("output"),
        &pull,
        &mapping,
    )
    .unwrap();
    assert!(
        processed.mapping.media_calibrated,
        "{:?}",
        processed.mapping.calibration_error
    );
    assert_eq!(processed.mapping.intervals.len(), 1);
    let interval = &processed.mapping.intervals[0];
    assert!(interval.pull_start_ms < -1_600, "关键帧预滚没有被识别");
    let target_seconds = (interval.video_start_ms - interval.pull_start_ms) as f64 / 1_000.0;
    let expected = fixture.frame_hash(&source.path, 4.0);
    let found = [-0.04, 0.0, 0.04].iter().any(|delta| {
        fixture.frame_hash(&processed.video_path, (target_seconds + delta).max(0.0)) == expected
    });
    assert!(found, "校准位置附近一帧内未找到源画面");
    let playlist = fs::read_to_string(processed.playback_path.unwrap()).unwrap();
    assert!(playlist.contains("#EXT-X-ENDLIST"));
    assert!(playlist.contains(".m4s"));
}

#[test]
fn retry_reuses_valid_media_and_rebuilds_corrupt_existing_output() {
    let fixture = MediaFixture::new();
    let source = fixture.source("retry.mp4", 10_000, 4);
    let mapping = map_clip_sources(&[source], 10_000, 14_000, 11_000).unwrap();
    let mut pull = fixture.pull(&mapping, 11_000, 13_000);
    let output = fixture.root.join("output");
    let processed = process_clip(&fixture.ffmpeg, &output, &pull, &mapping).unwrap();
    pull.video_path = Some(processed.video_path.clone());
    assert!(super::retry::reusable_video(&fixture.ffmpeg, &pull));
    fs::write(&processed.video_path, b"corrupt MP4").unwrap();
    assert!(!super::retry::reusable_video(&fixture.ffmpeg, &pull));
    let rebuilt = process_clip(&fixture.ffmpeg, &output, &pull, &mapping).unwrap();
    assert_eq!(rebuilt.video_path, processed.video_path);
    assert!(super::retry::reusable_video(&fixture.ffmpeg, &pull));
    assert!(rebuilt.playback_error.is_none());
}

#[test]
fn concatenated_sources_keep_missing_wall_time_out_of_video_time() {
    let fixture = MediaFixture::new();
    let first = fixture.source("a.mp4", 10_000, 4);
    let second = fixture.source("b.mp4", 16_000, 4);
    let mapping = map_clip_sources(&[first, second.clone()], 11_000, 19_000, 11_000).unwrap();
    let pull = fixture.pull(&mapping, 11_000, 19_000);
    let processed = process_clip(
        &fixture.ffmpeg,
        &fixture.root.join("output"),
        &pull,
        &mapping,
    )
    .unwrap();
    assert!(
        processed.mapping.media_calibrated,
        "{:?}",
        processed.mapping.calibration_error
    );
    assert!(processed.mapping.has_gap);
    assert_eq!(processed.mapping.intervals.len(), 2);
    let intervals = &processed.mapping.intervals;
    assert!(intervals[1].pull_start_ms - intervals[0].pull_end_ms >= 1_900);
    assert!(intervals[1].video_start_ms - intervals[0].video_end_ms < 200);
    let target =
        (intervals[1].video_start_ms + 6_000 - intervals[1].pull_start_ms) as f64 / 1_000.0;
    let expected = fixture.frame_hash(&second.path, 1.0);
    assert!([-0.04, 0.0, 0.04].iter().any(|delta| fixture
        .frame_hash(&processed.video_path, (target + delta).max(0.0))
        == expected));
}

#[test]
#[ignore = "仅在显式指定临时输出目录时生成浏览器验收媒体"]
fn prepare_browser_media_fixture() {
    let output =
        PathBuf::from(std::env::var_os("WOW_REPLAY_BROWSER_FIXTURE").expect("需要临时输出目录"));
    assert!(output.starts_with(std::env::temp_dir()));
    fs::create_dir_all(&output).unwrap();
    let fixture = MediaFixture::new();
    let source = fixture.source("browser.mp4", 10_000, 16);
    let mapping = map_clip_sources(&[source], 11_000, 24_000, 12_000).unwrap();
    let mut pull = fixture.pull(&mapping, 12_000, 22_000);
    pull.pull_id = format!("{:064x}", 1);
    pull.player_name = Some("测试角色".into());
    pull.timeline_events = serde_json::from_value(serde_json::json!([
        {"eventId":"skill-1","pullTimeMs":6000,"owner":"player","kind":"castSuccess","sourceName":"测试角色","sourceGuid":"Player-1","targetGuid":"Player-1","targetName":"测试角色","spellId":642,"spellName":"圣盾术"},
        {"eventId":"skill-2","pullTimeMs":6030,"owner":"player","kind":"castSuccess","sourceName":"测试角色","sourceGuid":"Player-1","targetGuid":"Player-2","targetName":"测试队友","spellId":17,"spellName":"真言术：盾"},
        {"eventId":"aura-1","pullTimeMs":4000,"owner":"player","kind":"buffApply","sourceName":"测试角色","sourceGuid":"Player-1","targetGuid":"Player-1","targetName":"测试角色","spellId":17,"spellName":"真言术：盾"},
        {"eventId":"death-1","pullTimeMs":8000,"owner":"team","kind":"death","sourceName":"nil","sourceGuid":"nil","targetGuid":"Player-2","targetName":"测试队友","spellId":0,"spellName":"死亡"}
    ])).unwrap();
    let processed = process_clip(&fixture.ffmpeg, &output, &pull, &mapping).unwrap();
    assert!(
        processed.mapping.media_calibrated,
        "{:?}",
        processed.mapping.calibration_error
    );
    pull.state = crate::recording::model::PullState::Ready;
    pull.mapping = Some(processed.mapping);
    pull.video_path = Some(processed.video_path);
    pull.playback_path = processed.playback_path;
    pull.timeline_indexed = true;
    pull.timeline_version = crate::recording::events::index::TIMELINE_VERSION;
    fs::write(
        output.join("fixture.json"),
        serde_json::to_vec_pretty(&pull).unwrap(),
    )
    .unwrap();
    println!("浏览器合成媒体验收输入已生成");
}
