use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
};

use futures_util::{stream, StreamExt};
use tauri::{AppHandle, Manager, State};
use tokio::sync::RwLock;

use crate::game_data::{
    config::{
        ICON_CONCURRENCY, ICON_LOCAL_ORIGIN, ICON_ORIGIN, METADATA_MAX_BYTES, SPELL_BATCH_LIMIT,
    },
    icons::cache::{valid_icon, IconCache},
    model::{SpellMetadata, SpellPack, SpellRecord},
};

/// 持有唯一技能资料目录；更新资料只影响展示，不接触录制事件。
pub struct GameDataState {
    records: RwLock<HashMap<u32, (SpellRecord, String)>>,
    metadata_path: PathBuf,
    pub icons: IconCache,
}

impl GameDataState {
    pub fn load(app: &AppHandle) -> Result<Self, String> {
        let packaged = app
            .path()
            .resource_dir()
            .map_err(|error| error.to_string())?
            .join("game-data");
        let bundled = if packaged.join("spells.json").is_file() {
            packaged
        } else {
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/game-data")
        };
        let directory = app
            .path()
            .app_local_data_dir()
            .map_err(|error| error.to_string())?
            .join("game-data");
        let metadata_path = directory.join("spells.json");
        let pack: SpellPack = serde_json::from_slice(
            &std::fs::read(bundled.join("spells.json")).map_err(|error| error.to_string())?,
        )
        .map_err(|error| format!("读取随包技能资料失败：{error}"))?;
        let mut records = pack
            .spells
            .into_iter()
            .map(|record| {
                (
                    record.spell_id,
                    (
                        record.clone(),
                        record.source.clone().unwrap_or_else(|| pack.source.clone()),
                    ),
                )
            })
            .collect::<HashMap<_, _>>();
        if let Ok(bytes) = std::fs::read(&metadata_path) {
            if let Ok(pack) = parse_pack(&bytes) {
                records.extend(pack.spells.into_iter().map(|record| {
                    (
                        record.spell_id,
                        (
                            record.clone(),
                            record.source.clone().unwrap_or_else(|| pack.source.clone()),
                        ),
                    )
                }));
            }
        }
        Ok(Self {
            records: RwLock::new(records),
            metadata_path,
            icons: IconCache::new(bundled.join("icons"), directory.join("icons"))?,
        })
    }
}

/// 接受资料包或 WCL masterData 导出；只提取公开展示字段。
fn parse_pack(bytes: &[u8]) -> Result<SpellPack, String> {
    let value: serde_json::Value =
        serde_json::from_slice(bytes).map_err(|error| format!("技能资料 JSON 无效：{error}"))?;
    if value
        .get("gameVersion")
        .and_then(|value| value.as_str())
        .is_some_and(|version| version != "retail")
        || value
            .get("schemaVersion")
            .and_then(|value| value.as_u64())
            .is_some_and(|version| version != 1)
    {
        return Err("不支持此游戏类型或技能资料版本".into());
    }
    let entries = value
        .get("spells")
        .or_else(|| value.get("abilities"))
        .or_else(|| value.pointer("/masterData/abilities"))
        .or_else(|| value.pointer("/reportData/report/masterData/abilities"))
        .or_else(|| value.pointer("/data/reportData/report/masterData/abilities"))
        .and_then(|value| value.as_array())
        .ok_or("未找到 spells 或 WCL masterData.abilities")?;
    let mut spells = Vec::new();
    let mut ids = HashSet::new();
    for entry in entries {
        let spell_id = entry
            .get("spellId")
            .or_else(|| entry.get("gameID"))
            .or_else(|| entry.get("id"))
            .and_then(|id| id.as_u64())
            .and_then(|id| u32::try_from(id).ok())
            .filter(|id| *id > 0)
            .ok_or("技能资料缺少有效的游戏技能 ID")?;
        let name = entry
            .get("name")
            .and_then(|name| name.as_str())
            .filter(|name| !name.is_empty())
            .ok_or("技能资料缺少名称")?;
        let raw_icon = entry
            .get("icon")
            .and_then(|icon| icon.as_str())
            .ok_or("技能资料缺少图标")?;
        let mut icon = raw_icon
            .strip_prefix(ICON_ORIGIN)
            .unwrap_or(raw_icon)
            .to_ascii_lowercase();
        if !icon.contains('.') {
            icon.push_str(".jpg");
        }
        if !valid_icon(&icon) || !ids.insert(spell_id) {
            return Err("技能资料包含无效图标或重复技能 ID".to_string());
        }
        spells.push(SpellRecord {
            spell_id,
            name: name.to_string(),
            icon,
            source: entry
                .get("source")
                .and_then(|value| value.as_str())
                .map(str::to_string),
        });
    }
    if spells.is_empty() {
        return Err("技能资料包为空".to_string());
    }
    Ok(SpellPack {
        schema_version: 1,
        game_version: "retail".to_string(),
        source: value
            .get("source")
            .and_then(|source| source.as_str())
            .unwrap_or("本地导入 WCL 技能资料")
            .to_string(),
        spells,
    })
}

