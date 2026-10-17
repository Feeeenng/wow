use std::{
    fs,
    path::Path,
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

use serde::Deserialize;

use crate::recording::{
    config::{
        MEDIA_PROBE_ERROR_CHAR_LIMIT, MEDIA_PROBE_MAX_BYTES, MEDIA_PROBE_PACKET_LIMIT,
        MEDIA_PROBE_POLL_INTERVAL_MS, MEDIA_PROBE_RELATIVE_PATH, MEDIA_PROBE_TIMEOUT_SECONDS,
    },
    model::{ClipInterval, ClipMapping},
};

/// 从录制 FFmpeg 的资源根目录定位隔离探测运行时。
pub fn executable_path(ffmpeg: &Path) -> Result<std::path::PathBuf, String> {
    ffmpeg
        .parent()
        .and_then(Path::parent)
        .map(|directory| directory.join(MEDIA_PROBE_RELATIVE_PATH))
        .ok_or_else(|| "无法从 FFmpeg 路径定位媒体探测组件".to_string())
}

#[derive(Deserialize)]
struct Packet {
    pts_time: Option<String>,
    data_hash: Option<String>,
    #[serde(default)]
    flags: String,
}

#[derive(Default, Deserialize)]
struct Timing {
    start_time: Option<String>,
    duration: Option<String>,
}

#[derive(Deserialize)]
struct Observation {
    #[serde(default)]
    packets: Vec<Packet>,
    #[serde(default)]
    streams: Vec<Timing>,
    #[serde(default)]
    format: Timing,
}

/// 将媒体秒数转换为日志同精度的毫秒，不接受无穷值。
fn milliseconds(value: &Option<String>) -> Option<i64> {
    value
        .as_ref()?
        .parse::<f64>()
        .ok()
        .filter(|value| value.is_finite())
        .map(|value| (value * 1_000.0).round() as i64)
}

impl Observation {
    /// 返回首个可显示包，排除仅用于解码预滚的 discard 包。
    fn first_packet(&self) -> Option<&Packet> {
        self.packets
            .iter()
            .filter(|packet| !packet.flags.contains('D'))
            .filter(|packet| {
                milliseconds(&packet.pts_time)
                    .is_some_and(|pts| self.video_start().is_none_or(|start| pts >= start))
            })
            .min_by_key(|packet| milliseconds(&packet.pts_time))
    }

    fn video_start(&self) -> Option<i64> {
        self.streams
            .first()
            .and_then(|stream| milliseconds(&stream.start_time))
    }

    fn video_end(&self) -> Option<i64> {
        let stream = self.streams.first()?;
        Some(milliseconds(&stream.start_time)? + milliseconds(&stream.duration)?)
    }

    fn duration(&self) -> Option<i64> {
        milliseconds(&self.format.duration).filter(|duration| *duration > 0)
    }
}

/// 运行受管 ffprobe，只读取固定数量的包，退出或超限时清理独有临时文件。
fn observe(probe: &Path, input: &Path, position_ms: i64) -> Result<Observation, String> {
    if !probe.is_file() {
        return Err("缺少内置媒体探测组件，录像仍可播放但时间对齐为估算".to_string());
    }
    let task_id = uuid::Uuid::new_v4();
    let directory = std::env::temp_dir();
    let output = directory.join(format!("wow-media-probe-{task_id}.json"));
    let errors = directory.join(format!("wow-media-probe-{task_id}.log"));
    let result = (|| {
        let mut command = Command::new(probe);
        command.args(["-v", "error", "-select_streams", "v:0", "-read_intervals"])
            .arg(format!("{:.3}%+#{MEDIA_PROBE_PACKET_LIMIT}", position_ms as f64 / 1_000.0))
            .args(["-show_packets", "-show_streams", "-show_format", "-show_data_hash", "sha256",
                "-show_entries", "packet=pts_time,data_hash,flags:stream=start_time,duration:format=start_time,duration",
                "-of", "json"])
            .arg(input)
            .stdin(Stdio::null())
            .stdout(fs::File::create(&output).map_err(|error| format!("创建媒体探测输出失败：{error}"))?)
            .stderr(fs::File::create(&errors).map_err(|error| format!("创建媒体探测诊断失败：{error}"))?);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let mut child = command
            .spawn()
            .map_err(|error| format!("启动媒体探测失败：{error}"))?;
        let deadline = Instant::now() + Duration::from_secs(MEDIA_PROBE_TIMEOUT_SECONDS);
        loop {
            match child.try_wait() {
                Ok(Some(status)) => {
                    if !status.success() {
                        let message = fs::read_to_string(&errors).unwrap_or_default();
                        return Err(format!(
                            "媒体探测失败（{status}）：{}",
                            message
                                .chars()
                                .take(MEDIA_PROBE_ERROR_CHAR_LIMIT)
                                .collect::<String>()
                        ));
                    }
                    let bytes =
                        fs::read(&output).map_err(|error| format!("读取媒体探测失败：{error}"))?;
                    if bytes.len() as u64 > MEDIA_PROBE_MAX_BYTES {
                        return Err("媒体探测输出超过限制".to_string());
                    }
                    return serde_json::from_slice(&bytes)
                        .map_err(|error| format!("解析媒体探测失败：{error}"));
                }
                Ok(None) => {}
                Err(error) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(format!("读取媒体探测进程失败：{error}"));
                }
            }
            let oversized = [&output, &errors].iter().any(|path| {
                fs::metadata(path).is_ok_and(|metadata| metadata.len() > MEDIA_PROBE_MAX_BYTES)
            });
            if Instant::now() >= deadline || oversized {
                let _ = child.kill();
                let _ = child.wait();
                return Err("媒体探测超时或输出超过限制".to_string());
            }
            thread::sleep(Duration::from_millis(MEDIA_PROBE_POLL_INTERVAL_MS));
        }
    })();
    let _ = fs::remove_file(output);
    let _ = fs::remove_file(errors);
    result
}

