use std::{
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
};

use crate::recording::config::HLS_SEGMENT_SECONDS;

pub const PLAYLIST_FILE_NAME: &str = "index.m3u8";

/// 返回指定 Pull 的固定 HLS 目录和播放清单路径。
pub fn prepare_directory(
    pull_directory: &Path,
    pull_id: &str,
) -> Result<(PathBuf, PathBuf), String> {
    let directory = pull_directory.join("hls");
    fs::create_dir_all(&directory)
        .map_err(|error| format!("创建 Pull {pull_id} 的 HLS 目录失败：{error}"))?;
    let playlist = directory.join(PLAYLIST_FILE_NAME);
    Ok((directory, playlist))
}

/// 构造从最终 MP4 无重新编码生成 CMAF/fMP4 HLS 的参数。
pub fn build_hls_args(input: &Path) -> Vec<OsString> {
    vec![
        "-hide_banner".into(),
        "-loglevel".into(),
        "error".into(),
        "-y".into(),
        "-i".into(),
        input.as_os_str().to_owned(),
        "-map".into(),
        "0:v:0".into(),
        "-map".into(),
        "0:a:0?".into(),
        "-c".into(),
        "copy".into(),
        "-f".into(),
        "hls".into(),
        "-hls_time".into(),
        HLS_SEGMENT_SECONDS.to_string().into(),
        "-hls_playlist_type".into(),
        "vod".into(),
        "-hls_segment_type".into(),
        "fmp4".into(),
        "-hls_flags".into(),
        "independent_segments".into(),
        "-hls_fmp4_init_filename".into(),
        "init.mp4".into(),
        "-hls_segment_filename".into(),
        "segment-%05d.m4s".into(),
        PLAYLIST_FILE_NAME.into(),
    ]
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::build_hls_args;

    #[test]
    fn hls_output_uses_relative_cmaf_files_without_reencoding() {
        let args = build_hls_args(Path::new(r"C:\recordings\boss.mp4"));
        let values = args
            .iter()
            .map(|value| value.to_string_lossy())
            .collect::<Vec<_>>();

        assert!(values.windows(2).any(|pair| pair == ["-c", "copy"]));
        assert!(values
            .windows(2)
            .any(|pair| pair == ["-hls_segment_type", "fmp4"]));
        assert!(values
            .windows(2)
            .any(|pair| pair == ["-hls_playlist_type", "vod"]));
        assert_eq!(
            values.last().map(|value| value.as_ref()),
            Some("index.m3u8")
        );
    }
}
