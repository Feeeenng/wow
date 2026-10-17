use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::local_state::LocalStateStore;
use crate::recording::config::{
    REPLAY_CUSTOM_TRACK_ID_PREFIX, REPLAY_CUSTOM_TRACK_LIMIT, REPLAY_CUSTOM_TRACK_NAME_MAX,
    REPLAY_ICON_PERCENT_DEFAULT, REPLAY_ICON_PERCENT_RANGE, REPLAY_TIMELINE_ZOOM_DEFAULT,
    REPLAY_TIMELINE_ZOOM_RANGE, REPLAY_TRACK_HEIGHT_DEFAULT, REPLAY_TRACK_HEIGHT_RANGE,
    REPLAY_TRACK_OVERRIDE_KEY_LIMIT, REPLAY_TRACK_OVERRIDE_LIMIT,
};

/// 个人新增显示轨道使用稳定 UUID，不携带或覆盖任何事件数据。
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomTimelineTrack {
    pub id: String,
    pub name: String,
}

/// 回放恢复书签与用户校准；不保存播放器连接和实际播放状态。
#[derive(Clone, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ReplayPreferences {
    pub selected_pull_id: Option<String>,
    pub bookmarks_ms: HashMap<String, u64>,
    pub offsets_ms: HashMap<String, i64>,
    pub offset_versions: HashMap<String, String>,
    pub volume: f64,
    pub muted: bool,
    pub playback_rate: f64,
    pub event_kinds: Vec<String>,
    pub actor_guid: Option<String>,
    pub timeline_track_height: u32,
    pub timeline_icon_percent: u32,
    pub timeline_zoom: f64,
    pub timeline_track_overrides: HashMap<String, String>,
    pub catalog_source: String,
    pub custom_timeline_tracks: Vec<CustomTimelineTrack>,
}

impl Default for ReplayPreferences {
    fn default() -> Self {
        Self {
            selected_pull_id: None,
            bookmarks_ms: HashMap::new(),
            offsets_ms: HashMap::new(),
            offset_versions: HashMap::new(),
            volume: 1.0,
            muted: false,
            playback_rate: 1.0,
            event_kinds: Vec::new(),
            actor_guid: None,
            timeline_track_height: REPLAY_TRACK_HEIGHT_DEFAULT,
            timeline_icon_percent: REPLAY_ICON_PERCENT_DEFAULT,
            timeline_zoom: REPLAY_TIMELINE_ZOOM_DEFAULT,
            timeline_track_overrides: HashMap::new(),
            catalog_source: "local".into(),
            custom_timeline_tracks: Vec::new(),
        }
    }
}

/// 从统一状态存储恢复用户书签，不将恢复解释为正在播放。
#[tauri::command]
pub async fn get_replay_preferences(
    state: State<'_, LocalStateStore>,
) -> Result<ReplayPreferences, String> {
    Ok(state.get("replay").await?.unwrap_or_default())
}

/// 校验原生媒体参数后保存回放区段，避免前端直接持久化业务状态。
#[tauri::command]
pub async fn set_replay_preferences(
    state: State<'_, LocalStateStore>,
    preferences: ReplayPreferences,
) -> Result<(), String> {
    if !preferences.volume.is_finite()
        || !(0.0..=1.0).contains(&preferences.volume)
        || !preferences.playback_rate.is_finite()
        || preferences.playback_rate <= 0.0
    {
        return Err("回放音量或倍速参数无效".to_string());
    }
    if !valid_timeline_appearance(&preferences) {
        return Err("时间轴轨高、图标比例或缩放参数无效".to_string());
    }
    if !valid_custom_tracks(&preferences.custom_timeline_tracks) {
        return Err("个人显示轨道的名称、编号或数量无效".to_string());
    }
    if !valid_track_overrides(
        &preferences.timeline_track_overrides,
        &preferences.custom_timeline_tracks,
    ) {
        return Err("技能显示轨道覆盖参数无效".to_string());
    }
    if !matches!(preferences.catalog_source.as_str(), "local" | "team") {
        return Err("回放目录来源无效".to_string());
    }
    if preferences.offset_versions.iter().any(|(id, version)| {
        uuid::Uuid::parse_str(id).is_err()
            || uuid::Uuid::parse_str(version).is_err()
            || !preferences.offsets_ms.contains_key(id)
    }) {
        return Err("本机微调的录像发布版本无效".into());
    }
    state.set("replay", &preferences).await
}

