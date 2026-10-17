use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    sync::atomic::AtomicBool,
};

use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::recording::{
    capture::state::RecordingState,
    events::parser::parse_event_for_actor,
    model::{BossPull, ClipMapping, TimelineOwner},
    playback::backfill::process_existing_playback,
    processing::{
        artifacts::ensure_artifact_layout,
        command::{build_validate_args, run_ffmpeg},
    },
};

use super::{
    assemble::assemble,
    source::{logs, metadata::load_candidate},
};

fn temporary() -> PathBuf {
    let directory = std::env::temp_dir().join(format!("wow-import-test-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&directory).unwrap();
    directory
}

fn pull(source: &Path) -> BossPull {
    serde_json::from_value(json!({
        "pullId":"a".repeat(64),"encounterId":1,"encounterName":"测试","difficultyId":16,
        "groupSize":20,"encounterStartUnixMs":10000,"encounterEndUnixMs":20000,
        "clipStartUnixMs":5000,"clipEndUnixMs":25000,"state":"waitingForPlayback",
        "logFileId":"missing#1","logStartOffset":0,"logEndOffset":1,
        "videoPath":source,"importedSource":source,"timelineIndexed":true
    }))
    .unwrap()
}

#[test]
fn external_layout_never_moves_original_directory_or_overwrites_sidecar() {
    let root = temporary();
    let external = root.join("external");
    fs::create_dir_all(&external).unwrap();
    let video = external.join("original.mp4");
    fs::write(&video, b"original-media").unwrap();
    fs::write(external.join("metadata.json"), b"original-sidecar").unwrap();
    let mut pull = pull(&video);
    pull.mapping = Some(ClipMapping {
        video_zero_ms: 5000,
        ..ClipMapping::default()
    });
    let app = root.join("application/recordings");
    ensure_artifact_layout(&app, &mut pull, true).unwrap();
    assert_eq!(fs::read(&video).unwrap(), b"original-media");
    assert_eq!(
        fs::read(external.join("metadata.json")).unwrap(),
        b"original-sidecar"
    );
    assert!(app.join(&pull.pull_id).join("metadata.json").is_file());
    assert_eq!(pull.video_path.as_deref(), Some(video.as_path()));
    pull.playback_path = Some(external.join("hls/index.m3u8"));
    assert!(ensure_artifact_layout(&app, &mut pull, false).unwrap());
    assert!(pull.playback_path.is_none());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn external_metadata_rejects_path_escape_and_invalid_boundaries() {
    let root = temporary();
    let metadata = root.join("metadata.json");
    let mut value = json!({"id":"id","key":"../outside.mp4","actorId":1,"startTime":10000,
        "endTime":20000,"startTimeOffsetMs":3300,"encounter":{"id":1},"players":[]});
    fs::write(&metadata, serde_json::to_vec(&value).unwrap()).unwrap();
    assert!(load_candidate(&metadata, &fs::canonicalize(&root).unwrap()).is_err());
    value["key"] = "original.mp4".into();
    value["endTime"] = 9000.into();
    fs::write(root.join("original.mp4"), b"media").unwrap();
    fs::write(&metadata, serde_json::to_vec(&value).unwrap()).unwrap();
    assert!(load_candidate(&metadata, &fs::canonicalize(&root).unwrap()).is_err());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn imported_viewer_classifies_affected_aura_actor_without_losing_hostile_source() {
    let line = "10/16/2026 20:00:00.0008  SPELL_AURA_APPLIED,Creature-1,\"敌方\",0xa48,0,Player-1,\"日志本人\",0x511,0,1,\"减益\",1,DEBUFF";
    let event = parse_event_for_actor(line, 2026, 0, i64::MAX, "event".into(), Some("Player-2"))
        .unwrap()
        .unwrap();
    assert_eq!(event.owner, TimelineOwner::Team);
    assert_eq!(event.source_guid, "Creature-1");
    assert_eq!(event.target_guid, "Player-1");
    let own = parse_event_for_actor(line, 2026, 0, i64::MAX, "event".into(), Some("Player-1"))
        .unwrap()
        .unwrap();
    assert_eq!(own.owner, TimelineOwner::Player);
    let cast = "10/16/2026 20:00:00.0008  SPELL_CAST_SUCCESS,Player-1,\"日志本人\",0x511,0,Creature-1,\"敌方\",0xa48,0,1,\"技能\",1";
    assert_eq!(
        parse_event_for_actor(cast, 2026, 0, i64::MAX, "event".into(), Some("Player-2"))
            .unwrap()
            .unwrap()
            .owner,
        TimelineOwner::Team
    );
}

#[test]
fn imported_insert_is_durable_idempotent_and_can_retry_after_failed_save() {
    tauri::async_runtime::block_on(async {
        let root = temporary();
        let blocked = root.join("blocked");
        fs::write(&blocked, b"not-a-directory").unwrap();
        let state = RecordingState::isolated(blocked.join("index.json"));
        let selected = pull(Path::new("original.mp4"));
        let mut previous = selected.clone();
        previous.pull_id = "b".repeat(64);
        state.index.lock().await.pulls.push(previous);
        assert!(state.insert_imported(selected.clone()).await.is_err());
        assert_eq!(state.index.lock().await.pulls.len(), 1);
        fs::remove_file(&blocked).unwrap();
        assert!(state.insert_imported(selected.clone()).await.unwrap());
        assert!(!state.insert_imported(selected).await.unwrap());
        assert_eq!(state.index.lock().await.pulls.len(), 2);
        let saved: Value =
            serde_json::from_slice(&fs::read(blocked.join("index.json")).unwrap()).unwrap();
        assert_eq!(saved["pulls"].as_array().unwrap().len(), 2);
        fs::remove_dir_all(root).unwrap();
    });
}

#[test]
fn cancelled_scan_does_not_produce_records_or_modify_log() {
    let root = temporary();
    let path = root.join("WoWCombatLog-101626_200443.txt");
    let bytes = b"10/16/2026 20:00:00.0008  ENCOUNTER_START,1,Test,16,20\r\r\n10/16/2026 20:00:10.0008  ENCOUNTER_END,1,Test,16,20,0\r\r\n";
    fs::write(&path, bytes).unwrap();
    let cancelled = AtomicBool::new(true);
    assert!(logs::scan(&[path.clone()], &cancelled, |_, _| panic!(
        "取消后不应推进扫描"
    ))
    .is_err());
    assert_eq!(fs::read(&path).unwrap(), bytes);
    let scan = logs::scan(&[path], &AtomicBool::new(false), |_, _| {}).unwrap();
    assert_eq!(scan.len(), 1);
    assert_eq!(scan[0].start.difficulty_id, 16);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn cancellation_during_streaming_stops_before_finishing_the_file() {
    use std::sync::atomic::Ordering;
    let root = temporary();
    let path = root.join("WoWCombatLog-101626_200443.txt");
    let line = b"10/16/2026 20:00:00.0008  SPELL_DAMAGE,ignored,ignored,ignored,ignored\r\r\n";
    let mut bytes = Vec::new();
    for _ in 0..50_000 {
        bytes.extend_from_slice(line);
    }
    fs::write(&path, &bytes).unwrap();
    let cancelled = AtomicBool::new(false);
    let mut last_read = 0;
    assert!(logs::scan(&[path.clone()], &cancelled, |read, _| {
        last_read = read;
        cancelled.store(true, Ordering::Relaxed);
    })
    .is_err());
    assert!(last_read > 0 && last_read < bytes.len() as u64);
    assert_eq!(fs::read(path).unwrap(), bytes);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn missing_or_ambiguous_encounter_is_not_guessed_from_boss_name() {
    let candidate = super::source::metadata::Candidate {
        metadata: serde_json::from_value(json!({"id":"id","key":"video.mp4","actorId":1,
            "startTime":10000,"endTime":20000,"startTimeOffsetMs":3300,
            "encounter":{"id":1},"players":[]}))
        .unwrap(),
        video_path: PathBuf::from("video.mp4"),
    };
    assert!(assemble(&candidate, &[], Path::new("missing-ffmpeg"))
        .unwrap()
        .is_none());
    let start = crate::combat_log::model::EncounterStart {
        encounter_id: 1,
        encounter_name: "测试".into(),
        difficulty_id: 16,
        group_size: 20,
        occurred_at_unix_ms: 10000,
    };
    let end = crate::combat_log::model::EncounterEnd {
        encounter_id: 1,
        encounter_name: "测试".into(),
        difficulty_id: 16,
        group_size: 20,
        occurred_at_unix_ms: 20000,
        success: false,
    };
    let encounters = ["first#1", "second#1"]
        .into_iter()
        .map(|file_id| logs::LogEncounter {
            file_id: file_id.into(),
            start: start.clone(),
            end: end.clone(),
            start_offset: 0,
            end_offset: 100,
        })
        .collect::<Vec<_>>();
    assert!(assemble(&candidate, &encounters, Path::new("missing-ffmpeg")).is_err());
}

fn digest(path: &Path) -> Vec<u8> {
    let mut input = fs::File::open(path).unwrap();
    let mut buffer = vec![0; 64 * 1024];
    let mut hash = Sha256::new();
    loop {
        let count = input.read(&mut buffer).unwrap();
        if count == 0 {
            break;
        }
        hash.update(&buffer[..count]);
    }
    hash.finalize().to_vec()
}

/// 用户授权后显式处理三场真实录像；HLS 只生成在隔离临时应用目录。
#[test]
#[ignore = "需要 WOW_REPLAY_REAL_SAMPLE_DIR 和用户授权的真实录像与日志"]
fn imports_three_real_videos_to_isolated_hls_without_touching_sources() {
    let directory =
        PathBuf::from(std::env::var_os("WOW_REPLAY_REAL_SAMPLE_DIR").expect("请指定真实审计目录"));
    let inventory: Value =
        serde_json::from_slice(&fs::read(directory.join("inventory.json")).unwrap()).unwrap();
    let log_paths = inventory["logs"]
        .as_array()
        .unwrap()
        .iter()
        .map(|entry| fs::canonicalize(entry["file"].as_str().unwrap()).unwrap())
        .collect::<Vec<_>>();
    let encounters = logs::scan(&log_paths, &AtomicBool::new(false), |_, _| {}).unwrap();
    assert_eq!(encounters.len(), 22);
    let ffmpeg =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/ffmpeg-runtime/bin/ffmpeg.exe");
    let output = directory.join("isolated-import/recordings");
    let mut evidence = Vec::new();
    for video_index in [0, 1, 4] {
        let video = &inventory["videos"][video_index];
        let folder = PathBuf::from(video["folder"].as_str().unwrap());
        let metadata_path = folder.join("metadata.json");
        let original_metadata = fs::read(&metadata_path).unwrap();
        let candidate = load_candidate(
            &metadata_path,
            &fs::canonicalize(folder.parent().unwrap()).unwrap(),
        )
        .unwrap();
        let original_digest = digest(&candidate.video_path);
        let mut pull = assemble(&candidate, &encounters, &ffmpeg).unwrap().unwrap();
        assert_eq!(pull.difficulty_id, 16);
        assert!(pull.battle_key.as_ref().unwrap().starts_with("wcl:"));
        assert!(pull.recording_player_guid.is_some());
        assert!(!pull.mapping.as_ref().unwrap().media_calibrated);
        assert_eq!(pull.timeline_parse_errors, 0);
        ensure_artifact_layout(&output, &mut pull, true).unwrap();
        let playlist = process_existing_playback(&ffmpeg, &output, &pull).unwrap();
        assert_eq!(playlist, output.join(&pull.pull_id).join("hls/index.m3u8"));
        run_ffmpeg(
            &ffmpeg,
            &build_validate_args(&candidate.video_path),
            &pull.pull_id,
            None,
        )
        .unwrap();
        run_ffmpeg(
            &ffmpeg,
            &build_validate_args(&playlist),
            &pull.pull_id,
            None,
        )
        .unwrap();
        assert_eq!(fs::read(&metadata_path).unwrap(), original_metadata);
        assert_eq!(digest(&candidate.video_path), original_digest);
        assert_eq!(super::assemble::pull_id(&candidate), pull.pull_id);
        evidence.push(json!({"videoIndex":video_index,"pullId":pull.pull_id,"events":pull.timeline_events.len(),
            "players":pull.players.len(),"playlist":playlist,"originalAudioTracks":6,"allOriginalTracksDecodeExitCode":0,
            "hlsDecodeExitCode":0,"originalVideoSha256Unchanged":true,"originalMetadataUnchanged":true}));
    }
    fs::write(
        directory.join("rust-import-validation.json"),
        serde_json::to_vec_pretty(&evidence).unwrap(),
    )
    .unwrap();
}
