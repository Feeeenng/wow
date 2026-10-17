use std::{
    fs,
    path::{Path, PathBuf},
};

use crate::recording::{
    model::{BossPull, ClipMapping, PullState},
    naming::recording_name,
    playback::hls::{build_hls_args, prepare_directory},
    processing::{
        artifacts::write_recording_json,
        command::{
            build_concat_args, build_concat_manifest, build_slice_args, build_validate_args,
            run_ffmpeg,
        },
    },
};

/// 汇总一个 Pull 的归档文件与本地播放清单。
pub struct ProcessedRecording {
    pub video_path: PathBuf,
    pub playback_path: Option<PathBuf>,
    pub playback_error: Option<String>,
    pub mapping: ClipMapping,
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
        crate::storage::replace_file(&parts[0], &output)
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
    let probe_parts = if parts.len() == 1 {
        vec![output.clone()]
    } else {
        parts.clone()
    };
    let mapping =
        match crate::recording::processing::probe::executable_path(ffmpeg).and_then(|probe| {
            crate::recording::processing::probe::calibrate_mapping(
                &probe,
                mapping,
                &probe_parts,
                &output,
                pull.encounter_start_unix_ms,
            )
        }) {
            Ok(mapping) => mapping,
            Err(error) => {
                // 校准失败不丢弃有效录像；缺片记录保持禁止精确跳转。
                let mut mapping = mapping.clone();
                mapping.intervals.clear();
                mapping.media_calibrated = false;
                mapping.calibration_error = Some(error);
                mapping
            }
        };
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
    finalized_pull.mapping = Some(mapping.clone());
    write_recording_json(&finalized_pull, &mapping, &pull_directory)?;
    let _ = fs::remove_dir_all(&work_directory);
    Ok(ProcessedRecording {
        video_path: output,
        playback_path,
        playback_error,
        mapping,
    })
}
