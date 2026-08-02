use std::{
    process::Child,
    sync::{atomic::AtomicBool, Mutex},
};

/// 保存客户端拥有的本机媒体进程及串行启动锁。
#[derive(Default)]
pub struct LocalMediaState {
    pub process: Mutex<Option<Child>>,
    pub operation: tokio::sync::Mutex<()>,
    pub shutting_down: AtomicBool,
}
