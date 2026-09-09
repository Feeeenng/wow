use std::{
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

use crate::recording::{
    config::FFMPEG_TIMEOUT_SECONDS,
    model::{BossPull, ClipMapping, PullManifest, PullState, SourceSlice},
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
    output_directory: &Path,
    pull_id: &str,
    video_path: &Path,
) -> Result<PathBuf, String> {
    let (playback_directory, playback_path) = prepare_directory(output_directory, pull_id)?;
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

fn safe_file_component(value: &str) -> String {
    let value = value
        .chars()
        .map(|character| match character {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            _ => character,
        })
        .collect::<String>();
    let trimmed = value.trim().trim_end_matches(['.', ' ']);
    if trimmed.is_empty() { "Boss".to_string() } else { trimmed.to_string() }
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

/// 同步生成一个 Boss MP4 与 manifest，调用方应放入阻塞任务线程。
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
    let short_id = pull.pull_id.get(..8).unwrap_or(&pull.pull_id);
    let output = output_directory.join(format!(
        "{}-{}-{short_id}.mp4",
        safe_file_component(&pull.encounter_name),
        pull.encounter_start_unix_ms
    ));
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
    run_ffmpeg(
        ffmpeg,
        &build_validate_args(&output),
        &pull.pull_id,
        None,
    )?;
    let playback_result = process_playback(ffmpeg, output_directory, &pull.pull_id, &output);
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
    let manifest = PullManifest {
        schema_version: 1,
        pull: &finalized_pull,
        mapping,
    };
    let manifest_path = output.with_extension("json");
    let manifest_temporary = manifest_path.with_extension("json.tmp");
    let bytes = serde_json::to_vec_pretty(&manifest)
        .map_err(|error| format!("序列化 Pull {} manifest 失败：{error}", pull.pull_id))?;
    fs::write(&manifest_temporary, bytes)
        .map_err(|error| format!("写入 Pull {} manifest 失败：{error}", pull.pull_id))?;
    fs::rename(&manifest_temporary, &manifest_path)
        .map_err(|error| format!("保存 Pull {} manifest 失败：{error}", pull.pull_id))?;
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
        let values = args.iter().map(|value| value.to_string_lossy()).collect::<Vec<_>>();

        assert!(values.windows(2).any(|pair| pair == ["-ss", "5.250"]));
        assert!(values.windows(2).any(|pair| pair == ["-t", "45.500"]));
        assert!(values.windows(2).any(|pair| pair == ["-map", "0"]));
        assert!(values.windows(2).any(|pair| pair == ["-c", "copy"]));
        assert!(values.windows(2).any(|pair| pair == ["-avoid_negative_ts", "make_zero"]));
        assert!(values.windows(2).any(|pair| pair == ["-movflags", "+faststart"]));
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
        let values = args.iter().map(|value| value.to_string_lossy()).collect::<Vec<_>>();
        assert!(values.windows(2).any(|pair| pair == ["-f", "concat"]));
        assert!(values.windows(2).any(|pair| pair == ["-safe", "0"]));
        assert!(values.windows(2).any(|pair| pair == ["-c", "copy"]));
    }

    #[test]
    fn validation_command_decodes_all_streams_strictly() {
        let args = build_validate_args(Path::new("boss.mp4"));
        let values = args.iter().map(|value| value.to_string_lossy()).collect::<Vec<_>>();
        assert!(values.iter().any(|value| value == "-xerror"));
        assert!(values.windows(2).any(|pair| pair == ["-map", "0"]));
        assert!(values.windows(2).any(|pair| pair == ["-f", "null"]));
    }
}
