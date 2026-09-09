use reqwest::{header, Client, StatusCode};
use tauri::State;
use uuid::Uuid;

use super::{
    config::{
        MAX_SDP_BYTES, PLAYBACK_READY_RETRIES, PLAYBACK_READY_RETRY_MILLISECONDS,
        SIGNAL_TIMEOUT_SECONDS,
    },
    model::WhepAnswer,
    state::{LiveState, PlaybackResource},
};

/// 创建带统一超时的直播信令客户端。
fn signaling_client() -> Result<Client, String> {
    Client::builder()
        .timeout(std::time::Duration::from_secs(SIGNAL_TIMEOUT_SECONDS))
        .build()
        .map_err(|error| format!("初始化直播播放信令失败：{error}"))
}

/// 删除媒体服务上的单个 WHEP 播放资源。
async fn delete_resource(resource: PlaybackResource) -> Result<(), String> {
    let client = signaling_client()?;
    let mut request = client.delete(resource.resource_url);
    if let Some(token) = resource.bearer_token {
        request = request.bearer_auth(token);
    }
    let response = request
        .send()
        .await
        .map_err(|error| format!("释放直播播放资源失败：{error}"))?;
    if response.status().is_success()
        || matches!(response.status(), StatusCode::NOT_FOUND | StatusCode::GONE)
    {
        Ok(())
    } else {
        Err(format!("释放直播播放资源失败：HTTP {}", response.status()))
    }
}

/// 使用浏览器生成的 SDP Offer 建立 WHEP 播放会话。
#[tauri::command]
pub async fn negotiate_live_playback(
    session_id: String,
    offer_sdp: String,
    state: State<'_, LiveState>,
) -> Result<WhepAnswer, String> {
    if offer_sdp.trim().is_empty() || offer_sdp.len() > MAX_SDP_BYTES {
        return Err("直播播放 SDP Offer 无效".to_string());
    }
    let active = state
        .session
        .read()
        .await
        .clone()
        .ok_or_else(|| "当前没有正在进行的直播".to_string())?;
    if active.public.session_id != session_id {
        return Err("直播会话已经更新，请重新进入直播页面".to_string());
    }

    let client = signaling_client()?;
    let mut response = None;
    for attempt in 0..PLAYBACK_READY_RETRIES {
        let mut request = client
            .post(active.transport.whep_url.clone())
            .header(header::CONTENT_TYPE, "application/sdp")
            .body(offer_sdp.clone());
        if let Some(token) = active.transport.bearer_token.as_ref() {
            request = request.bearer_auth(token);
        }
        let current = request
            .send()
            .await
            .map_err(|error| format!("连接直播播放服务失败：{error}"))?;
        if current.status() == StatusCode::CREATED {
            response = Some(current);
            break;
        }
        let retryable = matches!(
            current.status(),
            StatusCode::NOT_FOUND | StatusCode::CONFLICT | StatusCode::SERVICE_UNAVAILABLE
        );
        if !retryable || attempt + 1 == PLAYBACK_READY_RETRIES {
            return Err(format!("连接直播播放服务失败：HTTP {}", current.status()));
        }
        tokio::time::sleep(std::time::Duration::from_millis(
            PLAYBACK_READY_RETRY_MILLISECONDS,
        ))
        .await;
    }
    let response = response.ok_or_else(|| "本地直播画面尚未就绪".to_string())?;
    let location = response
        .headers()
        .get(header::LOCATION)
        .ok_or_else(|| "直播播放服务未返回资源地址".to_string())?
        .to_str()
        .map_err(|_| "直播播放服务返回了无效资源地址".to_string())?
        .to_string();
    let resource_url = active
        .transport
        .whep_url
        .join(&location)
        .map_err(|_| "直播播放服务返回了无效资源地址".to_string())?;
    let resource = PlaybackResource {
        resource_url,
        bearer_token: active.transport.bearer_token,
    };
    if response
        .content_length()
        .is_some_and(|length| length > MAX_SDP_BYTES as u64)
    {
        let _ = delete_resource(resource).await;
        return Err("直播播放服务返回的 SDP Answer 过大".to_string());
    }
    let answer_sdp = match response.text().await {
        Ok(answer) => answer,
        Err(error) => {
            let _ = delete_resource(resource).await;
            return Err(format!("读取直播播放应答失败：{error}"));
        }
    };
    if answer_sdp.trim().is_empty() || answer_sdp.len() > MAX_SDP_BYTES {
        let _ = delete_resource(resource).await;
        return Err("直播播放服务返回了无效 SDP Answer".to_string());
    }
    let still_active = state
        .session
        .read()
        .await
        .as_ref()
        .is_some_and(|current| current.public.session_id == session_id);
    if !still_active {
        let _ = delete_resource(resource).await;
        return Err("直播已停止".to_string());
    }

    let playback_id = Uuid::new_v4().to_string();
    state
        .playback_resources
        .write()
        .await
        .insert(playback_id.clone(), resource);
    Ok(WhepAnswer {
        playback_id,
        answer_sdp,
    })
}

/// 释放页面离开或切换视角时创建的 WHEP 播放资源。
#[tauri::command]
pub async fn release_live_playback(
    playback_id: String,
    state: State<'_, LiveState>,
) -> Result<(), String> {
    let resource = state.playback_resources.write().await.remove(&playback_id);
    if let Some(resource) = resource {
        delete_resource(resource).await?;
    }
    Ok(())
}

/// 停止发布前释放当前客户端创建的全部播放资源。
pub async fn release_all_playbacks(state: &LiveState) -> Vec<String> {
    let resources = state
        .playback_resources
        .write()
        .await
        .drain()
        .map(|(_, resource)| resource)
        .collect::<Vec<_>>();
    let mut errors = Vec::new();
    for resource in resources {
        if let Err(error) = delete_resource(resource).await {
            errors.push(error);
        }
    }
    errors
}
