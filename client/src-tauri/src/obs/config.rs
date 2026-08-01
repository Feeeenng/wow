use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

pub const OBS_VERSION: &str = "32.2.1";
pub const OBS_DOWNLOAD_URL: &str = "https://github.com/obsproject/obs-studio/releases/download/32.2.1/OBS-Studio-32.2.1-Windows-x64.zip";
pub const OBS_DOWNLOAD_SHA256: &str =
    "db64a2934f8261f85b1410b84be011207a0afda5400d008289f1f1e211bcc7de";
pub const OBS_WEBSOCKET_PORT: u16 = 4455;

/// OBS 当前配置文件中选择的视频编码器。
#[derive(Clone, Debug)]
pub struct ObsEncoder {
    pub id: String,
    pub name: String,
}

/// 保存由 Rust 后端管理的 OBS 便携运行时参数。
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortableObsConfig {
    pub install_dir: PathBuf,
    pub websocket_password: String,
}

impl PortableObsConfig {
    /// 返回便携版 OBS 的 Windows 可执行文件路径。
    pub fn executable_path(&self) -> PathBuf {
        self.install_dir.join("bin").join("64bit").join("obs64.exe")
    }

    /// 返回 OBS 官方便携模式标记文件路径。
    pub fn portable_marker_path(&self) -> PathBuf {
        self.install_dir.join("portable_mode.txt")
    }
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|path| path.join("obs-runtime.json"))
        .map_err(|error| format!("无法定位客户端配置目录：{error}"))
}

/// 以当前客户端可执行文件所在目录作为 OBS 默认安装位置。
fn default_install_dir() -> Result<PathBuf, String> {
    let executable = std::env::current_exe()
        .map_err(|error| format!("无法定位客户端安装目录：{error}"))?;
    let directory = executable
        .parent()
        .ok_or_else(|| "客户端可执行文件缺少父目录".to_string())?;

    Ok(directory.join("obs"))
}

fn encoder_name(id: &str) -> String {
    match id {
        "nvenc" | "jim_nvenc" => "NVIDIA NVENC H.264".to_string(),
        "obs_qsv11" | "qsv" => "Intel Quick Sync H.264".to_string(),
        "amd" | "h264_texture_amf" => "AMD H.264".to_string(),
        "obs_x264" | "x264" => "软件编码 H.264".to_string(),
        value => value.to_string(),
    }
}

/// 从 OBS 当前 profile 读取实际生效的默认编码器。
pub async fn read_obs_encoder(config: &PortableObsConfig) -> ObsEncoder {
    let profiles = config
        .install_dir
        .join("config")
        .join("obs-studio")
        .join("basic")
        .join("profiles");
    let Ok(mut directories) = tokio::fs::read_dir(profiles).await else {
        return ObsEncoder {
            id: "auto".to_string(),
            name: "由 OBS 自动选择".to_string(),
        };
    };
    while let Ok(Some(directory)) = directories.next_entry().await {
        let path = directory.path().join("basic.ini");
        let Ok(content) = tokio::fs::read_to_string(path).await else {
            continue;
        };
        let mut section = "";
        let mut output_mode = "Simple";
        let mut simple_encoder = None;
        let mut advanced_encoder = None;
        for line in content.lines().map(str::trim) {
            if line.starts_with('[') && line.ends_with(']') {
                section = &line[1..line.len() - 1];
                continue;
            }
            let Some((key, value)) = line.split_once('=') else {
                continue;
            };
            match (section, key) {
                ("Output", "Mode") => output_mode = value,
                ("SimpleOutput", "RecEncoder") => simple_encoder = Some(value),
                ("AdvOut", "RecEncoder") if value != "none" => advanced_encoder = Some(value),
                _ => {}
            }
        }
        let selected = if output_mode == "Advanced" {
            advanced_encoder
        } else {
            simple_encoder
        };
        if let Some(id) = selected {
            return ObsEncoder {
                id: id.to_string(),
                name: encoder_name(id),
            };
        }
    }
    ObsEncoder {
        id: "auto".to_string(),
        name: "由 OBS 自动选择".to_string(),
    }
}

/// 读取 OBS 运行时配置，不存在时生成独立 WebSocket 密码。
pub async fn load_or_create_config(
    app: &AppHandle,
    install_dir: Option<String>,
) -> Result<PortableObsConfig, String> {
    let path = config_path(app)?;
    let mut config = if path.exists() {
        let bytes = tokio::fs::read(&path)
            .await
            .map_err(|error| format!("读取 OBS 运行时配置失败：{error}"))?;
        serde_json::from_slice(&bytes)
            .map_err(|error| format!("解析 OBS 运行时配置失败：{error}"))?
    } else {
        PortableObsConfig {
            install_dir: default_install_dir()?,
            websocket_password: Uuid::new_v4().simple().to_string(),
        }
    };

    if let Some(value) = install_dir.filter(|value| !value.trim().is_empty()) {
        config.install_dir = PathBuf::from(value);
    } else {
        config.install_dir = default_install_dir()?;
    }

    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|error| format!("创建客户端配置目录失败：{error}"))?;
    }
    let bytes = serde_json::to_vec_pretty(&config)
        .map_err(|error| format!("序列化 OBS 运行时配置失败：{error}"))?;
    tokio::fs::write(path, bytes)
        .await
        .map_err(|error| format!("保存 OBS 运行时配置失败：{error}"))?;
    Ok(config)
}
