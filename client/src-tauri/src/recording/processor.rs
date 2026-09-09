use std::{
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

use serde::Serialize;

use crate::recording::{
    config::FFMPEG_TIMEOUT_SECONDS,
    model::{
        BossPull, ClipMapping, MetadataContentType, MetadataNamedId, PullCombatLog, PullState,
        RecordingMetadata, SourceSlice,
    },
    naming::{difficulty_name, recording_name},
    playback::hls::{build_hls_args, prepare_directory},
};

/// 汇总一个 Pull 的归档文件与本地播放清单。
pub struct ProcessedRecording {
    pub video_path: PathBuf,
    pub playback_path: Option<PathBuf>,
    pub playback_error: Option<String>,
}

/// 从已经完成的最终 MP4 生成本地 HLS 播放清单。
pub fn process_playback(
    ffmpeg: &Path,
    pull_directory: &Path,
    pull_id: &str,
    video_path: &Path,
) -> Result<PathBuf, String> {
    let (playback_directory, playback_path) = prepare_directory(pull_directory, pull_id)?;
    run_ffmpeg(
        ffmpeg,
        &build_hls_args(video_path),
        pull_id,
        Some(&playback_directory),
    )?;
    if fs::metadata(&playback_path)
        .map(|metadata| metadata.len() == 0)
        .unwrap_or(true)
    {
        return Err(format!("Pull {pull_id} 的 HLS 播放清单为空"));
    }
    Ok(playback_path)
}

fn seconds(milliseconds: u64) -> String {
    format!("{}.{:03}", milliseconds / 1_000, milliseconds % 1_000)
}

/// 构造单个源区间的 stream-copy 参数，不经过 Shell。
pub fn build_slice_args(slice: &SourceSlice, output: &Path) -> Vec<OsString> {
    vec![
        "-hide_banner".into(),
        "-loglevel".into(),
        "error".into(),
        "-y".into(),
        "-ss".into(),
        seconds(slice.offset_ms).into(),
        "-i".into(),
        slice.path.as_os_str().to_owned(),
        "-t".into(),
        seconds(slice.duration_ms).into(),
        "-map".into(),
        "0".into(),
        "-c".into(),
        "copy".into(),
        "-avoid_negative_ts".into(),
        "make_zero".into(),
        "-movflags".into(),
        "+faststart".into(),
        output.as_os_str().to_owned(),
    ]
}

/// 生成 FFmpeg concat demuxer 清单并转义路径中的单引号。
pub fn build_concat_manifest(parts: &[PathBuf]) -> String {
    parts
        .iter()
        .map(|path| {
            let normalized = path.to_string_lossy().replace('\\', "/");
            format!("file '{}'", normalized.replace('\'', "'\\''"))
        })
        .collect::<Vec<_>>()
        .join("\n")
        + "\n"
}

/// 构造最终合并 MP4 的 stream-copy 参数，不经过 Shell。
pub fn build_concat_args(manifest: &Path, output: &Path) -> Vec<OsString> {
    vec![
        "-hide_banner".into(),
        "-loglevel".into(),
        "error".into(),
        "-y".into(),
        "-f".into(),
        "concat".into(),
        "-safe".into(),
        "0".into(),
        "-i".into(),
        manifest.as_os_str().to_owned(),
        "-map".into(),
        "0".into(),
        "-c".into(),
        "copy".into(),
        "-avoid_negative_ts".into(),
        "make_zero".into(),
        "-movflags".into(),
        "+faststart".into(),
        output.as_os_str().to_owned(),
    ]
}

/// 构造最终成片的严格解码校验参数，避免损坏文件进入可回放状态。
pub fn build_validate_args(input: &Path) -> Vec<OsString> {
    vec![
        "-hide_banner".into(),
        "-xerror".into(),
        "-loglevel".into(),
        "error".into(),
        "-i".into(),
        input.as_os_str().to_owned(),
        "-map".into(),
        "0".into(),
        "-f".into(),
        "null".into(),
        "NUL".into(),
    ]
}

fn write_json_atomic<T: Serialize>(path: &Path, value: &T, pull_id: &str) -> Result<(), String> {
    let temporary = path.with_extension("json.tmp");
    let bytes = serde_json::to_vec_pretty(value)
        .map_err(|error| format!("序列化 Pull {pull_id} 的 {} 失败：{error}", path.display()))?;
    fs::write(&temporary, bytes)
        .map_err(|error| format!("写入 Pull {pull_id} 的 {} 失败：{error}", path.display()))?;
    fs::rename(&temporary, path)
        .map_err(|error| format!("保存 Pull {pull_id} 的 {} 失败：{error}", path.display()))
}

fn write_recording_json(
    pull: &BossPull,
    mapping: &ClipMapping,
    pull_directory: &Path,
) -> Result<(), String> {
    let difficulty = difficulty_name(pull.difficulty_id);
    let video_file_name = format!("{}.mp4", recording_name(pull));
    let metadata = RecordingMetadata {
        id: &pull.pull_id,
        actor_id: None,
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

fn run_ffmpeg(
    ffmpeg: &Path,
    args: &[OsString],
    pull_id: &str,
    working_directory: Option<&Path>,
) -> Result<(), String> {
    let stderr_path = std::env::temp_dir().join(format!(
        "wow-recorder-ffmpeg-{pull_id}-{}.log",
        std::process::id()
    ));
    let stderr_file = fs::File::create(&stderr_path)
        .map_err(|error| format!("创建 FFmpeg 诊断文件失败：{error}"))?;
    let mut command = Command::new(ffmpeg);
    command.args(args).stdout(Stdio::null()).stderr(stderr_file);
    if let Some(directory) = working_directory {
        command.current_dir(directory);
    }
    let mut child = command
        .spawn()
        .map_err(|error| format!("启动 FFmpeg 处理 Pull {pull_id} 失败：{error}"))?;
    let deadline = Instant::now() + Duration::from_secs(FFMPEG_TIMEOUT_SECONDS);
    while Instant::now() < deadline {
        if child
            .try_wait()
            .map_err(|error| format!("读取 FFmpeg 处理 Pull {pull_id} 状态失败：{error}"))?
            .is_some()
        {
            let status = child
                .wait()
                .map_err(|error| format!("等待 FFmpeg 处理 Pull {pull_id} 失败：{error}"))?;
            let stderr = fs::read_to_string(&stderr_path).unwrap_or_default();
            let _ = fs::remove_file(&stderr_path);
            if status.success() {
                return Ok(());
            }
            return Err(format!(
                "FFmpeg 处理 Pull {pull_id} 失败（{}）：{}",
                status,
                stderr.trim()
            ));
        }
        thread::sleep(Duration::from_millis(100));
    }
    let _ = child.kill();
    let _ = child.wait();
    let _ = fs::remove_file(&stderr_path);
    Err(format!(
        "FFmpeg 处理 Pull {pull_id} 超过 {FFMPEG_TIMEOUT_SECONDS} 秒，已终止"
    ))
}

/// 同步生成一个 Boss MP4、回放切片与战斗 JSON，调用方应放入阻塞任务线程。
pub fn process_clip(
    ffmpeg: &Path,
    output_directory: &Path,
    pull: &BossPull,
    mapping: &ClipMapping,
) -> Result<ProcessedRecording, String> {
    if !ffmpeg.is_file() {
        return Err(format!("未找到内置 FFmpeg：{}", ffmpeg.display()));
    }
    fs::create_dir_all(output_directory)
        .map_err(|error| format!("创建本地回放目录失败：{error}"))?;
    let work_directory = output_directory.join(".processing").join(&pull.pull_id);
    fs::create_dir_all(&work_directory)
        .map_err(|error| format!("创建 Pull 处理目录失败：{error}"))?;
    let mut parts = Vec::new();
    for (index, slice) in mapping.slices.iter().enumerate() {
        let part = work_directory.join(format!("part-{index:03}.mp4"));
        run_ffmpeg(ffmpeg, &build_slice_args(slice, &part), &pull.pull_id, None)?;
        parts.push(part);
    }
    if parts.is_empty() {
        return Err(format!("Pull {} 没有可处理的源录像", pull.pull_id));
    }
    let recording_name = recording_name(pull);
    let pull_directory = output_directory.join(&recording_name);
    fs::create_dir_all(&pull_directory)
        .map_err(|error| format!("创建 Pull {} 成片目录失败：{error}", pull.pull_id))?;
    let output = pull_directory.join(format!("{recording_name}.mp4"));
    if parts.len() == 1 {
        fs::rename(&parts[0], &output)
            .map_err(|error| format!("保存 Pull {} 视频失败：{error}", pull.pull_id))?;
    } else {
        let concat_path = work_directory.join("parts.txt");
        fs::write(&concat_path, build_concat_manifest(&parts))
            .map_err(|error| format!("写入 Pull {} 合并清单失败：{error}", pull.pull_id))?;
        run_ffmpeg(
            ffmpeg,
            &build_concat_args(&concat_path, &output),
            &pull.pull_id,
            None,
        )?;
    }
    let output_size = fs::metadata(&output)
        .map_err(|error| format!("检查 Pull {} 输出失败：{error}", pull.pull_id))?
        .len();
    if output_size == 0 {
        return Err(format!("Pull {} 输出视频为空", pull.pull_id));
    }
    run_ffmpeg(ffmpeg, &build_validate_args(&output), &pull.pull_id, None)?;
    let playback_result = process_playback(ffmpeg, &pull_directory, &pull.pull_id, &output);
    let mut finalized_pull = pull.clone();
    let (playback_path, playback_error) = match playback_result {
        Ok(path) => {
            finalized_pull.state = if mapping.has_gap {
                PullState::Partial
            } else {
                PullState::Ready
            };
            (Some(path), None)
        }
        Err(error) => {
            finalized_pull.state = PullState::Failed;
            (None, Some(error))
        }
    };
    finalized_pull.video_path = Some(output.clone());
    finalized_pull.playback_path = playback_path.clone();
    finalized_pull.error = playback_error.clone();
    write_recording_json(&finalized_pull, mapping, &pull_directory)?;
    let _ = fs::remove_dir_all(&work_directory);
    Ok(ProcessedRecording {
        video_path: output,
        playback_path,
        playback_error,
    })
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};

    use crate::recording::model::SourceSlice;

    use super::{build_concat_args, build_concat_manifest, build_slice_args, build_validate_args};

    #[test]
    fn slice_command_stream_copies_all_streams() {
        let slice = SourceSlice {
            path: PathBuf::from(r"D:\录像\source.mp4"),
            offset_ms: 5_250,
            duration_ms: 45_500,
        };
        let args = build_slice_args(&slice, Path::new(r"D:\output\part.mp4"));
        let values = args
            .iter()
            .map(|value| value.to_string_lossy())
            .collect::<Vec<_>>();

        assert!(values.windows(2).any(|pair| pair == ["-ss", "5.250"]));
        assert!(values.windows(2).any(|pair| pair == ["-t", "45.500"]));
        assert!(values.windows(2).any(|pair| pair == ["-map", "0"]));
        assert!(values.windows(2).any(|pair| pair == ["-c", "copy"]));
        assert!(values
            .windows(2)
            .any(|pair| pair == ["-avoid_negative_ts", "make_zero"]));
        assert!(values
            .windows(2)
            .any(|pair| pair == ["-movflags", "+faststart"]));
    }

    #[test]
    fn concat_manifest_escapes_single_quotes() {
        let manifest = build_concat_manifest(&[
            PathBuf::from(r"D:\parts\one.mp4"),
            PathBuf::from(r"D:\parts\boss's view.mp4"),
        ]);
        assert!(manifest.contains("file 'D:/parts/one.mp4'"));
        assert!(manifest.contains("file 'D:/parts/boss'\\''s view.mp4'"));
    }

    #[test]
    fn concat_command_uses_safe_argument_vector() {
        let args = build_concat_args(Path::new("parts.txt"), Path::new("boss.mp4"));
        let values = args
            .iter()
            .map(|value| value.to_string_lossy())
            .collect::<Vec<_>>();
        assert!(values.windows(2).any(|pair| pair == ["-f", "concat"]));
        assert!(values.windows(2).any(|pair| pair == ["-safe", "0"]));
        assert!(values.windows(2).any(|pair| pair == ["-c", "copy"]));
    }

    #[test]
    fn validation_command_decodes_all_streams_strictly() {
        let args = build_validate_args(Path::new("boss.mp4"));
        let values = args
            .iter()
            .map(|value| value.to_string_lossy())
            .collect::<Vec<_>>();
        assert!(values.iter().any(|value| value == "-xerror"));
        assert!(values.windows(2).any(|pair| pair == ["-map", "0"]));
        assert!(values.windows(2).any(|pair| pair == ["-f", "null"]));
    }
}
