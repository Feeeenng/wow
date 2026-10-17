use crate::{
    combat_log::parser::{parse_csv_fields, parse_timestamp},
    recording::model::{TimelineEvent, TimelineEventKind as Kind, TimelineOwner},
};

const AFFILIATION_MINE: u64 = 0x1;
const AFFILIATION_GROUP: u64 = 0x7;
const REACTION_HOSTILE: u64 = 0x40;

/// 仅识别已支持的关键事件，其他行不当作解析失败。
pub fn is_timeline_line(line: &str) -> bool {
    line.split_once("  ")
        .and_then(|(_, payload)| payload.split(',').next())
        .is_some_and(|event| {
            matches!(
                event,
                "SPELL_CAST_START"
                    | "SPELL_CAST_SUCCESS"
                    | "SPELL_EMPOWER_START"
                    | "SPELL_EMPOWER_END"
                    | "SPELL_EMPOWER_INTERRUPT"
                    | "SPELL_RESURRECT"
                    | "UNIT_DIED"
                    | "SPELL_AURA_APPLIED"
                    | "SPELL_AURA_REMOVED"
                    | "SPELL_AURA_REFRESH"
                    | "SPELL_AURA_APPLIED_DOSE"
                    | "SPELL_AURA_REMOVED_DOSE"
                    | "SPELL_INTERRUPT"
                    | "SPELL_DISPEL"
            )
        })
}

pub(crate) fn parse_flags(value: &str) -> Option<u64> {
    u64::from_str_radix(value.trim_start_matches("0x"), 16).ok()
}

/// 按事件各自布局读取字段，以角色 GUID 保留来源和目标，不猜测死亡原因。
#[cfg(test)]
pub fn parse_event(
    line: &str,
    year: i32,
    pull_start: i64,
    pull_end: i64,
    event_id: String,
) -> Result<Option<TimelineEvent>, String> {
    parse_event_for_actor(line, year, pull_start, pull_end, event_id, None)
}

