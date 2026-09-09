use std::{path::{Path, PathBuf}, time::{SystemTime, UNIX_EPOCH}};

use crate::recording::model::{RecordingIndex, RECORDING_INDEX_VERSION};

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
            Ok(index) => Err(format!(
                "不支持录制业务索引版本 {}",
                index.schema_version
            )),
            Err(error) => {
                let timestamp = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis();
                let corrupt = self.path.with_file_name(format!(
                    "recording-index.corrupt-{timestamp}.json"
                ));
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

#[cfg(windows)]
fn replace_file(source: &Path, destination: &Path) -> std::io::Result<()> {
    use std::{ffi::OsStr, os::windows::ffi::OsStrExt};

    const MOVEFILE_REPLACE_EXISTING: u32 = 0x1;
    const MOVEFILE_WRITE_THROUGH: u32 = 0x8;
    #[link(name = "Kernel32")]
    extern "system" {
        fn MoveFileExW(existing: *const u16, new: *const u16, flags: u32) -> i32;
    }
    fn wide(value: &OsStr) -> Vec<u16> {
        value.encode_wide().chain(Some(0)).collect()
    }
    let source = wide(source.as_os_str());
    let destination = wide(destination.as_os_str());
    let result = unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn replace_file(source: &Path, destination: &Path) -> std::io::Result<()> {
    std::fs::rename(source, destination)
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
