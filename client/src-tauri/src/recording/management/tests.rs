use super::{paths, transaction};
use crate::recording::{
    capture::state::RecordingState,
    model::{BossPull, SourceRecording},
    naming::recording_name,
};
use std::{fs, path::PathBuf};

struct Fixture {
    root: PathBuf,
    output: PathBuf,
    state: RecordingState,
    pull: BossPull,
    directory: PathBuf,
}
impl Fixture {
    async fn new(imported: bool) -> Self {
        let root =
            std::env::temp_dir().join(format!("wow-recording-management-{}", uuid::Uuid::new_v4()));
        let output = root.join("recordings");
        fs::create_dir_all(&output).unwrap();
        let state = RecordingState::isolated(root.join("index.json"));
        let mut pull: BossPull = serde_json::from_value(serde_json::json!({"pullId":if imported { "a".repeat(64) } else { "managed".into() }, "encounterId":1,"encounterName":"测试", "difficultyId":16,"groupSize":20,"encounterStartUnixMs":0,"clipStartUnixMs":0,"logFileId":"file","logStartOffset":0,"state":"ready"})).unwrap();
        if imported {
            let original = root.join("original.mp4");
            fs::write(&original, b"original").unwrap();
            pull.imported_source = Some(original.clone());
            pull.video_path = Some(original);
        }
        let directory = output.join(if imported {
            pull.pull_id.clone()
        } else {
            recording_name(&pull)
        });
        fs::create_dir_all(directory.join("hls")).unwrap();
        fs::write(directory.join("hls/index.m3u8"), b"playlist").unwrap();
        fs::write(directory.join("hls/init.mp4"), b"init").unwrap();
        fs::write(directory.join("combat-log.json"), b"log").unwrap();
        fs::write(directory.join("metadata.json"), b"metadata").unwrap();
        if !imported {
            let video = directory.join(format!("{}.mp4", recording_name(&pull)));
            fs::write(&video, b"managed video").unwrap();
            pull.video_path = Some(video);
        }
        pull.playback_path = Some(directory.join("hls/index.m3u8"));
        state.index.lock().await.pulls.push(pull.clone());
        state.save().await.unwrap();
        Self {
            root,
            output,
            state,
            pull,
            directory,
        }
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

#[test]
fn deletion_preserves_logs_raw_sources_and_imported_originals() {
    tauri::async_runtime::block_on(async {
        for imported in [false, true] {
            let fixture = Fixture::new(imported).await;
            let raw = fixture.root.join("obs-source.mp4");
            fs::write(&raw, b"raw").unwrap();
            fixture
                .state
                .index
                .lock()
                .await
                .sources
                .push(SourceRecording {
                    path: raw.clone(),
                    ..Default::default()
                });
            transaction::delete(&fixture.state, &fixture.output, &fixture.pull.pull_id)
                .await
                .unwrap();
            assert!(fixture.state.index.lock().await.pulls.is_empty());
            assert_eq!(fs::read(raw).unwrap(), b"raw");
            assert_eq!(
                fs::read(fixture.directory.join("combat-log.json")).unwrap(),
                b"log"
            );
            assert_eq!(
                fs::read(fixture.directory.join("metadata.json")).unwrap(),
                b"metadata"
            );
            assert!(!fixture.directory.join("hls").exists());
            if imported {
                assert_eq!(
                    fs::read(fixture.pull.video_path.as_ref().unwrap()).unwrap(),
                    b"original"
                );
            }
        }
    });
}

#[test]
fn failed_index_save_rolls_back_media_and_memory() {
    tauri::async_runtime::block_on(async {
        let fixture = Fixture::new(false).await;
        let original = fs::read(fixture.root.join("index.json")).unwrap();
        fs::create_dir(fixture.root.join("index.json.tmp")).unwrap();
        assert!(
            transaction::delete(&fixture.state, &fixture.output, &fixture.pull.pull_id)
                .await
                .is_err()
        );
        assert_eq!(fixture.state.index.lock().await.pulls.len(), 1);
        assert_eq!(fs::read(fixture.root.join("index.json")).unwrap(), original);
        assert_eq!(
            fs::read(fixture.pull.video_path.as_ref().unwrap()).unwrap(),
            b"managed video"
        );
        assert!(fixture.directory.join("hls/index.m3u8").is_file());
    });
}

#[test]
fn external_video_and_shared_raw_source_are_rejected() {
    tauri::async_runtime::block_on(async {
        let fixture = Fixture::new(false).await;
        {
            let mut index = fixture.state.index.lock().await;
            index.sources.push(SourceRecording {
                path: fixture.pull.video_path.clone().unwrap(),
                ..Default::default()
            });
        }
        assert!(
            transaction::delete(&fixture.state, &fixture.output, &fixture.pull.pull_id)
                .await
                .unwrap_err()
                .contains("原片")
        );
        let mut pull = fixture.pull.clone();
        pull.video_path = Some(fixture.root.join("outside.mp4"));
        assert!(
            paths::artifacts(&fixture.output, &pull, &*fixture.state.index.lock().await).is_err()
        );
    });
}

#[test]
fn processing_active_and_unknown_hls_files_are_rejected() {
    tauri::async_runtime::block_on(async {
        let fixture = Fixture::new(false).await;
        fixture.state.index.lock().await.active_pull = Some(fixture.pull.clone());
        assert!(
            transaction::delete(&fixture.state, &fixture.output, &fixture.pull.pull_id)
                .await
                .is_err()
        );
        fixture.state.index.lock().await.active_pull = None;
        fixture.state.index.lock().await.pulls[0].state =
            crate::recording::model::PullState::Processing;
        assert!(
            transaction::delete(&fixture.state, &fixture.output, &fixture.pull.pull_id)
                .await
                .is_err()
        );
        fixture.state.index.lock().await.pulls[0].state = crate::recording::model::PullState::Ready;
        fs::write(fixture.directory.join("hls/keep-log.txt"), b"log").unwrap();
        assert!(
            transaction::delete(&fixture.state, &fixture.output, &fixture.pull.pull_id)
                .await
                .is_err()
        );
        assert!(fixture.pull.video_path.as_ref().unwrap().is_file());
    });
}

#[test]
fn linked_media_is_rejected() {
    tauri::async_runtime::block_on(async {
        let fixture = Fixture::new(false).await;
        let target = fixture.root.join("outside.m4s");
        fs::write(&target, b"protected").unwrap();
        let link = fixture.directory.join("hls/segment-00000.m4s");
        #[cfg(windows)]
        let result = std::os::windows::fs::symlink_file(&target, &link);
        #[cfg(not(windows))]
        let result = std::os::unix::fs::symlink(&target, &link);
        if let Err(error) = result {
            panic!("需要符号链接测试权限：{error}");
        }
        assert!(
            transaction::delete(&fixture.state, &fixture.output, &fixture.pull.pull_id)
                .await
                .is_err()
        );
        assert_eq!(fs::read(&target).unwrap(), b"protected");
    });
}

#[test]
fn favorites_are_persisted_without_overwriting_other_sections() {
    tauri::async_runtime::block_on(async {
        let fixture = Fixture::new(false).await;
        let path = fixture.root.join("client-state.json");
        let store = crate::local_state::LocalStateStore::isolated(path.clone());
        store.set("other", &"preserved").await.unwrap();
        super::commands::save_favorite(&fixture.pull.pull_id, true, &fixture.state, &store)
            .await
            .unwrap();
        let value: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(
            value["sections"]["recordingManagement"]["favorites"][0],
            fixture.pull.pull_id
        );
        assert_eq!(value["sections"]["other"], "preserved");
        fs::create_dir(fixture.root.join("client-state.json.tmp")).unwrap();
        assert!(super::commands::save_favorite(
            &fixture.pull.pull_id,
            false,
            &fixture.state,
            &store
        )
        .await
        .is_err());
        let value: serde_json::Value = store.get("recordingManagement").await.unwrap().unwrap();
        assert_eq!(value["favorites"][0], fixture.pull.pull_id);
        fs::remove_dir(fixture.root.join("client-state.json.tmp")).unwrap();
        super::commands::save_favorite(&fixture.pull.pull_id, false, &fixture.state, &store)
            .await
            .unwrap();
        assert!(
            super::commands::save_favorite("unknown", true, &fixture.state, &store)
                .await
                .is_err()
        );
        let value: serde_json::Value = store.get("recordingManagement").await.unwrap().unwrap();
        assert_eq!(value["favorites"], serde_json::json!([]));
    });
}
