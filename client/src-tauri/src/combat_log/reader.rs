use std::{
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

use tokio::io::{AsyncReadExt, AsyncSeekExt};

use crate::combat_log::model::{CombatLogCursor, CombatLogFileIdentity, LogLine};

/// 按持久化字节游标读取 CombatLog 新增的完整行。
#[derive(Default)]
pub struct CombatLogReader {
    cursor: CombatLogCursor,
}

impl CombatLogReader {
    /// 使用已有游标恢复日志读取。
    pub fn from_cursor(cursor: CombatLogCursor) -> Self {
        Self { cursor }
    }

    /// 返回当前游标快照，供录制业务索引持久化。
    pub fn cursor(&self) -> &CombatLogCursor {
        &self.cursor
    }

    /// 首次启用监控时从现有文件末尾开始，避免重放历史 Boss 战。
    pub async fn follow_from_end(&mut self, path: &Path) -> Result<(), String> {
        let canonical_path = tokio::fs::canonicalize(path)
            .await
            .map_err(|error| format!("定位 CombatLog 文件失败：{error}"))?;
        let metadata = tokio::fs::metadata(&canonical_path)
            .await
            .map_err(|error| format!("读取 CombatLog 文件状态失败：{error}"))?;
        let created_at_unix_ms = metadata
            .created()
            .unwrap_or(SystemTime::UNIX_EPOCH)
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        self.cursor = CombatLogCursor {
            file: Some(CombatLogFileIdentity {
                canonical_path: canonical_path.to_string_lossy().into_owned(),
                created_at_unix_ms,
            }),
            byte_offset: metadata.len(),
            incomplete_tail: Vec::new(),
        };
        Ok(())
    }

    /// 从文件上次位置读取新增字节，只返回换行结束的完整日志行。
    pub async fn poll(&mut self, path: &Path) -> Result<Vec<LogLine>, String> {
        let canonical_path = tokio::fs::canonicalize(path)
            .await
            .map_err(|error| format!("定位 CombatLog 文件失败：{error}"))?;
        let metadata = tokio::fs::metadata(&canonical_path)
            .await
            .map_err(|error| format!("读取 CombatLog 文件状态失败：{error}"))?;
        let created_at_unix_ms = metadata
            .created()
            .unwrap_or(SystemTime::UNIX_EPOCH)
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        let identity = CombatLogFileIdentity {
            canonical_path: canonical_path.to_string_lossy().into_owned(),
            created_at_unix_ms,
        };
        if self.cursor.file.as_ref() != Some(&identity) || metadata.len() < self.cursor.byte_offset
        {
            self.cursor = CombatLogCursor {
                file: Some(identity.clone()),
                ..CombatLogCursor::default()
            };
        }

        let previous_offset = self.cursor.byte_offset;
        let mut file = tokio::fs::File::open(&canonical_path)
            .await
            .map_err(|error| format!("打开 CombatLog 文件失败：{error}"))?;
        file.seek(std::io::SeekFrom::Start(previous_offset))
            .await
            .map_err(|error| format!("定位 CombatLog 读取位置失败：{error}"))?;
        let mut appended = Vec::new();
        file.read_to_end(&mut appended)
            .await
            .map_err(|error| format!("读取 CombatLog 新增内容失败：{error}"))?;
        self.cursor.byte_offset = previous_offset + appended.len() as u64;
        self.cursor.file = Some(identity);

        let tail_length = self.cursor.incomplete_tail.len() as u64;
        let combined_start = previous_offset.saturating_sub(tail_length);
        let mut combined = std::mem::take(&mut self.cursor.incomplete_tail);
        combined.extend_from_slice(&appended);
        let mut lines = Vec::new();
        let mut line_start = 0usize;
        for (index, byte) in combined.iter().enumerate() {
            if *byte != b'\n' {
                continue;
            }
            let mut content = &combined[line_start..index];
            if content.last() == Some(&b'\r') {
                content = &content[..content.len() - 1];
            }
            let text = std::str::from_utf8(content)
                .map_err(|error| format!("CombatLog 包含无效 UTF-8：{error}"))?
                .to_string();
            lines.push(LogLine {
                text,
                start_offset: combined_start + line_start as u64,
                end_offset: combined_start + index as u64 + 1,
            });
            line_start = index + 1;
        }
        self.cursor.incomplete_tail = combined[line_start..].to_vec();
        Ok(lines)
    }
}

#[cfg(test)]
mod tests {
    use std::{fs, io::Write, path::PathBuf};

    use super::CombatLogReader;

    fn temporary_log(name: &str) -> PathBuf {
        let directory = std::env::temp_dir().join(format!("wow-recorder-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&directory).unwrap();
        directory.join(name)
    }

    #[test]
    fn retains_incomplete_tail_until_next_poll() {
        tauri::async_runtime::block_on(async {
            let path = temporary_log("WoWCombatLog-test.txt");
            fs::write(&path, b"first\nsecond").unwrap();
            let mut reader = CombatLogReader::default();

            let first = reader.poll(&path).await.unwrap();
            assert_eq!(
                first
                    .iter()
                    .map(|line| line.text.as_str())
                    .collect::<Vec<_>>(),
                ["first"]
            );

            fs::OpenOptions::new()
                .append(true)
                .open(&path)
                .unwrap()
                .write_all(b" line\n")
                .unwrap();
            let second = reader.poll(&path).await.unwrap();
            assert_eq!(
                second
                    .iter()
                    .map(|line| line.text.as_str())
                    .collect::<Vec<_>>(),
                ["second line"]
            );
            assert!(reader.poll(&path).await.unwrap().is_empty());
            fs::remove_dir_all(path.parent().unwrap()).unwrap();
        });
    }

    #[test]
    fn resets_cursor_after_file_truncation() {
        tauri::async_runtime::block_on(async {
            let path = temporary_log("WoWCombatLog-test.txt");
            fs::write(&path, b"old line\n").unwrap();
            let mut reader = CombatLogReader::default();
            assert_eq!(reader.poll(&path).await.unwrap().len(), 1);

            fs::write(&path, b"new\n").unwrap();
            let lines = reader.poll(&path).await.unwrap();
            assert_eq!(
                lines
                    .iter()
                    .map(|line| line.text.as_str())
                    .collect::<Vec<_>>(),
                ["new"]
            );
            fs::remove_dir_all(path.parent().unwrap()).unwrap();
        });
    }

    #[test]
    fn follows_existing_file_from_end() {
        tauri::async_runtime::block_on(async {
            let path = temporary_log("WoWCombatLog-test.txt");
            fs::write(&path, b"historical\n").unwrap();
            let mut reader = CombatLogReader::default();

            reader.follow_from_end(&path).await.unwrap();
            assert!(reader.poll(&path).await.unwrap().is_empty());
            fs::OpenOptions::new()
                .append(true)
                .open(&path)
                .unwrap()
                .write_all(b"new\n")
                .unwrap();
            let lines = reader.poll(&path).await.unwrap();
            assert_eq!(
                lines
                    .iter()
                    .map(|line| line.text.as_str())
                    .collect::<Vec<_>>(),
                ["new"]
            );
            fs::remove_dir_all(path.parent().unwrap()).unwrap();
        });
    }
}
