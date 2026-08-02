use std::{collections::HashMap, path::PathBuf};

use serde::{de::DeserializeOwned, Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tokio::sync::Mutex;

const LOCAL_STATE_VERSION: u32 = 1;
const LOCAL_STATE_FILE: &str = "client-state.json";

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalStateFile {
    schema_version: u32,
    #[serde(default)]
    sections: HashMap<String, serde_json::Value>,
}

impl Default for LocalStateFile {
    fn default() -> Self {
        Self {
            schema_version: LOCAL_STATE_VERSION,
            sections: HashMap::new(),
        }
    }
}

/// 在 Rust 后端统一维护客户端可持久化状态，并按业务区段写入 JSON。
pub struct LocalStateStore {
    path: PathBuf,
    value: Mutex<LocalStateFile>,
}

impl LocalStateStore {
    /// 从应用配置目录加载本地状态，不存在时创建空状态容器。
    pub fn load(app: &AppHandle) -> Result<Self, String> {
        let directory = app
            .path()
            .app_config_dir()
            .map_err(|error| format!("无法定位客户端配置目录：{error}"))?;
        std::fs::create_dir_all(&directory)
            .map_err(|error| format!("创建客户端配置目录失败：{error}"))?;
        let path = directory.join(LOCAL_STATE_FILE);
        let value = if path.is_file() {
            let bytes =
                std::fs::read(&path).map_err(|error| format!("读取客户端本地状态失败：{error}"))?;
            // 缓存损坏不能阻止客户端启动，下一次有效状态会覆盖它。
            serde_json::from_slice(&bytes).unwrap_or_default()
        } else {
            LocalStateFile::default()
        };
        Ok(Self {
            path,
            value: Mutex::new(value),
        })
    }

    /// 读取指定业务区段，不存在时返回空值。
    pub async fn get<T: DeserializeOwned>(&self, section: &str) -> Result<Option<T>, String> {
        let guard = self.value.lock().await;
        guard
            .sections
            .get(section)
            .cloned()
            .map(serde_json::from_value)
            .transpose()
            .map_err(|error| format!("解析本地状态区段 {section} 失败：{error}"))
    }

    /// 串行更新指定业务区段，并在返回前写入本地配置文件。
    pub async fn set<T: Serialize>(&self, section: &str, value: &T) -> Result<(), String> {
        let serialized = serde_json::to_value(value)
            .map_err(|error| format!("序列化本地状态区段 {section} 失败：{error}"))?;
        let mut guard = self.value.lock().await;
        if guard.sections.get(section) == Some(&serialized) {
            return Ok(());
        }
        guard.sections.insert(section.to_string(), serialized);
        let bytes = serde_json::to_vec_pretty(&*guard)
            .map_err(|error| format!("序列化客户端本地状态失败：{error}"))?;
        tokio::fs::write(&self.path, bytes)
            .await
            .map_err(|error| format!("保存客户端本地状态失败：{error}"))
    }
}
