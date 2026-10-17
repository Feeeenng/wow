use crate::cloud::test_server::server;
use crate::{
    cloud::{
        auth::model::StoredSettings,
        state::CloudState,
        upload::model::{StoredJob, UploadIntent},
    },
    local_state::LocalStateStore,
};

fn job() -> StoredJob {
    StoredJob {
        job_id: uuid::Uuid::new_v4().to_string(),
        pull_id: "a".repeat(64),
        origin: "https://example.invalid".into(),
        user_id: uuid::Uuid::new_v4().to_string(),
        team_id: uuid::Uuid::new_v4().to_string(),
        device_id: uuid::Uuid::new_v4().to_string(),
        encounter_name: "测试首领".into(),
        team_pull_id: None,
        intent: UploadIntent::Queued,
        file_size_bytes: 6,
        registration: None,
        upload_id: None,
        restart_requested: false,
    }
}

#[test]
fn restored_intent_does_not_restore_uploading_truth_or_identity() {
    let state = CloudState::from_saved(StoredSettings::default(), vec![job()]);
    tauri::async_runtime::block_on(async {
        assert_eq!(state.jobs.lock().await.len(), 1);
        assert!(state.observations.read().await.is_empty());
        assert!(state.identity.read().await.is_none());
        assert!(state.active.lock().await.is_none());
    });
}

#[test]
fn queue_write_failure_preserves_memory_and_can_retry_without_losing_sections() {
    tauri::async_runtime::block_on(async {
        let root = std::env::temp_dir().join(format!("wow-cloud-test-{}", uuid::Uuid::new_v4()));
        let store = LocalStateStore::isolated(root.join("client-state.json"));
        let state = CloudState::from_saved(StoredSettings::default(), Vec::new());
        assert!(state
            .update_jobs(&store, |jobs| {
                jobs.push(job());
                Ok(())
            })
            .await
            .is_err());
        assert!(state.jobs.lock().await.is_empty());
        std::fs::create_dir_all(&root).unwrap();
        store.set("replay", &"preserved").await.unwrap();
        state
            .update_jobs(&store, |jobs| {
                jobs.push(job());
                Ok(())
            })
            .await
            .unwrap();
        assert_eq!(state.jobs.lock().await.len(), 1);
        let saved: serde_json::Value =
            serde_json::from_slice(&std::fs::read(root.join("client-state.json")).unwrap())
                .unwrap();
        assert_eq!(saved["sections"]["replay"], "preserved");
        assert_eq!(
            saved["sections"]["cloudUploads"].as_array().unwrap().len(),
            1
        );
        std::fs::remove_dir_all(root).unwrap();
    });
}

