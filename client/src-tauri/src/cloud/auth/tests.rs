use crate::{
    cloud::{
        auth::{
            commands::{save_settings, verify_connection},
            credentials,
            model::{Identity, SettingsInput, StoredSettings},
        },
        state::CloudState,
        test_server::server,
    },
    local_state::LocalStateStore,
};
use serde_json::json;
use std::sync::Arc;

fn identity(id: &str) -> Identity {
    serde_json::from_value(json!({"userId":id,"displayName":"测试用户","teams":[{"teamId":"33333333-3333-4333-8333-333333333333","name":"测试团队","role":"member"}]})).unwrap()
}

fn settings(endpoint: String, user_id: String, token: &str) -> StoredSettings {
    StoredSettings {
        endpoint,
        user_id: Some(user_id),
        protected_token: credentials::protect(token).unwrap(),
        ..StoredSettings::default()
    }
}

fn store() -> (std::path::PathBuf, LocalStateStore) {
    let root = std::env::temp_dir().join(format!("wow-cloud-auth-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let store = LocalStateStore::isolated(root.join("client-state.json"));
    (root, store)
}

#[test]
fn endpoint_change_without_new_token_clears_old_credentials_and_same_endpoint_blank_preserves() {
    tauri::async_runtime::block_on(async {
        let account = identity("11111111-1111-4111-8111-111111111111");
        let saved = settings(
            "https://old.example.invalid".into(),
            account.user_id.clone(),
            "old-fixture-token",
        );
        let state = CloudState::from_saved(saved.clone(), Vec::new());
        *state.identity.write().await = Some(account);
        let (root, store) = store();
        save_settings(
            SettingsInput {
                endpoint: saved.endpoint.clone(),
                team_id: None,
                token: None,
            },
            &state,
            &store,
        )
        .await
        .unwrap();
        assert_eq!(
            state.settings.lock().await.protected_token,
            saved.protected_token
        );
        save_settings(
            SettingsInput {
                endpoint: "https://new.example.invalid".into(),
                team_id: None,
                token: None,
            },
            &state,
            &store,
        )
        .await
        .unwrap();
        assert!(state.settings.lock().await.protected_token.is_empty());
        assert!(state.settings.lock().await.user_id.is_none());
        assert!(state.identity.read().await.is_none());
        let bytes = std::fs::read(root.join("client-state.json")).unwrap();
        assert!(!String::from_utf8_lossy(&bytes).contains("old-fixture-token"));
        std::fs::remove_dir_all(root).unwrap();
    });
}

#[test]
fn same_endpoint_team_change_rechecks_membership_without_replacing_credentials() {
    tauri::async_runtime::block_on(async {
        let account = identity("11111111-1111-4111-8111-111111111111");
        let response = account.clone();
        let (origin, thread) = server(1, move |request, _| {
            assert_eq!(
                request.headers.get("authorization").map(String::as_str),
                Some("Bearer fixture-token")
            );
            (200, serde_json::to_value(&response).unwrap())
        });
        let saved = settings(origin.clone(), account.user_id, "fixture-token");
        let state = CloudState::from_saved(saved.clone(), Vec::new());
        let (root, store) = store();
        store
            .set(crate::cloud::config::SETTINGS_SECTION, &saved)
            .await
            .unwrap();
        let original = std::fs::read(root.join("client-state.json")).unwrap();
        let result = save_settings(
            SettingsInput {
                endpoint: origin,
                team_id: Some("44444444-4444-4444-8444-444444444444".into()),
                token: None,
            },
            &state,
            &store,
        )
        .await;
        assert!(result.is_err());
        assert_eq!(
            state.settings.lock().await.protected_token,
            saved.protected_token
        );
        assert!(state.settings.lock().await.team_id.is_none());
        assert_eq!(
            std::fs::read(root.join("client-state.json")).unwrap(),
            original
        );
        thread.join().unwrap();
        std::fs::remove_dir_all(root).unwrap();
    });
}

#[test]
fn stale_verify_response_cannot_overwrite_new_endpoint_identity() {
    tauri::async_runtime::block_on(async {
        let old_account = identity("11111111-1111-4111-8111-111111111111");
        let old_response = old_account.clone();
        let (entered, waiting) = std::sync::mpsc::channel();
        let (release, blocked) = std::sync::mpsc::channel();
        let (old_origin, old_server) = server(1, move |request, _| {
            assert_eq!(
                request.headers.get("authorization").map(String::as_str),
                Some("Bearer old-fixture-token")
            );
            entered.send(()).unwrap();
            blocked
                .recv_timeout(std::time::Duration::from_secs(5))
                .unwrap();
            (200, serde_json::to_value(&old_response).unwrap())
        });
        let new_account = identity("22222222-2222-4222-8222-222222222222");
        let new_response = new_account.clone();
        let (new_origin, new_server) = server(1, move |request, _| {
            assert_eq!(
                request.headers.get("authorization").map(String::as_str),
                Some("Bearer new-fixture-token")
            );
            (200, serde_json::to_value(&new_response).unwrap())
        });
        let state = Arc::new(CloudState::from_saved(
            settings(old_origin, old_account.user_id, "old-fixture-token"),
            Vec::new(),
        ));
        let verifying = state.clone();
        let previous =
            tauri::async_runtime::spawn(async move { verify_connection(&verifying).await });
        waiting
            .recv_timeout(std::time::Duration::from_secs(5))
            .unwrap();
        let (root, store) = store();
        save_settings(
            SettingsInput {
                endpoint: new_origin.clone(),
                team_id: None,
                token: Some("new-fixture-token".into()),
            },
            &state,
            &store,
        )
        .await
        .unwrap();
        assert_eq!(
            state.identity.read().await.as_ref().unwrap().user_id,
            new_account.user_id
        );
        release.send(()).unwrap();
        assert!(previous.await.unwrap().is_err());
        assert_eq!(
            state.identity.read().await.as_ref().unwrap().user_id,
            new_account.user_id
        );
        assert_eq!(state.settings.lock().await.endpoint, new_origin);
        old_server.join().unwrap();
        new_server.join().unwrap();
        std::fs::remove_dir_all(root).unwrap();
    });
}
