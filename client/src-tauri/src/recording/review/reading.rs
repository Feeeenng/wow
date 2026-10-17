use super::{
    model::{DeathReview, ReviewEvent},
    parser::{parse_line, supported_header},
};
use crate::recording::{
    config::{DEATH_REVIEW_MAX_PRIOR_AURAS, DEATH_REVIEW_MAX_ROWS, DEATH_REVIEW_WINDOW_MS},
    model::{RecordingIndex, TimelineEventKind},
};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, VecDeque},
    fs::File,
    io::{BufRead, BufReader, Seek, SeekFrom},
    path::PathBuf,
};

/// 锁内只摘取本次读取所需信息，文件扫描在锁外执行。
#[derive(Clone)]
pub struct ReviewRequest {
    pub path: PathBuf,
    pub pull_id: String,
    pub pull_start: i64,
    pub start_offset: u64,
    pub death_offset: u64,
    pub death: ReviewEvent,
    pub prior_auras: Vec<ReviewEvent>,
    pub prior_truncated: bool,
    pub views: Vec<(String, String)>,
}

impl ReviewRequest {
    /// 死亡及日志范围来自当前索引，网页不能提供任意文件或字节位置。
    pub fn from_index(
        index: &RecordingIndex,
        pull_id: &str,
        event_id: &str,
    ) -> Result<Self, String> {
        let pull = index
            .active_pull
            .iter()
            .chain(&index.pulls)
            .find(|pull| pull.pull_id == pull_id)
            .ok_or("未找到死亡所在录像")?;
        let death = pull
            .timeline_events
            .iter()
            .find(|event| event.event_id == event_id && event.kind == TimelineEventKind::Death)
            .ok_or("当前索引中没有该死亡记录")?;
        if !death.target_guid.starts_with("Player-") {
            return Err("死亡记录缺少明确角色GUID，不能按同名猜测".into());
        }
        let path = pull
            .log_file_id
            .rsplit_once('#')
            .map(|(path, _)| PathBuf::from(path))
            .ok_or("录像缺少可读取的日志来源")?;
        let death_offset = event_id
            .strip_prefix(&format!("{pull_id}:"))
            .and_then(|value| value.parse::<u64>().ok())
            .ok_or("死亡事件缺少稳定字节身份，请重新构建索引")?;
        if death_offset < pull.log_start_offset
            || pull.log_end_offset.is_some_and(|end| death_offset >= end)
        {
            return Err("死亡字节身份超出本场日志区间".into());
        }
        let start = death.pull_time_ms as i64 - DEATH_REVIEW_WINDOW_MS;
        let mut prior = VecDeque::new();
        let mut prior_truncated = false;
        for event in &pull.timeline_events {
            if event.pull_time_ms as i64 >= start.max(0) || event.target_guid != death.target_guid {
                continue;
            }
            if !matches!(
                event.kind,
                TimelineEventKind::BuffApply
                    | TimelineEventKind::BuffRefresh
                    | TimelineEventKind::BuffRemove
                    | TimelineEventKind::BuffStack
                    | TimelineEventKind::DebuffApply
                    | TimelineEventKind::DebuffRefresh
                    | TimelineEventKind::DebuffRemove
                    | TimelineEventKind::DebuffStack
            ) {
                continue;
            }
            prior.push_back(ReviewEvent::from_timeline(event, ""));
            if prior.len() > DEATH_REVIEW_MAX_PRIOR_AURAS {
                prior.pop_front();
                prior_truncated = true;
            }
        }
        let battle = pull.battle_key.as_deref().filter(|value| !value.is_empty());
        let views = index
            .active_pull
            .iter()
            .chain(&index.pulls)
            .filter(|candidate| {
                candidate.pull_id == pull_id
                    || battle.is_some_and(|key| candidate.battle_key.as_deref() == Some(key))
            })
            .filter_map(|candidate| {
                candidate
                    .recording_player_guid
                    .as_ref()
                    .map(|guid| (candidate.pull_id.clone(), guid.clone()))
            })
            .collect();
        Ok(Self {
            path,
            pull_id: pull_id.to_string(),
            pull_start: pull.encounter_start_unix_ms,
            start_offset: pull.log_start_offset,
            death_offset,
            death: ReviewEvent::from_timeline(death, "UNIT_DIED"),
            prior_auras: prior.into(),
            prior_truncated,
            views,
        })
    }

    pub fn unavailable(&self, availability: &str, message: &str) -> DeathReview {
        let mut result = self.empty();
        result.availability = availability.into();
        result.message = Some(message.into());
        finalize(result)
    }