/// 有界读取外部原片头部，确认存在可显示视频并返回容器时长，不声明墙钟校准。
pub(crate) fn inspect_video(probe: &Path, input: &Path) -> Result<u64, String> {
    let observed = observe(probe, input, 0)?;
    observed.first_packet().ok_or("录像缺少可显示视频包")?;
    observed
        .duration()
        .map(|value| value as u64)
        .ok_or_else(|| "录像缺少有效时长".into())
}

/// 导入原片使用头部探测与有限解码；完整媒体解码由显式验收执行。
pub(crate) fn validate_external_video(
    ffmpeg: &Path,
    input: &Path,
    pull_id: &str,
) -> Result<(), String> {
    inspect_video(&executable_path(ffmpeg)?, input)?;
    let mut args = super::command::build_validate_args(input);
    args.splice(
        6..6,
        [
            "-t".into(),
            crate::recording::config::IMPORT_VALIDATION_SECONDS
                .to_string()
                .into(),
        ],
    );
    super::command::run_ffmpeg(ffmpeg, &args, pull_id, None)
}

/// 仅以唯一视频包摘要匹配源位置，不把目标 seek 秒数当成实际裁切点。
fn matched_pts(observation: &Observation, reference: &Packet) -> Result<i64, String> {
    let hash = reference.data_hash.as_ref().ok_or("视频包缺少摘要")?;
    let matches = observation
        .packets
        .iter()
        .filter(|packet| packet.data_hash.as_ref() == Some(hash))
        .filter_map(|packet| milliseconds(&packet.pts_time))
        .collect::<Vec<_>>();
    if matches.len() != 1 {
        return Err("无法唯一匹配裁切首帧的源视频包，保留估算对齐".to_string());
    }
    Ok(matches[0])
}

/// 用首段的多个相邻包确认整体位移，允许拼接器丢弃预滚或改写首个参数包。
fn initial_shift(
    part: &Observation,
    output: &Observation,
    format_start: i64,
) -> Result<i64, String> {
    let references = part
        .packets
        .iter()
        .filter(|packet| !packet.flags.contains('D'))
        .filter(|packet| packet.data_hash.is_some() && milliseconds(&packet.pts_time).is_some())
        .take(8)
        .collect::<Vec<_>>();
    let mut candidates = Vec::new();
    for reference in &references {
        let part_pts = milliseconds(&reference.pts_time).expect("已过滤时间戳");
        for packet in &output.packets {
            if packet.flags.contains('D') || packet.data_hash != reference.data_hash {
                continue;
            }
            if let Some(pts) = milliseconds(&packet.pts_time) {
                candidates.push(pts - (part_pts - format_start));
            }
        }
    }
    candidates.sort_by_key(|value| value.unsigned_abs());
    candidates.dedup();
    for shift in candidates {
        let support = references
            .iter()
            .filter(|reference| {
                let expected =
                    milliseconds(&reference.pts_time).expect("已过滤时间戳") - format_start + shift;
                output.packets.iter().any(|packet| {
                    !packet.flags.contains('D')
                        && packet.data_hash == reference.data_hash
                        && milliseconds(&packet.pts_time)
                            .is_some_and(|pts| (pts - expected).abs() <= 1)
                })
            })
            .count();
        if support >= 3.min(references.len()) && support > 0 {
            return Ok(shift);
        }
    }
    Err("最终视频无法通过相邻视频包确认拼接位置，保留估算对齐".to_string())
}

