use std::time::Duration;

use futures_util::{
    future::{select, Either},
    StreamExt,
};
use serde::{de::DeserializeOwned, Serialize};

use super::model::{PresignedPart, Registration, UploadStatus};
use crate::cloud::{
    auth::model::Identity,
    config::{self, API_PREFIX, API_TIMEOUT_SECONDS, MAX_API_RESPONSE_BYTES, PART_TIMEOUT_SECONDS},
    upload::state::TransferControl,
};

/// API 客户端只向明确配置的服务根地址发送 Bearer，不跟随重定向。
pub struct ApiClient {
    endpoint: String,
    token: String,
    client: reqwest::Client,
}

impl ApiClient {
    pub fn new(endpoint: &str, token: String) -> Result<Self, String> {
        let endpoint = config::endpoint(endpoint)?;
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(API_TIMEOUT_SECONDS))
            .build()
            .map_err(|error| error.without_url().to_string())?;
        Ok(Self {
            endpoint,
            token,
            client,
        })
    }

    async fn request<T: DeserializeOwned>(
        &self,
        method: reqwest::Method,
        path: &str,
        body: Option<Vec<u8>>,
    ) -> Result<T, String> {
        let mut request = self
            .client
            .request(method, format!("{}{API_PREFIX}{path}", self.endpoint))
            .bearer_auth(&self.token);
        if let Some(body) = body {
            request = request
                .header(reqwest::header::CONTENT_TYPE, "application/json")
                .body(body);
        }
        let response = request
            .send()
            .await
            .map_err(|error| format!("云端接口请求失败：{}", error.without_url()))?;
        if !response.status().is_success() {
            return Err(format!("云端接口返回 HTTP {}", response.status().as_u16()));
        }
        if response
            .content_length()
            .is_some_and(|length| length > MAX_API_RESPONSE_BYTES as u64)
        {
            return Err("云端响应超过大小限制".into());
        }
        let mut stream = response.bytes_stream();
        let mut bytes = Vec::new();
        while let Some(chunk) = stream.next().await {
            let chunk =
                chunk.map_err(|error| format!("读取云端响应失败：{}", error.without_url()))?;
            if bytes.len() + chunk.len() > MAX_API_RESPONSE_BYTES {
                return Err("云端响应超过大小限制".into());
            }
            bytes.extend_from_slice(&chunk);
        }
        serde_json::from_slice(&bytes).map_err(|_| "云端接口响应格式无效".into())
    }

    async fn post<T: DeserializeOwned>(
        &self,
        path: &str,
        body: &impl Serialize,
    ) -> Result<T, String> {
        self.request(
            reqwest::Method::POST,
            path,
            Some(serde_json::to_vec(body).map_err(|_| "无法编码云端请求")?),
        )
        .await
    }

    pub async fn me(&self) -> Result<Identity, String> {
        self.request(reqwest::Method::GET, "/me", None).await
    }
    pub async fn register(&self, body: &Registration) -> Result<UploadStatus, String> {
        self.post("/recordings", body).await
    }
    pub async fn status(&self, id: &str) -> Result<UploadStatus, String> {
        self.request(
            reqwest::Method::GET,
            &format!("/uploads/{}/status", upload_id(id)?),
            None,
        )
        .await
    }
    pub async fn presign(
        &self,
        id: &str,
        number: u32,
        checksum: &str,
    ) -> Result<PresignedPart, String> {
        self.post(
            &format!("/uploads/{}/parts", upload_id(id)?),
            &serde_json::json!({"partNumber":number,"checksumSha256":checksum}),
        )
        .await
    }
    pub async fn confirm(&self, id: &str, number: u32) -> Result<UploadStatus, String> {
        self.post(
            &format!("/uploads/{}/parts/{number}/confirm", upload_id(id)?),
            &serde_json::json!({}),
        )
        .await
    }
    pub async fn complete(&self, id: &str) -> Result<UploadStatus, String> {
        self.post(
            &format!("/uploads/{}/complete", upload_id(id)?),
            &serde_json::json!({}),
        )
        .await
    }
    pub async fn abort(&self, id: &str) -> Result<UploadStatus, String> {
        self.post(
            &format!("/uploads/{}/abort", upload_id(id)?),
            &serde_json::json!({}),
        )
        .await
    }
    pub async fn restart(&self, id: &str) -> Result<UploadStatus, String> {
        self.post(
            &format!("/uploads/{}/restart", upload_id(id)?),
            &serde_json::json!({}),
        )
        .await
    }

    /// 使用独立请求发送预签名分片，绝不沿用 API Bearer；丢弃错误内的签名 URL。
    pub async fn put_part(
        part: PresignedPart,
        bytes: Vec<u8>,
        control: &TransferControl,
    ) -> Result<(), String> {
        let url = config::secure_url(&part.url)?;
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(PART_TIMEOUT_SECONDS))
            .build()
            .map_err(|error| error.without_url().to_string())?;
        let mut request = client.put(url);
        for (key, value) in part.headers {
            if ["authorization", "cookie", "proxy-authorization"]
                .iter()
                .any(|header| key.eq_ignore_ascii_case(header))
            {
                return Err("预签名上传包含不允许的认证头".into());
            }
            request = request.header(key, value);
        }
        if control.interrupted() {
            return Err("上传已暂停或取消".into());
        }
        let sending = Box::pin(request.body(bytes).send());
        let cancelled = Box::pin(control.changed.notified());
        match select(sending, cancelled).await {
            Either::Left((response, _)) => {
                let response = response
                    .map_err(|error| format!("分片上传请求失败：{}", error.without_url()))?;
                if !response.status().is_success() {
                    return Err(format!("分片上传返回 HTTP {}", response.status().as_u16()));
                }
                Ok(())
            }
            Either::Right(_) => Err("上传已暂停或取消".into()),
        }
    }
}

fn upload_id(id: &str) -> Result<uuid::Uuid, String> {
    uuid::Uuid::parse_str(id).map_err(|_| "云端上传身份无效".into())
}
