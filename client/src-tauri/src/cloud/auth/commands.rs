use crate::{
    cloud::{
        api::client::ApiClient,
        auth::{
            credentials,
            model::{Identity, SettingsInput, SettingsView},
        },
        config::{self, SETTINGS_SECTION},
        state::CloudState,
    },
    local_state::LocalStateStore,
};
use tauri::State;

/// 前端只获得是否配置凭证以及本进程已核验身份，不获得密文或明文令牌。
#[tauri::command]
pub async fn get_cloud_settings(state: State<'_, CloudState>) -> Result<SettingsView, String> {
    if let Some(error) = &state.recovery_error {
        return Err(error.clone());
    }
    let settings = state.settings.lock().await;
    Ok(SettingsView {
        connection_key: super::connection::connection_key(&settings),
        endpoint: settings.endpoint.clone(),
        team_id: settings.team_id.clone(),
        device_id: settings.device_id.clone(),
        has_token: !settings.protected_token.is_empty(),
        identity: state.identity.read().await.clone(),
    })
}

/// 更换服务地址不复用旧凭证；新令牌先验证本人身份再以 DPAPI 密文保存。
#[tauri::command]
pub async fn set_cloud_settings(
    settings: SettingsInput,
    state: State<'_, CloudState>,
    store: State<'_, LocalStateStore>,
) -> Result<(), String> {
    save_settings(settings, &state, &store).await
}

/// 验证新凭证与团队后才原子保存，供原生命令及隔离集成测试共用。
pub(crate) async fn save_settings(
    settings: SettingsInput,
    state: &CloudState,
    store: &LocalStateStore,
) -> Result<(), String> {
    if let Some(error) = &state.recovery_error {
        return Err(error.clone());
    }
    let mut current = state.settings.lock().await;
    let mut next = current.clone();
    let endpoint = if settings.endpoint.trim().is_empty() {
        String::new()
    } else {
        config::endpoint(settings.endpoint.trim())?
    };
    let changed = endpoint != next.endpoint;
    if changed || endpoint.is_empty() {
        next.protected_token.clear();
        next.user_id = None;
        next.team_id = None;
    }
    next.endpoint = endpoint;
    next.team_id = settings.team_id.filter(|value| !value.is_empty());
    if next
        .team_id
        .as_ref()
        .is_some_and(|value| uuid::Uuid::parse_str(value).is_err())
    {
        return Err("团队身份格式无效".into());
    }
    let mut identity = None;
    if let Some(token) = settings.token.filter(|token| !token.trim().is_empty()) {
        let token = token.trim();
        let account = ApiClient::new(&next.endpoint, token.into())?.me().await?;
        if next
            .team_id
            .as_ref()
            .is_some_and(|team| !account.teams.iter().any(|entry| &entry.team_id == team))
        {
            return Err("当前账号不属于所选团队".into());
        }
        next.user_id = Some(account.user_id.clone());
        next.protected_token = credentials::protect(token)?;
        identity = Some(account);
    } else if !changed {
        identity = state.identity.read().await.clone();
        if next.team_id != current.team_id && next.team_id.is_some() {
            let account =
                ApiClient::new(&next.endpoint, credentials::reveal(&next.protected_token)?)?
                    .me()
                    .await?;
            if next.user_id.as_ref() != Some(&account.user_id)
                || next
                    .team_id
                    .as_ref()
                    .is_some_and(|team| !account.teams.iter().any(|entry| &entry.team_id == team))
            {
                return Err("当前账号不属于所选团队".into());
            }
            identity = Some(account);
        }
    }
    if changed && next.team_id.is_some() && next.protected_token.is_empty() {
        return Err("请先提交新服务的令牌并验证团队".into());
    }
    state.interrupt(None).await;
    store.set(SETTINGS_SECTION, &next).await?;
    *current = next;
    *state.identity.write().await = identity;
    Ok(())
}

/// 每次验证都查询服务端，失败时清除当前连接身份但保留用户显式配置。
#[tauri::command]
pub async fn verify_cloud_connection(state: State<'_, CloudState>) -> Result<Identity, String> {
    verify_connection(&state).await
}

pub(crate) async fn verify_connection(state: &CloudState) -> Result<Identity, String> {
    if let Some(error) = &state.recovery_error {
        return Err(error.clone());
    }
    *state.identity.write().await = None;
    let settings = state.settings.lock().await.clone();
    let identity = ApiClient::new(
        &settings.endpoint,
        credentials::reveal(&settings.protected_token)?,
    )?
    .me()
    .await?;
    if settings
        .user_id
        .as_ref()
        .is_some_and(|id| id != &identity.user_id)
    {
        return Err("云端账号与已保存凭证身份不一致，请重新配置令牌".into());
    }
    state.publish_identity(&settings, identity.clone()).await?;
    Ok(identity)
}