/// 外部录像按观看者 GUID 判断本人，保留日志原始敌对阵营语义。
pub(crate) fn parse_event_for_actor(
    line: &str,
    year: i32,
    pull_start: i64,
    pull_end: i64,
    event_id: String,
    recording_player_guid: Option<&str>,
) -> Result<Option<TimelineEvent>, String> {
    if !is_timeline_line(line) {
        return Ok(None);
    }
    let (timestamp, payload) = line.split_once("  ").ok_or("事件缺少时间")?;
    let fields = parse_csv_fields(payload).map_err(|error| error.to_string())?;
    let event = fields.first().map(String::as_str).ok_or("事件类型为空")?;
    let text = |index| fields.get(index).map(String::as_str).unwrap_or("");
    let number = |index| text(index).parse::<u32>().ok();
    let source_flags = parse_flags(text(3)).unwrap_or(0);
    let target_flags = parse_flags(text(7)).unwrap_or(0);
    let source_group = text(1).starts_with("Player-") && source_flags & AFFILIATION_GROUP != 0;
    let target_group = text(5).starts_with("Player-") && target_flags & AFFILIATION_GROUP != 0;
    let hostile = (text(1).starts_with("Creature-") || text(1).starts_with("Vehicle-"))
        && source_flags & REACTION_HOSTILE != 0;
    let aura = event.starts_with("SPELL_AURA_");
    let death = event == "UNIT_DIED";
    let resurrect = event == "SPELL_RESURRECT";
    if (death || resurrect) && !target_group {
        return Ok(None);
    }
    if !death && !source_group && !target_group && !hostile {
        return Ok(None);
    }
    // 受影响者决定光环／死亡／复活归属，不能把敌方施加的减益列为敌方个人状态。
    let uses_target = death || aura || resurrect;
    let own_event = if let Some(guid) = recording_player_guid {
        text(if uses_target { 5 } else { 1 }) == guid
    } else if uses_target {
        target_flags & AFFILIATION_MINE != 0
    } else {
        source_flags & AFFILIATION_MINE != 0
    };
    let classified_hostile = if uses_target {
        (text(5).starts_with("Creature-") || text(5).starts_with("Vehicle-"))
            && target_flags & REACTION_HOSTILE != 0
    } else {
        hostile
    };
    let owner = if own_event {
        TimelineOwner::Player
    } else if classified_hostile {
        TimelineOwner::Boss
    } else {
        TimelineOwner::Team
    };
    let kind = match event {
        "SPELL_CAST_START" => Kind::CastStart,
        "SPELL_CAST_SUCCESS" => Kind::CastSuccess,
        "SPELL_EMPOWER_START" => Kind::EmpowerStart,
        "SPELL_EMPOWER_END" => Kind::EmpowerEnd,
        "SPELL_EMPOWER_INTERRUPT" => Kind::EmpowerInterrupt,
        "SPELL_RESURRECT" => Kind::Resurrect,
        "UNIT_DIED" => Kind::Death,
        "SPELL_INTERRUPT" => Kind::Interrupt,
        "SPELL_DISPEL" => Kind::Dispel,
        _ => {
            let buff = match text(12) {
                "BUFF" => true,
                "DEBUFF" => false,
                _ => return Err("光环事件缺少 BUFF/DEBUFF 类型".to_string()),
            };
            match (event, buff) {
                ("SPELL_AURA_APPLIED", true) => Kind::BuffApply,
                ("SPELL_AURA_REMOVED", true) => Kind::BuffRemove,
                ("SPELL_AURA_REFRESH", true) => Kind::BuffRefresh,
                ("SPELL_AURA_APPLIED", false) => Kind::DebuffApply,
                ("SPELL_AURA_REMOVED", false) => Kind::DebuffRemove,
                ("SPELL_AURA_REFRESH", false) => Kind::DebuffRefresh,
                (_, true) => Kind::BuffStack,
                (_, false) => Kind::DebuffStack,
            }
        }
    };
    let occurred = parse_timestamp(timestamp.trim(), year).map_err(|error| error.to_string())?;
    if occurred < pull_start || occurred > pull_end {
        return Ok(None);
    }
    let spell_id = if death {
        0
    } else {
        number(9).ok_or("技能事件缺少有效 spellId")?
    };
    let spell_name = if death { "死亡" } else { text(10) };
    if spell_name.is_empty() {
        return Err("技能事件缺少名称".to_string());
    }
    let extra_spell_id = if matches!(event, "SPELL_INTERRUPT" | "SPELL_DISPEL") {
        Some(number(12).ok_or("打断或驱散事件缺少关联技能")?)
    } else {
        None
    };
    Ok(Some(TimelineEvent {
        event_id,
        pull_time_ms: (occurred - pull_start) as u64,
        owner,
        kind,
        source_name: text(2).to_string(),
        source_guid: text(1).to_string(),
        target_guid: text(5).to_string(),
        target_name: text(6).to_string(),
        spell_id,
        spell_name: spell_name.to_string(),
        extra_spell_id,
        empower_level: if matches!(event, "SPELL_EMPOWER_END" | "SPELL_EMPOWER_INTERRUPT") {
            Some(number(12).ok_or("蓄力结束或中断事件缺少有效等级")?)
        } else {
            None
        },
        stack_count: if event.ends_with("_DOSE") {
            Some(number(13).ok_or("叠层事件缺少层数")?)
        } else {
            None
        },
    }))
}

#[cfg(test)]
mod tests {
    use super::{parse_event, parse_event_for_actor};
    use crate::recording::model::{TimelineEventKind, TimelineOwner};

    fn parse(payload: &str) -> crate::recording::model::TimelineEvent {
        parse_event(
            &format!("9/9/2026 21:39:11.000  {payload}"),
            2026,
            0,
            i64::MAX,
            "event-1".into(),
        )
        .unwrap()
        .unwrap()
    }

    #[test]
    fn aura_stack_keeps_target_identity_and_same_timestamp_events() {
        let event = parse("SPELL_AURA_APPLIED_DOSE,Creature-1,\"敌人\",0x40,0,Player-1,\"本人\",0x511,0,123,\"减益\",1,DEBUFF,3");
        assert_eq!(event.kind, TimelineEventKind::DebuffStack);
        assert_eq!(event.owner, TimelineOwner::Player);
        assert_eq!(event.stack_count, Some(3));
        assert_eq!(event.target_guid, "Player-1");
    }

    #[test]
    fn death_has_no_invented_killing_spell() {
        let event = parse("UNIT_DIED,0000000000000000,nil,0,0,Player-2,\"团员\",0x512,0");
        assert_eq!(event.kind, TimelineEventKind::Death);
        assert_eq!(event.spell_id, 0);
        assert_eq!(event.owner, TimelineOwner::Team);
        assert_eq!(event.target_name, "团员");
    }

