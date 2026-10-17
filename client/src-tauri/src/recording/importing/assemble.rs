use std::{
    collections::BTreeSet,
    fs::File,
    io::{BufRead, BufReader, Read, Seek, SeekFrom},
    path::Path,
};

use sha2::{Digest, Sha256};

use crate::{
    combat_log::parser::parse_csv_fields,
    recording::{
        events::{actors::player_identity, index::populate_missing_timelines},
        importing::source::{
            logs::LogEncounter,
            metadata::{Candidate, ExternalPlayer},
        },
        model::{BossPull, ClipMapping},
        processing::probe::{executable_path, inspect_video},
    },
};

/// 对路径和战斗身份生成稳定标识，重复导入不会复制另一份录像记录。
pub(crate) fn pull_id(candidate: &Candidate) -> String {
    hash(&format!(
        "external\0{}\0{}\0{}",
        candidate.video_path.display(),
        candidate.metadata.start_time,
        candidate.metadata.encounter.id
    ))
}

fn hash(value: &str) -> String {
    Sha256::digest(value.as_bytes())
        .iter()
        .map(|value| format!("{value:02x}"))
        .collect()
}

fn same_player(name: &str, server: Option<&str>, player: &ExternalPlayer) -> bool {
    name == player.name && server == player.server_name.as_deref()
}

/// 仅读取匹配战斗的字节范围，按姓名和服务器唯一关联观看者 GUID。
fn viewer_guid(encounter: &LogEncounter, viewer: &ExternalPlayer) -> Result<String, String> {
    let (path, _) = encounter
        .file_id
        .rsplit_once('#')
        .ok_or("日志文件身份无效")?;
    let mut file = File::open(path).map_err(|error| error.to_string())?;
    file.seek(SeekFrom::Start(encounter.start_offset))
        .map_err(|error| error.to_string())?;
    let mut reader = BufReader::new(file.take(encounter.end_offset - encounter.start_offset));
    let mut bytes = Vec::new();
    let mut matches = BTreeSet::new();
    loop {
        bytes.clear();
        if reader
            .read_until(b'\n', &mut bytes)
            .map_err(|error| error.to_string())?
            == 0
        {
            break;
        }
        let line = String::from_utf8_lossy(&bytes);
        if !line.contains(&viewer.name) {
            continue;
        }
        let Some((_, payload)) = line.trim_end_matches(['\r', '\n']).split_once("  ") else {
            continue;
        };
        let Ok(fields) = parse_csv_fields(payload) else {
            continue;
        };
        for (guid_index, name_index) in [(1, 2), (5, 6)] {
            if let Some(actor) = fields
                .get(guid_index)
                .zip(fields.get(name_index))
                .and_then(|(guid, name)| player_identity(guid, name))
            {
                if same_player(&actor.name, actor.server_name.as_deref(), viewer) {
                    matches.insert(actor.guid);
                }
            }
        }
    }
    if matches.len() != 1 {
        return Err("无法将录像观看者唯一关联到本场日志 GUID".into());
    }
    Ok(matches.into_iter().next().expect("已验证唯一身份"))
}

/// 精确匹配边界、重建真实事件并保留估算偏移；不写原片、旁车或应用索引。
pub(crate) fn assemble(
    candidate: &Candidate,
    encounters: &[LogEncounter],
    ffmpeg: &Path,
) -> Result<Option<BossPull>, String> {
    let metadata = &candidate.metadata;
    let matched = encounters
        .iter()
        .filter(|item| {
            item.start.encounter_id == metadata.encounter.id
                && item.start.occurred_at_unix_ms == metadata.start_time
                && item.end.occurred_at_unix_ms == metadata.end_time
        })
        .collect::<Vec<_>>();
    if matched.is_empty() {
        return Ok(None);
    }
    if matched.len() != 1 {
        return Err("多份日志包含相同战斗边界，请只选择该观看者的一份原日志".into());
    }
    let encounter = matched[0];
    let viewers = metadata
        .players
        .iter()
        .filter(|player| player.actor_id == metadata.actor_id)
        .collect::<Vec<_>>();
    if viewers.len() != 1 {
        return Err("旁车 actorId 缺少唯一录像观看者".into());
    }
    let guid = viewer_guid(encounter, viewers[0])?;
    let duration = inspect_video(&executable_path(ffmpeg)?, &candidate.video_path)?;
    let actual_start = metadata
        .start_time
        .checked_sub(metadata.start_time_offset_ms)
        .ok_or("旁车偏移超出有效范围")?;
    let actual_end = actual_start
        .checked_add(i64::try_from(duration).map_err(|_| "录像时长超出有效范围")?)
        .ok_or("录像时长超出有效范围")?;
    if metadata.start_time_offset_ms.unsigned_abs() > duration {
        return Err("旁车偏移超出录像时长".into());
    }
    let mapping = ClipMapping {
        actual_start_unix_ms: actual_start,
        actual_end_unix_ms: actual_end,
        video_zero_ms: metadata.start_time_offset_ms,
        media_duration_ms: Some(duration),
        media_calibrated: false,
        calibration_error: Some(
            "外部录像使用旁车估算偏移，缺少原始录制时钟；可按画面锚点手动微调".into(),
        ),
        ..ClipMapping::default()
    };
    let battle_key = if let Some(fight) = metadata
        .server_fight
        .as_ref()
        .filter(|fight| !fight.report_code.is_empty() && fight.fight_id > 0)
    {
        format!("wcl:{}:{}", fight.report_code, fight.fight_id)
    } else {
        format!(
            "log:{}",
            hash(&format!(
                "{}:{}:{}:{}",
                encounter.file_id,
                encounter.start_offset,
                encounter.end_offset,
                encounter.start.encounter_id
            ))
        )
    };
    let mut pull: BossPull = serde_json::from_value(serde_json::json!({
        "pullId":pull_id(candidate), "encounterId":encounter.start.encounter_id,
        "encounterName":encounter.start.encounter_name,"difficultyId":encounter.start.difficulty_id,
        "groupSize":encounter.start.group_size,"success":encounter.end.success,
        "encounterStartUnixMs":metadata.start_time,"encounterEndUnixMs":metadata.end_time,
        "clipStartUnixMs":actual_start,"clipEndUnixMs":actual_end,
        "logFileId":encounter.file_id,"logStartOffset":encounter.start_offset,"logEndOffset":encounter.end_offset,
        "state":"waitingForPlayback","endReason":"encounterEnd","mapping":mapping,
        "videoPath":candidate.video_path,"importedSource":candidate.video_path,
        "recordingPlayerGuid":guid,"battleKey":battle_key
    })).map_err(|error| format!("创建导入战斗失败：{error}"))?;
    let (_, errors) = populate_missing_timelines(std::slice::from_mut(&mut pull), 0);
    if !errors.is_empty() {
        return Err(errors.join("；"));
    }
    for player in &mut pull.players {
        let matched = metadata
            .players
            .iter()
            .filter(|entry| same_player(&player.name, player.server_name.as_deref(), entry))
            .collect::<Vec<_>>();
        if matched.len() == 1 {
            player.actor_id = Some(matched[0].actor_id);
            player.full_type = matched[0].full_type.clone();
        }
    }
    Ok(Some(pull))
}
