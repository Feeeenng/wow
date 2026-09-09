use crate::recording::model::BossPull;

const SHANGHAI_OFFSET_SECONDS: i64 = 8 * 60 * 60;

fn civil_from_days(days: i64) -> (i32, u32, u32) {
    let days = days + 719_468;
    let era = days.div_euclid(146_097);
    let day_of_era = days - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let mut year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_position = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_position + 2) / 5 + 1;
    let month = month_position + if month_position < 10 { 3 } else { -9 };
    year += i64::from(month <= 2);
    (year as i32, month as u32, day as u32)
}

fn format_shanghai_time(unix_ms: i64) -> String {
    let local_seconds = unix_ms.div_euclid(1_000) + SHANGHAI_OFFSET_SECONDS;
    let days = local_seconds.div_euclid(86_400);
    let seconds_of_day = local_seconds.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    let hour = seconds_of_day / 3_600;
    let minute = seconds_of_day % 3_600 / 60;
    let second = seconds_of_day % 60;
    format!("{year:04}-{month:02}-{day:02} {hour:02}-{minute:02}-{second:02}")
}

fn safe_component(value: &str) -> String {
    let sanitized = value
        .chars()
        .map(|character| {
            if character.is_control()
                || matches!(
                    character,
                    '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
                )
            {
                '_'
            } else {
                character
            }
        })
        .collect::<String>();
    sanitized.trim().trim_end_matches(['.', ' ']).to_string()
}

pub fn difficulty_name(difficulty_id: u32) -> String {
    match difficulty_id {
        8 | 16 => "史诗".to_string(),
        15 => "英雄".to_string(),
        14 => "普通".to_string(),
        17 => "随机团队".to_string(),
        _ => format!("难度 {difficulty_id}"),
    }
}

/// 生成 Windows 可用的“时间 - Boss - 难度 - 人物”录像基础名称。
pub fn recording_name(pull: &BossPull) -> String {
    let player = pull.player_name.as_deref().unwrap_or("未识别人物");
    [
        format_shanghai_time(pull.encounter_start_unix_ms),
        safe_component(&pull.encounter_name),
        safe_component(&difficulty_name(pull.difficulty_id)),
        safe_component(player),
    ]
    .join(" - ")
}

#[cfg(test)]
mod tests {
    use crate::recording::model::{BossPull, PullState};

    use super::{format_shanghai_time, recording_name, safe_component};

    #[test]
    fn formats_unix_time_in_shanghai_timezone() {
        assert_eq!(
            format_shanghai_time(1_788_961_150_647),
            "2026-09-09 21-39-10"
        );
    }

    #[test]
    fn builds_readable_windows_recording_name() {
        let pull = BossPull {
            pull_id: "pull-id".to_string(),
            encounter_id: 3379,
            encounter_name: "尼姆瑞莎:唤波者".to_string(),
            difficulty_id: 16,
            group_size: 20,
            success: Some(true),
            encounter_start_unix_ms: 1_788_961_150_647,
            encounter_end_unix_ms: Some(1_788_961_170_759),
            clip_start_unix_ms: 1_788_961_145_647,
            clip_end_unix_ms: Some(1_788_961_175_759),
            log_file_id: "log".to_string(),
            log_start_offset: 0,
            log_end_offset: Some(100),
            state: PullState::Ready,
            end_reason: None,
            player_name: Some("韩梦".to_string()),
            timeline_events: Vec::new(),
            players: Vec::new(),
            timeline_indexed: true,
            mapping: None,
            video_path: None,
            playback_path: None,
            error: None,
        };

        assert_eq!(
            recording_name(&pull),
            "2026-09-09 21-39-10 - 尼姆瑞莎_唤波者 - 史诗 - 韩梦"
        );
        assert_eq!(safe_component("Boss. "), "Boss");
    }
}
