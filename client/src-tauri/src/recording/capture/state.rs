use std::{sync::atomic::AtomicBool, time::Instant};

use tauri::{AppHandle, Manager};
use tokio::sync::{Mutex, RwLock};

use crate::{
    combat_log::reader::CombatLogReader,
    recording::{
        model::RecordingIndex, pull_tracker::PullTracker, recovery::recover_interrupted_processing,
        store::RecordingStore,
    },
};

/// 保存唯一日志读取器、Pull 状态机、处理队列和业务索引。
pub struct RecordingState {
    pub(crate) index: Mutex<RecordingIndex>,
    pub(crate) reader: Mutex<CombatLogReader>,
    pub(crate) tracker: Mutex<PullTracker>,
    store: RecordingStore,
    persistence: Mutex<()>,
    pub(crate) processing: AtomicBool,
    pub(crate) last_error: RwLock<Option<String>>,
    pub(crate) last_rotation: Mutex<Instant>,
    pub(crate) clock: Mutex<crate::recording::capture::clock::ClockTracker>,
    pub(crate) event_queries: Mutex<crate::recording::events::query::EventQueryCache>,
}

impl RecordingState {
    /// 从应用数据目录恢复录制业务状态，损坏索引保留后以空状态启动。
    pub fn load(app: &AppHandle) -> Result<Self, String> {
        let directory = app
            .path()
            .app_data_dir()
            .map_err(|error| format!("无法定位录制业务目录：{error}"))?;
        let index_path = directory.join("recording-index.json");
        let store = RecordingStore::new(index_path.clone());
        let loaded = tauri::async_runtime::block_on(store.load());
        let (mut index, last_error) = match loaded {
            Ok(index) => (index, None),
            // 读取或迁移失败且原索引仍存在时，禁止用空状态覆盖用户现场。
            Err(error) if index_path.is_file() => return Err(error),
            Err(error) => (RecordingIndex::default(), Some(error)),
        };
        recover_interrupted_processing(&mut index);
        if let (Some(active), Some(file)) = (&mut index.active_pull, &index.combat_log_cursor.file)
        {
            let file_id = format!("{}#{}", file.canonical_path, file.created_at_unix_ms);
            if let Err(error) = crate::recording::events::index::restore_active(
                active,
                &file_id,
                index.combat_log_cursor.byte_offset,
            ) {
                index.diagnostics.push(error);
            }
        }
        Ok(Self {
            reader: Mutex::new(CombatLogReader::from_cursor(
                index.combat_log_cursor.clone(),
            )),
            tracker: Mutex::new(PullTracker::from_active(index.active_pull.clone())),
            index: Mutex::new(index),
            store,
            persistence: Mutex::new(()),
            processing: AtomicBool::new(false),
            last_error: RwLock::new(last_error),
            last_rotation: Mutex::new(Instant::now()),
            clock: Mutex::new(crate::recording::capture::clock::ClockTracker::new()),
            event_queries: Mutex::new(crate::recording::events::query::EventQueryCache::default()),
        })
    }

    /// 串行保存业务快照，避免处理线程与日志轮询覆盖索引。
    pub(crate) async fn save(&self) -> Result<(), String> {
        let _guard = self.persistence.lock().await;
        let snapshot = self.index.lock().await.clone();
        self.store.save(&snapshot).await
    }

    /// 处理线程启动前保存领取状态；失败时只回退仍被本次领取的 Processing。
    pub(crate) async fn persist_processing_claim(&self, pull_id: &str) -> Result<(), String> {
        if let Err(error) = self.save().await {
            let mut index = self.index.lock().await;
            if let Some(pull) = index.pulls.iter_mut().find(|pull| {
                pull.pull_id == pull_id
                    && pull.state == crate::recording::model::PullState::Processing
            }) {
                pull.state = crate::recording::model::PullState::Failed;
                pull.error = Some(format!(
                    "保存处理领取状态失败，媒体任务尚未启动，可重试：{error}"
                ));
            }
            self.processing
                .store(false, std::sync::atomic::Ordering::SeqCst);
            return Err(error);
        }
        Ok(())
    }

