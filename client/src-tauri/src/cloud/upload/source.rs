use sha2::{Digest, Sha256};
use std::path::PathBuf;
use tokio::io::AsyncReadExt;

use crate::{
    cloud::{
        api::model::{Player, Registration},
        config::{HASH_BUFFER_BYTES, MAX_MAPPING_ERROR_CHARS},
        upload::{model::StoredJob, state::TransferControl},
    },
    recording::{
        model::{BossPull, PullState},
        processing::probe::{executable_path, inspect_video},
    },
};

/// 上传源只接受已完成的索引 MP4；前端不能指定任意磁盘路径。
pub fn video_path(pull: &BossPull) -> Result<PathBuf, String> {
    if !matches!(pull.state, PullState::Ready | PullState::Partial)
        || pull.encounter_end_unix_ms.is_none()
    {
        return Err("只有已完成的本地录像可以上传".into());
    }
    let video = pull.video_path.as_ref().ok_or("录像缺少 MP4 成片")?;
    if !video.is_file()
        || video
            .extension()
            .and_then(|value| value.to_str())
            .is_none_or(|extension| !extension.eq_ignore_ascii_case("mp4"))
    {
        return Err("本地录像 MP4 不可用".into());
    }
    let path =
        std::fs::canonicalize(video).map_err(|error| format!("定位上传原片失败：{error}"))?;
    if pull
        .imported_source
        .as_ref()
        .is_some_and(|source| std::fs::canonicalize(source).ok().as_ref() != Some(&path))
    {
        return Err("外部原片与录像索引不一致".into());
    }
    Ok(path)
}

pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|value| format!("{value:02x}")).collect()
}

/// 流式计算原片完整摘要；正在变化的成片或已暂停任务不能继续登记。
pub async fn registration(
    job: &StoredJob,
    pull: &BossPull,
    ffmpeg: PathBuf,
    control: &TransferControl,
) -> Result<(PathBuf, Registration), String> {
    let path = video_path(pull)?;
    let before = tokio::fs::metadata(&path)
        .await
        .map_err(|error| error.to_string())?;
    if before.len() == 0 || before.len() != job.file_size_bytes {
        return Err("录像文件大小已变化，请取消后重新建立上传任务".into());
    }
    let mut file = tokio::fs::File::open(&path)
        .await
        .map_err(|error| format!("打开上传原片失败：{error}"))?;
    let mut buffer = vec![0; HASH_BUFFER_BYTES];
    let mut digest = Sha256::new();
    loop {
        if control.interrupted() {
            return Err("上传已暂停或取消".into());
        }
        let count = file
            .read(&mut buffer)
            .await
            .map_err(|error| format!("读取上传原片失败：{error}"))?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    let checksum = hex(&digest.finalize());
    let after = tokio::fs::metadata(&path)
        .await
        .map_err(|error| error.to_string())?;
    if before.len() != after.len() || before.modified().ok() != after.modified().ok() {
        return Err("录像正在变化，已停止上传".into());
    }
    if let Some(registration) = &job.registration {
        if registration.file_sha256 != checksum || registration.file_size_bytes != before.len() {
            return Err("录像内容与已登记上传不一致，请取消后建立新任务".into());
        }
        return Ok((path, registration.clone()));
    }
    let actors = pull
        .players
        .iter()
        .filter(|actor| {
            pull.recording_player_guid
                .as_ref()
                .map(|guid| guid == &actor.guid)
                .unwrap_or_else(|| pull.player_name.as_ref() == Some(&actor.name))
        })
        .collect::<Vec<_>>();
    if actors.len() != 1 {
        return Err("录像缺少唯一观看者 GUID，不能登记云端视角".into());
    }
    let actor = actors[0];
    let mapping = pull.mapping.as_ref().ok_or("录像缺少战斗时间映射")?;
    let duration = if let Some(duration) = mapping.media_duration_ms {
        duration
    } else {
        let input = path.clone();
        tauri::async_runtime::spawn_blocking(move || {
            inspect_video(&executable_path(&ffmpeg)?, &input)
        })
        .await
        .map_err(|_| "等待媒体探测失败")??
    };
    let wcl = pull
        .battle_key
        .as_deref()
        .and_then(|value| value.strip_prefix("wcl:"))
        .and_then(|value| value.split_once(':'))
        .and_then(|(code, id)| Some((code.to_string(), id.parse::<u32>().ok()?)));
    Ok((
        path,
        Registration {
            team_id: job.team_id.clone(),
            device_id: job.device_id.clone(),
            local_pull_id: pull.pull_id.clone(),
            artifact_version: checksum.clone(),
            file_size_bytes: before.len(),
            file_sha256: checksum,
            character_guid: actor.guid.clone(),
            character_name: actor.name.clone(),
            server_name: actor.server_name.clone(),
            encounter_id: pull.encounter_id,
            encounter_name: pull.encounter_name.clone(),
            difficulty_id: pull.difficulty_id,
            encounter_start_unix_ms: pull.encounter_start_unix_ms,
            encounter_end_unix_ms: pull.encounter_end_unix_ms.ok_or("战斗尚未结束")?,
            video_zero_ms: mapping.video_zero_ms,
            video_duration_ms: duration,
            wcl_report_code: wcl.as_ref().map(|value| value.0.clone()),
            wcl_fight_id: wcl.map(|value| value.1),
            team_pull_id: job.team_pull_id.clone(),
            players: pull
                .players
                .iter()
                .map(|player| Player {
                    guid: player.guid.clone(),
                    name: player.name.clone(),
                    server_name: player.server_name.clone(),
                    full_type: player.full_type.clone(),
                })
                .collect(),
            intervals: mapping.intervals.clone(),
            media_calibrated: mapping.media_calibrated,
            clock_discontinuous: mapping.clock_discontinuous,
            has_gap: mapping.has_gap,
            success: pull.success,
            group_size: Some(pull.group_size),
            calibration_error: mapping
                .calibration_error
                .as_ref()
                .map(|message| message.chars().take(MAX_MAPPING_ERROR_CHARS).collect()),
        },
    ))
}
