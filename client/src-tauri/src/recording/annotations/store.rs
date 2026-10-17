use std::collections::HashMap;
use tokio::sync::Mutex;

use super::{
    config,
    model::{validate, Document, SaveRequest, Snapshot},
};
use crate::local_state::LocalStateStore;

/// 串行执行本地快照的读／CAS／写盘，持久化失败时不发布新版本。
#[derive(Default)]
pub struct AnnotationState(pub Mutex<()>);

impl AnnotationState {
    pub async fn get(&self, store: &LocalStateStore, pull_id: &str) -> Result<Snapshot, String> {
        let _guard = self.0.lock().await;
        let documents: HashMap<String, Document> =
            store.get(config::SECTION).await?.unwrap_or_default();
        Ok(documents.get(pull_id).cloned().unwrap_or_default().into())
    }

    pub async fn save(
        &self,
        store: &LocalStateStore,
        pull_id: &str,
        request: SaveRequest,
        duration_ms: i64,
    ) -> Result<Snapshot, String> {
        validate(&request.items, duration_ms)?;
        let _guard = self.0.lock().await;
        let mut documents: HashMap<String, Document> =
            store.get(config::SECTION).await?.unwrap_or_default();
        let old_version = documents
            .get(pull_id)
            .map(|document| document.version)
            .unwrap_or(0);
        if old_version != request.expected_version {
            return Err("ANNOTATION_CONFLICT: 标注已被另一操作修改，请重新读取后合并".into());
        }
        let document = Document {
            version: old_version.checked_add(1).ok_or("标注版本超出限制")?,
            items: request.items,
        };
        documents.insert(pull_id.into(), document.clone());
        let points = documents
            .values()
            .flat_map(|document| &document.items)
            .map(|item| item.points.len())
            .sum::<usize>();
        if documents.len() > config::LOCAL_DOCUMENT_LIMIT || points > config::LOCAL_POINT_LIMIT {
            return Err("本地标注总容量超过限制，请先清理不再需要的标注".into());
        }
        store.set(config::SECTION, &documents).await?;
        Ok(document.into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn concurrent_cas_has_one_winner_and_failed_persistence_does_not_advance_version() {
        tauri::async_runtime::block_on(async {
            let root =
                std::env::temp_dir().join(format!("wow-annotations-{}", uuid::Uuid::new_v4()));
            let store = LocalStateStore::isolated(root.join("client-state.json"));
            let state = AnnotationState::default();
            assert!(state
                .save(
                    &store,
                    "pull",
                    SaveRequest {
                        expected_version: 0,
                        items: vec![]
                    },
                    10000
                )
                .await
                .is_err());
            assert_eq!(state.get(&store, "pull").await.unwrap().version, 0);
            std::fs::create_dir_all(&root).unwrap();
            let (first, second) = futures_util::join!(
                state.save(
                    &store,
                    "pull",
                    SaveRequest {
                        expected_version: 0,
                        items: vec![]
                    },
                    10000
                ),
                state.save(
                    &store,
                    "pull",
                    SaveRequest {
                        expected_version: 0,
                        items: vec![]
                    },
                    10000
                )
            );
            assert_ne!(first.is_ok(), second.is_ok());
            assert_eq!(state.get(&store, "pull").await.unwrap().version, 1);
            let raw: serde_json::Value =
                serde_json::from_slice(&std::fs::read(root.join("client-state.json")).unwrap())
                    .unwrap();
            assert_eq!(raw["sections"][config::SECTION]["pull"]["version"], 1);
            std::fs::remove_dir_all(root).unwrap();
        });
    }
}
