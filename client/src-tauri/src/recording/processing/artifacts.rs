use std::{fs, path::Path};

use serde::Serialize;

use crate::recording::{
    model::{
        BossPull, ClipMapping, MetadataContentType, MetadataNamedId, PullCombatLog,
        RecordingMetadata,
    },
    naming::{difficulty_name, recording_name},
};

fn write_json_atomic<T: Serialize>(path: &Path, value: &T, pull_id: &str) -> Result<(), String> {
    let temporary = path.with_extension("json.tmp");
    let bytes = serde_json::to_vec_pretty(value)
        .map_err(|error| format!("序列化 Pull {pull_id} 的 {} 失败：{error}", path.display()))?;
    fs::write(&temporary, bytes)
        .map_err(|error| format!("写入 Pull {pull_id} 的 {} 失败：{error}", path.display()))?;
    crate::storage::replace_file(&temporary, path)
        .map_err(|error| format!("保存 Pull {pull_id} 的 {} 失败：{error}", path.display()))
}

/// 将当前媒体映射与事件来源一起写入旁车，供重建和上传复用。
pub(crate) fn write_recording_json(
    pull: &BossPull,
    mapping: &ClipMapping,
    pull_directory: &Path,
) -> Result<(), String> {
    let difficulty = difficulty_name(pull.difficulty_id);
    let video_file_name = pull
        .imported_source
        .as_ref()
        .and_then(|path| path.file_name())
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| format!("{}.mp4", recording_name(pull)));
    let metadata = RecordingMetadata {
        schema_version: 2,
        mapping,
        id: &pull.pull_id,
        actor_id: pull
            .recording_player_guid
            .as_ref()
            .and_then(|guid| pull.players.iter().find(|player| &player.guid == guid))
            .and_then(|player| player.actor_id),
        source: "disk",
        key: &video_file_name,
        start_time_offset_ms: mapping.video_zero_ms,
        name: format!("{} {}", difficulty, pull.encounter_name),
        content_type: MetadataContentType {
            id: if pull.group_size >= 10 {
                "raids"
            } else {
                "dungeons"
            },
            name: if pull.group_size >= 10 {
                "团队副本"
            } else {
                "地下城"
            },
        },
        zone: None,
        difficulty: MetadataNamedId {
            id: pull.difficulty_id,
            name: difficulty,
        },
        size: MetadataNamedId {
            id: pull.group_size,
            name: format!("{} 玩家", pull.group_size),
        },
        encounter: MetadataNamedId {
            id: pull.encounter_id,
            name: pull.encounter_name.clone(),
        },
        level: None,
        start_time: pull.encounter_start_unix_ms,
        end_time: pull.encounter_end_unix_ms,
        is_kill: pull.success,
        players: &pull.players,
        server_fight: None,
        server_fight_last_updated: None,
        server_video: None,
        server_video_last_updated: None,
        other_videos: &[],
        other_videos_last_updated: None,
        is_favorited: false,
    };
    write_json_atomic(
        &pull_directory.join("metadata.json"),
        &metadata,
        &pull.pull_id,
    )?;
    let combat_log = PullCombatLog {
        schema_version: 1,
        pull_id: &pull.pull_id,
        log_file_id: &pull.log_file_id,
        log_start_offset: pull.log_start_offset,
        log_end_offset: pull.log_end_offset,
        player_name: &pull.player_name,
        players: &pull.players,
        events: &pull.timeline_events,
    };
    write_json_atomic(
        &pull_directory.join("combat-log.json"),
        &combat_log,
        &pull.pull_id,
    )
}

/// 外部原片派生产物固定落在应用目录的稳定 Pull ID 下。
pub(crate) fn imported_directory(
    output_directory: &Path,
    pull: &BossPull,
) -> Result<std::path::PathBuf, String> {
    if pull.pull_id.len() != 64 || !pull.pull_id.bytes().all(|value| value.is_ascii_hexdigit()) {
        return Err("导入录像的 Pull ID 无效".into());
    }
    Ok(output_directory.join(&pull.pull_id))
}

