use std::{collections::HashMap, path::PathBuf, sync::Arc, time::Duration};

use tokio::sync::Mutex;

use crate::game_data::config::{ICON_MAX_BYTES, ICON_ORIGIN, ICON_TIMEOUT_SECONDS};

/// 校验图标文件名；拒绝路径、编码穿越及任意远端 endpoint。
pub fn valid_icon(name: &str) -> bool {
    let Some((stem, extension)) = name.rsplit_once('.') else {
        return false;
    };
    !stem.is_empty()
        && stem.len() <= 150
        && stem
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
        && matches!(extension, "jpg" | "png" | "webp")
}

/// 不将 HTML 错误页缓存成图片。
pub fn image_content_type(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some("image/jpeg")
    } else if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        Some("image/webp")
    } else {
        None
    }
}

/// 资料图标独立缓存，已有随包图片可离线读取；不反向依赖页面或资料状态。
pub struct IconCache {
    bundled: PathBuf,
    writable: PathBuf,
    client: reqwest::Client,
    gates: Mutex<HashMap<String, Arc<Mutex<()>>>>,
}

impl IconCache {
    pub fn new(bundled: PathBuf, writable: PathBuf) -> Result<Self, String> {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(ICON_TIMEOUT_SECONDS))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|error| error.to_string())?;
        Ok(Self {
            bundled,
            writable,
            client,
            gates: Mutex::new(HashMap::new()),
        })
    }

    /// 查找缓存只接受可信文件名，随包资料和下载缓存都不能越界。
    pub fn path(&self, name: &str) -> Option<PathBuf> {
        if !valid_icon(name) {
            return None;
        }
        [self.writable.join(name), self.bundled.join(name)]
            .into_iter()
            .find(|path| path.is_file())
    }

    /// 有效本地图优先，下载失败不写入永久失败状态，之后仍可重试。
    pub async fn ensure(&self, name: &str) -> Option<PathBuf> {
        if let Some(path) = self.path(name) {
            return Some(path);
        }
        if !valid_icon(name) {
            return None;
        }
        let gate = self
            .gates
            .lock()
            .await
            .entry(name.to_string())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone();
        let _guard = gate.lock().await;
        if let Some(path) = self.path(name) {
            return Some(path);
        }
        let mut response = self
            .client
            .get(format!("{ICON_ORIGIN}{name}"))
            .send()
            .await
            .ok()?
            .error_for_status()
            .ok()?;
        if response
            .content_length()
            .is_some_and(|size| size > ICON_MAX_BYTES as u64)
        {
            return None;
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.ok()? {
            if bytes.len() + chunk.len() > ICON_MAX_BYTES {
                return None;
            }
            bytes.extend_from_slice(&chunk);
        }
        image_content_type(&bytes)?;
        if let Some(path) = self.path(name) {
            return Some(path);
        }
        tokio::fs::create_dir_all(&self.writable).await.ok()?;
        let target = self.writable.join(name);
        let temporary = self.writable.join(format!("{}.tmp", uuid::Uuid::new_v4()));
        tokio::fs::write(&temporary, &bytes).await.ok()?;
        if tokio::fs::rename(&temporary, &target).await.is_err() {
            let _ = tokio::fs::remove_file(temporary).await;
            return None;
        }
        Some(target)
    }

    /// 提供受限的小图片读取，避免无限长度文件进入协议响应。
    pub fn read(&self, name: &str) -> Option<Vec<u8>> {
        let path = self.path(name)?;
        if std::fs::metadata(&path).ok()?.len() > ICON_MAX_BYTES as u64 {
            return None;
        }
        let bytes = std::fs::read(path).ok()?;
        image_content_type(&bytes)?;
        Some(bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::{image_content_type, valid_icon, IconCache};
    use std::path::PathBuf;

    #[test]
    fn blocks_paths_urls_and_html_images() {
        for name in [
            "../a.jpg",
            "..%2Fa.jpg",
            "https://evil/a.jpg",
            "a/b.jpg",
            "a.svg",
        ] {
            assert!(!valid_icon(name));
        }
        assert!(valid_icon("ability_kick.jpg"));
        assert_eq!(image_content_type(b"<html>not a picture</html>"), None);
    }

    #[test]
    fn bundled_icons_are_readable_without_network() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/game-data/icons");
        let cache = IconCache::new(
            root,
            std::env::temp_dir().join(uuid::Uuid::new_v4().to_string()),
        )
        .unwrap();
        let bytes = cache
            .read("spell_holy_divineshield.jpg")
            .expect("随包图标必须真实存在");
        assert_eq!(image_content_type(&bytes), Some("image/jpeg"));
    }
}
