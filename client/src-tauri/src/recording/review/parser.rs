use super::model::ReviewEvent;
use crate::{
    combat_log::parser::{parse_csv_fields, parse_timestamp},
    recording::{config::DEATH_REVIEW_LOG_VERSION, events::parser::parse_event_for_actor},
};

/// 仅启用实际样本核对过的正式服22版高级日志，拒绝按尾部长度猜其他格式。
pub fn supported_header(line: &str) -> bool {
    let Some((_, payload)) = line.trim().split_once("  ") else {
        return false;
    };
    let Ok(fields) = parse_csv_fields(payload) else {
        return false;
    };
    fields
        .first()
        .is_some_and(|value| value == "COMBAT_LOG_VERSION")
        && fields
            .get(1)
            .is_some_and(|value| value == DEATH_REVIEW_LOG_VERSION)
        && fields
            .get(2)
            .is_some_and(|value| value == "ADVANCED_LOG_ENABLED")
        && fields.get(3).is_some_and(|value| value == "1")
        && fields.get(6).is_some_and(|value| value == "PROJECT_ID")
        && fields.get(7).is_some_and(|value| value == "1")
}

fn number(fields: &[String], index: usize) -> Option<f64> {
    fields
        .get(index)?
        .parse::<f64>()
        .ok()
        .filter(|value| value.is_finite() && *value >= 0.0 && *value <= 9_007_199_254_740_991.0)
}

/// 资源区段明确属于死者时才读取生命采样，不把攻击者资源当成受击者生命。
fn health(row: &mut ReviewEvent, fields: &[String], base: usize, victim: &str) {
    if fields.get(base).is_none_or(|guid| guid != victim) {
        return;
    }
    if let (Some(current), Some(maximum)) = (number(fields, base + 2), number(fields, base + 3)) {
        if maximum > 0.0 && current <= maximum {
            row.health = Some(current);
            row.max_health = Some(maximum);
        }
    }
}

