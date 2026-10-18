use std::{fs, path::Path};

use super::paths::artifacts;
use crate::recording::{capture::state::RecordingState, model::PullState};

/// 暂存受管媒体后保存索引；保存失败时恢复原路径，日志和原片从不参与移动。
pub(super) async fn delete(
    state: &RecordingState,
    root: &Path,
    pull_id: &str,
) -> Result<(), String> {
    state
        .manage(async |index, store| {
            if index
                .active_pull
                .as_ref()
                .is_some_and(|pull| pull.pull_id == pull_id)
            {
                return Err("当前战斗正在录制，不能删除".into());
            }
            let position = index
                .pulls
                .iter()
                .position(|pull| pull.pull_id == pull_id)
                .ok_or("本地录像不存在")?;
            let pull = &index.pulls[position];
            if !matches!(
                pull.state,
                PullState::Ready | PullState::Partial | PullState::Failed | PullState::Interrupted
            ) {
                return Err("录像正在录制、等待或处理中，不能删除".into());
            }
            let (directory, targets, _) = artifacts(root, pull, index)?;
            if targets.is_empty() {
                return Err("没有可删除的客户端成片，原片和日志已保留".into());
            }
            let staging = directory.join(format!(".delete-{}", uuid::Uuid::new_v4()));
            fs::create_dir(&staging).map_err(|error| format!("创建删除暂存目录失败：{error}"))?;
            let mut moved = Vec::new();
            for target in targets {
                let staged = staging.join(target.file_name().ok_or("成片路径无效")?);
                if let Err(error) = fs::rename(&target, &staged) {
                    let rollback = rollback(&moved);
                    let _ = fs::remove_dir(&staging);
                    return Err(format!(
                        "录像仍被播放器或其他进程占用，未删除：{error}{rollback}"
                    ));
                }
                moved.push((target, staged));
            }
            let mut next = index.clone();
            next.pulls.remove(position);
            if let Err(error) = store.save(&next).await {
                let rollback = rollback(&moved);
                let _ = fs::remove_dir(&staging);
                return Err(format!(
                    "保存录像目录失败，已尝试恢复成片：{error}{rollback}"
                ));
            }
            *index = next;
            fs::remove_dir_all(&staging).map_err(|error| {
                format!(
                    "录像已从目录移除，但暂存媒体清理失败 {}：{error}",
                    staging.display()
                )
            })?;
            Ok(())
        })
        .await
}

fn rollback(moved: &[(std::path::PathBuf, std::path::PathBuf)]) -> String {
    let errors = moved
        .iter()
        .rev()
        .filter_map(|(target, staged)| {
            fs::rename(staged, target)
                .err()
                .map(|error| format!("{}：{error}", target.display()))
        })
        .collect::<Vec<_>>();
    if errors.is_empty() {
        String::new()
    } else {
        format!(
            "；恢复失败，媒体仍保存在删除暂存目录：{}",
            errors.join("；")
        )
    }
}