/// 将旧版平铺产物迁移到单 Pull 文件夹，并补齐 metadata 与时间轴 JSON。
pub fn ensure_artifact_layout(
    output_directory: &Path,
    pull: &mut BossPull,
    refresh_json: bool,
) -> Result<bool, String> {
    let Some(mapping) = pull.mapping.clone() else {
        return Ok(false);
    };
    let Some(current_video) = pull.video_path.clone().filter(|path| path.is_file()) else {
        return Ok(false);
    };
    if let Some(source) = &pull.imported_source {
        if fs::canonicalize(source).ok() != fs::canonicalize(&current_video).ok() {
            return Err("导入录像原片路径与索引不一致，已阻止产物迁移".into());
        }
        let directory = imported_directory(output_directory, pull)?;
        fs::create_dir_all(&directory).map_err(|error| format!("创建导入录像目录失败：{error}"))?;
        let expected = directory.join("hls/index.m3u8");
        let changed = pull
            .playback_path
            .as_ref()
            .is_some_and(|path| path != &expected);
        if changed {
            pull.playback_path = expected.is_file().then_some(expected);
        }
        if pull.timeline_indexed && (refresh_json || !directory.join("metadata.json").is_file()) {
            write_recording_json(pull, &mapping, &directory)?;
        }
        return Ok(changed);
    }
    let recording_name = recording_name(pull);
    let pull_directory = output_directory.join(&recording_name);
    let target_video = pull_directory.join(format!("{recording_name}.mp4"));
    let mut changed = false;
    let current_directory = current_video.parent();
    if current_directory != Some(pull_directory.as_path())
        && current_directory != Some(output_directory)
        && !pull_directory.exists()
    {
        fs::rename(
            current_directory.expect("录像文件必然存在父目录"),
            &pull_directory,
        )
        .map_err(|error| format!("迁移 Pull {} 成片目录失败：{error}", pull.pull_id))?;
        changed = true;
    } else {
        fs::create_dir_all(&pull_directory)
            .map_err(|error| format!("创建 Pull {} 成片目录失败：{error}", pull.pull_id))?;
    }
    let current_video = if current_video.is_file() {
        current_video
    } else {
        pull_directory.join(
            current_video
                .file_name()
                .ok_or_else(|| format!("Pull {} 的视频路径无效", pull.pull_id))?,
        )
    };
    if current_video != target_video {
        if !target_video.is_file() {
            fs::rename(&current_video, &target_video)
                .map_err(|error| format!("迁移 Pull {} 视频失败：{error}", pull.pull_id))?;
        }
        pull.video_path = Some(target_video);
        changed = true;
    }
    let relocated_playlist = pull_directory.join("hls").join("index.m3u8");
    if !pull
        .playback_path
        .as_ref()
        .is_some_and(|path| path.is_file())
        && relocated_playlist.is_file()
    {
        pull.playback_path = Some(relocated_playlist.clone());
        changed = true;
    }
    if let Some(current_playlist) = pull.playback_path.clone().filter(|path| path.is_file()) {
        let target_playlist = pull_directory.join("hls").join("index.m3u8");
        if current_playlist != target_playlist {
            if !target_playlist.is_file() {
                let current_hls = current_playlist
                    .parent()
                    .ok_or_else(|| format!("Pull {} 的 HLS 路径无效", pull.pull_id))?;
                fs::rename(current_hls, pull_directory.join("hls"))
                    .map_err(|error| format!("迁移 Pull {} HLS 失败：{error}", pull.pull_id))?;
            }
            pull.playback_path = Some(target_playlist);
            changed = true;
        }
    }
    if pull.timeline_indexed
        && (refresh_json
            || changed
            || !pull_directory.join("metadata.json").is_file()
            || !pull_directory.join("combat-log.json").is_file())
    {
        write_recording_json(pull, &mapping, &pull_directory)?;
    }
    Ok(changed)
}
