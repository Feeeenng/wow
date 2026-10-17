use serde::{Deserialize, Serialize};

/// 令牌只保存系统保护密文；绑定用户 ID 用于拒绝跨账号续传。
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredSettings {
    pub endpoint: String,
    pub team_id: Option<String>,
    pub device_id: String,
    pub user_id: Option<String>,
    pub protected_token: Vec<u8>,
}

impl Default for StoredSettings {
    fn default() -> Self {
        Self {
            endpoint: String::new(),
            team_id: None,
            device_id: uuid::Uuid::new_v4().to_string(),
            user_id: None,
            protected_token: Vec::new(),
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsInput {
    pub endpoint: String,
    pub team_id: Option<String>,
    pub token: Option<String>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Team {
    pub team_id: String,
    pub name: String,
    pub role: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Identity {
    pub user_id: String,
    pub display_name: String,
    pub teams: Vec<Team>,
}

/// 面向前端只返回是否配置令牌及当前进程已核验的身份。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsView {
    pub connection_key:String,
    pub endpoint: String,
    pub team_id: Option<String>,
    pub device_id: String,
    pub has_token: bool,
    pub identity: Option<Identity>,
}
