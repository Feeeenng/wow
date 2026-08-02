use tauri::AppHandle;

use super::config::{local_media_config, runtime_config_content, LocalMediaConfig};

/// 定位随安装包内置的媒体运行时，并生成本次启动所需配置。
pub async fn prepare_runtime(app: &AppHandle) -> Result<LocalMediaConfig, String> {
    let config = local_media_config(app)?;
    if !config.executable_path().is_file() {
        return Err("客户端缺少内置直播组件，请重新安装软件".to_string());
    }
    tokio::fs::create_dir_all(&config.runtime_dir)
        .await
        .map_err(|error| format!("创建本地直播运行目录失败：{error}"))?;
    tokio::fs::write(config.runtime_config_path(), runtime_config_content())
        .await
        .map_err(|error| format!("保存本地直播配置失败：{error}"))?;
    Ok(config)
}
