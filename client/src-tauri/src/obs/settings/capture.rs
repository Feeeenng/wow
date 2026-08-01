use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;
use obws::{
    common::{Alignment, BoundsType},
    requests::{
        inputs::{Create, InputId, SetSettings},
        scene_items::{
            Bounds, CreateSceneItem, Position, SceneItemTransform, SetEnabled, SetTransform,
        },
        sources::SourceId,
    },
    Client,
};
use serde_json::json;
use tauri::State;

use crate::obs::{
    common::{obs_error, MANAGED_SCENE},
    runtime::service::ObsState,
};

use super::model::{ObsCaptureSettings, ObsSelectOption};

pub(crate) const GAME_CAPTURE_INPUT: &str = "魔兽世界游戏画面";
const LEGACY_GAME_CAPTURE_INPUT: &str = "WoW 游戏画面";
const DEFAULT_WOW_WINDOW: &str = "魔兽世界:waApplication Window:Wow.exe";

fn is_wow_window(name: &str, value: &serde_json::Value) -> bool {
    let candidate = format!("{} {}", name, value.as_str().unwrap_or_default()).to_lowercase();
    candidate.contains("wow.exe") || candidate.contains("魔兽世界")
}

/// 从 OBS 捕捉源的属性列表中查找正在运行的魔兽世界窗口。
pub(crate) async fn find_wow_window(client: &Client) -> Option<String> {
    client
        .inputs()
        .properties_list_property_items(InputId::Name(GAME_CAPTURE_INPUT), "window")
        .await
        .ok()?
        .into_iter()
        .find(|item| is_wow_window(&item.name, &item.value))
        .and_then(|item| item.value.as_str().map(str::to_string))
}

/// 确保专属场景中存在可复用的魔兽世界画面源。
pub(crate) async fn ensure_capture_source(client: &Client) -> Result<(), String> {
    let inputs = client
        .inputs()
        .list(None)
        .await
        .map_err(|error| obs_error("读取 OBS 输入源失败", error))?;
    if inputs
        .iter()
        .any(|input| LEGACY_GAME_CAPTURE_INPUT == input.id)
    {
        client
            .inputs()
            .remove(InputId::Name(LEGACY_GAME_CAPTURE_INPUT))
            .await
            .map_err(|error| obs_error("迁移旧版游戏画面来源失败", error))?;
    }

    let source_exists = inputs.iter().any(|input| GAME_CAPTURE_INPUT == input.id);
    let scene_item_id = if source_exists {
        let scene_items = client
            .scene_items()
            .list(MANAGED_SCENE.into())
            .await
            .map_err(|error| obs_error("读取 OBS 专属场景来源失败", error))?;
        if let Some(item) = scene_items
            .iter()
            .find(|item| GAME_CAPTURE_INPUT == item.source_name)
        {
            item.id
        } else {
            client
                .scene_items()
                .create(CreateSceneItem {
                    scene: MANAGED_SCENE.into(),
                    source: SourceId::Name(GAME_CAPTURE_INPUT),
                    enabled: Some(true),
                })
                .await
                .map_err(|error| obs_error("添加魔兽世界画面到专属场景失败", error))?
        }
    } else {
        client
            .inputs()
            .create(Create {
                scene: MANAGED_SCENE.into(),
                input: GAME_CAPTURE_INPUT,
                kind: "game_capture",
                settings: Some(json!({
                    "capture_mode": "window",
                    "window": DEFAULT_WOW_WINDOW,
                    "capture_cursor": false,
                })),
                enabled: Some(true),
            })
            .await
            .map_err(|error| obs_error("创建魔兽世界游戏画面来源失败", error))?
            .scene_item_id
    };

    client
        .scene_items()
        .set_transform(SetTransform {
            scene: MANAGED_SCENE.into(),
            item_id: scene_item_id,
            transform: SceneItemTransform {
                position: Some(Position {
                    x: Some(960.0),
                    y: Some(540.0),
                }),
                alignment: Some(Alignment::CENTER),
                bounds: Some(Bounds {
                    r#type: Some(BoundsType::ScaleInner),
                    alignment: Some(Alignment::CENTER),
                    width: Some(1920.0),
                    height: Some(1080.0),
                }),
                ..Default::default()
            },
        })
        .await
        .map_err(|error| obs_error("调整魔兽世界画面尺寸失败", error))?;
    client
        .scene_items()
        .set_enabled(SetEnabled {
            scene: MANAGED_SCENE.into(),
            item_id: scene_item_id,
            enabled: true,
        })
        .await
        .map_err(|error| obs_error("启用魔兽世界画面来源失败", error))
}

fn capture_kind_name(kind: &str) -> String {
    match kind {
        "game_capture" => "游戏捕捉".to_string(),
        "window_capture" => "窗口捕捉".to_string(),
        value => value.to_string(),
    }
}

