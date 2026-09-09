use std::{
    collections::BTreeMap,
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
};

use crate::{
    combat_log::parser::{parse_csv_fields, parse_timestamp},
    recording::model::{
        BossPull, RecordingPlayer, TimelineEvent, TimelineEventKind, TimelineOwner,
    },
};

const AFFILIATION_MINE: u64 = 0x1;
const REACTION_HOSTILE: u64 = 0x40;

fn log_path(log_file_id: &str) -> Option<PathBuf> {
    log_file_id
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

fn parse_flags(value: &str) -> Option<u64> {
    u64::from_str_radix(value.trim_start_matches("0x"), 16).ok()
}

fn player_identity(guid: &str, full_name: &str) -> Option<RecordingPlayer> {
    if !guid.starts_with("Player-") || full_name.is_empty() || full_name == "nil" {
        return None;
    }
    let parts = full_name.split('-').collect::<Vec<_>>();
    let (name, server_name) = if parts.len() >= 3 && parts.last() == Some(&"CN") {
        (
            parts[..parts.len() - 2].join("-"),
            Some(parts[parts.len() - 2].to_string()),
        )
    } else if parts.len() >= 2 {
        (
            parts[..parts.len() - 1].join("-"),
            Some(parts[parts.len() - 1].to_string()),
        )
    } else {
        (full_name.to_string(), None)
    };
    Some(RecordingPlayer {
        actor_id: None,
        guid: guid.to_string(),
        name,
        server_name,
        full_type: None,
    })
}

fn collect_players(
    fields: &[String],
    players: &mut BTreeMap<String, RecordingPlayer>,
) -> Option<String> {
    let mut local_player = None;
    for (guid_index, name_index, flags_index) in [(1, 2, 3), (5, 6, 7)] {
        let flags = fields
            .get(flags_index)
            .filter(|value| value.starts_with("0x"))
            .and_then(|value| parse_flags(value));
        let Some(flags) = flags else {
            continue;
        };
        let Some(player) = fields
            .get(guid_index)
            .zip(fields.get(name_index))
            .and_then(|(guid, name)| player_identity(guid, name))
        else {
            continue;
        };
        if flags & AFFILIATION_MINE != 0 {
            local_player = Some(player.name.clone());
        }
        players.entry(player.guid.clone()).or_insert(player);
    }
    local_player
}

fn parse_timeline_event(
    line: &str,
    anchor_year: i32,
    encounter_start_unix_ms: i64,
    encounter_end_unix_ms: i64,
) -> Result<Option<(TimelineEvent, bool)>, String> {
    let Some((timestamp, payload)) = line.split_once("  ") else {
        return Ok(None);
    };
    let fields = parse_csv_fields(payload).map_err(|error| error.to_string())?;
    let Some(event_name) = fields.first().map(String::as_str) else {
        return Ok(None);
    };
    if !matches!(event_name, "SPELL_CAST_START" | "SPELL_CAST_SUCCESS") {
        return Ok(None);
    }
    let source_guid = fields.get(1).map(String::as_str).unwrap_or_default();
    let source_name = fields.get(2).cloned().unwrap_or_default();
    let source_flags = fields
        .get(3)
        .and_then(|value| parse_flags(value))
        .unwrap_or(0);
    let is_player = source_guid.starts_with("Player-") && source_flags & AFFILIATION_MINE != 0;
    let is_boss = (source_guid.starts_with("Creature-") || source_guid.starts_with("Vehicle-"))
        && source_flags & REACTION_HOSTILE != 0;
    let owner = if is_player && event_name == "SPELL_CAST_SUCCESS" {
        TimelineOwner::Player
    } else if is_boss {
        TimelineOwner::Boss
    } else {
        return Ok(None);
    };
    let occurred_at_unix_ms =
        parse_timestamp(timestamp.trim(), anchor_year).map_err(|error| error.to_string())?;
    if occurred_at_unix_ms < encounter_start_unix_ms || occurred_at_unix_ms > encounter_end_unix_ms
    {
        return Ok(None);
    }
    let spell_id = fields
        .get(9)
        .and_then(|value| value.parse::<u32>().ok())
        .ok_or_else(|| "施法事件缺少有效 spellId".to_string())?;
    let spell_name = fields
        .get(10)
        .filter(|value| !value.is_empty())
        .cloned()
        .ok_or_else(|| "施法事件缺少技能名称".to_string())?;
    Ok(Some((
        TimelineEvent {
            pull_time_ms: occurred_at_unix_ms.saturating_sub(encounter_start_unix_ms) as u64,
            owner,
            kind: if event_name == "SPELL_CAST_START" {
                TimelineEventKind::CastStart
            } else {
                TimelineEventKind::CastSuccess
            },
            source_name,
            spell_id,
            spell_name,
        },
        is_player,
    )))
}

fn read_pull_log(pull: &BossPull, path: &Path) -> Result<String, String> {
    let end = pull
        .log_end_offset
        .ok_or_else(|| format!("Pull {} 尚无日志结束位置", pull.pull_id))?;
    let length = end
        .checked_sub(pull.log_start_offset)
        .ok_or_else(|| format!("Pull {} 的日志区间无效", pull.pull_id))?;
    let mut file = File::open(path)
        .map_err(|error| format!("打开 Pull {} 的 CombatLog 失败：{error}", pull.pull_id))?;
    file.seek(SeekFrom::Start(pull.log_start_offset))
        .map_err(|error| format!("定位 Pull {} 的 CombatLog 失败：{error}", pull.pull_id))?;
    let mut bytes = Vec::with_capacity(length as usize);
    file.take(length)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("读取 Pull {} 的 CombatLog 失败：{error}", pull.pull_id))?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

fn populate_timeline(pull: &mut BossPull, fallback_year: i32) -> Result<(), String> {
    let end = pull
        .encounter_end_unix_ms
        .ok_or_else(|| format!("Pull {} 尚未结束", pull.pull_id))?;
    let path = log_path(&pull.log_file_id)
        .ok_or_else(|| format!("Pull {} 的日志文件标识无效", pull.pull_id))?;
    let year = log_year(&path).unwrap_or(fallback_year);
    if year == 0 {
        return Err(format!("无法确定 Pull {} 的 CombatLog 年份", pull.pull_id));
    }
    let log = read_pull_log(pull, &path)?;
    let mut player_name = None;
    let mut players = BTreeMap::new();
    let mut events = Vec::new();
    for line in log.lines() {
        if let Some((_, payload)) = line.split_once("  ") {
            if let Ok(fields) = parse_csv_fields(payload) {
                if let Some(name) = collect_players(&fields, &mut players) {
                    player_name = Some(name);
                }
            }
        }
        match parse_timeline_event(line, year, pull.encounter_start_unix_ms, end) {
            Ok(Some((event, is_player))) => {
                if is_player && player_name.is_none() {
                    player_name = player_identity("Player-local", &event.source_name)
                        .map(|player| player.name);
                }
                events.push(event);
            }
            Ok(None) => {}
            Err(_) => {}
        }
    }
    pull.player_name = player_name;
    pull.players = players.into_values().collect();
    pull.timeline_events = events;
    pull.timeline_indexed = true;
    Ok(())
}

/// 为已完成且尚未建立事件索引的 Pull 读取真实 CombatLog 区间。
pub fn populate_missing_timelines(
    pulls: &mut [BossPull],
    fallback_year: i32,
) -> (Vec<String>, Vec<String>) {
    let mut updated_pull_ids = Vec::new();
    let mut diagnostics = Vec::new();
    for pull in pulls.iter_mut().filter(|pull| {
        (!pull.timeline_indexed
            || pull.players.iter().any(|player| {
                player.name.is_empty()
                    || player
                        .name
                        .chars()
                        .all(|character| character.is_ascii_digit())
            }))
            && pull.encounter_end_unix_ms.is_some()
            && pull.log_end_offset.is_some()
    }) {
        match populate_timeline(pull, fallback_year) {
            Ok(()) => updated_pull_ids.push(pull.pull_id.clone()),
            Err(error) => diagnostics.push(error),
        }
    }
    (updated_pull_ids, diagnostics)
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::{collect_players, parse_timeline_event, player_identity};
    use crate::combat_log::parser::parse_csv_fields;
    use crate::recording::model::{TimelineEventKind, TimelineOwner};

    #[test]
    fn parses_real_player_and_hostile_casts_on_pull_time() {
        let player = parse_timeline_event(
            "9/9/2026 21:39:11.3788  SPELL_CAST_SUCCESS,Player-729-06223A96,\"韩梦-罗宁-CN\",0x511,0x80000000,Creature-0-1,\"瘤根\",0x10a48,0x80000000,193455,\"眼镜蛇射击\",0x1",
            2026,
            1_788_961_150_647,
            1_788_961_170_759,
        )
        .unwrap()
        .unwrap()
        .0;
        assert_eq!(player.owner, TimelineOwner::Player);
        assert_eq!(player.kind, TimelineEventKind::CastSuccess);
        assert_eq!(player.pull_time_ms, 731);
        assert_eq!(player.spell_name, "眼镜蛇射击");

        let boss = parse_timeline_event(
            "9/9/2026 21:39:13.6298  SPELL_CAST_START,Creature-0-1,\"瘤根\",0x10a48,0x80000000,0000000000000000,nil,0x80000000,0x80000000,422026,\"苦难尖啸\",0x24",
            2026,
            1_788_961_150_647,
            1_788_961_170_759,
        )
        .unwrap()
        .unwrap()
        .0;
        assert_eq!(boss.owner, TimelineOwner::Boss);
        assert_eq!(boss.kind, TimelineEventKind::CastStart);
        assert_eq!(boss.pull_time_ms, 2_982);
    }

    #[test]
    fn splits_chinese_player_and_server_without_region_suffix() {
        let player = player_identity("Player-729-06223A96", "韩梦-罗宁-CN").unwrap();
        assert_eq!(player.name, "韩梦");
        assert_eq!(player.server_name.as_deref(), Some("罗宁"));
        assert_eq!(player.actor_id, None);
    }

    #[test]
    fn ignores_combatant_info_nonstandard_fields_when_collecting_players() {
        let fields =
            parse_csv_fields("COMBATANT_INFO,Player-729-06223A96,1,253,70,0,0,0,0,0").unwrap();
        let mut players = BTreeMap::new();

        assert_eq!(collect_players(&fields, &mut players), None);
        assert!(players.is_empty());
    }
}
