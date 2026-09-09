use std::fmt::{Display, Formatter};

use crate::combat_log::model::{EncounterEnd, EncounterEvent, EncounterStart};

/// 表示一行 Boss 边界日志无法安全解析。
#[derive(Debug, PartialEq, Eq)]
pub struct ParseError(String);

impl Display for ParseError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

pub(crate) fn parse_csv_fields(value: &str) -> Result<Vec<String>, ParseError> {
    let mut fields = Vec::new();
    let mut current = String::new();
    let mut chars = value.chars().peekable();
    let mut quoted = false;
    while let Some(character) = chars.next() {
        match character {
            '"' if quoted && chars.peek() == Some(&'"') => {
                current.push('"');
                chars.next();
            }
            '"' => quoted = !quoted,
            ',' if !quoted => {
                fields.push(std::mem::take(&mut current));
            }
            _ => current.push(character),
        }
    }
    if quoted {
        return Err(ParseError("CombatLog 引号字段未闭合".to_string()));
    }
    fields.push(current);
    Ok(fields)
}

fn is_leap_year(year: i32) -> bool {
    year % 4 == 0 && (year % 100 != 0 || year % 400 == 0)
}

fn days_in_month(year: i32, month: u32) -> Option<u32> {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => Some(31),
        4 | 6 | 9 | 11 => Some(30),
        2 => Some(if is_leap_year(year) { 29 } else { 28 }),
        _ => None,
    }
}

fn days_from_civil(year: i32, month: u32, day: u32) -> i64 {
    let adjusted_year = year - i32::from(month <= 2);
    let era = adjusted_year.div_euclid(400);
    let year_of_era = adjusted_year - era * 400;
    let shifted_month = month as i32 + if month > 2 { -3 } else { 9 };
    let day_of_year = (153 * shifted_month + 2) / 5 + day as i32 - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    (era * 146_097 + day_of_era - 719_468) as i64
}

pub(crate) fn parse_timestamp(value: &str, anchor_year: i32) -> Result<i64, ParseError> {
    let (date, time) = value
        .split_once(' ')
        .ok_or_else(|| ParseError("CombatLog 时间缺少日期或时刻".to_string()))?;
    let date_parts = date.split('/').collect::<Vec<_>>();
    let (month, day, year) = match date_parts.as_slice() {
        [month, day] => (*month, *day, anchor_year),
        [month, day, year] => (
            *month,
            *day,
            year.parse::<i32>()
                .map_err(|_| ParseError("CombatLog 年份无效".to_string()))?,
        ),
        _ => return Err(ParseError("CombatLog 日期格式无效".to_string())),
    };
    let mut time_parts = time.split(':');
    let hour = time_parts.next().and_then(|part| part.parse::<u32>().ok());
    let minute = time_parts.next().and_then(|part| part.parse::<u32>().ok());
    let second_and_millis = time_parts.next();
    if time_parts.next().is_some() {
        return Err(ParseError("CombatLog 时刻字段过多".to_string()));
    }
    let (second, millis) = second_and_millis
        .and_then(|part| part.split_once('.'))
        .ok_or_else(|| ParseError("CombatLog 时刻格式无效".to_string()))?;
    let month = month
        .parse::<u32>()
        .map_err(|_| ParseError("CombatLog 月份无效".to_string()))?;
    let day = day
        .parse::<u32>()
        .map_err(|_| ParseError("CombatLog 日期无效".to_string()))?;
    let hour = hour.ok_or_else(|| ParseError("CombatLog 小时无效".to_string()))?;
    let minute = minute.ok_or_else(|| ParseError("CombatLog 分钟无效".to_string()))?;
    let second = second
        .parse::<u32>()
        .map_err(|_| ParseError("CombatLog 秒数无效".to_string()))?;
    let normalized_millis = format!("{millis:0<3}");
    let millis = normalized_millis
        .get(..3)
        .unwrap_or(&normalized_millis)
        .parse::<u32>()
        .map_err(|_| ParseError("CombatLog 毫秒无效".to_string()))?;
    let valid_day = days_in_month(year, month).is_some_and(|maximum| day > 0 && day <= maximum);
    if !valid_day || hour > 23 || minute > 59 || second > 59 || millis > 999 {
        return Err(ParseError("CombatLog 时间超出有效范围".to_string()));
    }

    const SHANGHAI_OFFSET_SECONDS: i64 = 8 * 60 * 60;
    let seconds = days_from_civil(year, month, day) * 86_400
        + hour as i64 * 3_600
        + minute as i64 * 60
        + second as i64
        - SHANGHAI_OFFSET_SECONDS;
    Ok(seconds * 1_000 + millis as i64)
}

