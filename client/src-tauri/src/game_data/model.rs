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

/// 固定版本公开DB2的纯文本说明；动态数值不按当前人物属性猜测。
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpellTooltip {
    pub spell_id: u32,
    pub name: String,
    pub description: String,
    pub english_name: Option<String>,
    pub range_text: Option<String>,
    pub cast_time_text: Option<String>,
    pub cost_text: Option<String>,
    pub cooldown_text: Option<String>,
    pub description_note: Option<String>,
    #[serde(default)]
    pub dynamic_values: bool,
    pub source: Option<String>,
    pub build: Option<String>,
}

/// 随包说明独立于可导入的名称和图标资料。
#[derive(Deserialize)]
pub struct SpellTooltipPack {
    pub spells: Vec<SpellTooltip>,
}
