use std::{
    collections::BTreeSet,
    path::{Path, PathBuf},
};

use crate::combat_log::model::DiscoveryResult;

/// 校验目录确实属于正式服 `_retail_\Logs`。
pub fn validate_logs_directory(path: &Path) -> bool {
    if !path.is_dir() {
        return false;
    }
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.eq_ignore_ascii_case("Logs"))
        && path
            .parent()
            .and_then(Path::file_name)
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.eq_ignore_ascii_case("_retail_"))
}

/// 从候选数量生成需要自动使用或交给用户选择的结果。
pub fn classify_candidates(mut candidates: Vec<PathBuf>) -> DiscoveryResult {
    candidates.sort();
    candidates.dedup();
    match candidates.len() {
        0 => DiscoveryResult::NotFound,
        1 => DiscoveryResult::Found(candidates.remove(0)),
        _ => DiscoveryResult::Multiple(candidates),
    }
}

/// 检查常见安装根目录，不对用户磁盘进行递归扫描。
pub fn discover_logs_directories() -> DiscoveryResult {
    let mut candidates = BTreeSet::new();
    if let Some(program_files) = std::env::var_os("ProgramFiles(x86)") {
        candidates.insert(PathBuf::from(program_files).join(r"World of Warcraft\_retail_\Logs"));
    }
    if let Some(program_files) = std::env::var_os("ProgramFiles") {
        candidates.insert(PathBuf::from(program_files).join(r"World of Warcraft\_retail_\Logs"));
    }
    for drive in b'C'..=b'Z' {
        let root = format!("{}:\\", drive as char);
        candidates.insert(PathBuf::from(&root).join(r"World of Warcraft\_retail_\Logs"));
        candidates.insert(PathBuf::from(&root).join(r"Games\World of Warcraft\_retail_\Logs"));
    }
    let valid = candidates
        .into_iter()
        .filter(|path| validate_logs_directory(path))
        .filter_map(|path| std::fs::canonicalize(path).ok())
        .collect();
    classify_candidates(valid)
}

/// 返回目录内最后修改的正式 CombatLog 文件。
pub fn latest_combat_log(directory: &Path) -> Result<Option<PathBuf>, String> {
    if !validate_logs_directory(directory) {
        return Err("战斗日志目录必须指向正式服 _retail_\\Logs".to_string());
    }
    let entries =
        std::fs::read_dir(directory).map_err(|error| format!("读取战斗日志目录失败：{error}"))?;
    let mut logs = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|error| format!("读取战斗日志目录项失败：{error}"))?;
        let path = entry.path();
        let valid_name = path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.starts_with("WoWCombatLog") && name.ends_with(".txt"));
        if valid_name && path.is_file() {
            let modified = entry
                .metadata()
                .and_then(|metadata| metadata.modified())
                .unwrap_or(std::time::SystemTime::UNIX_EPOCH);
            logs.push((modified, path));
        }
    }
    logs.sort_by(|left, right| left.0.cmp(&right.0).then_with(|| left.1.cmp(&right.1)));
    Ok(logs.pop().map(|(_, path)| path))
}

#[cfg(test)]
mod tests {
    use std::{fs, path::PathBuf, thread, time::Duration};

    use super::{classify_candidates, latest_combat_log, validate_logs_directory};
    use crate::combat_log::model::DiscoveryResult;

    fn temporary_directory() -> PathBuf {
        let path = std::env::temp_dir()
            .join(format!("wow-recorder-discovery-{}", uuid::Uuid::new_v4()))
            .join("_retail_")
            .join("Logs");
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn accepts_only_existing_retail_logs_directory() {
        let path = temporary_directory();
        assert!(validate_logs_directory(&path));
        assert!(!validate_logs_directory(path.parent().unwrap()));
        fs::remove_dir_all(path.ancestors().nth(2).unwrap()).unwrap();
    }

    #[test]
    fn selects_latest_combat_log_file() {
        let path = temporary_directory();
        let older = path.join("WoWCombatLog-old.txt");
        let latest = path.join("WoWCombatLog-new.txt");
        fs::write(&older, b"old").unwrap();
        thread::sleep(Duration::from_millis(20));
        fs::write(&latest, b"new").unwrap();
        fs::write(path.join("ClientLog.txt"), b"ignored").unwrap();

        assert_eq!(latest_combat_log(&path).unwrap(), Some(latest));
        fs::remove_dir_all(path.ancestors().nth(2).unwrap()).unwrap();
    }

    #[test]
    fn classifies_candidate_count() {
        assert_eq!(classify_candidates(Vec::new()), DiscoveryResult::NotFound);
        assert!(matches!(
            classify_candidates(vec![PathBuf::from("a")]),
            DiscoveryResult::Found(_)
        ));
        assert!(matches!(
            classify_candidates(vec![PathBuf::from("a"), PathBuf::from("b")]),
            DiscoveryResult::Multiple(_)
        ));
    }
}
