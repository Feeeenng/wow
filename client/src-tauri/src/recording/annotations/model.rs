use serde::{Deserialize, Serialize};
use std::collections::HashSet;

use super::config;

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AnnotationKind {
    Pen,
    Arrow,
    Rect,
    Ellipse,
    Text,
    Marker,
}

/// 使用视频内容的归一化坐标与共同战斗时间，不保存任意 HTML 或 SVG。
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Annotation {
    pub id: uuid::Uuid,
    pub kind: AnnotationKind,
    pub points: Vec<Point>,
    pub color: String,
    pub width: f64,
    #[serde(default)]
    pub text: String,
    pub at_ms: i64,
    pub duration_ms: u32,
}

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Document {
    pub version: u32,
    pub items: Vec<Annotation>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub version: u32,
    pub items: Vec<Annotation>,
    pub can_edit: bool,
}

impl From<Document> for Snapshot {
    fn from(document: Document) -> Self {
        Self {
            version: document.version,
            items: document.items,
            can_edit: true,
        }
    }
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveRequest {
    pub expected_version: u32,
    pub items: Vec<Annotation>,
}

/// 原生与远端均校验相同图形约束，错误不修改已有快照。
pub fn validate(items: &[Annotation], duration_ms: i64) -> Result<(), String> {
    if items.len() > config::ITEM_LIMIT
        || items.iter().map(|item| item.points.len()).sum::<usize>() > config::DOCUMENT_POINT_LIMIT
    {
        return Err("标注数量或笔迹点数超过限制".into());
    }
    let mut ids = HashSet::new();
    for item in items {
        let count_valid = match item.kind {
            AnnotationKind::Pen => (2..=config::POINT_LIMIT).contains(&item.points.len()),
            AnnotationKind::Arrow | AnnotationKind::Rect | AnnotationKind::Ellipse => {
                item.points.len() == 2
            }
            AnnotationKind::Text | AnnotationKind::Marker => item.points.len() == 1,
        };
        if !ids.insert(item.id)
            || !count_valid
            || item.points.iter().any(|point| {
                !point.x.is_finite()
                    || !point.y.is_finite()
                    || !(0.0..=1.0).contains(&point.x)
                    || !(0.0..=1.0).contains(&point.y)
            })
        {
            return Err("标注身份、图形或画面坐标无效".into());
        }
        if !item.width.is_finite()
            || !config::WIDTH_RANGE.contains(&item.width)
            || item.color.len() != 7
            || !item.color.starts_with('#')
            || !item.color.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit)
        {
            return Err("标注颜色或线宽无效".into());
        }
        if item.at_ms < 0
            || item.at_ms > duration_ms
            || !config::DURATION_RANGE.contains(&item.duration_ms)
            || item.text.chars().count() > config::TEXT_LIMIT
            || item.text.contains('\0')
            || matches!(item.kind, AnnotationKind::Text) && item.text.trim().is_empty()
        {
            return Err("标注时间或文字无效".into());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    pub fn sample() -> Annotation {
        Annotation {
            id: uuid::Uuid::new_v4(),
            kind: AnnotationKind::Arrow,
            points: vec![Point { x: 0.1, y: 0.2 }, Point { x: 0.5, y: 0.7 }],
            color: "#E51039".into(),
            width: 3.0,
            text: String::new(),
            at_ms: 1000,
            duration_ms: 5000,
        }
    }

    #[test]
    fn rejects_outside_frame_duplicate_identity_and_executable_markup_fields() {
        let mut item = sample();
        assert!(validate(&[item.clone()], 10_000).is_ok());
        assert!(validate(&[item.clone(), item.clone()], 10_000).is_err());
        item.points[0].x = f64::NAN;
        assert!(validate(&[item], 10_000).is_err());
        let mut raw = serde_json::to_value(sample()).unwrap();
        raw["html"] = serde_json::json!("<script>bad</script>");
        assert!(serde_json::from_value::<Annotation>(raw).is_err());
        let mut text = sample();
        text.kind = AnnotationKind::Text;
        text.points.truncate(1);
        assert!(validate(&[text.clone()], 10_000).is_err());
        text.text = "<b>字面文字</b>".into();
        assert!(validate(&[text], 10_000).is_ok());
    }

    #[test]
    fn plain_text_preserves_tabs_and_windows_line_endings_across_team_dto() {
        let mut text = sample();
        text.kind = AnnotationKind::Text;
        text.points.truncate(1);
        text.text = "第一行\t备注\r\n第二行 <b>字面文字</b>".into();
        assert!(validate(&[text.clone()], 10_000).is_ok());
        let snapshot = Snapshot {
            version: 1,
            items: vec![text.clone()],
            can_edit: true,
        };
        let raw = serde_json::to_vec(&snapshot).unwrap();
        let restored: Snapshot = serde_json::from_slice(&raw).unwrap();
        assert_eq!(restored.items[0].text, text.text);
        assert!(validate(&restored.items, 10_000).is_ok());
        text.text.push('\0');
        assert!(validate(&[text], 10_000).is_err());
    }
}
