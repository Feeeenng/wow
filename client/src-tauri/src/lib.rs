/// 启动桌面客户端，当前仅承载首页界面。
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("启动 WoW Recorder 客户端失败");
}
