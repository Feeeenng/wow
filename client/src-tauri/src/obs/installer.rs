use std::{fs::File, io, path::Path, process::Command, sync::atomic::Ordering};

use futures_util::StreamExt;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, State};
use tokio::io::AsyncWriteExt;

use super::{
    config::{
        load_or_create_config, OBS_DOWNLOAD_SHA256, OBS_DOWNLOAD_URL, OBS_VERSION,
        OBS_WEBSOCKET_PORT,
    },
    model::{ObsInstallationStatus, ObsStatus},
    service::{connect_with_credentials, ObsState},
};

/// 在 OBS 便携配置目录中启用仅供本机客户端使用的 WebSocket 服务。
async fn write_websocket_config(config: &super::config::PortableObsConfig) -> Result<(), String> {
    let directory = config
        .install_dir
        .join("config")
        .join("obs-studio")
        .join("plugin_config")
        .join("obs-websocket");
    tokio::fs::create_dir_all(&directory)
        .await
        .map_err(|error| format!("创建 OBS WebSocket 配置目录失败：{error}"))?;
    let value = serde_json::json!({
        "alerts_enabled": false,
        "auth_required": true,
        "first_load": false,
        "server_enabled": true,
        "server_password": config.websocket_password,
        "server_port": OBS_WEBSOCKET_PORT,
    });
    let bytes = serde_json::to_vec_pretty(&value)
        .map_err(|error| format!("序列化 OBS WebSocket 配置失败：{error}"))?;
    tokio::fs::write(directory.join("config.json"), bytes)
        .await
        .map_err(|error| format!("保存 OBS WebSocket 配置失败：{error}"))
}

fn installation_status(
    config: &super::config::PortableObsConfig,
    installing: bool,
) -> ObsInstallationStatus {
    ObsInstallationStatus {
        expected_version: OBS_VERSION.to_string(),
        installed: config.executable_path().is_file(),
        installing,
        install_dir: config.install_dir.to_string_lossy().into_owned(),
    }
}

/// 返回客户端所需 OBS 的安装状态。
#[tauri::command]
pub async fn get_obs_installation(
    app: AppHandle,
    state: State<'_, ObsState>,
) -> Result<ObsInstallationStatus, String> {
    let config = load_or_create_config(&app, None).await?;
    Ok(installation_status(
        &config,
        state.installing.load(Ordering::Relaxed),
    ))
}

fn extract_archive(archive_path: &Path, install_dir: &Path) -> Result<(), String> {
    let file = File::open(archive_path).map_err(|error| format!("打开 OBS 安装包失败：{error}"))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|error| format!("读取 OBS 安装包失败：{error}"))?;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| format!("读取 OBS 安装文件失败：{error}"))?;
        let relative = entry
            .enclosed_name()
            .ok_or_else(|| "OBS 安装包包含不安全路径".to_string())?;
        let target = install_dir.join(relative);
        if entry.is_dir() {
            std::fs::create_dir_all(&target)
                .map_err(|error| format!("创建 OBS 安装目录失败：{error}"))?;
            continue;
        }
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("创建 OBS 安装目录失败：{error}"))?;
        }
        let mut output =
            File::create(&target).map_err(|error| format!("写入 OBS 安装文件失败：{error}"))?;
        io::copy(&mut entry, &mut output)
            .map_err(|error| format!("解压 OBS 安装文件失败：{error}"))?;
    }
    Ok(())
}

/// 从官方发布页下载、校验并安装固定版本的 OBS。
#[tauri::command]
pub async fn install_portable_obs(
    app: AppHandle,
    install_dir: Option<String>,
    state: State<'_, ObsState>,
) -> Result<ObsInstallationStatus, String> {
    state
        .installing
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .map_err(|_| "OBS 正在安装，请等待当前任务完成".to_string())?;
    let result = install_portable_obs_inner(&app, install_dir).await;
    state.installing.store(false, Ordering::SeqCst);
    result
}