/// 只接受已知轨道及来源技能键，不允许任意字符串变成持久显示规则。
fn valid_track_overrides(
    overrides: &HashMap<String, String>,
    custom_tracks: &[CustomTimelineTrack],
) -> bool {
    overrides.len() <= REPLAY_TRACK_OVERRIDE_LIMIT
        && overrides.iter().all(|(key, target)| {
            if key.len() > REPLAY_TRACK_OVERRIDE_KEY_LIMIT
                || !(matches!(
                    target.as_str(),
                    "boss" | "player" | "team" | "aura" | "death"
                ) || custom_tracks.iter().any(|track| track.id == *target))
            {
                return false;
            }
            let fields: Vec<_> = key.split(':').collect();
            fields.len() == 4
                && matches!(fields[0], "boss" | "player" | "team")
                && fields[1].parse::<u32>().is_ok()
                && matches!(
                    fields[2],
                    "castStart"
                        | "castSuccess"
                        | "empowerStart"
                        | "empowerEnd"
                        | "empowerInterrupt"
                        | "resurrect"
                        | "death"
                        | "buffApply"
                        | "buffRefresh"
                        | "buffRemove"
                        | "buffStack"
                        | "debuffApply"
                        | "debuffRefresh"
                        | "debuffRemove"
                        | "debuffStack"
                        | "interrupt"
                        | "dispel"
                )
                && fields[3]
                    .bytes()
                    .all(|value| value.is_ascii_alphanumeric() || value == b'-')
        })
}

/// 数量、稳定编号及名称均由原生层校验，拒绝重复编号和不可见名称。
fn valid_custom_tracks(tracks: &[CustomTimelineTrack]) -> bool {
    let mut ids = HashSet::new();
    let mut names = HashSet::new();
    tracks.len() <= REPLAY_CUSTOM_TRACK_LIMIT
        && tracks.iter().all(|track| {
            let valid_id = track
                .id
                .strip_prefix(REPLAY_CUSTOM_TRACK_ID_PREFIX)
                .and_then(|value| uuid::Uuid::parse_str(value).ok())
                .is_some_and(|id| track.id == format!("{REPLAY_CUSTOM_TRACK_ID_PREFIX}{id}"));
            valid_id
                && ids.insert(&track.id)
                && !track.name.is_empty()
                && track.name.trim() == track.name
                && track.name.chars().count() <= REPLAY_CUSTOM_TRACK_NAME_MAX
                && !track.name.chars().any(char::is_control)
                && names.insert(track.name.to_lowercase())
        })
}

