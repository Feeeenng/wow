use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use super::config::PortableObsConfig;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// 将本机路径编码为不会改变 PowerShell 命令结构的单引号字面量。
fn powershell_path(path: &std::path::Path) -> String {
    format!("'{}'", path.to_string_lossy().replace('\'', "''"))
}

/// 通过一次管理员授权注册便携 OBS 官方 32/64 位虚拟摄像头组件。
pub async fn register_virtual_camera(config: &PortableObsConfig) -> Result<(), String> {
    let plugin_directory = config
        .install_dir
        .join("data")
        .join("obs-plugins")
        .join("win-dshow");
    let module_32 = plugin_directory.join("obs-virtualcam-module32.dll");
    let module_64 = plugin_directory.join("obs-virtualcam-module64.dll");
    if !module_32.is_file() || !module_64.is_file() {
        return Err("OBS 画面组件不完整，请重新下载安装".to_string());
    }

    let script_path = config.install_dir.join("register-virtual-camera.ps1");
    let register_script = format!(
        "$ErrorActionPreference = \"Stop\"\n\
         & \"$env:WINDIR\\SysWOW64\\regsvr32.exe\" /s /i {}\n\
         if ($LASTEXITCODE -ne 0) {{ exit $LASTEXITCODE }}\n\
         & \"$env:WINDIR\\System32\\regsvr32.exe\" /s /i {}\n\
         exit $LASTEXITCODE\n",
        powershell_path(&module_32),
        powershell_path(&module_64),
    );
    tokio::fs::write(&script_path, register_script)
        .await
        .map_err(|error| format!("准备 OBS 画面组件失败：{error}"))?;

    let result = tokio::task::spawn_blocking(move || {
        let elevate_command = format!(
            "$process = Start-Process -FilePath \"powershell.exe\" \
             -ArgumentList @(\"-NoProfile\", \"-NonInteractive\", \"-ExecutionPolicy\", \
             \"Bypass\", \"-File\", {}) -Verb RunAs -WindowStyle Hidden -Wait -PassThru; \
             exit $process.ExitCode",
            powershell_path(&script_path),
        );
        let mut command = Command::new("powershell.exe");
        command.args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            &elevate_command,
        ]);
        #[cfg(windows)]
        command.creation_flags(CREATE_NO_WINDOW);
        let status = command.status();
        let _ = std::fs::remove_file(script_path);
        let status = status.map_err(|error| format!("启动 OBS 画面组件配置失败：{error}"))?;
        if status.success() {
            Ok(())
        } else {
            Err("OBS 画面组件配置未完成，请允许 Windows 管理员授权后重试".to_string())
        }
    })
    .await
    .map_err(|error| format!("OBS 画面组件配置任务失败：{error}"))?;

    result
}
