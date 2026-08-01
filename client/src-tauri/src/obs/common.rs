/// 将 OBS 协议错误补充为可定位的业务错误。
pub(crate) fn obs_error(context: &str, error: impl std::fmt::Display) -> String {
    format!("{context}：{error}")
}

pub(crate) const MANAGED_SCENE: &str = "WoW Recorder";
