use std::{
    fs::{self, File},
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
    time::UNIX_EPOCH,
};

use crate::{
    combat_log::{
        model::{EncounterEnd, EncounterEvent, EncounterStart},
        parser::parse_encounter_line,
    },
    recording::importing::config::PROGRESS_BYTES,
};

pub struct LogEncounter {
    pub file_id: String,
    pub start: EncounterStart,
    pub end: EncounterEnd,
    pub start_offset: u64,
    pub end_offset: u64,
}

/// 旧版不带年份的日志使用文件名日期，无法确定时拒绝猜测。
fn year(path: &Path) -> Result<i32, String> {
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or("日志文件名无效")?;
    let date = name
        .strip_prefix("WoWCombatLog-")
        .and_then(|value| value.split('_').next())
        .ok_or("请选择 WoWCombatLog 日志")?;
    let value = date
        .get(4..6)
        .and_then(|value| value.parse::<i32>().ok())
        .ok_or("日志文件名缺少年份")?;
    Ok(if value >= 70 {
        1900 + value
    } else {
        2000 + value
    })
}

/// 所选日志每个只流式扫描一次来识别完整边界，事件重建另仅读取选中 Pull 区间。
pub fn scan(
    paths: &[PathBuf],
    cancelled: &AtomicBool,
    mut progress: impl FnMut(u64, &Path),
) -> Result<Vec<LogEncounter>, String> {
    let mut found = Vec::new();
    let mut total_read = 0;
    for path in paths {
        let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
        let created = metadata
            .created()
            .or_else(|_| metadata.modified())
            .map_err(|error| error.to_string())?
            .duration_since(UNIX_EPOCH)
            .map_err(|error| error.to_string())?
            .as_millis();
        let file_id = format!("{}#{created}", path.display());
        let mut reader = BufReader::new(File::open(path).map_err(|error| error.to_string())?);
        let mut bytes = Vec::new();
        let (mut offset, mut last_progress) = (0, 0);
        let mut active: Option<(EncounterStart, u64)> = None;
        let anchor_year = year(path)?;
        loop {
            if cancelled.load(Ordering::Relaxed) {
                return Err("导入已取消".into());
            }
            bytes.clear();
            let read = reader
                .read_until(b'\n', &mut bytes)
                .map_err(|error| error.to_string())?;
            if read == 0 {
                break;
            }
            let end_offset = offset + read as u64;
            if bytes.ends_with(b"\n")
                && bytes
                    .splitn(4, |value| *value == b' ')
                    .nth(3)
                    .is_some_and(|payload| payload.starts_with(b"ENCOUNTER_"))
            {
                let line = std::str::from_utf8(&bytes)
                    .map_err(|error| format!("日志边界不是 UTF-8：{error}"))?
                    .trim_end_matches(['\r', '\n']);
                match parse_encounter_line(line, anchor_year)
                    .map_err(|error| format!("{} 字节 {offset}：{error}", path.display()))?
                {
                    Some(EncounterEvent::Start(start)) => active = Some((start, offset)),
                    Some(EncounterEvent::End(end)) => {
                        if let Some((start, start_offset)) = active.take() {
                            if start.encounter_id == end.encounter_id
                                && start.difficulty_id == end.difficulty_id
                                && start.occurred_at_unix_ms <= end.occurred_at_unix_ms
                            {
                                found.push(LogEncounter {
                                    file_id: file_id.clone(),
                                    start,
                                    end,
                                    start_offset,
                                    end_offset,
                                });
                            }
                        }
                    }
                    None => {}
                }
            }
            offset = end_offset;
            if offset - last_progress >= PROGRESS_BYTES {
                progress(total_read + offset, path);
                last_progress = offset;
            }
        }
        total_read += offset;
        progress(total_read, path);
    }
    Ok(found)
}