/// 明细只读取当前死亡相关来源或目标；伤害／治疗数值仅来自死者收到的记录。
pub fn parse_line(
    line: &str,
    year: i32,
    pull_start: i64,
    from: i64,
    through: i64,
    id: String,
    victim: &str,
) -> Result<Option<ReviewEvent>, String> {
    let Some((stamp, payload)) = line.trim_end().split_once("  ") else {
        return Err("明细缺少日志时间".into());
    };
    if !payload.contains(victim) {
        return Ok(None);
    }
    let occurred = parse_timestamp(stamp, year).map_err(|error| error.to_string())? - pull_start;
    if occurred < from || occurred > through {
        return Ok(None);
    }
    let fields = parse_csv_fields(payload).map_err(|error| error.to_string())?;
    let text = |index| fields.get(index).map(String::as_str).unwrap_or("");
    if text(1) != victim && text(5) != victim {
        return Ok(None);
    }
    let raw = text(0);
    // 支援行是原命中的归属分摊，不是另一笔实际生命损失或恢复。
    if raw.ends_with("_SUPPORT") {
        return Ok(None);
    }
    if matches!(raw, "SPELL_ABSORBED" | "SPELL_HEAL_ABSORBED") && text(5) == victim {
        let base = if text(9).parse::<u32>().is_ok() {
            12
        } else {
            9
        };
        if fields.len() < base + 9 {
            return Err("吸收记录布局不符合22版日志".into());
        }
        let mut row = empty_row(
            &id,
            occurred,
            &fields,
            if raw == "SPELL_HEAL_ABSORBED" {
                "healAbsorb"
            } else {
                "absorb"
            },
        );
        row.spell_id = text(base + 4).parse().map_err(|_| "吸收记录缺少技能ID")?;
        row.spell_name = text(base + 5).to_string();
        row.extra_spell_id = if base == 12 {
            text(9).parse().ok()
        } else {
            None
        };
        row.source_guid = text(base).to_string();
        row.source_name = text(base + 1).to_string();
        row.source_is_player = row.source_guid.starts_with("Player-");
        row.related_source_guid = Some(text(1).to_string());
        row.related_source_name = Some(text(2).to_string());
        row.absorbed = number(&fields, base + 7);
        return Ok(Some(row));
    }
    if matches!(
        raw,
        "SPELL_MISSED" | "SPELL_PERIODIC_MISSED" | "RANGE_MISSED" | "SWING_MISSED"
    ) && text(5) == victim
    {
        let base = if raw == "SWING_MISSED" { 9 } else { 12 };
        if text(base) != "ABSORB" {
            return Ok(None);
        }
        let mut row = empty_row(&id, occurred, &fields, "absorb");
        if base == 12 {
            row.spell_id = text(9).parse().map_err(|_| "吸收攻击缺少技能ID")?;
            row.spell_name = text(10).to_string();
        }
        row.absorbed = number(&fields, base + 2);
        return Ok(Some(row));
    }
    let specification = match raw {
        "SPELL_DAMAGE"
        | "SPELL_PERIODIC_DAMAGE"
        | "RANGE_DAMAGE"
        | "SPELL_BUILDING_DAMAGE"
        | "DAMAGE_SPLIT"
        | "DAMAGE_SHIELD" => Some(("damage", 31, 12, 41)),
        "SWING_DAMAGE" | "SWING_DAMAGE_LANDED" => Some(("damage", 28, 9, 38)),
        "ENVIRONMENTAL_DAMAGE" => Some(("damage", 29, 9, 39)),
        "SPELL_HEAL" | "SPELL_PERIODIC_HEAL" | "SPELL_BUILDING_HEAL" => Some(("heal", 31, 12, 36)),
        _ => None,
    };
    if let Some((kind, amount_index, resources, minimum)) = specification {
        if text(5) != victim {
            return Ok(None);
        }
        if fields.len() < minimum {
            return Err("明细布局不符合22版高级日志".into());
        }
        let spell_id = if resources == 12 {
            text(9).parse::<u32>().map_err(|_| "明细缺少有效技能ID")?
        } else {
            0
        };
        let mut row = ReviewEvent {
            event_id: id,
            pull_time_ms: occurred,
            kind: kind.to_string(),
            source_guid: text(1).to_string(),
            source_name: text(2).to_string(),
            target_guid: text(5).to_string(),
            target_name: text(6).to_string(),
            source_is_player: text(1).starts_with("Player-"),
            target_is_player: text(5).starts_with("Player-"),
            spell_id,
            spell_name: if resources == 12 {
                text(10).to_string()
            } else if raw == "ENVIRONMENTAL_DAMAGE" {
                text(28).to_string()
            } else {
                "近战攻击".to_string()
            },
            extra_spell_id: None,
            stack_count: None,
            empower_level: None,
            identity_namespace: None,
            source_actor_id: None,
            target_actor_id: None,
            raw_type: raw.to_string(),
            amount: number(&fields, amount_index),
            absorbed: number(&fields, amount_index + if kind == "heal" { 3 } else { 6 }),
            overkill: if kind == "damage" {
                number(&fields, amount_index + 2)
            } else {
                None
            },
            overheal: if kind == "heal" {
                number(&fields, amount_index + 2)
            } else {
                None
            },
            health: None,
            max_health: None,
            related_source_guid: None,
            related_source_name: None,
            pairing_key: if raw.starts_with("SWING_DAMAGE") {
                Some(format!(
                    "{stamp}:{}:{}:{}",
                    text(1),
                    text(5),
                    fields[amount_index..].join(",")
                ))
            } else {
                None
            },
        };
        health(&mut row, &fields, resources, victim);
        return Ok(Some(row));
    }
    let event = parse_event_for_actor(
        line,
        year,
        pull_start,
        pull_start + through,
        id,
        Some(victim),
    )?;
    Ok(event.map(|event| {
        let mut row = ReviewEvent::from_timeline(&event, raw);
        health(
            &mut row,
            &fields,
            if raw == "UNIT_DIED" { 9 } else { 12 },
            victim,
        );
        row
    }))
}

fn empty_row(id: &str, time: i64, fields: &[String], kind: &str) -> ReviewEvent {
    let text = |index| fields.get(index).map(String::as_str).unwrap_or("");
    ReviewEvent {
        event_id: id.to_string(),
        pull_time_ms: time,
        kind: kind.to_string(),
        source_guid: text(1).to_string(),
        source_name: text(2).to_string(),
        target_guid: text(5).to_string(),
        target_name: text(6).to_string(),
        source_is_player: text(1).starts_with("Player-"),
        target_is_player: text(5).starts_with("Player-"),
        spell_id: 0,
        spell_name: "近战吸收".into(),
        extra_spell_id: None,
        stack_count: None,
        empower_level: None,
        identity_namespace: None,
        source_actor_id: None,
        target_actor_id: None,
        raw_type: text(0).to_string(),
        amount: None,
        absorbed: None,
        overkill: None,
        overheal: None,
        health: None,
        max_health: None,
        related_source_guid: None,
        related_source_name: None,
        pairing_key: None,
    }
}
