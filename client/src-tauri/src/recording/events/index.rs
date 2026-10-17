use std::{
    collections::BTreeMap,
    fs::File,
    io::{BufRead, BufReader, Read, Seek, SeekFrom},
    path::{Path, PathBuf},
};

use crate::recording::events::{actors::collect_players, parser::parse_event_for_actor};
use crate::{
    combat_log::model::LogLine, combat_log::parser::parse_csv_fields, recording::model::BossPull,
};

pub const TIMELINE_VERSION: u32 = 3;

fn log_path(file_id: &str) -> Option<PathBuf> {
    file_id
        .rsplit_once('#')
        .map(|(path, _)| PathBuf::from(path))
}

fn log_year(path: &Path) -> Option<i32> {
    let name = path.file_name()?.to_str()?;
    let date = name.strip_prefix("WoWCombatLog-")?.split('_').next()?;
    if date.len() != 6 {
        return None;
    }
    let year = date.get(4..6)?.parse::<i32>().ok()?;
    Some(if year >= 70 { 1900 + year } else { 2000 + year })
}

/// 增量记录当前 Pull 真实观测到的角色与关键事件；重复字节位置只保留一次。
pub fn append_line(pull: &mut BossPull, line: &LogLine, file_id: &str, year: i32) {
    if pull.log_file_id != file_id || line.start_offset < pull.log_start_offset {
        return;
    }
    if let Some((_, payload)) = line.text.split_once("  ") {
        if payload.contains("Player-") {
            if let Ok(fields) = parse_csv_fields(payload) {
                let mut players = pull
                    .players
                    .iter()
                    .map(|player| (player.guid.clone(), player.clone()))
                    .collect::<BTreeMap<_, _>>();
                if let Some(name) = collect_players(&fields, &mut players) {
                    if pull.recording_player_guid.is_none() {
                        pull.player_name = Some(name);
                    }
                }
                pull.players = players.into_values().collect();
            }
        }
    }
    let id = format!("{}:{}", pull.pull_id, line.start_offset);
    match parse_event_for_actor(
        &line.text,
        year,
        pull.encounter_start_unix_ms,
        pull.encounter_end_unix_ms.unwrap_or(i64::MAX),
        id,
        pull.recording_player_guid.as_deref(),
    ) {
        Ok(Some(event)) => {
            let newer_offset = pull
                .timeline_events
                .last()
                .and_then(|event| event.event_id.rsplit_once(':'))
                .and_then(|(_, offset)| offset.parse::<u64>().ok())
                .is_none_or(|offset| line.start_offset > offset);
            if newer_offset
                || !pull
                    .timeline_events
                    .iter()
                    .any(|existing| existing.event_id == event.event_id)
            {
                pull.timeline_events.push(event);
                pull.event_generation = pull.event_generation.wrapping_add(1);
            }
        }
        Ok(None) => {}
        Err(_) => pull.timeline_parse_errors = pull.timeline_parse_errors.saturating_add(1),
    }
}