/// 批量解析技能与受控图片地址，未知技能返回缺省并保留日志中的名称。
#[tauri::command]
pub async fn get_spell_metadata(
    spell_ids: Vec<u32>,
    state: State<'_, GameDataState>,
) -> Result<Vec<SpellMetadata>, String> {
    if spell_ids.len() > SPELL_BATCH_LIMIT {
        return Err("一次查询的技能数量过多".to_string());
    }
    let ids = spell_ids.into_iter().collect::<HashSet<_>>();
    let records = {
        let cache = state.records.read().await;
        ids.into_iter()
            .filter_map(|id| cache.get(&id).cloned())
            .collect::<Vec<_>>()
    };
    Ok(stream::iter(records)
        .map(|(record, source)| {
            let icons = &state.icons;
            async move {
                let available = icons.ensure(&record.icon).await.is_some();
                SpellMetadata {
                    spell_id: record.spell_id,
                    name: record.name,
                    icon_url: available.then(|| format!("{ICON_LOCAL_ORIGIN}/{}", record.icon)),
                    source,
                }
            }
        })
        .buffer_unordered(ICON_CONCURRENCY)
        .collect()
        .await)
}

/// 只有用户通过文件选择器指定资料文件后才读取，成功写盘后发布新资料。
#[tauri::command]
pub async fn import_spell_metadata(
    path: String,
    state: State<'_, GameDataState>,
) -> Result<usize, String> {
    let path = Path::new(&path);
    if tokio::fs::metadata(path)
        .await
        .map_err(|error| error.to_string())?
        .len()
        > METADATA_MAX_BYTES
    {
        return Err("技能资料文件超过大小限制".to_string());
    }
    let pack = parse_pack(
        &tokio::fs::read(path)
            .await
            .map_err(|error| error.to_string())?,
    )?;
    let mut records = state.records.write().await;
    let mut merged = records.clone();
    for record in pack.spells {
        merged.insert(
            record.spell_id,
            (
                record.clone(),
                record.source.clone().unwrap_or_else(|| pack.source.clone()),
            ),
        );
    }
    let persisted = SpellPack {
        schema_version: 1,
        game_version: "retail".into(),
        source: pack.source,
        spells: merged
            .values()
            .map(|(record, source)| {
                let mut record = record.clone();
                record.source = Some(source.clone());
                record
            })
            .collect(),
    };
    let bytes = serde_json::to_vec_pretty(&persisted).map_err(|error| error.to_string())?;
    tokio::fs::create_dir_all(state.metadata_path.parent().expect("缓存路径有父目录"))
        .await
        .map_err(|error| error.to_string())?;
    let temporary = state.metadata_path.with_extension("json.tmp");
    tokio::fs::write(&temporary, bytes)
        .await
        .map_err(|error| error.to_string())?;
    crate::storage::replace_file(&temporary, &state.metadata_path)
        .map_err(|error| error.to_string())?;
    let count = merged.len();
    *records = merged;
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::parse_pack;

    #[test]
    fn imports_wcl_game_id_instead_of_report_local_id() {
        let pack = parse_pack(br#"{"data":{"reportData":{"report":{"masterData":{"abilities":[{"id":99,"gameID":642,"name":"Divine Shield","icon":"spell_holy_divineshield.jpg"}]}}}}}"#).unwrap();
        assert_eq!(pack.spells[0].spell_id, 642);
    }

    #[test]
    fn rejects_external_endpoints_and_duplicate_spells() {
        assert!(parse_pack(
            br#"{"spells":[{"spellId":1,"name":"bad","icon":"https://evil.example/a.jpg"}]}"#
        )
        .is_err());
        assert!(parse_pack(br#"{"spells":[{"spellId":1,"name":"a","icon":"a.jpg"},{"spellId":1,"name":"b","icon":"b.jpg"}]}"#).is_err());
    }
}