/// 外观参数由原生层验证，防止异常偏好产生不可操作的布局。
fn valid_timeline_appearance(preferences: &ReplayPreferences) -> bool {
    REPLAY_TRACK_HEIGHT_RANGE.contains(&preferences.timeline_track_height)
        && REPLAY_ICON_PERCENT_RANGE.contains(&preferences.timeline_icon_percent)
        && preferences.timeline_zoom.is_finite()
        && REPLAY_TIMELINE_ZOOM_RANGE.contains(&preferences.timeline_zoom)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn old_preferences_restore_timeline_defaults() {
        let preferences: ReplayPreferences =
            serde_json::from_str(r#"{"volume":0.5,"actorGuid":null}"#).unwrap();
        assert_eq!(preferences.timeline_track_height, 30);
        assert_eq!(preferences.timeline_icon_percent, 80);
        assert_eq!(preferences.timeline_zoom, 1.0);
        assert!(valid_timeline_appearance(&preferences));
        assert_eq!(preferences.catalog_source, "local");
        assert!(preferences.custom_timeline_tracks.is_empty());
    }

    #[test]
    fn invalid_timeline_appearance_is_rejected() {
        let mut preferences = ReplayPreferences::default();
        preferences.timeline_track_height = 19;
        assert!(!valid_timeline_appearance(&preferences));
        preferences.timeline_track_height = 50;
        preferences.timeline_icon_percent = 101;
        assert!(!valid_timeline_appearance(&preferences));
        preferences.timeline_icon_percent = 100;
        preferences.timeline_zoom = f64::NAN;
        assert!(!valid_timeline_appearance(&preferences));
        preferences.timeline_zoom = 4.0;
        assert!(valid_timeline_appearance(&preferences));
    }

    #[test]
    fn track_overrides_restore_without_changing_event_identity() {
        let mut preferences = ReplayPreferences::default();
        preferences
            .timeline_track_overrides
            .insert("player:642:castSuccess:Player-1".into(), "team".into());
        let saved = serde_json::to_vec(&preferences).unwrap();
        let restored: ReplayPreferences = serde_json::from_slice(&saved).unwrap();
        assert_eq!(
            restored
                .timeline_track_overrides
                .get("player:642:castSuccess:Player-1")
                .map(String::as_str),
            Some("team")
        );
        assert!(valid_track_overrides(
            &restored.timeline_track_overrides,
            &restored.custom_timeline_tracks
        ));
        let old: ReplayPreferences = serde_json::from_str("{}").unwrap();
        assert!(old.timeline_track_overrides.is_empty());
    }

    #[test]
    fn catalog_source_survives_restart_without_restoring_runtime_connections() {
        let mut preferences = ReplayPreferences::default();
        preferences.catalog_source = "team".into();
        let saved = serde_json::to_value(&preferences).unwrap();
        assert_eq!(saved["catalogSource"], "team");
        assert!(saved.get("connection").is_none());
        let restored: ReplayPreferences = serde_json::from_value(saved).unwrap();
        assert_eq!(restored.catalog_source, "team");
    }

    #[test]
    fn track_overrides_reject_unknown_targets_keys_and_excess_entries() {
        for (key, target) in [
            ("player:642:castSuccess:Player-1", "unknown"),
            ("player:642:invented:Player-1", "team"),
            ("player:642:castSuccess:Player-1:extra", "team"),
            ("player:642:castSuccess:bad guid", "team"),
        ] {
            assert!(!valid_track_overrides(
                &HashMap::from([(key.into(), target.into())]),
                &[]
            ));
        }
        let too_many = (0..=REPLAY_TRACK_OVERRIDE_LIMIT)
            .map(|index| {
                (
                    format!("player:{index}:castSuccess:Player-1"),
                    "team".into(),
                )
            })
            .collect();
        assert!(!valid_track_overrides(&too_many, &[]));
    }

    #[test]
    fn personal_tracks_and_wcl_actor_overrides_survive_restart() {
        let mut preferences = ReplayPreferences::default();
        let id = "custom-00000000-0000-4000-8000-000000000001";
        preferences
            .custom_timeline_tracks
            .push(CustomTimelineTrack {
                id: id.into(),
                name: "个人减伤".into(),
            });
        preferences.timeline_track_overrides.insert(
            "player:17:castSuccess:WCL-AbCdEf1234567890-1".into(),
            id.into(),
        );
        let restored: ReplayPreferences =
            serde_json::from_slice(&serde_json::to_vec(&preferences).unwrap()).unwrap();
        assert_eq!(restored.custom_timeline_tracks[0].id, id);
        assert_eq!(restored.custom_timeline_tracks[0].name, "个人减伤");
        assert!(valid_custom_tracks(&restored.custom_timeline_tracks));
        assert!(valid_track_overrides(
            &restored.timeline_track_overrides,
            &restored.custom_timeline_tracks
        ));
        assert!(!valid_track_overrides(
            &restored.timeline_track_overrides,
            &[]
        ));
    }

    #[test]
    fn personal_track_validation_rejects_duplicate_ids_names_and_limits() {
        let track = CustomTimelineTrack {
            id: "custom-00000000-0000-4000-8000-000000000001".into(),
            name: "个人减伤".into(),
        };
        assert!(valid_custom_tracks(&[track.clone()]));
        assert!(!valid_custom_tracks(&[track.clone(), track.clone()]));
        let mut duplicate_name = track.clone();
        duplicate_name.id = "custom-00000000-0000-4000-8000-000000000002".into();
        assert!(!valid_custom_tracks(&[track.clone(), duplicate_name]));
        for name in [
            "",
            "  ",
            "前后 ",
            "含\n换行",
            &"长".repeat(REPLAY_CUSTOM_TRACK_NAME_MAX + 1),
        ] {
            assert!(!valid_custom_tracks(&[CustomTimelineTrack {
                id: track.id.clone(),
                name: name.into()
            }]));
        }
        assert!(!valid_custom_tracks(&[CustomTimelineTrack {
            id: "custom-not-a-uuid".into(),
            name: "有效名称".into()
        }]));
        let too_many = (0..=REPLAY_CUSTOM_TRACK_LIMIT)
            .map(|index| CustomTimelineTrack {
                id: format!("custom-{}", uuid::Uuid::from_u128(index as u128)),
                name: format!("轨道{index}"),
            })
            .collect::<Vec<_>>();
        assert!(!valid_custom_tracks(&too_many));
    }

    #[test]
    fn extended_event_track_rules_survive_serialization_and_native_validation() {
        let mut preferences = ReplayPreferences::default();
        for kind in [
            "buffRefresh",
            "debuffRefresh",
            "empowerStart",
            "empowerEnd",
            "empowerInterrupt",
            "resurrect",
        ] {
            preferences.event_kinds.push(kind.into());
            preferences
                .timeline_track_overrides
                .insert(format!("player:17:{kind}:Player-1"), "team".into());
        }
        let restored: ReplayPreferences =
            serde_json::from_slice(&serde_json::to_vec(&preferences).unwrap()).unwrap();
        assert_eq!(restored.event_kinds.len(), 6);
        assert_eq!(restored.timeline_track_overrides.len(), 6);
        assert!(valid_track_overrides(
            &restored.timeline_track_overrides,
            &[]
        ));
    }
}
