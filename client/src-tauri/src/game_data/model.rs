use serde::{Deserialize, Serialize};

/// 只保存展示资料，不保存或修改战斗事件时间。
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpellRecord {
    pub spell_id: u32,
    pub name: String,
    pub icon: String,
    #[serde(default)]
    pub source: Option<String>,
}

/// 初始资料与 WCL 导入资料共用的缓存格式。
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpellPack {
    pub schema_version: u32,
    pub game_version: String,
    pub source: String,
    pub spells: Vec<SpellRecord>,
}

/// 返回给界面的技能展示资料，原始事件名称仍以 CombatLog 为准。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpellMetadata {
    pub spell_id: u32,
    pub name: String,
    pub icon_url: Option<String>,
    pub source: String,
}