    #[test]
    fn interrupt_and_dispel_read_extra_spell_from_their_own_layout() {
        let event = parse("SPELL_INTERRUPT,Player-1,\"本人\",0x511,0,Creature-1,\"敌人\",0x40,0,1766,\"脚踢\",1,123,\"读条\",4");
        assert_eq!(event.kind, TimelineEventKind::Interrupt);
        assert_eq!(event.extra_spell_id, Some(123));
        assert!(parse_event("9/9/2026 21:39:11.000  SPELL_AURA_APPLIED,Player-1,\"本人\",0x511,0,Player-2,\"团员\",0x512,0,17,\"盾\",2",2026,0,i64::MAX,"bad".into()).is_err());
    }

    #[test]
    fn aura_refresh_preserves_type_and_classifies_the_affected_actor() {
        let friend = parse("SPELL_AURA_REFRESH,Creature-1,\"敌人\",0x40,0,Player-2,\"团员\",0x512,0,123,\"减益\",1,DEBUFF");
        assert_eq!(friend.kind, TimelineEventKind::DebuffRefresh);
        assert_eq!(friend.owner, TimelineOwner::Team);
        assert_eq!(friend.stack_count, None);
        let boss = parse("SPELL_AURA_REFRESH,Player-1,\"本人\",0x511,0,Creature-1,\"敌人\",0x40,0,123,\"减益\",1,DEBUFF");
        assert_eq!(boss.owner, TimelineOwner::Boss);
        let buff = parse("SPELL_AURA_REFRESH,Player-2,\"团员\",0x512,0,Player-1,\"本人\",0x511,0,17,\"盾\",2,BUFF");
        assert_eq!(buff.kind, TimelineEventKind::BuffRefresh);
        assert_eq!(buff.owner, TimelineOwner::Player);
    }

    #[test]
    fn empower_lifecycle_preserves_zero_and_rejects_missing_or_invalid_level() {
        let payload =
            "Player-2,\"团员\",0x512,0,0000000000000000,nil,0x80000000,0,357208,\"火焰吐息\",0x4";
        for (raw, kind, suffix, level) in [
            (
                "SPELL_EMPOWER_START",
                TimelineEventKind::EmpowerStart,
                "",
                None,
            ),
            (
                "SPELL_EMPOWER_END",
                TimelineEventKind::EmpowerEnd,
                ",4",
                Some(4),
            ),
            (
                "SPELL_EMPOWER_INTERRUPT",
                TimelineEventKind::EmpowerInterrupt,
                ",0",
                Some(0),
            ),
        ] {
            let event = parse(&format!("{raw},{payload}{suffix}"));
            assert_eq!(event.kind, kind);
            assert_eq!(event.empower_level, level);
            assert_eq!(event.stack_count, None);
            assert_eq!(event.owner, TimelineOwner::Team);
        }
        for suffix in ["", ",-1", ",4294967296", ",invalid"] {
            let line = format!("9/9/2026 21:39:11.000  SPELL_EMPOWER_END,{payload}{suffix}");
            assert!(parse_event(&line, 2026, 0, i64::MAX, "bad".into()).is_err());
        }
    }

    #[test]
    fn resurrection_belongs_to_the_revived_player_in_each_pov() {
        let payload = "SPELL_RESURRECT,Player-1,\"施法者\",0x511,0,Player-2,\"被复活者\",0x512,0,20484,\"复生\",0x8";
        let event = parse(payload);
        assert_eq!(event.kind, TimelineEventKind::Resurrect);
        assert_eq!(event.owner, TimelineOwner::Team);
        assert_eq!(event.target_guid, "Player-2");
        let line = format!("9/9/2026 21:39:11.000  {payload}");
        let other = parse_event_for_actor(
            &line,
            2026,
            0,
            i64::MAX,
            "other-pov".into(),
            Some("Player-2"),
        )
        .unwrap()
        .unwrap();
        assert_eq!(other.owner, TimelineOwner::Player);
        assert_eq!(other.source_guid, "Player-1");
        assert_eq!(other.spell_id, 20484);
        assert_eq!(other.empower_level, None);
        let npc = payload.replace("Player-2", "Creature-2");
        assert!(parse_event(
            &format!("9/9/2026 21:39:11.000  {npc}"),
            2026,
            0,
            i64::MAX,
            "npc".into()
        )
        .unwrap()
        .is_none());
    }
}
