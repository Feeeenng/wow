use std::path::PathBuf;

use tauri::{AppHandle, Manager};

/// 客户端固定使用的 MediaMTX 版本。
pub const MEDIA_RUNTIME_VERSION: &str = "1.18.2";
/// 仅监听回环地址的 WHIP/WHEP HTTP 端口。
pub const MEDIA_HTTP_PORT: u16 = 18_889;
/// 仅监听回环地址的 WebRTC UDP 媒体端口。
pub const MEDIA_UDP_PORT: u16 = 18_189;
/// 本机直播使用的固定媒体路径。
pub const MEDIA_PATH: &str = "wow-recorder";

#[derive(Clone, Debug)]
/// 描述本机媒体运行时的受管文件位置。
pub struct LocalMediaConfig {
    pub runtime_dir: PathBuf,
    pub executable_path: PathBuf,
}

impl LocalMediaConfig {
    /// 返回 MediaMTX 可执行文件路径。
    pub fn executable_path(&self) -> &PathBuf {
        &self.executable_path
    }

    /// 返回客户端生成的最小运行配置路径。
    pub fn runtime_config_path(&self) -> PathBuf {
        self.runtime_dir.join("wow-recorder.yml")
    }
}

/// 定位安装包内置可执行文件，并将可写配置放到应用本地数据目录。
pub fn local_media_config(app: &AppHandle) -> Result<LocalMediaConfig, String> {
    let packaged_executable = app
        .path()
        .resource_dir()
        .map_err(|error| format!("无法定位内置直播组件目录：{error}"))?
        .join("media-runtime")
        .join("mediamtx.exe");
    let development_executable = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("media-runtime")
        .join("mediamtx.exe");
    let executable_path = if packaged_executable.is_file() {
        packaged_executable
    } else {
        development_executable
    };
    let runtime_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("无法定位本地直播运行目录：{error}"))?
        .join("media-runtime")
        .join(MEDIA_RUNTIME_VERSION);
    Ok(LocalMediaConfig {
        runtime_dir,
        executable_path,
    })
}

/// 生成只暴露本机 WHIP/WHEP 和单一受管路径的 MediaMTX 配置。
pub fn runtime_config_content() -> String {
    format!(
        r#"logLevel: warn
logDestinations: [stdout]
api: false
metrics: false
pprof: false
playback: false
rtsp: false
rtmp: false
hls: false
srt: false
webrtc: true
webrtcAddress: 127.0.0.1:{MEDIA_HTTP_PORT}
webrtcEncryption: false
webrtcLocalUDPAddress: 127.0.0.1:{MEDIA_UDP_PORT}
webrtcLocalTCPAddress: ''
webrtcIPsFromInterfaces: false
webrtcAdditionalHosts: [127.0.0.1]
webrtcTrackGatherTimeout: 15s
paths:
  {MEDIA_PATH}:
    source: publisher
"#
    )
}
