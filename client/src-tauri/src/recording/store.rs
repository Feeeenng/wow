use std::{
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

use crate::{
    recording::model::{RecordingIndex, RECORDING_INDEX_VERSION},
    storage::replace_file,
};

/// 负责录制业务索引的校验加载与原子写入。
pub struct RecordingStore {
    path: PathBuf,
}

impl RecordingStore {
    /// 为指定应用数据路径创建业务索引存储。
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    /// 加载索引；损坏文件会被保留并返回错误。
    pub async fn load(&self) -> Result<RecordingIndex, String> {
        if !self.path.is_file() {
            return Ok(RecordingIndex::default());
        }
        let bytes = tokio::fs::read(&self.path)
            .await
            .map_err(|error| format!("读取录制业务索引失败：{error}"))?;
        match serde_json::from_slice::<RecordingIndex>(&bytes) {
            Ok(index) if index.schema_version == RECORDING_INDEX_VERSION => Ok(index),
            Ok(mut index) if index.schema_version == 1 => {
                // 旧映射没有媒体包校准；保留原始索引，不能为缺片记录补造有效区间。
                let mut backup = self.path.with_file_name("recording-index.v1.json");
                if backup.exists() {
                    backup = self.path.with_file_name(format!(
                        "recording-index.v1-{}.json",
                        uuid::Uuid::new_v4()
                    ));
                }
                tokio::fs::write(&backup, &bytes)
                    .await
                    .map_err(|error| format!("保留旧版录制索引失败：{error}"))?;
                index.schema_version = RECORDING_INDEX_VERSION;
                self.save(&index).await?;
                Ok(index)
            }
            Ok(index) => Err(format!("不支持录制业务索引版本 {}", index.schema_version)),
            Err(error) => {
                let timestamp = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis();
                let corrupt = self
                    .path
                    .with_file_name(format!("recording-index.corrupt-{timestamp}.json"));
                tokio::fs::rename(&self.path, &corrupt)
                    .await
                    .map_err(|rename_error| {
                        format!("录制业务索引损坏且无法保留：{error}；{rename_error}")
                    })?;
                Err(format!(
                    "录制业务索引损坏，原文件已保留为 {}：{error}",
                    corrupt.display()
                ))
            }
        }
    }

    /// 在同目录写入临时文件并原子替换正式索引。
    pub async fn save(&self, index: &RecordingIndex) -> Result<(), String> {
        let parent = self
            .path
            .parent()
            .ok_or_else(|| "录制业务索引缺少父目录".to_string())?;
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|error| format!("创建录制业务目录失败：{error}"))?;
        let temporary = self.path.with_extension("json.tmp");
        let bytes = serde_json::to_vec_pretty(index)
            .map_err(|error| format!("序列化录制业务索引失败：{error}"))?;
        tokio::fs::write(&temporary, bytes)
            .await
            .map_err(|error| format!("写入录制业务临时索引失败：{error}"))?;
        replace_file(&temporary, &self.path)
            .map_err(|error| format!("替换录制业务索引失败：{error}"))
    }
}

#[cfg(test)]
mod tests {
    use std::{fs, path::PathBuf};

    use crate::recording::model::RecordingIndex;

    use super::RecordingStore;

    fn temporary_index() -> PathBuf {
        std::env::temp_dir()
            .join(format!("wow-recorder-store-{}", uuid::Uuid::new_v4()))
            .join("recording-index.json")
    }

    #[test]
    fn saves_and_loads_versioned_index() {
        tauri::async_runtime::block_on(async {
            let path = temporary_index();
            let store = RecordingStore::new(path.clone());
            let index = RecordingIndex::default();

            store.save(&index).await.unwrap();
            assert_eq!(store.load().await.unwrap(), index);
            assert!(!path.with_extension("json.tmp").exists());
            fs::remove_dir_all(path.parent().unwrap()).unwrap();
        });
    }

    #[test]
    fn migrates_v1_without_losing_the_original_index() {
        tauri::async_runtime::block_on(async {
            let path = temporary_index();
            let store = RecordingStore::new(path.clone());
            let mut old = RecordingIndex::default();
            old.schema_version = 1;
            store.save(&old).await.unwrap();
            let original = fs::read(&path).unwrap();

            let migrated = store.load().await.unwrap();

            assert_eq!(migrated.schema_version, 2);
            assert_eq!(
                fs::read(path.with_file_name("recording-index.v1.json")).unwrap(),
                original
            );
            assert_eq!(store.load().await.unwrap(), migrated);
            fs::remove_dir_all(path.parent().unwrap()).unwrap();
        });
    }

    #[test]
    fn preserves_corrupt_index() {
        tauri::async_runtime::block_on(async {
            let path = temporary_index();
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(&path, b"not json").unwrap();
            let store = RecordingStore::new(path.clone());

            assert!(store.load().await.is_err());
            assert!(!path.exists());
            assert_eq!(
                fs::read_dir(path.parent().unwrap())
                    .unwrap()
                    .filter_map(Result::ok)
                    .filter(|entry| entry.file_name().to_string_lossy().contains("corrupt"))
                    .count(),
                1
            );
            fs::remove_dir_all(path.parent().unwrap()).unwrap();
        });
    }
}
