/// 云端地址与 DPAPI 密文凭证的持久化业务区段。
pub const SETTINGS_SECTION: &str = "cloud";
/// 上传意图与服务器任务身份的持久化业务区段，不恢复运行时进度。
pub const UPLOAD_SECTION: &str = "cloudUploads";
/// 固定的第一版后端接口前缀，服务地址只填写根地址。
pub const API_PREFIX: &str = "/api/v1";
/// 元数据请求超时，避免网络故障长期占住队列。
pub const API_TIMEOUT_SECONDS: u64 = 30;
/// 单片上传超时，暂停和取消可提前中止请求。
pub const PART_TIMEOUT_SECONDS: u64 = 180;
/// 单片最大内存与服务端 64MiB 上限一致。
pub const MAX_PART_BYTES: u64 = 64 * 1024 * 1024;
/// S3 Multipart 最多接收一万个分片。
pub const MAX_PARTS: u32 = 10_000;
/// 文件摘要流式缓冲区，不把整段录像载入内存。
pub const HASH_BUFFER_BYTES: usize = 1024 * 1024;
/// 队列轮询周期，空配置不会进行网络请求。
pub const QUEUE_POLL_MS: u64 = 1_000;
/// 已上传与暂停的服务器会话定期重查，处理完成状态不会永久停留在旧快照。
pub const SERVER_STATUS_POLL_MS: u64 = 10_000;
/// API JSON 最大体积，可容纳一万个已确认分片状态。
pub const MAX_API_RESPONSE_BYTES: usize = 4 * 1024 * 1024;
/// 队列条目上限，防止误操作无限积累本地状态。
pub const MAX_QUEUE_JOBS: usize = 1_000;
/// 与服务端映射说明字段上限一致，保留中文字符而不截断 UTF-8。
pub const MAX_MAPPING_ERROR_CHARS: usize = 512;

/// 服务与预签名地址只允许 HTTPS，或用户明确配置的本机 HTTP。
pub fn secure_url(value: &str) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(value).map_err(|_| "云端地址格式无效")?;
    let host = url.host_str().ok_or("云端地址缺少主机")?;
    let loopback = host.eq_ignore_ascii_case("localhost")
        || host
            .trim_matches(['[', ']'])
            .parse::<std::net::IpAddr>()
            .is_ok_and(|address| address.is_loopback());
    if (url.scheme() != "https" && !(url.scheme() == "http" && loopback))
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err("仅支持 HTTPS 或本机回环 HTTP 地址，地址不得包含账号或片段".into());
    }
    Ok(url)
}

pub fn endpoint(value: &str) -> Result<String, String> {
    let url = secure_url(value)?;
    if url.path() != "/" || url.query().is_some() {
        return Err("请填写服务根地址，不包含接口路径或查询参数".into());
    }
    Ok(url.as_str().trim_end_matches('/').to_string())
}

#[cfg(test)]
mod tests {
    #[test]
    fn remote_http_credentials_and_endpoint_queries_are_rejected() {
        assert!(super::endpoint("http://example.com").is_err());
        assert!(super::endpoint("https://user:secret@example.com").is_err());
        assert!(super::endpoint("https://example.com/api/v1").is_err());
        assert!(super::endpoint("https://example.com?token=secret").is_err());
        assert!(super::endpoint("http://127.0.0.1:8000").is_ok());
        assert!(super::endpoint("http://[::1]:8000").is_ok());
    }
}
