use super::model::StoredSettings;
use sha2::{Digest, Sha256};

/// 网页只获得不可逆连接版本；团队、服务、账号或 DPAPI 密文变化时旧缓存失效。
pub fn connection_key(settings: &StoredSettings) -> String {
    let bytes = serde_json::to_vec(&(
        settings.endpoint.as_str(),
        &settings.team_id,
        &settings.user_id,
        &settings.protected_token,
    ))
    .expect("连接摘要字段可序列化");
    format!("{:x}", Sha256::digest(bytes))
}

#[cfg(test)]
mod tests {
    #[test]
    fn token_rotation_changes_opaque_connection_version() {
        let mut settings = super::StoredSettings::default();
        let original = super::connection_key(&settings);
        settings.protected_token = vec![1, 2, 3];
        let rotated = super::connection_key(&settings);
        assert_ne!(original, rotated);
        assert_eq!(rotated.len(), 64);
        settings.team_id = Some("team".into());
        assert_ne!(rotated, super::connection_key(&settings));
    }
}