async fn install_portable_obs_inner(
    app: &AppHandle,
    install_dir: Option<String>,
) -> Result<ObsInstallationStatus, String> {
    let config = load_or_create_config(app, install_dir).await?;
    tokio::fs::create_dir_all(&config.install_dir)
        .await
        .map_err(|error| format!("创建 OBS 安装目录失败：{error}"))?;
    let archive_path = app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("无法定位客户端缓存目录：{error}"))?
        .join(format!("obs-studio-{OBS_VERSION}.zip"));
    if let Some(parent) = archive_path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|error| format!("创建下载缓存目录失败：{error}"))?;
    }

    let response = reqwest::get(OBS_DOWNLOAD_URL)
        .await
        .map_err(|error| format!("下载 OBS 失败：{error}"))?
        .error_for_status()
        .map_err(|error| format!("下载 OBS 失败：{error}"))?;
    let mut file = tokio::fs::File::create(&archive_path)
        .await
        .map_err(|error| format!("创建 OBS 安装包失败：{error}"))?;
    let mut hasher = Sha256::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| format!("下载 OBS 数据失败：{error}"))?;
        hasher.update(&chunk);
        file.write_all(&chunk)
            .await
            .map_err(|error| format!("保存 OBS 安装包失败：{error}"))?;
    }
    file.flush()
        .await
        .map_err(|error| format!("保存 OBS 安装包失败：{error}"))?;
    drop(file);
    let checksum = format!("{:x}", hasher.finalize());
    if checksum != OBS_DOWNLOAD_SHA256 {
        return Err("OBS 安装包 SHA-256 校验失败，已停止安装".to_string());
    }

    let archive = archive_path.clone();
    let target = config.install_dir.clone();
    tokio::task::spawn_blocking(move || extract_archive(&archive, &target))
        .await
        .map_err(|error| format!("OBS 解压任务失败：{error}"))??;
    tokio::fs::write(config.portable_marker_path(), b"")
        .await
        .map_err(|error| format!("创建 OBS 便携模式标记失败：{error}"))?;
    let _ = tokio::fs::remove_file(archive_path).await;
    Ok(installation_status(&config, false))
}

/// 启动受客户端管理的 OBS 进程并连接其 WebSocket。
#[tauri::command]
pub async fn launch_portable_obs(
    app: AppHandle,
    state: State<'_, ObsState>,
) -> Result<ObsStatus, String> {
    state
        .launching
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .map_err(|_| "OBS 正在启动".to_string())?;
    let result = launch_obs_inner(&app, &state).await;
    state.launching.store(false, Ordering::SeqCst);
    result
}

/// 启动或重新连接 OBS，供界面命令和后台守护共同调用。
async fn launch_obs_inner(app: &AppHandle, state: &ObsState) -> Result<ObsStatus, String> {
    let config = load_or_create_config(&app, None).await?;
    let executable = config.executable_path();
    if !executable.is_file() {
        return Err("尚未安装 OBS Studio".to_string());
    }
    if let Ok(status) = connect_with_credentials(
        "127.0.0.1",
        OBS_WEBSOCKET_PORT,
        &config.websocket_password,
        &state,
    )
    .await
    {
        return Ok(status);
    }
    write_websocket_config(&config).await?;
    Command::new(&executable)
        .current_dir(
            executable
                .parent()
                .ok_or_else(|| "OBS 可执行文件路径无效".to_string())?,
        )
        .args([
            "--portable",
            "--disable-updater",
            "--minimize-to-tray",
            "--websocket_ipv4_only",
            &format!("--websocket_port={OBS_WEBSOCKET_PORT}"),
            &format!("--websocket_password={}", config.websocket_password),
        ])
        .spawn()
        .map_err(|error| format!("启动 OBS 失败：{error}"))?;

    let mut last_error = "OBS WebSocket 尚未就绪".to_string();
    for _ in 0..20 {
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        match tokio::time::timeout(
            std::time::Duration::from_secs(1),
            connect_with_credentials(
                "127.0.0.1",
                OBS_WEBSOCKET_PORT,
                &config.websocket_password,
                state,
            ),
        )
        .await
        {
            Ok(Ok(status)) => return Ok(status),
            Ok(Err(error)) => last_error = error,
            Err(_) => last_error = "OBS WebSocket 连接超时".to_string(),
        }
    }
    Err(format!("OBS 已启动，但 WebSocket 连接超时：{last_error}"))
}

/// 在客户端生命周期内持续监测 OBS，用户关闭后自动重新启动。
pub async fn maintain_obs(app: AppHandle) {
    loop {
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        let state = app.state::<ObsState>();
        if state.installing.load(Ordering::Relaxed) || state.launching.load(Ordering::Relaxed) {
            continue;
        }
        let Ok(config) = load_or_create_config(&app, None).await else {
            continue;
        };
        if !config.executable_path().is_file() {
            continue;
        }
        let connected = {
            let guard = state.client.read().await;
            if let Some(client) = guard.as_ref() {
                client.general().version().await.is_ok()
            } else {
                false
            }
        };
        if connected {
            continue;
        }
        state.client.write().await.take();
        *state.connected_at.write().await = None;
        if state
            .launching
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            continue;
        }
        let _ = launch_obs_inner(&app, &state).await;
        state.launching.store(false, Ordering::SeqCst);
    }
}

/// 使用资源管理器打开 OBS 安装目录。
#[tauri::command]
pub async fn open_obs_install_directory(app: AppHandle) -> Result<(), String> {
    let config = load_or_create_config(&app, None).await?;
    std::fs::create_dir_all(&config.install_dir)
        .map_err(|error| format!("创建 OBS 安装目录失败：{error}"))?;
    Command::new("explorer")
        .arg(&config.install_dir)
        .spawn()
        .map_err(|error| format!("打开 OBS 安装目录失败：{error}"))?;
    Ok(())
}
