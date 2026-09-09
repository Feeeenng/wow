pub(crate) mod discovery;
pub(crate) mod model;
pub(crate) mod parser;
pub(crate) mod reader;

use std::path::PathBuf;

use tauri::State;

use crate::local_state::LocalStateStore;

use self::{
    discovery::{discover_logs_directories, latest_combat_log, validate_logs_directory},
    model::{CombatLogSettings, CombatLogStatus, DiscoveryResult},
};

const COMBAT_LOG_STATE_SECTION: &str = "combatLog";

/// 读取 CombatLog 用户设置，后台监控与命令共用同一来源。
pub(crate) async fn load_settings(store: &LocalStateStore) -> Result<CombatLogSettings, String> {
    Ok(store
        .get::<CombatLogSettings>(COMBAT_LOG_STATE_SECTION)
        .await?
        .unwrap_or_default())
}

/// 返回已保存或自动发现的正式服 CombatLog 监控状态。
#[tauri::command]
pub async fn get_combat_log_status(
    store: State<'_, LocalStateStore>,
) -> Result<CombatLogStatus, String> {
    let mut settings = load_settings(&store).await?;
    let discovery = discover_logs_directories();
    if settings.directory.is_none() {
        if let DiscoveryResult::Found(path) = &discovery {
            settings.directory = Some(path.clone());
            store.set(COMBAT_LOG_STATE_SECTION, &settings).await?;
        }
    }
    let mut error = None;
    let current_file = if let Some(directory) = settings.directory.as_deref() {
        match latest_combat_log(directory) {
            Ok(path) => path.map(|value| value.to_string_lossy().into_owned()),
            Err(message) => {
                error = Some(message);
                None
            }
        }
    } else {
        None
    };
    let (discovery_state, candidates) = match discovery {
        DiscoveryResult::NotFound => ("notFound", Vec::new()),
        DiscoveryResult::Found(path) => ("found", vec![path.to_string_lossy().into_owned()]),
        DiscoveryResult::Multiple(paths) => (
            "multiple",
            paths
                .into_iter()
                .map(|path| path.to_string_lossy().into_owned())
                .collect(),
        ),
    };
    Ok(CombatLogStatus {
        directory: settings
            .directory
            .map(|path| path.to_string_lossy().into_owned()),
        current_file,
        monitoring: settings.monitoring,
        discovery_state: discovery_state.to_string(),
        candidates,
        error,
    })
}

/// 校验并保存用户选择的正式服 CombatLog 目录。
#[tauri::command]
pub async fn set_combat_log_directory(
    directory: String,
    store: State<'_, LocalStateStore>,
) -> Result<CombatLogStatus, String> {
    let path = PathBuf::from(directory.trim());
    if !validate_logs_directory(&path) {
        return Err("请选择中国区正式服的 _retail_\\Logs 目录".to_string());
    }
    let mut settings = load_settings(&store).await?;
    settings.directory = Some(
        std::fs::canonicalize(path).map_err(|error| format!("定位战斗日志目录失败：{error}"))?,
    );
    store.set(COMBAT_LOG_STATE_SECTION, &settings).await?;
    get_combat_log_status(store).await
}

/// 更新 CombatLog 自动监控开关。
#[tauri::command]
pub async fn set_combat_log_monitoring(
    monitoring: bool,
    store: State<'_, LocalStateStore>,
) -> Result<CombatLogStatus, String> {
    let mut settings = load_settings(&store).await?;
    settings.monitoring = monitoring;
    store.set(COMBAT_LOG_STATE_SECTION, &settings).await?;
    get_combat_log_status(store).await
}
