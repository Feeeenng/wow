use std::{collections::HashMap, sync::Arc};
use tauri::{AppHandle, Manager};
use tokio::sync::{Mutex, RwLock};

use crate::{
    cloud::{
        auth::model::{Identity, StoredSettings},
        config::{SETTINGS_SECTION, UPLOAD_SECTION},
        upload::{
            model::{Observation, StoredJob},
            state::TransferControl,
        },
    },
    local_state::LocalStateStore,
};

/// 云连接、上传意图与瞬时真值分离，启动后观察状态一律从未核验开始。
pub struct CloudState {
    pub settings: Mutex<StoredSettings>,
    pub jobs: Mutex<Vec<StoredJob>>,
    pub identity: RwLock<Option<Identity>>,
    pub observations: RwLock<HashMap<String, Observation>>,
    pub active: Mutex<Option<(String, Arc<TransferControl>)>>,
    pub recovery_error: Option<String>,
}

impl CloudState {
    pub fn load(app: &AppHandle) -> Result<Self, String> {
        let store = app.state::<LocalStateStore>();
        tauri::async_runtime::block_on(async {
            Ok(Self::from_sections(
                store
                    .get::<StoredSettings>(SETTINGS_SECTION)
                    .await
                    .map(|value| value.unwrap_or_default()),
                store
                    .get::<Vec<StoredJob>>(UPLOAD_SECTION)
                    .await
                    .map(|value| value.unwrap_or_default()),
            ))
        })
    }

    pub(crate) fn from_saved(settings: StoredSettings, jobs: Vec<StoredJob>) -> Self {
        Self {
            settings: Mutex::new(settings),
            jobs: Mutex::new(jobs),
            identity: RwLock::new(None),
            observations: RwLock::new(HashMap::new()),
            active: Mutex::new(None),
            recovery_error: None,
        }
    }

    /// 损坏的云区段不阻止本地录制启动，也不被空队列覆盖。
    pub(crate) fn from_sections(
        settings: Result<StoredSettings, String>,
        jobs: Result<Vec<StoredJob>, String>,
    ) -> Self {
        let corrupt = settings.is_err() || jobs.is_err();
        let mut state = Self::from_saved(settings.unwrap_or_default(), jobs.unwrap_or_default());
        if corrupt {
            state.recovery_error =
                Some("云端本地状态区段无法读取，原始配置已保留；请恢复配置后重启云端功能".into());
        }
        state
    }

    /// 先保存下一份队列再发布内存；失败不会制造已持久化的假象。
    pub async fn update_jobs<T>(
        &self,
        store: &LocalStateStore,
        change: impl FnOnce(&mut Vec<StoredJob>) -> Result<T, String>,
    ) -> Result<T, String> {
        if let Some(error) = &self.recovery_error {
            return Err(error.clone());
        }
        let mut guard = self.jobs.lock().await;
        let mut next = guard.clone();
        let result = change(&mut next)?;
        store.set(UPLOAD_SECTION, &next).await?;
        *guard = next;
        Ok(result)
    }

    pub async fn observe(&self, id: &str, change: impl FnOnce(&mut Observation)) {
        change(
            self.observations
                .write()
                .await
                .entry(id.into())
                .or_default(),
        );
    }

    /// 旧连接的异步响应不得覆盖后来保存的新服务或新凭证身份。
    pub async fn publish_identity(
        &self,
        snapshot: &StoredSettings,
        identity: Identity,
    ) -> Result<(), String> {
        let current = self.settings.lock().await;
        if current.endpoint != snapshot.endpoint
            || current.protected_token != snapshot.protected_token
            || current.user_id != snapshot.user_id
        {
            return Err("云端连接已变化，请重新验证当前连接".into());
        }
        *self.identity.write().await = Some(identity);
        Ok(())
    }

    pub async fn interrupt(&self, id: Option<&str>) {
        if let Some((active, control)) = self.active.lock().await.as_ref() {
            if id.is_none_or(|id| id == active) {
                control.interrupt();
            }
        }
    }
}
