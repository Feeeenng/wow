use std::{
    process::{Command, Stdio},
    sync::atomic::Ordering,
    time::Duration,
};

#[cfg(windows)]
use std::os::windows::process::CommandExt;
use tauri::{AppHandle, Manager};

use crate::live::state::LiveState;

use super::{
    config::{LocalMediaConfig, MEDIA_HTTP_PORT, MEDIA_PATH},
    resource::prepare_runtime,
    state::LocalMediaState,
};

/// 判断受管媒体进程是否仍在运行，并清理已退出的句柄。
fn managed_process_running(state: &LocalMediaState) -> Result<bool, String> {
    let mut process = state
        .process
        .lock()
        .map_err(|_| "读取本地直播进程状态失败".to_string())?;
    match process.as_mut() {
        Some(child) => match child.try_wait() {
            Ok(None) => Ok(true),
            Ok(Some(_)) => {
                *process = None;
                Ok(false)
            }
            Err(error) => Err(format!("检查本地直播进程失败：{error}")),
        },
        None => Ok(false),
    }
}

/// 探测 MediaMTX 本机 WHIP/WHEP HTTP 服务是否已经监听。
async fn endpoint_ready() -> bool {
    let Ok(client) = reqwest::Client::builder()
        .timeout(Duration::from_millis(500))
        .build()
    else {
        return false;
    };
    client
        .get(format!(
            "http://127.0.0.1:{MEDIA_HTTP_PORT}/{MEDIA_PATH}/"
        ))
        .send()
        .await
        .is_ok_and(|response| response.status().is_success())
}

/// 确保本机媒体运行时已安装、已启动且可以接收 WHIP/WHEP 请求。
pub async fn ensure_running(
    app: &AppHandle,
    state: &LocalMediaState,
) -> Result<LocalMediaConfig, String> {
    let _operation = state.operation.lock().await;
    if state.shutting_down.load(Ordering::Relaxed) {
        return Err("客户端正在退出".to_string());
    }
    let config = prepare_runtime(app).await?;
    if managed_process_running(state)? {
        if endpoint_ready().await {
            return Ok(config);
        }
        shutdown(state);
    }

    let executable = config.executable_path();
    let mut command = Command::new(executable);
    command
        .current_dir(&config.runtime_dir)
        .arg(config.runtime_config_path())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    command.creation_flags(0x0800_0000);
    let child = command
        .spawn()
        .map_err(|error| format!("启动本地直播服务失败：{error}"))?;
    *state
        .process
        .lock()
        .map_err(|_| "保存本地直播进程状态失败".to_string())? = Some(child);

    for _ in 0..50 {
        if !managed_process_running(state)? {
            return Err("本地直播服务启动后异常退出".to_string());
        }
        if endpoint_ready().await {
            return Ok(config);
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    shutdown(state);
    Err("本地直播服务启动超时".to_string())
}

/// 直播期间持续守护本机媒体节点，异常退出后自动重新启动。
pub async fn maintain(app: AppHandle) {
    loop {
        tokio::time::sleep(Duration::from_secs(2)).await;
        let state = app.state::<LocalMediaState>();
        if state.shutting_down.load(Ordering::Relaxed) {
            return;
        }
        let live_state = app.state::<LiveState>();
        if live_state.session.read().await.is_none() {
            continue;
        }
        let _ = ensure_running(&app, &state).await;
    }
}

/// 客户端退出时关闭由自身启动的本机媒体进程。
pub fn shutdown(state: &LocalMediaState) {
    state.shutting_down.store(true, Ordering::SeqCst);
    let Ok(mut process) = state.process.lock() else {
        return;
    };
    if let Some(mut child) = process.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}