/// 只扫描一个 Pull 的字节区间，保留原始偏移作为事件身份，不重复扫描整个日志。
fn rebuild(pull: &BossPull, fallback_year: i32, end_offset: u64) -> Result<BossPull, String> {
    let path = log_path(&pull.log_file_id).ok_or("录像日志文件标识无效")?;
    let year = log_year(&path).unwrap_or(fallback_year);
    if year == 0 {
        return Err(format!("Pull {} 无法确定日志年份", pull.pull_id));
    }
    let length = end_offset
        .checked_sub(pull.log_start_offset)
        .ok_or("录像日志字节区间无效")?;
    let mut file = File::open(&path)
        .map_err(|error| format!("打开 Pull {} 日志失败：{error}", pull.pull_id))?;
    if file.metadata().map_err(|error| error.to_string())?.len() < end_offset {
        return Err(format!(
            "Pull {} 原始日志已截断，保留现有索引",
            pull.pull_id
        ));
    }
    file.seek(SeekFrom::Start(pull.log_start_offset))
        .map_err(|error| error.to_string())?;
    let mut reader = BufReader::new(file.take(length));
    let mut offset = pull.log_start_offset;
    let mut bytes = Vec::new();
    let mut rebuilt = pull.clone();
    rebuilt.timeline_events.clear();
    rebuilt.players.clear();
    rebuilt.player_name = None;
    rebuilt.timeline_parse_errors = 0;
    loop {
        bytes.clear();
        let read = reader
            .read_until(b'\n', &mut bytes)
            .map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        let line = LogLine {
            text: String::from_utf8_lossy(&bytes)
                .trim_end_matches(['\r', '\n'])
                .to_string(),
            start_offset: offset,
            end_offset: offset + read as u64,
        };
        append_line(&mut rebuilt, &line, &pull.log_file_id, year);
        offset += read as u64;
    }
    rebuilt
        .timeline_events
        .sort_by_key(|event| event.pull_time_ms);
    if let Some(guid) = &rebuilt.recording_player_guid {
        rebuilt.player_name = rebuilt
            .players
            .iter()
            .find(|player| &player.guid == guid)
            .map(|player| player.name.clone());
    }
    rebuilt.timeline_version = TIMELINE_VERSION;
    rebuilt.timeline_indexed = pull.encounter_end_unix_ms.is_some();
    rebuilt.event_generation = rebuilt.event_generation.wrapping_add(1);
    Ok(rebuilt)
}

/// 结束后的完整索引覆盖活动期快照；旧日志不可用时保留原有事件。
pub fn populate_missing_timelines(
    pulls: &mut [BossPull],
    fallback_year: i32,
) -> (Vec<String>, Vec<String>) {
    let mut changed = Vec::new();
    let mut errors = Vec::new();
    for pull in pulls
        .iter_mut()
        .filter(|pull| !pull.timeline_indexed || pull.timeline_version < TIMELINE_VERSION)
    {
        if pull.encounter_end_unix_ms.is_none() {
            continue;
        }
        let Some(end) = pull.log_end_offset else {
            continue;
        };
        match rebuild(pull, fallback_year, end) {
            Ok(rebuilt) => {
                changed.push(pull.pull_id.clone());
                *pull = rebuilt;
            }
            Err(error) => errors.push(error),
        }
    }
    (changed, errors)
}

