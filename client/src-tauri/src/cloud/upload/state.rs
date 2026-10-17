use std::sync::atomic::{AtomicBool, Ordering};
use tokio::sync::Notify;

/// 中止当前 HTTP 分片请求；已被 S3 接收的分片在续传时由服务端重新确认。
#[derive(Default)]
pub struct TransferControl {
    interrupted: AtomicBool,
    pub changed: Notify,
}

impl TransferControl {
    pub fn interrupt(&self) {
        self.interrupted.store(true, Ordering::SeqCst);
        self.changed.notify_one();
    }
    pub fn interrupted(&self) -> bool {
        self.interrupted.load(Ordering::SeqCst)
    }
}