fn parse_u32(fields: &[String], index: usize, name: &str) -> Result<u32, ParseError> {
    fields
        .get(index)
        .ok_or_else(|| ParseError(format!("Boss 事件缺少{name}")))?
        .parse::<u32>()
        .map_err(|_| ParseError(format!("Boss 事件{name}无效")))
}

/// 只解析 Boss 战开始和结束行，其他 CombatLog 事件返回空值。
pub fn parse_encounter_line(
    line: &str,
    anchor_year: i32,
) -> Result<Option<EncounterEvent>, ParseError> {
    let Some((timestamp, payload)) = line.split_once("  ") else {
        return Ok(None);
    };
    if !payload.starts_with("ENCOUNTER_START,") && !payload.starts_with("ENCOUNTER_END,") {
        return Ok(None);
    }
    let fields = parse_csv_fields(payload)?;
    let encounter_id = parse_u32(&fields, 1, " encounterId")?;
    let encounter_name = fields
        .get(2)
        .filter(|value| !value.is_empty())
        .cloned()
        .ok_or_else(|| ParseError("Boss 事件缺少名称".to_string()))?;
    let difficulty_id = parse_u32(&fields, 3, " difficultyId")?;
    let group_size = parse_u32(&fields, 4, "团队人数")?;
    let occurred_at_unix_ms = parse_timestamp(timestamp.trim(), anchor_year)?;

    match fields.first().map(String::as_str) {
        Some("ENCOUNTER_START") => Ok(Some(EncounterEvent::Start(EncounterStart {
            encounter_id,
            encounter_name,
            difficulty_id,
            group_size,
            occurred_at_unix_ms,
        }))),
        Some("ENCOUNTER_END") => {
            let success = parse_u32(&fields, 5, "成功标记")? == 1;
            Ok(Some(EncounterEvent::End(EncounterEnd {
                encounter_id,
                encounter_name,
                difficulty_id,
                group_size,
                success,
                occurred_at_unix_ms,
            })))
        }
        _ => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::parse_encounter_line;
    use crate::combat_log::model::EncounterEvent;

    #[test]
    fn parses_encounter_start_with_extended_fields() {
        let line = "5/30 20:23:02.383  ENCOUNTER_START,2952,\"阿塔拉利恩\",215,20,109,2";

        let event = parse_encounter_line(line, 2024).unwrap().unwrap();

        let EncounterEvent::Start(start) = event else {
            panic!("预期为 Boss 开始事件");
        };
        assert_eq!(start.encounter_id, 2952);
        assert_eq!(start.encounter_name, "阿塔拉利恩");
        assert_eq!(start.difficulty_id, 215);
        assert_eq!(start.group_size, 20);
        assert_eq!(start.occurred_at_unix_ms, 1_717_071_782_383);
    }

    #[test]
    fn parses_encounter_end_success_flag() {
        let line = "5/30 20:23:53.492  ENCOUNTER_END,2952,\"阿塔拉利恩\",215,20,1";

        let event = parse_encounter_line(line, 2024).unwrap().unwrap();

        let EncounterEvent::End(end) = event else {
            panic!("预期为 Boss 结束事件");
        };
        assert_eq!(end.encounter_id, 2952);
        assert!(end.success);
        assert_eq!(end.occurred_at_unix_ms, 1_717_071_833_492);
    }

    #[test]
    fn ignores_non_encounter_events() {
        let line = "5/30 20:23:03.000  SPELL_CAST_START,Player-1,\"测试\",0x0";

        assert!(parse_encounter_line(line, 2024).unwrap().is_none());
    }

    #[test]
    fn rejects_incomplete_encounter_event() {
        let line = "5/30 20:23:02.383  ENCOUNTER_START,2952,\"阿塔拉利恩\"";

        assert!(parse_encounter_line(line, 2024).is_err());
    }

    #[test]
    fn parses_quoted_name_containing_comma() {
        let line = "5/30 20:23:02.383  ENCOUNTER_START,2952,\"首领,测试\",215,20";

        let event = parse_encounter_line(line, 2024).unwrap().unwrap();
        let EncounterEvent::Start(start) = event else {
            panic!("预期为 Boss 开始事件");
        };
        assert_eq!(start.encounter_name, "首领,测试");
    }

    #[test]
    fn parses_current_log_date_and_sub_millisecond_fraction() {
        let line = "9/6/2026 16:11:16.3648  ENCOUNTER_END,2126,\"加瓦兹特\",8,5,1,134273";

        let event = parse_encounter_line(line, 2024).unwrap().unwrap();
        let EncounterEvent::End(end) = event else {
            panic!("预期为 Boss 结束事件");
        };
        assert_eq!(end.occurred_at_unix_ms, 1_788_682_276_364);
        assert!(end.success);
    }
}
