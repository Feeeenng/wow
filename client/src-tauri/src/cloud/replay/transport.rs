use std::time::Duration;

use crate::cloud::{
    auth::{connection::connection_key, credentials, model::StoredSettings},
    config::{API_PREFIX, MAX_API_RESPONSE_BYTES},
    state::CloudState,
};

/// 私有媒体读取绑定完整连接和选定团队；换服务／令牌后旧本地 URL 立即失效。
pub struct ReplayClient {
    pub settings: StoredSettings,
    pub connection: String,
    token: String,
    client: reqwest::Client,
}

impl ReplayClient {
    pub async fn current(state: &CloudState) -> Result<Self, String> {
        if let Some(error) = &state.recovery_error {
            return Err(error.clone());
        }
        let settings = state.settings.lock().await.clone();
        crate::cloud::config::endpoint(&settings.endpoint)?;
        uuid::Uuid::parse_str(settings.team_id.as_deref().ok_or("请先选择已授权团队")?)
            .map_err(|_| "团队身份无效")?;
        if settings.user_id.is_none() {
            return Err("请先验证云端账号身份".into());
        }
        let token = credentials::reveal(&settings.protected_token)?;
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(super::config::MEDIA_TIMEOUT_SECONDS))
            .build()
            .map_err(|error| error.without_url().to_string())?;
        Ok(Self {
            connection: connection_key(&settings),
            settings,
            token,
            client,
        })
    }

    /// 目录与媒体只访问程序固定的 API 路径，远端返回值不能改变主机。
    pub async fn request(
        &self,
        method: reqwest::Method,
        path: &str,
        media: bool,
        body: Option<&serde_json::Value>,
    ) -> Result<Vec<u8>, String> {
        let mut request = self
            .client
            .request(
                method,
                format!("{}{API_PREFIX}{path}", self.settings.endpoint),
            )
            .bearer_auth(&self.token);
        if let Some(body) = body {
            request = request
                .header(reqwest::header::CONTENT_TYPE, "application/json")
                .body(serde_json::to_vec(body).map_err(|_| "团队请求参数编码失败")?);
        }
        let mut response = request
            .send()
            .await
            .map_err(|error| format!("读取团队回放失败：{}", error.without_url()))?;
        if !response.status().is_success() {
            return Err(format!("团队回放返回 HTTP {}", response.status().as_u16()));
        }
        let maximum = if media {
            super::config::MAX_MEDIA_BYTES
        } else {
            MAX_API_RESPONSE_BYTES
        };
        if response
            .content_length()
            .is_some_and(|length| length > maximum as u64)
        {
            return Err("团队回放响应超过大小限制".into());
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|error| error.without_url().to_string())?
        {
            if bytes.len() + chunk.len() > maximum {
                return Err("团队回放响应超过大小限制".into());
            }
            bytes.extend_from_slice(&chunk);
        }
        Ok(bytes)
    }

    pub async fn still_current(&self, state: &CloudState) -> bool {
        connection_key(&*state.settings.lock().await) == self.connection
    }
}
