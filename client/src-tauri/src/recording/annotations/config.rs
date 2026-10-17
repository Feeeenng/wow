/// 标注保存为用户业务区段，独立于播放器连接、撤销历史和绘制中的瞬时笔迹。
pub const SECTION: &str = "replayAnnotations";
/// 与团队标注默认边界一致，限制单份快照及本地总量，避免状态文件无限增长。
pub const ITEM_LIMIT: usize = 200;
pub const POINT_LIMIT: usize = 512;
pub const DOCUMENT_POINT_LIMIT: usize = 20_000;
pub const LOCAL_POINT_LIMIT: usize = 200_000;
pub const LOCAL_DOCUMENT_LIMIT: usize = 1000;
pub const TEXT_LIMIT: usize = 500;
pub const WIDTH_RANGE: std::ops::RangeInclusive<f64> = 1.0..=12.0;
pub const DURATION_RANGE: std::ops::RangeInclusive<u32> = 1..=60_000;
