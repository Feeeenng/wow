use serde::Deserialize;
use std::{
    fs,
    path::{Component, Path, PathBuf},
};

use crate::recording::importing::{
    config::{MAX_METADATA_BYTES, MAX_RECORDINGS},
    model::ImportRequest,
};

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalPlayer {
    pub actor_id: u32,
    pub name: String,
    pub server_name: Option<String>,
    pub full_type: Option<String>,
}

#[derive(Clone, Deserialize)]
pub struct ExternalEncounter {
    pub id: u32,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalFight {
    pub report_code: String,
    pub fight_id: u32,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalMetadata {
    pub id: String,
    pub key: String,
    pub actor_id: u32,
    pub start_time: i64,
    pub end_time: i64,
    pub start_time_offset_ms: i64,
    pub encounter: ExternalEncounter,
    pub players: Vec<ExternalPlayer>,
    pub server_fight: Option<ExternalFight>,
}

pub struct Candidate {
    pub metadata: ExternalMetadata,
    pub video_path: PathBuf,
}

/// 只接受同目录 MP4 文件名，不允许旁车指向其他目录或网络位置。
pub fn load_candidate(metadata_path: &Path, root: &Path) -> Result<Candidate, String> {
    if !fs::canonicalize(metadata_path)
        .map_err(|error| error.to_string())?
        .starts_with(root)
    {
        return Err("录像旁车超出用户选择的目录".into());
    }
    if fs::metadata(metadata_path)
        .map_err(|error| error.to_string())?
        .len()
        > MAX_METADATA_BYTES
    {
        return Err("录像旁车超过大小限制".into());
    }
    let metadata: ExternalMetadata =
        serde_json::from_slice(&fs::read(metadata_path).map_err(|error| error.to_string())?)
            .map_err(|error| format!("录像旁车格式无效：{error}"))?;
    let key = Path::new(&metadata.key);
    if key.components().count() != 1
        || !matches!(key.components().next(), Some(Component::Normal(_)))
        || key
            .extension()
            .and_then(|value| value.to_str())
            .is_none_or(|value| !value.eq_ignore_ascii_case("mp4"))
        || metadata.end_time <= metadata.start_time
        || metadata.id.is_empty()
    {
        return Err("录像旁车中的文件名或战斗边界无效".into());
    }
    let video_path = fs::canonicalize(metadata_path.parent().ok_or("旁车缺少目录")?.join(key))
        .map_err(|error| format!("找不到旁车对应视频：{error}"))?;
    if !video_path.starts_with(root) || !video_path.is_file() {
        return Err("旁车视频超出用户选择的录像目录".into());
    }
    Ok(Candidate {
        metadata,
        video_path,
    })
}

/// 只读取选中目录及直接子目录内的固定旁车，不递归遍历磁盘。
pub fn candidates(request: &ImportRequest) -> Result<(Vec<Candidate>, Vec<String>), String> {
    let root =
        fs::canonicalize(&request.directory).map_err(|error| format!("录像目录不可用：{error}"))?;
    if !root.is_dir() {
        return Err("请选择录像目录".into());
    }
    let mut paths = vec![root.join("metadata.json")];
    for entry in fs::read_dir(&root).map_err(|error| error.to_string())? {
        let path = entry.map_err(|error| error.to_string())?.path();
        if path.is_dir() {
            paths.push(path.join("metadata.json"));
        }
    }
    paths.retain(|path| path.is_file());
    paths.sort();
    if paths.len() > MAX_RECORDINGS {
        return Err("录像目录旁车过多，请缩小导入范围".into());
    }
    let (mut found, mut issues) = (Vec::new(), Vec::new());
    for path in paths {
        match load_candidate(&path, &root) {
            Ok(candidate)
                if request.recording_ids.is_empty()
                    || request.recording_ids.contains(&candidate.metadata.id) =>
            {
                found.push(candidate)
            }
            Ok(_) => {}
            Err(error) => issues.push(format!("{}：{error}", path.display())),
        }
    }
    if found.is_empty() {
        return Err("未发现可导入的 MP4 与有效 metadata.json".into());
    }
    Ok((found, issues))
}
