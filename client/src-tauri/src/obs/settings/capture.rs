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
const GAME_CAPTURE_KIND: &str = "game_capture";
const MONITOR_CAPTURE_KIND: &str = "monitor_capture";
const AUTO_CAPTURE_SETTING: &str = "wow_recorder_auto_capture";

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
                kind: GAME_CAPTURE_KIND,
                settings: Some(json!({
                    "capture_mode": "window",
                    "window": DEFAULT_WOW_WINDOW,
                    "capture_cursor": false,
                    "wow_recorder_auto_capture": true,
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
        GAME_CAPTURE_KIND => "窗口捕捉".to_string(),
        MONITOR_CAPTURE_KIND => "屏幕捕捉".to_string(),
        value => value.to_string(),
    }
}

fn option_id(value: &serde_json::Value) -> String {
    value
        .as_str()
        .map(str::to_string)
        .unwrap_or_else(|| value.to_string())
}

/// 读取当前捕捉类型由 OBS 提供的窗口或屏幕选项。
async fn read_capture_targets(client: &Client, kind: &str) -> Vec<ObsSelectOption> {
    let primary_property = if kind == MONITOR_CAPTURE_KIND {
        "monitor_id"
    } else {
        "window"
    };
    let mut items = client
        .inputs()
        .properties_list_property_items(InputId::Name(GAME_CAPTURE_INPUT), primary_property)
        .await
        .unwrap_or_default();
    if kind == MONITOR_CAPTURE_KIND && items.is_empty() {
        items = client
            .inputs()
            .properties_list_property_items(InputId::Name(GAME_CAPTURE_INPUT), "monitor")
            .await
            .unwrap_or_default();
    }
    items
        .into_iter()
        .filter(|item| item.enabled)
        .map(|item| ObsSelectOption {
            id: option_id(&item.value),
            name: item.name,
        })
        .collect()
}

fn current_capture_target(kind: &str, settings: &serde_json::Value) -> Option<String> {
    let keys = if kind == MONITOR_CAPTURE_KIND {
        ["monitor_id", "monitor"]
    } else {
        ["window", "window"]
    };
    keys.into_iter().find_map(|key| {
        settings
            .get(key)
            .filter(|value| !value.is_null())
            .map(option_id)
            .filter(|value| !value.is_empty())
    })
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
    let input_kinds = [GAME_CAPTURE_KIND, MONITOR_CAPTURE_KIND]
        .into_iter()
        .filter(|kind| available_kinds.iter().any(|value| value == kind))
        .map(|kind| ObsSelectOption {
            id: kind.to_string(),
            name: capture_kind_name(kind),
        })
        .collect();
    let windows = read_capture_targets(client, &current.kind).await;
    Ok(ObsCaptureSettings {
        input_kind: current.kind.clone(),
        auto_capture: current
            .settings
            .get(AUTO_CAPTURE_SETTING)
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(current.kind == GAME_CAPTURE_KIND),
        window: current_capture_target(&current.kind, &current.settings),
        capture_cursor: current
            .settings
            .get("capture_cursor")
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
    if ![GAME_CAPTURE_KIND, MONITOR_CAPTURE_KIND].contains(&settings.input_kind.as_str())
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
        wait_for_capture_source_removed(client).await?;
        let initial_target =
            (settings.input_kind == GAME_CAPTURE_KIND).then_some(DEFAULT_WOW_WINDOW);
        let initial_settings = capture_source_settings(&settings, initial_target);
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
    let target_options = read_capture_targets(client, &settings.input_kind).await;
    let detected_window = if settings.input_kind == GAME_CAPTURE_KIND {
        find_wow_window(client).await
    } else {
        None
    };
    let target = settings
        .window
        .as_deref()
        .or(detected_window.as_deref())
        .or_else(|| target_options.first().map(|option| option.id.as_str()))
        .or((settings.input_kind == GAME_CAPTURE_KIND).then_some(DEFAULT_WOW_WINDOW));
    let source_settings = capture_source_settings(&settings, target);
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

/// 等待 OBS 完成异步来源销毁，避免同名来源重建冲突。
async fn wait_for_capture_source_removed(client: &Client) -> Result<(), String> {
    for _ in 0..20 {
        let inputs = client
            .inputs()
            .list(None)
            .await
            .map_err(|error| obs_error("确认 OBS 捕捉来源删除状态失败", error))?;
        if !inputs.iter().any(|input| GAME_CAPTURE_INPUT == input.id) {
            return Ok(());
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    Err("OBS 捕捉来源删除超时".to_string())
}

fn capture_source_settings(
    settings: &ObsCaptureSettings,
    target: Option<&str>,
) -> serde_json::Value {
    if settings.input_kind == GAME_CAPTURE_KIND {
        json!({
            "capture_mode": "window",
            "window": target.unwrap_or(DEFAULT_WOW_WINDOW),
            "capture_cursor": settings.capture_cursor,
            "wow_recorder_auto_capture": settings.auto_capture,
        })
    } else {
        let mut value = json!({
            "capture_cursor": settings.capture_cursor,
            "wow_recorder_auto_capture": settings.auto_capture,
        });
        if let Some(target) = target {
            value["monitor_id"] = serde_json::from_str::<serde_json::Value>(target)
                .unwrap_or_else(|_| serde_json::Value::String(target.to_string()));
        }
        value
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