    /// 先持久化再发布导入记录，后台队列不会领取尚未成功保存的原片引用。
    pub(crate) async fn insert_imported(
        &self,
        pull: crate::recording::model::BossPull,
    ) -> Result<bool, String> {
        let _guard = self.persistence.lock().await;
        let mut index = self.index.lock().await;
        if index
            .pulls
            .iter()
            .any(|existing| existing.pull_id == pull.pull_id)
        {
            return Ok(false);
        }
        let mut next = index.clone();
        next.pulls.push(pull);
        self.store.save(&next).await?;
        *index = next;
        Ok(true)
    }

    #[cfg(test)]
    pub(crate) fn isolated(path: std::path::PathBuf) -> Self {
        Self {
            index: Mutex::new(RecordingIndex::default()),
            reader: Mutex::new(CombatLogReader::from_cursor(Default::default())),
            tracker: Mutex::new(PullTracker::default()),
            store: RecordingStore::new(path),
            persistence: Mutex::new(()),
            processing: AtomicBool::new(false),
            last_error: RwLock::new(None),
            last_rotation: Mutex::new(Instant::now()),
            clock: Mutex::new(crate::recording::capture::clock::ClockTracker::new()),
            event_queries: Mutex::new(crate::recording::events::query::EventQueryCache::default()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::RecordingState;
    use crate::recording::model::{BossPull, PullState};
    use std::{fs, sync::atomic::Ordering};

    #[test]
    fn failed_processing_claim_releases_queue_and_preserves_disk_snapshot() {
        tauri::async_runtime::block_on(async {
            let root =
                std::env::temp_dir().join(format!("wow-claim-test-{}", uuid::Uuid::new_v4()));
            let path = root.join("recording-index.json");
            let state = RecordingState::isolated(path.clone());
            let pull: BossPull = serde_json::from_value(serde_json::json!({"pullId":"claimed","encounterId":1,
                "encounterName":"测试","difficultyId":16,"groupSize":20,"encounterStartUnixMs":0,
                "clipStartUnixMs":0,"logFileId":"file","logStartOffset":0,"state":"waitingForPlayback"})).unwrap();
            state.index.lock().await.pulls.push(pull);
            state.save().await.unwrap();
            let original = fs::read(&path).unwrap();
            fs::create_dir(path.with_extension("json.tmp")).unwrap();
            state.processing.store(true, Ordering::SeqCst);
            state.index.lock().await.pulls[0].state = PullState::Processing;
            assert!(state.persist_processing_claim("claimed").await.is_err());
            assert!(!state.processing.load(Ordering::SeqCst));
            assert_eq!(fs::read(&path).unwrap(), original);
            {
                let index = state.index.lock().await;
                assert_eq!(index.pulls[0].state, PullState::Failed);
                assert!(index.pulls[0]
                    .error
                    .as_deref()
                    .unwrap()
                    .contains("尚未启动"));
            }
            // 保存故障不能覆盖已变化的状态；只允许本次仍为 Processing 的领取回退。
            state.index.lock().await.pulls[0].state = PullState::Ready;
            state.processing.store(true, Ordering::SeqCst);
            assert!(state.persist_processing_claim("claimed").await.is_err());
            assert_eq!(state.index.lock().await.pulls[0].state, PullState::Ready);
            assert!(!state.processing.load(Ordering::SeqCst));
            fs::remove_dir(path.with_extension("json.tmp")).unwrap();
            state.index.lock().await.pulls[0].state = PullState::Processing;
            state.processing.store(true, Ordering::SeqCst);
            state.persist_processing_claim("claimed").await.unwrap();
            assert!(state.processing.load(Ordering::SeqCst));
            assert_eq!(
                state.index.lock().await.pulls[0].state,
                PullState::Processing
            );
            fs::remove_dir_all(root).unwrap();
        });
    }
}