#[test]
fn corrupt_cloud_sections_disable_only_cloud_and_are_not_overwritten() {
    tauri::async_runtime::block_on(async {
        let root = std::env::temp_dir().join(format!("wow-cloud-corrupt-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let store = LocalStateStore::isolated(root.join("client-state.json"));
        store
            .set("cloudUploads", &"preserve-invalid-original")
            .await
            .unwrap();
        let original = std::fs::read(root.join("client-state.json")).unwrap();
        let state = CloudState::from_sections(Ok(StoredSettings::default()), Err("invalid".into()));
        assert!(state.recovery_error.is_some());
        assert!(state
            .update_jobs(&store, |jobs| {
                jobs.clear();
                Ok(())
            })
            .await
            .is_err());
        assert_eq!(
            std::fs::read(root.join("client-state.json")).unwrap(),
            original
        );
        std::fs::remove_dir_all(root).unwrap();
    });
}

fn status(all: bool, uploaded: bool) -> crate::cloud::api::model::UploadStatus {
    use sha2::{Digest, Sha256};
    let mut parts = vec![
        serde_json::json!({"partNumber":1,"sizeBytes":4,"checksumSha256":super::source::hex(&Sha256::digest(b"ABCD")),"etag":"etag-1"}),
    ];
    if all {
        parts.push(serde_json::json!({"partNumber":2,"sizeBytes":2,"checksumSha256":super::source::hex(&Sha256::digest(b"EF")),"etag":"etag-2"}));
    }
    serde_json::from_value(serde_json::json!({"recordingId":"22222222-2222-4222-8222-222222222222","teamPullId":"33333333-3333-4333-8333-333333333333","uploadId":"11111111-1111-4111-8111-111111111111",
        "uploadStatus":if uploaded {"uploaded"} else {"uploading"},"recordingStatus":if uploaded {"uploaded"} else {"pendingUpload"},
        "partSizeBytes":4,"totalParts":2,"confirmedParts":parts,"uploadedBytes":if all {6} else {4},"fileSizeBytes":6,
        "verification":if uploaded {Some("partsVerified")} else {None},"fullFileSha256Verified":false})).unwrap()
}

#[test]
fn multipart_resumes_from_server_after_lost_confirmation_without_resending_accepted_part() {
    use crate::cloud::{
        api::client::ApiClient,
        upload::{
            multipart::{base64, upload_parts},
            state::TransferControl,
        },
    };
    use sha2::{Digest, Sha256};
    tauri::async_runtime::block_on(async {
        let (origin, thread) = server(5, |request, origin| {
            if request.path.ends_with("/parts") {
                let body: serde_json::Value = serde_json::from_slice(&request.body).unwrap();
                assert_eq!(body["partNumber"], 2);
                assert_eq!(
                    body["checksumSha256"],
                    super::source::hex(&Sha256::digest(b"EF"))
                );
                (
                    200,
                    serde_json::json!({"partNumber":2,"sizeBytes":2,"url":format!("{origin}/object?X-Amz-Signature=test-only"),"headers":{"x-amz-checksum-sha256":base64(&Sha256::digest(b"EF"))},"expiresInSeconds":60}),
                )
            } else if request.path.starts_with("/object?") {
                assert!(!request.headers.contains_key("authorization"));
                assert_eq!(request.body, b"EF");
                (200, serde_json::json!({}))
            } else if request.path.ends_with("/confirm") {
                (
                    503,
                    serde_json::json!({"detail":"simulated lost confirmation"}),
                )
            } else if request.path.ends_with("/status") {
                (200, serde_json::to_value(status(true, false)).unwrap())
            } else if request.path.ends_with("/complete") {
                (200, serde_json::to_value(status(true, true)).unwrap())
            } else {
                panic!("未知协议请求");
            }
        });
        let client = ApiClient::new(&origin, "fixture-token".into()).unwrap();
        let mut selected = job();
        selected.origin = origin;
        selected.upload_id = Some(status(false, false).upload_id.clone());
        let state = CloudState::from_saved(StoredSettings::default(), vec![selected.clone()]);
        let path =
            std::env::temp_dir().join(format!("wow-upload-protocol-{}", uuid::Uuid::new_v4()));
        std::fs::write(&path, b"ABCDEF").unwrap();
        assert!(upload_parts(
            &client,
            &path,
            &state,
            &selected,
            &TransferControl::default(),
            status(false, false),
            &super::source::hex(&Sha256::digest(b"ABCDEF")),
        )
        .await
        .is_err());
        let remote = client
            .status(selected.upload_id.as_deref().unwrap())
            .await
            .unwrap();
        let complete = upload_parts(
            &client,
            &path,
            &state,
            &selected,
            &TransferControl::default(),
            remote,
            &super::source::hex(&Sha256::digest(b"ABCDEF")),
        )
        .await
        .unwrap();
        assert_eq!(complete.upload_status, "uploaded");
        assert!(!complete.full_file_sha256_verified);
        let requests = thread.join().unwrap();
        assert_eq!(
            requests
                .iter()
                .filter(|request| request.path.starts_with("/object?"))
                .count(),
            1
        );
        for request in requests
            .iter()
            .filter(|request| request.path.starts_with("/api/"))
        {
            assert_eq!(
                request.headers.get("authorization").map(String::as_str),
                Some("Bearer fixture-token")
            );
        }
        assert_eq!(std::fs::read(&path).unwrap(), b"ABCDEF");
        std::fs::remove_file(path).unwrap();
    });
}

#[test]
fn pre_signed_errors_do_not_expose_signature_and_cancel_interrupts_request() {
    use crate::cloud::{
        api::{client::ApiClient, model::PresignedPart},
        upload::state::TransferControl,
    };
    use std::{collections::BTreeMap, sync::Arc};
    tauri::async_runtime::block_on(async {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        drop(listener);
        let part = PresignedPart {
            part_number: 1,
            size_bytes: 1,
            url: format!("http://{address}/object?X-Amz-Signature=do-not-expose"),
            headers: BTreeMap::new(),
            expires_in_seconds: 60,
        };
        let failure = ApiClient::put_part(part, vec![1], &TransferControl::default())
            .await
            .unwrap_err();
        assert!(!failure.contains("do-not-expose") && !failure.contains("X-Amz"));
        let control = Arc::new(TransferControl::default());
        let interrupt = control.clone();
        let (origin, thread) = server(1, move |request, _| {
            assert!(!request.headers.contains_key("authorization"));
            interrupt.interrupt();
            (200, serde_json::json!({}))
        });
        let part = PresignedPart {
            part_number: 1,
            size_bytes: 1,
            url: format!("{origin}/object"),
            headers: BTreeMap::new(),
            expires_in_seconds: 60,
        };
        let result = ApiClient::put_part(part, vec![1], &control).await;
        assert!(result.is_err() || control.interrupted());
        thread.join().unwrap();
    });
}

#[test]
fn server_part_plan_and_checksum_encoding_are_validated() {
    let mut invalid = status(false, false);
    invalid
        .confirmed_parts
        .push(invalid.confirmed_parts[0].clone());
    assert!(super::multipart::validate_status(&invalid, &job()).is_err());
    let mut invalid = status(false, false);
    invalid.part_size_bytes = crate::cloud::config::MAX_PART_BYTES + 1;
    assert!(super::multipart::validate_status(&invalid, &job()).is_err());
    assert_eq!(super::multipart::base64(b"abc"), "YWJj");
    assert_eq!(super::multipart::base64(b"EF"), "RUY=");
}

#[test]
fn explicit_pause_cancel_and_retry_persist_intent_and_interrupt_active_transfer() {
    use crate::cloud::upload::{commands::change_intent, state::TransferControl};
    use std::sync::Arc;
    tauri::async_runtime::block_on(async {
        let root = std::env::temp_dir().join(format!("wow-cloud-intent-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let store = LocalStateStore::isolated(root.join("state.json"));
        let selected = job();
        let id = selected.job_id.clone();
        let state = CloudState::from_saved(StoredSettings::default(), vec![selected]);
        let control = Arc::new(TransferControl::default());
        *state.active.lock().await = Some((id.clone(), control.clone()));
        change_intent(&id, UploadIntent::Paused, &state, &store)
            .await
            .unwrap();
        assert!(control.interrupted());
        assert!(state.jobs.lock().await[0].intent == UploadIntent::Paused);
        change_intent(&id, UploadIntent::CancelRequested, &state, &store)
            .await
            .unwrap();
        assert!(state.jobs.lock().await[0].intent == UploadIntent::CancelRequested);
        change_intent(&id, UploadIntent::Queued, &state, &store)
            .await
            .unwrap();
        assert!(state.jobs.lock().await[0].restart_requested);
        let saved: serde_json::Value =
            serde_json::from_slice(&std::fs::read(root.join("state.json")).unwrap()).unwrap();
        assert_eq!(saved["sections"]["cloudUploads"][0]["intent"], "queued");
        assert!(saved["sections"]["cloudUploads"][0]
            .get("uploadedBytes")
            .is_none());
        std::fs::remove_dir_all(root).unwrap();
    });
}

#[test]
fn source_registration_sends_public_manifest_without_local_paths_or_raw_log() {
    use crate::cloud::upload::{source, state::TransferControl};
    use crate::recording::model::BossPull;
    use sha2::{Digest, Sha256};
    tauri::async_runtime::block_on(async {
        let path = std::env::temp_dir().join(format!("wow-manifest-{}.mp4", uuid::Uuid::new_v4()));
        std::fs::write(&path, b"ABCDEF").unwrap();
        let mut pull:BossPull=serde_json::from_value(serde_json::json!({"pullId":"a".repeat(64),"encounterId":1,"encounterName":"测试","difficultyId":16,"groupSize":20,
            "encounterStartUnixMs":10000,"encounterEndUnixMs":20000,"clipStartUnixMs":5000,"clipEndUnixMs":25000,
            "logFileId":"C:/private/combatlog.txt#1","logStartOffset":0,"state":"partial","recordingPlayerGuid":"Player-1","videoPath":path,"importedSource":path,"success":false,
            "players":[{"actorId":1,"guid":"Player-1","name":"测试角色","serverName":"罗宁","fullType":"Hunter-Marksmanship"}],
            "mapping":{"slices":[{"path":"D:/sensitive/source.mp4","offsetMs":0,"durationMs":20000}],"actualStartUnixMs":5000,"actualEndUnixMs":25000,"videoZeroMs":5000,"hasGap":true,"mediaDurationMs":20000}})).unwrap();
        let mut selected = job();
        selected.team_pull_id = Some("33333333-3333-4333-8333-333333333333".into());
        let (_, manifest) = source::registration(
            &selected,
            &pull,
            std::path::PathBuf::new(),
            &TransferControl::default(),
        )
        .await
        .unwrap();
        let value = serde_json::to_value(&manifest).unwrap();
        let serialized = serde_json::to_string(&value).unwrap();
        assert!(
            !serialized.contains("private")
                && !serialized.contains("sensitive")
                && !serialized.contains("wow-manifest")
                && !serialized.contains("actorId")
        );
        assert_eq!(value["characterGuid"], "Player-1");
        assert_eq!(
            value["artifactVersion"],
            source::hex(&Sha256::digest(b"ABCDEF"))
        );
        assert_eq!(value["mediaCalibrated"], false);
        assert_eq!(value["hasGap"], true);
        assert_eq!(value["success"], false);
        assert_eq!(value["groupSize"], 20);
        assert_eq!(
            value["teamPullId"],
            selected.team_pull_id.as_deref().unwrap()
        );
        assert_eq!(value["intervals"], serde_json::json!([]));
        pull.state = crate::recording::model::PullState::Recording;
        assert!(source::video_path(&pull).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"ABCDEF");
        std::fs::remove_file(path).unwrap();
    });
}

#[test]
fn changed_file_hash_prevents_cloud_complete_even_when_parts_are_confirmed() {
    use crate::cloud::{
        api::client::ApiClient,
        upload::{multipart::upload_parts, state::TransferControl},
    };
    tauri::async_runtime::block_on(async {
        let path = std::env::temp_dir().join(format!("wow-changed-file-{}", uuid::Uuid::new_v4()));
        std::fs::write(&path, b"ABCDEF").unwrap();
        let client = ApiClient::new("https://example.invalid", "fixture-token".into()).unwrap();
        let selected = job();
        let state = CloudState::from_saved(StoredSettings::default(), vec![selected.clone()]);
        let error = upload_parts(
            &client,
            &path,
            &state,
            &selected,
            &TransferControl::default(),
            status(true, false),
            &"0".repeat(64),
        )
        .await
        .err()
        .expect("原片摘要变化必须阻止云端完成");
        assert!(error.contains("原片发生变化"));
        std::fs::remove_file(path).unwrap();
    });
}

#[test]
fn server_status_refresh_prioritizes_explicit_work_and_does_not_starve_restored_jobs() {
    use std::{
        collections::HashMap,
        time::{Duration, Instant},
    };
    let now = Instant::now();
    let mut old = job();
    old.intent = UploadIntent::Completed;
    old.upload_id = Some(status(true, true).upload_id);
    let mut restored = job();
    restored.intent = UploadIntent::Paused;
    let mut queued = job();
    queued.intent = UploadIntent::Queued;
    let mut verified = HashMap::new();
    verified.insert(old.job_id.clone(), now - Duration::from_secs(20));
    let mut jobs = vec![old, restored, queued];
    assert_eq!(
        super::worker::next_job(&jobs, &verified, now)
            .unwrap()
            .job_id,
        jobs[2].job_id
    );
    jobs[2].intent = UploadIntent::Paused;
    verified.insert(jobs[2].job_id.clone(), now);
    assert_eq!(
        super::worker::next_job(&jobs, &verified, now)
            .unwrap()
            .job_id,
        jobs[1].job_id
    );
    verified.insert(jobs[1].job_id.clone(), now);
    assert_eq!(
        super::worker::next_job(&jobs, &verified, now)
            .unwrap()
            .job_id,
        jobs[0].job_id
    );
    verified.insert(jobs[0].job_id.clone(), now);
    assert!(super::worker::next_job(&jobs, &verified, now).is_none());
}
