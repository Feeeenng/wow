use serde::Serialize;

/// 每个已发布分片都保留独立墙钟锚点，重连造成的缺口不能压成连续时间。
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistorySegment {
    pub file: String,
    pub program_date_time: String,
    pub program_date_time_offset_seconds: f64,
    pub duration_seconds: f64,
    pub discontinuity: bool,
}

/// 只允许同一受管媒体路径下的普通文件，不接受路径、查询或外部地址。
pub fn valid_file(file: &str) -> bool {
    !file.is_empty() && file.len() < 160 && !file.contains("..")
        && file.bytes().all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.'))
        && [".m3u8", ".mp4", ".m4s"].iter().any(|suffix| file.ends_with(suffix))
}

/// MediaMTX 1.18 的音视频清单会携带 HLS 会话 UUID，只放行这一固定查询字段。
pub fn valid_reference(reference: &str) -> bool {
    match reference.split_once('?') {
        Some((file, query)) => valid_file(file) && query.strip_prefix("session=").is_some_and(|id| uuid::Uuid::parse_str(id).is_ok()),
        None => valid_file(reference),
    }
}

/// 提取主清单唯一音视频子清单，拒绝任意 URL 与多层路径。
pub fn media_playlist(master: &str) -> Result<String, String> {
    let file = master.lines().map(str::trim).find(|line| !line.is_empty() && !line.starts_with('#'))
        .ok_or("直播历史主清单尚未发布")?;
    if !valid_reference(file) || !file.split('?').next().unwrap_or_default().ends_with(".m3u8") { return Err("直播历史子清单路径无效".into()); }
    Ok(file.into())
}

/// 只接收带显式节目时间锚点的完整媒体分片；未知锚点时禁用业务跳转。
pub fn segments(playlist: &str) -> Result<Vec<HistorySegment>, String> {
    if !playlist.starts_with("#EXTM3U") { return Err("直播历史清单无效".into()); }
    let mut time = None;
    let mut duration = None;
    let mut discontinuity = false;
    let mut raw = Vec::new();
    let mut elapsed = 0.0;
    let mut group = 0;
    for line in playlist.lines().map(str::trim) {
        if let Some(value) = line.strip_prefix("#EXT-X-PROGRAM-DATE-TIME:") { time = Some(value.to_string()); }
        else if let Some(value) = line.strip_prefix("#EXTINF:") {
            duration = value.split(',').next().and_then(|value| value.parse::<f64>().ok())
                .filter(|value| value.is_finite() && *value > 0.0);
        } else if line == "#EXT-X-DISCONTINUITY" { discontinuity = true; group += 1; }
        else if !line.is_empty() && !line.starts_with('#') {
            if !valid_reference(line) { return Err("直播历史分片路径无效".into()); }
            let duration_seconds = duration.take().ok_or("直播历史分片缺少有效时长")?;
            raw.push((line.to_string(), time.take(), duration_seconds, discontinuity, elapsed, group));
            elapsed += duration_seconds;
            discontinuity = false;
        }
    }
    let mut result = Vec::new();
    let mut previous: Option<(&str, f64, usize)> = None;
    for (file, time, duration, discontinuity, start, group) in &raw {
        if let Some(time) = time { previous = Some((time, *start, *group)); }
        // HLS 允许只在部分分片声明节目时间；按 EXTINF 插值，但绝不跨 discontinuity 推导。
        let anchor = previous.filter(|(_, _, anchor_group)| anchor_group == group).or_else(|| {
            raw.iter().find(|(_, time, _, _, _, anchor_group)| time.is_some() && anchor_group == group)
                .map(|(_, time, _, _, anchor_start, anchor_group)| (time.as_deref().expect("已过滤时间锚点"), *anchor_start, *anchor_group))
        });
        if let Some((time, anchor_start, _)) = anchor {
            result.push(HistorySegment { file: file.clone(), program_date_time: time.into(), program_date_time_offset_seconds: start - anchor_start,
                duration_seconds: *duration, discontinuity: *discontinuity });
        }
    }
    if result.is_empty() { return Err("直播历史正在生成，暂时没有带时间锚点的分片".into()); }
    Ok(result)
}

/// 验证清单内所有引用均为同目录受控文件，代理保留相对地址即可隔离会话。
pub fn validate_references(playlist: &str) -> Result<(), String> {
    if !playlist.starts_with("#EXTM3U") { return Err("直播历史清单无效".into()); }
    for line in playlist.lines().map(str::trim) {
        if !line.is_empty() && !line.starts_with('#') && !valid_reference(line) { return Err("历史清单包含越界资源".into()); }
        for attribute in line.split("URI=\"").skip(1) {
            let reference = attribute.split('"').next().ok_or("历史清单引用无效")?;
            if !valid_reference(reference) { return Err("历史清单包含越界资源".into()); }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preserves_discontinuous_wall_time_and_rejects_external_references() {
        let text = "#EXTM3U\n#EXT-X-MAP:URI=\"init.mp4\"\n#EXT-X-PROGRAM-DATE-TIME:2026-10-16T12:00:00Z\n#EXTINF:4,\na.mp4\n#EXT-X-DISCONTINUITY\n#EXT-X-PROGRAM-DATE-TIME:2026-10-16T12:00:10Z\n#EXTINF:4,\nb.mp4\n";
        validate_references(text).unwrap();
        let parsed = segments(text).unwrap();
        assert_eq!(parsed.len(), 2); assert!(parsed[1].discontinuity);
        assert!(segments("#EXTM3U\n#EXTINF:4,\na.mp4").is_err());
        assert!(validate_references("#EXTM3U\n#EXT-X-MAP:URI=\"https://evil/a.mp4\"").is_err());
        assert!(!valid_file("../a.mp4")); assert!(!valid_file("a.mp4?token=x"));
        assert!(valid_reference("video1_stream.m3u8?session=32d8e1a1-082e-4046-9762-8db348ec5a2c"));
        assert!(!valid_reference("video1_stream.m3u8?session=32d8e1a1-082e-4046-9762-8db348ec5a2c&url=evil"));
    }
    #[test]
    fn interpolates_sparse_program_times_without_crossing_discontinuities() {
        let parsed = segments("#EXTM3U\n#EXTINF:4,\na.mp4\n#EXT-X-PROGRAM-DATE-TIME:2026-10-16T12:00:04Z\n#EXTINF:4,\nb.mp4\n#EXTINF:4,\nc.mp4\n#EXT-X-DISCONTINUITY\n#EXTINF:4,\nd.mp4\n").unwrap();
        assert_eq!(parsed.len(), 3);
        assert_eq!(parsed[0].program_date_time_offset_seconds, -4.0);
        assert_eq!(parsed[2].program_date_time_offset_seconds, 4.0);
    }
}