    fn empty(&self) -> DeathReview {
        DeathReview {
            revision: String::new(),
            source_kind: "combatLog".into(),
            availability: "ready".into(),
            message: None,
            window_start_ms: (self.death.pull_time_ms - DEATH_REVIEW_WINDOW_MS).max(0),
            window_end_ms: self.death.pull_time_ms,
            death: self.death.clone(),
            events: vec![],
            prior_auras: self.prior_auras.clone(),
            total: 0,
            observed_count: 0,
            truncated: false,
            prior_auras_truncated: self.prior_truncated,
            parse_errors: 0,
            paired_rows_removed: 0,
            victim_recording_ids: vec![],
            related_recording_ids: vec![],
            next_cursor: None,
            has_more: false,
        }
    }
}

/// 同时间、双方及全部伤害字段严格配对，保留落地记录，不猜测近似时延。
pub fn remove_swing_echoes(rows: Vec<ReviewEvent>) -> (Vec<ReviewEvent>, usize) {
    let mut landed = HashMap::<String, usize>::new();
    for row in &rows {
        if row.raw_type == "SWING_DAMAGE_LANDED" {
            if let Some(key) = &row.pairing_key {
                *landed.entry(key.clone()).or_default() += 1;
            }
        }
    }
    let mut removed = 0;
    let rows = rows
        .into_iter()
        .filter(|row| {
            if row.raw_type == "SWING_DAMAGE" {
                if let Some(count) = row.pairing_key.as_ref().and_then(|key| landed.get_mut(key)) {
                    if *count > 0 {
                        *count -= 1;
                        removed += 1;
                        return false;
                    }
                }
            }
            true
        })
        .collect();
    (rows, removed)
}

fn finalize(mut result: DeathReview) -> DeathReview {
    result.total = result.events.len();
    result.revision = format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&result).expect("有限明细字段可序列化"))
    );
    result
}

/// 流式只读扫描到选中死亡行，保留最靠近死亡的有界明细，不阻塞录像索引锁。
pub fn read(request: &ReviewRequest) -> Result<DeathReview, String> {
    let file = match File::open(&request.path) {
        Ok(file) => file,
        Err(_) => {
            return Ok(
                request.unavailable("missingLog", "源日志不可读取，不能补造伤害、治疗或生命值。")
            )
        }
    };
    let mut reader = BufReader::new(file);
    let mut line = String::new();
    reader.read_line(&mut line).map_err(|_| "无法读取日志头")?;
    if !supported_header(line.trim_start_matches('\u{feff}')) {
        return Ok(request.unavailable(
            "unsupportedLog",
            "当前死亡明细仅支持已核对的22版正式服高级日志。",
        ));
    }
    let year = request
        .path
        .file_name()
        .and_then(|value| value.to_str())
        .and_then(|name| name.strip_prefix("WoWCombatLog-"))
        .and_then(|name| name.get(4..6))
        .and_then(|year| year.parse::<i32>().ok())
        .map(|year| if year >= 70 { 1900 + year } else { 2000 + year })
        .unwrap_or(0);
    reader
        .seek(SeekFrom::Start(request.start_offset))
        .map_err(|_| "无法读取本场日志范围")?;
    let mut offset = request.start_offset;
    let mut rows = VecDeque::new();
    let mut result = request.empty();
    let mut matched_death = false;
    while offset <= request.death_offset {
        line.clear();
        let length = reader
            .read_line(&mut line)
            .map_err(|_| "死亡明细日志编码或读取失败")?;
        if length == 0 {
            break;
        }
        let id = format!("{}:{offset}", request.pull_id);
        match parse_line(
            &line,
            year,
            request.pull_start,
            result.window_start_ms,
            result.window_end_ms,
            id,
            &request.death.target_guid,
        ) {
            Ok(Some(row)) => {
                if offset == request.death_offset
                    && row.kind == "death"
                    && row.target_guid == request.death.target_guid
                    && row.pull_time_ms == request.death.pull_time_ms
                {
                    matched_death = true;
                }
                result.observed_count += 1;
                rows.push_back(row);
                if rows.len() > DEATH_REVIEW_MAX_ROWS {
                    rows.pop_front();
                    result.truncated = true;
                }
            }
            Ok(None) => {}
            Err(_) => result.parse_errors += 1,
        }
        offset += length as u64;
    }
    if !matched_death {
        return Ok(request.unavailable(
            "sourceChanged",
            "源日志与当前死亡索引不一致，请重新导入或构建索引。",
        ));
    }
    (result.events, result.paired_rows_removed) = remove_swing_echoes(rows.into());
    result.events.sort_by_key(|row| row.pull_time_ms);
    for (id, guid) in &request.views {
        if guid == &request.death.target_guid {
            result.victim_recording_ids.push(id.clone());
        } else if result
            .events
            .iter()
            .any(|row| &row.source_guid == guid || row.related_source_guid.as_ref() == Some(guid))
        {
            result.related_recording_ids.push(id.clone());
        }
    }
    Ok(finalize(result))
}