/// 从已持久化的日志游标恢复活动期事件，不把瞬时媒体状态从磁盘恢复为运行中。
pub fn restore_active(pull: &mut BossPull, file_id: &str, end_offset: u64) -> Result<(), String> {
    if pull.log_file_id != file_id {
        return Ok(());
    }
    *pull = rebuild(pull, 0, end_offset)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{append_line, populate_missing_timelines, TIMELINE_VERSION};
    use crate::{combat_log::model::LogLine, recording::model::BossPull};

    #[test]
    fn repeated_poll_does_not_duplicate_events_and_byte_offsets_preserve_equal_timestamps() {
        let mut pull: BossPull = serde_json::from_value(serde_json::json!({
            "pullId":"pull", "encounterId":1,"encounterName":"测试","difficultyId":16,"groupSize":20,
            "encounterStartUnixMs":0,"clipStartUnixMs":0,"logFileId":"file","logStartOffset":0,
            "state":"recording"
        })).unwrap();
        let mut line = LogLine { text: "9/9/2026 21:39:11.000  SPELL_CAST_SUCCESS,Player-1,\"本人\",0x511,0,Creature-1,\"敌人\",0x40,0,17,\"盾\",2".into(), start_offset: 100, end_offset: 200 };
        append_line(&mut pull, &line, "file", 2026);
        append_line(&mut pull, &line, "file", 2026);
        line.start_offset = 200;
        append_line(&mut pull, &line, "file", 2026);
        assert_eq!(pull.timeline_events.len(), 2);
        assert_ne!(
            pull.timeline_events[0].event_id,
            pull.timeline_events[1].event_id
        );
    }

    #[test]
    fn missing_log_keeps_existing_events_instead_of_marking_a_complete_empty_index() {
        let mut pull: BossPull = serde_json::from_value(serde_json::json!({
            "pullId":"pull", "encounterId":1,"encounterName":"测试","difficultyId":16,"groupSize":20,
            "encounterStartUnixMs":0,"encounterEndUnixMs":10,"clipStartUnixMs":0,
            "logFileId":"missing#0","logStartOffset":0,"logEndOffset":10,"state":"ready"
        })).unwrap();
        let (_, errors) = populate_missing_timelines(std::slice::from_mut(&mut pull), 2026);
        assert_eq!(errors.len(), 1);
        assert!(pull.timeline_version < TIMELINE_VERSION);
        assert!(!pull.timeline_indexed);
    }

    #[test]
    fn old_completed_index_rebuilds_new_event_kinds_once_without_changing_source_or_ids() {
        use std::fs;
        let root = std::env::temp_dir().join(format!("wow-events-v3-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("WoWCombatLog-101626_200443.txt");
        let prefix = "10/16/2026 20:12:53.000  ";
        let lines = [
            "SPELL_CAST_SUCCESS,Player-1,\"本人\",0x511,0,Player-1,\"本人\",0x511,0,17,\"盾\",2",
            "SPELL_AURA_REFRESH,Player-1,\"本人\",0x511,0,Player-1,\"本人\",0x511,0,17,\"盾\",2,BUFF",
            "SPELL_EMPOWER_END,Player-1,\"本人\",0x511,0,0000000000000000,nil,0x80000000,0,357208,\"火焰吐息\",4,3",
            "SPELL_RESURRECT,Player-2,\"队友\",0x512,0,Player-1,\"本人\",0x511,0,20484,\"复生\",8",
        ].map(|payload| format!("{prefix}{payload}\n")).concat();
        fs::write(&path, &lines).unwrap();
        let before = fs::metadata(&path).unwrap();
        let start =
            crate::combat_log::parser::parse_timestamp("10/16/2026 20:12:53.000", 2026).unwrap();
        let mut pull: BossPull = serde_json::from_value(serde_json::json!({
            "pullId":"migration","encounterId":1,"encounterName":"测试","difficultyId":16,"groupSize":20,
            "encounterStartUnixMs":start,"encounterEndUnixMs":start+1000,"clipStartUnixMs":start,
            "logFileId":format!("{}#fixture",path.display()),"logStartOffset":0,"logEndOffset":lines.len(),
            "state":"ready","timelineVersion":2,"timelineIndexed":true,
            "timelineEvents":[{"eventId":"migration:0","pullTimeMs":0,"owner":"player","kind":"castSuccess",
                "sourceName":"本人","spellId":17,"spellName":"盾"}]
        })).unwrap();
        assert_eq!(pull.timeline_events[0].empower_level, None);
        let (changed, errors) = populate_missing_timelines(std::slice::from_mut(&mut pull), 2026);
        assert_eq!(changed, ["migration"]);
        assert!(errors.is_empty());
        assert_eq!(pull.timeline_events.len(), 4);
        assert_eq!(pull.timeline_events[0].event_id, "migration:0");
        assert_eq!(pull.timeline_events[2].empower_level, Some(3));
        assert_eq!(pull.timeline_version, TIMELINE_VERSION);
        assert_eq!(pull.timeline_parse_errors, 0);
        let (changed, errors) = populate_missing_timelines(std::slice::from_mut(&mut pull), 2026);
        assert!(changed.is_empty() && errors.is_empty());
        assert_eq!(fs::read_to_string(&path).unwrap(), lines);
        assert_eq!(
            fs::metadata(&path).unwrap().modified().unwrap(),
            before.modified().unwrap()
        );
        fs::remove_dir_all(root).unwrap();
    }
}