/// 校正裁切与拼接的媒体位置；源文件墙钟仍为估算，不能据此声明帧级日志同步。
pub fn calibrate_mapping(
    probe: &Path,
    mapping: &ClipMapping,
    parts: &[std::path::PathBuf],
    output: &Path,
    encounter_start_ms: i64,
) -> Result<ClipMapping, String> {
    if parts.len() != mapping.slices.len() || parts.is_empty() {
        return Err("媒体校准缺少完整源片段".to_string());
    }
    if mapping.clock_discontinuous {
        return Err("录制时钟或输出进度发生不连续，不能自动对齐该录像".to_string());
    }
    let final_media = observe(probe, output, 0)?;
    let mut result = mapping.clone();
    let mut intervals = Vec::new();
    let mut output_base = 0;
    let mut final_shift = None;
    for (slice, part) in mapping.slices.iter().zip(parts) {
        let source_wall = slice.source_start_unix_ms.ok_or("旧片段缺少源录像起点")?;
        let source_header = observe(probe, &slice.path, 0)?;
        let source_origin = source_header
            .video_start()
            .ok_or("源录像缺少视频时间原点")?;
        let source = observe(probe, &slice.path, source_origin + slice.offset_ms as i64)?;
        let media = observe(probe, part, 0)?;
        let packet = media.first_packet().ok_or("裁切视频没有可显示的视频包")?;
        let part_pts = milliseconds(&packet.pts_time).ok_or("裁切视频缺少时间戳")?;
        let source_pts = matched_pts(&source, packet)?;
        let format_start =
            milliseconds(&media.format.start_time).ok_or("裁切视频缺少容器时间原点")?;
        let shift = match final_shift {
            Some(shift) => shift,
            None => {
                let shift = initial_shift(&media, &final_media, format_start)?;
                final_shift = Some(shift);
                shift
            }
        };
        let raw_start = output_base + part_pts - format_start + shift;
        let video_start = raw_start.max(final_media.video_start().unwrap_or(raw_start));
        let skipped = video_start - raw_start;
        let duration = media.video_end().ok_or("裁切视频缺少实际视频时长")? - part_pts - skipped;
        let pull_start = source_wall + source_pts - source_origin - encounter_start_ms + skipped;
        if duration <= 0 || video_start < 0 {
            return Err("裁切视频校准后区间无效".to_string());
        }
        if intervals
            .last()
            .is_some_and(|previous: &ClipInterval| previous.pull_end_ms > pull_start)
        {
            return Err("源录像墙钟重叠，无法建立唯一战斗时间映射".to_string());
        }
        intervals.push(ClipInterval {
            pull_start_ms: pull_start,
            pull_end_ms: pull_start + duration,
            video_start_ms: video_start,
            video_end_ms: video_start + duration,
        });
        output_base += media.duration().ok_or("裁切视频缺少容器时长")?;
    }
    let first = &intervals[0];
    result.video_zero_ms = first.video_start_ms - first.pull_start_ms;
    result.actual_start_unix_ms = encounter_start_ms + first.pull_start_ms;
    result.actual_end_unix_ms =
        encounter_start_ms + intervals.last().expect("已确认有区间").pull_end_ms;
    result.media_duration_ms = final_media.duration().map(|duration| duration as u64);
    result.intervals = intervals;
    result.media_calibrated = true;
    result.calibration_error = None;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::{matched_pts, Observation};

    #[test]
    fn ignores_discard_preroll_and_matches_reordered_packet_pts() {
        let part: Observation = serde_json::from_str(
            r#"{
            "streams":[{"start_time":"0.040","duration":"1.000"}],
            "packets":[
                {"pts_time":"-0.040","data_hash":"discard","flags":"KD"},
                {"pts_time":"0.080","data_hash":"later","flags":"__"},
                {"pts_time":"0.040","data_hash":"first","flags":"K_"}
            ]
        }"#,
        )
        .unwrap();
        let source: Observation = serde_json::from_str(
            r#"{
            "packets":[{"pts_time":"12.240","data_hash":"first","flags":"K_"}]
        }"#,
        )
        .unwrap();
        let first = part.first_packet().unwrap();
        assert_eq!(first.data_hash.as_deref(), Some("first"));
        assert_eq!(matched_pts(&source, first).unwrap(), 12_240);
    }

    #[test]
    fn ambiguous_packet_match_does_not_publish_a_false_mapping() {
        let source: Observation = serde_json::from_str(
            r#"{
            "packets":[
                {"pts_time":"1.0","data_hash":"same","flags":"K_"},
                {"pts_time":"2.0","data_hash":"same","flags":"K_"}
            ]
        }"#,
        )
        .unwrap();
        assert!(matched_pts(&source, &source.packets[0]).is_err());
    }
}
