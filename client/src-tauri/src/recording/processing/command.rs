use std::{
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

use crate::recording::{config::FFMPEG_TIMEOUT_SECONDS, model::SourceSlice};

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

/// 使用参数数组执行受管媒体处理，并在超时后回收进程。
pub(crate) fn run_ffmpeg(
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
            source_start_unix_ms: None,
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
