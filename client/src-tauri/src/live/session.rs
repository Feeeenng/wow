use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::State;
use uuid::Uuid;

use crate::obs::{
    common::obs_error,
    runtime::service::{read_status, wait_for_recording_state, ObsState},
};

use super::{
    config::load_transport_config,
    model::LiveSession,
    state::{ActiveLiveSession, LiveState},
    whep::release_all_playbacks,
};

#[derive(Serialize)]
/// OBS `whip_custom` 服务只接受发布端点与 Bearer Token。
struct WhipSettings<'a> {
    server: &'a str,
    bearer_token: &'a str,
}

/// 返回适合跨端记录的 UTC Unix 毫秒时间。
fn unix_time_ms() -> Result<u64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .map_err(|error| format!("读取直播开始时间失败：{error}"))
}

/// 等待 OBS Streaming 输出完成状态切换。
async fn wait_for_stream_state(client: &obws::Client, expected: bool) -> Result<(), String> {
    for _ in 0..75 {
        let status = client
            .streaming()
            .status()
            .await
            .map_err(|error| obs_error("确认 OBS 直播状态失败", error))?;
        if status.active == expected {
            return Ok(());
        }
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }
    Err("OBS 直播状态切换超时".to_string())
}

/// 配置 OBS WHIP 输出，并与本地录像原子启动正式直播会话。
#[tauri::command]
pub async fn start_live_session(
    obs_state: State<'_, ObsState>,
    live_state: State<'_, LiveState>,
) -> Result<LiveSession, String> {
    let _operation = live_state.operation.lock().await;
    let transport = load_transport_config()?;
    let guard = obs_state.client.read().await;
    let client = guard
        .as_ref()
        .ok_or_else(|| "请先启动并连接 OBS".to_string())?;
    let mut status = read_status(client, &obs_state).await?;
    if !status.capture_ready {
        return Err("未检测到魔兽世界窗口，无法开始直播".to_string());
    }
    if status.live_active {
        return live_state
            .session
            .read()
            .await
            .as_ref()
            .map(|active| active.public.clone())
            .ok_or_else(|| "OBS 已存在其他直播输出，请先停止后重试".to_string());
    }
    if let Some(stale) = live_state.session.write().await.take() {
        let _ = release_all_playbacks(&live_state).await;
        if stale.public.recording_started_by_session && status.recording_active {
            client
                .recording()
                .stop()
                .await
                .map_err(|error| obs_error("清理上次直播录像失败", error))?;
            wait_for_recording_state(client, false).await?;
            status.recording_active = false;
        }
    }

    let bearer_token = transport.bearer_token.as_deref().unwrap_or_default();
    client
        .config()
        .set_stream_service_settings(
            "whip_custom",
            &WhipSettings {
                server: transport.whip_url.as_str(),
                bearer_token,
            },
        )
        .await
        .map_err(|error| obs_error("配置 OBS 直播服务失败", error))?;

    let started_at_unix_ms = unix_time_ms()?;
    let recording_started_by_session = !status.recording_active;
    if recording_started_by_session {
        client
            .recording()
            .start()
            .await
            .map_err(|error| obs_error("开始直播录像失败", error))?;
        if let Err(error) = wait_for_recording_state(client, true).await {
            let _ = client.recording().stop().await;
            return Err(error);
        }
    }

    if let Err(error) = client.streaming().start().await {
        if recording_started_by_session {
            let _ = client.recording().stop().await;
            let _ = wait_for_recording_state(client, false).await;
        }
        return Err(obs_error("启动 OBS WHIP 直播失败", error));
    }
    if let Err(error) = wait_for_stream_state(client, true).await {
        let _ = client.streaming().stop().await;
        if recording_started_by_session {
            let _ = client.recording().stop().await;
            let _ = wait_for_recording_state(client, false).await;
        }
        return Err(error);
    }

    let session = LiveSession {
        session_id: Uuid::new_v4().to_string(),
        started_at_unix_ms,
        recording_active: true,
        recording_started_by_session,
        ice_servers: transport.ice_servers.clone(),
    };
    *live_state.session.write().await = Some(ActiveLiveSession {
        public: session.clone(),
        transport,
    });
    Ok(session)
}

/// 返回当前正式直播会话，不因进入直播页重复启动 OBS 输出。
#[tauri::command]
pub async fn get_live_session(state: State<'_, LiveState>) -> Result<Option<LiveSession>, String> {
    Ok(state
        .session
        .read()
        .await
        .as_ref()
        .map(|active| active.public.clone()))
}

/// 停止 WHIP 发布，并只停止由当前直播会话启动的录像。
#[tauri::command]
pub async fn stop_live_session(
    obs_state: State<'_, ObsState>,
    live_state: State<'_, LiveState>,
) -> Result<(), String> {
    let _operation = live_state.operation.lock().await;
    let session = live_state
        .session
        .read()
        .await
        .clone()
        .ok_or_else(|| "当前 OBS 直播不属于客户端会话，未执行停止操作".to_string())?;
    let mut errors = release_all_playbacks(&live_state).await;
    let guard = obs_state.client.read().await;
    let Some(client) = guard.as_ref() else {
        errors.push("OBS 连接已断开，无法确认直播输出已经停止".to_string());
        return Err(errors.join("；"));
    };

    let stream_active = client
        .streaming()
        .status()
        .await
        .map(|status| status.active)
        .unwrap_or(false);
    let mut stream_stopped = !stream_active;
    if stream_active {
        match client.streaming().stop().await {
            Ok(_) => {
                match wait_for_stream_state(client, false).await {
                    Ok(_) => stream_stopped = true,
                    Err(error) => errors.push(error),
                }
            }
            Err(error) => errors.push(obs_error("停止 OBS WHIP 直播失败", error)),
        }
    }

    let mut recording_stopped = !session.public.recording_started_by_session;
    if stream_stopped && session.public.recording_started_by_session {
        let recording_active = client
            .recording()
            .status()
            .await
            .map(|status| status.active)
            .unwrap_or(false);
        if recording_active {
            match client.recording().stop().await {
                Ok(_) => {
                    match wait_for_recording_state(client, false).await {
                        Ok(_) => recording_stopped = true,
                        Err(error) => errors.push(error),
                    }
                }
                Err(error) => errors.push(obs_error("停止直播录像失败", error)),
            }
        } else {
            recording_stopped = true;
        }
    }

    if stream_stopped && recording_stopped {
        let mut guard = live_state.session.write().await;
        if guard
            .as_ref()
            .is_some_and(|current| current.public.session_id == session.public.session_id)
        {
            guard.take();
        }
    }

    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("；"))
    }
}
