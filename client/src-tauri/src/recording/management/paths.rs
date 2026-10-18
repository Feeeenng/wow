use std::{
    fs,
    path::{Path, PathBuf},
};

use crate::recording::{
    model::{BossPull, RecordingIndex},
    naming::recording_name,
};

/// 只接受真实文件或目录；Windows 联接与重解析点同样拒绝。
pub(super) fn checked_metadata(path: &Path) -> Result<fs::Metadata, String> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| format!("读取录像路径 {} 失败：{error}", path.display()))?;
    #[cfg(windows)]
    let reparse = {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0
    };
    #[cfg(not(windows))]
    let reparse = false;
    if metadata.file_type().is_symlink() || reparse {
        return Err("录像路径包含符号链接或目录联接，已阻止操作".into());
    }
    Ok(metadata)
}

/// 由稳定产物命名推导目录，不接受前端传入文件路径。
pub(super) fn directory(root: &Path, pull: &BossPull) -> Result<PathBuf, String> {
    checked_metadata(root)?;
    let name = if pull.imported_source.is_some() {
        if pull.pull_id.len() != 64 || !pull.pull_id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err("导入录像身份无效".into());
        }
        pull.pull_id.clone()
    } else {
        recording_name(pull)
    };
    let expected = root.join(name);
    if !checked_metadata(&expected)?.is_dir() {
        return Err("受管理录像目录不存在".into());
    }
    let canonical_root = fs::canonicalize(root).map_err(|error| error.to_string())?;
    let actual = fs::canonicalize(&expected).map_err(|error| error.to_string())?;
    if actual.parent() != Some(canonical_root.as_path()) {
        return Err("录像目录超出客户端管理范围".into());
    }
    Ok(expected)
}

fn tree_bytes(path: &Path) -> Result<u64, String> {
    let metadata = checked_metadata(path)?;
    if metadata.is_file() {
        if !matches!(
            path.extension().and_then(|value| value.to_str()),
            Some("mp4" | "m3u8" | "m4s")
        ) {
            return Err("HLS目录存在非媒体文件，已阻止删除以保留日志".into());
        }
        return Ok(metadata.len());
    }
    let mut bytes = 0_u64;
    for entry in fs::read_dir(path).map_err(|error| error.to_string())? {
        bytes = bytes.saturating_add(tree_bytes(
            &entry.map_err(|error| error.to_string())?.path(),
        )?);
    }
    Ok(bytes)
}

/// 删除只涵盖该场成片及 HLS，原始 OBS、导入原片与日志均不得落入候选路径。
pub(super) fn artifacts(
    root: &Path,
    pull: &BossPull,
    index: &RecordingIndex,
) -> Result<(PathBuf, Vec<PathBuf>, u64), String> {
    let directory = directory(root, pull)?;
    let mut targets = Vec::new();
    if pull.imported_source.is_none() {
        let expected = directory.join(format!("{}.mp4", recording_name(pull)));
        if let Some(video) = &pull.video_path {
            if video != &expected {
                return Err("成片路径与客户端产物目录不一致".into());
            }
        }
        if fs::symlink_metadata(&expected).is_ok() {
            targets.push(expected);
        }
    }
    let hls = directory.join("hls");
    if let Some(playlist) = &pull.playback_path {
        if playlist != &hls.join("index.m3u8") {
            return Err("回放路径与客户端产物目录不一致".into());
        }
    }
    if fs::symlink_metadata(&hls).is_ok() {
        targets.push(hls);
    }
    let mut protected = index
        .sources
        .iter()
        .map(|source| &source.path)
        .collect::<Vec<_>>();
    for other in index.active_pull.iter().chain(index.pulls.iter()) {
        protected.extend(other.imported_source.iter());
        if let Some(mapping) = &other.mapping {
            protected.extend(mapping.slices.iter().map(|slice| &slice.path));
        }
        if other.pull_id != pull.pull_id {
            protected.extend(other.video_path.iter());
            protected.extend(other.playback_path.iter());
        }
    }
    let canonical_targets = targets
        .iter()
        .map(|path| fs::canonicalize(path).map_err(|error| error.to_string()))
        .collect::<Result<Vec<_>, _>>()?;
    for path in protected {
        let actual = fs::canonicalize(path).unwrap_or_else(|_| path.clone());
        if canonical_targets
            .iter()
            .any(|target| actual == *target || actual.starts_with(target))
        {
            return Err("成片目录包含原片或其他录像引用，已阻止删除".into());
        }
    }
    let mut bytes = 0_u64;
    for target in &targets {
        bytes = bytes.saturating_add(tree_bytes(target)?);
    }
    Ok((directory, targets, bytes))
}