/// 读取 OBS 画面来源设置及 OBS 当前提供的捕捉选项。
pub(crate) async fn read_capture_settings(
    client: &Client,
) -> Result<ObsCaptureSettings, String> {
    let current = client
        .inputs()
        .settings::<serde_json::Value>(InputId::Name(GAME_CAPTURE_INPUT))
        .await
        .map_err(|error| obs_error("读取 OBS 捕捉设置失败", error))?;
    let available_kinds = client
        .inputs()
        .list_kinds(true)
        .await
        .map_err(|error| obs_error("读取 OBS 捕捉类型失败", error))?;
    let input_kinds = ["game_capture", "window_capture"]
        .into_iter()
        .filter(|kind| available_kinds.iter().any(|value| value == kind))
        .map(|kind| ObsSelectOption {
            id: kind.to_string(),
            name: capture_kind_name(kind),
        })
        .collect();
    let windows = client
        .inputs()
        .properties_list_property_items(InputId::Name(GAME_CAPTURE_INPUT), "window")
        .await
        .unwrap_or_default()
        .into_iter()
        .filter(|item| item.enabled)
        .filter_map(|item| {
            item.value.as_str().map(|value| ObsSelectOption {
                id: value.to_string(),
                name: item.name,
            })
        })
        .collect();
    let capture_mode = current
        .settings
        .get("capture_mode")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("window");
    Ok(ObsCaptureSettings {
        input_kind: current.kind.clone(),
        auto_capture: capture_mode == "any_fullscreen",
        window: current
            .settings
            .get("window")
            .and_then(serde_json::Value::as_str)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        capture_cursor: current
            .settings
            .get(if current.kind == "window_capture" {
                "cursor"
            } else {
                "capture_cursor"
            })
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false),
        input_kinds,
        windows,
    })
}

/// 判断 Wow.exe 是否真实运行，防止仅凭 OBS 的旧窗口配置误判。
#[cfg(windows)]
pub(crate) fn is_wow_process_running() -> bool {
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let mut command = Command::new("tasklist");
    command
        .args(["/FI", "IMAGENAME eq Wow.exe", "/FO", "CSV", "/NH"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()
        .is_some_and(|value| {
            String::from_utf8_lossy(&value.stdout)
                .to_lowercase()
                .contains("wow.exe")
        })
}

#[cfg(not(windows))]
pub(crate) fn is_wow_process_running() -> bool {
    false
}

/// 返回 OBS 游戏画面来源的当前设置。
#[tauri::command]
pub async fn get_obs_capture_settings(
    state: State<'_, ObsState>,
) -> Result<ObsCaptureSettings, String> {
    let guard = state.client.read().await;
    let client = guard
        .as_ref()
        .ok_or_else(|| "请先启动并连接 OBS".to_string())?;
    match read_capture_settings(client).await {
        Ok(settings) => Ok(settings),
        Err(_) => {
            ensure_capture_source(client).await?;
            read_capture_settings(client).await
        }
    }
}

/// 将用户选择的 OBS 捕捉类型和窗口写回专属来源。
#[tauri::command]
pub async fn configure_obs_game_capture(
    settings: ObsCaptureSettings,
    state: State<'_, ObsState>,
) -> Result<(), String> {
    let guard = state.client.read().await;
    let client = guard
        .as_ref()
        .ok_or_else(|| "请先启动并连接 OBS".to_string())?;
    let available_kinds = client
        .inputs()
        .list_kinds(true)
        .await
        .map_err(|error| obs_error("读取 OBS 捕捉类型失败", error))?;
    if !["game_capture", "window_capture"].contains(&settings.input_kind.as_str())
        || !available_kinds
            .iter()
            .any(|kind| kind == &settings.input_kind)
    {
        return Err("OBS 不支持所选捕捉模式".to_string());
    }
    let current = client
        .inputs()
        .settings::<serde_json::Value>(InputId::Name(GAME_CAPTURE_INPUT))
        .await
        .map_err(|error| obs_error("读取 OBS 捕捉设置失败", error))?;
    if current.kind != settings.input_kind {
        client
            .inputs()
            .remove(InputId::Name(GAME_CAPTURE_INPUT))
            .await
            .map_err(|error| obs_error("切换 OBS 捕捉模式失败", error))?;
        let initial_settings = capture_source_settings(&settings, DEFAULT_WOW_WINDOW);
        client
            .inputs()
            .create(Create {
                scene: MANAGED_SCENE.into(),
                input: GAME_CAPTURE_INPUT,
                kind: &settings.input_kind,
                settings: Some(initial_settings),
                enabled: Some(true),
            })
            .await
            .map_err(|error| obs_error("创建 OBS 捕捉来源失败", error))?;
    }
    let detected_window = find_wow_window(client).await;
    let target_window = settings
        .window
        .as_deref()
        .or(detected_window.as_deref())
        .unwrap_or(DEFAULT_WOW_WINDOW);
    let source_settings = capture_source_settings(&settings, target_window);
    client
        .inputs()
        .set_settings(SetSettings {
            input: InputId::Name(GAME_CAPTURE_INPUT),
            settings: &source_settings,
            overlay: Some(true),
        })
        .await
        .map_err(|error| obs_error("更新 OBS 捕捉设置失败", error))?;
    ensure_capture_source(client).await
}

fn capture_source_settings(settings: &ObsCaptureSettings, window: &str) -> serde_json::Value {
    if settings.input_kind == "game_capture" {
        json!({
            "capture_mode": if settings.auto_capture { "any_fullscreen" } else { "window" },
            "window": window,
            "capture_cursor": settings.capture_cursor,
        })
    } else {
        json!({
            "window": window,
            "cursor": settings.capture_cursor,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::is_wow_window;
    use serde_json::json;

    #[test]
    fn identifies_only_wow_capture_windows() {
        assert!(is_wow_window(
            "魔兽世界",
            &json!("魔兽世界:waApplication Window:Wow.exe")
        ));
        assert!(!is_wow_window(
            "记事本",
            &json!("无标题 - 记事本:Notepad:Notepad.exe")
        ));
    }
}
