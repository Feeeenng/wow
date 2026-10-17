use crate::cloud::{
    api::{client::ApiClient, model::UploadStatus},
    config::{MAX_PARTS, MAX_PART_BYTES},
    state::CloudState,
    upload::{
        model::{JobStatus, StoredJob},
        source::hex,
        state::TransferControl,
    },
};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use tokio::io::{AsyncReadExt, AsyncSeekExt};

/// 检查服务端分片计划，拒绝越界、重复或超过客户端内存上限的状态。
pub(crate) fn validate_status(status: &UploadStatus, job: &StoredJob) -> Result<(), String> {
    if status.file_size_bytes != job.file_size_bytes
        || status.part_size_bytes == 0
        || status.part_size_bytes > MAX_PART_BYTES
        || status.total_parts == 0
        || status.total_parts > MAX_PARTS
        || uuid::Uuid::parse_str(&status.upload_id).is_err()
    {
        return Err("云端分片计划与本地文件不一致或超出限制".into());
    }
    let expected = job.file_size_bytes.div_ceil(status.part_size_bytes);
    if expected != status.total_parts as u64
        || !matches!(
            status.upload_status.as_str(),
            "pending" | "uploading" | "uploaded" | "aborted"
        )
    {
        return Err("云端上传状态无效".into());
    }
    let mut seen = BTreeSet::new();
    let mut bytes = 0;
    for part in &status.confirmed_parts {
        if part.part_number == 0
            || part.part_number > status.total_parts
            || !seen.insert(part.part_number)
            || part.size_bytes != part_size(status, part.part_number)
            || part.checksum_sha256.len() != 64
            || !part
                .checksum_sha256
                .bytes()
                .all(|value| value.is_ascii_hexdigit())
        {
            return Err("云端已确认分片状态无效".into());
        }
        bytes += part.size_bytes;
    }
    if bytes != status.uploaded_bytes || bytes > job.file_size_bytes {
        return Err("云端已确认上传字节不一致".into());
    }
    if job
        .upload_id
        .as_ref()
        .is_some_and(|id| id != &status.upload_id)
    {
        return Err("云端上传身份与恢复任务不一致".into());
    }
    Ok(())
}

fn part_size(status: &UploadStatus, number: u32) -> u64 {
    (status.file_size_bytes - (number as u64 - 1) * status.part_size_bytes)
        .min(status.part_size_bytes)
}

pub(crate) fn check(control: &TransferControl) -> Result<(), String> {
    if control.interrupted() {
        Err("上传已暂停或取消".into())
    } else {
        Ok(())
    }
}

pub(crate) async fn observe_status(
    state: &CloudState,
    job: &StoredJob,
    status: &UploadStatus,
    phase: JobStatus,
) {
    state
        .observe(&job.job_id, |observation| {
            observation.status = phase;
            observation.uploaded_bytes = status.uploaded_bytes;
            observation.recording_status = Some(status.recording_status.clone());
            observation.verification = status.verification.clone();
            observation.full_file_sha256_verified = status.full_file_sha256_verified;
            observation.error = None;
        })
        .await;
}

/// 分片传输独立于应用生命周期，恢复时逐片校验本地摘要和服务器确认。
pub(crate) async fn upload_parts(
    client: &ApiClient,
    path: &std::path::Path,
    state: &CloudState,
    job: &StoredJob,
    control: &TransferControl,
    mut status: UploadStatus,
    expected_file_sha256: &str,
) -> Result<UploadStatus, String> {
    validate_status(&status, job)?;
    if status.upload_status != "uploaded" {
        let original_metadata = tokio::fs::metadata(path)
            .await
            .map_err(|error| error.to_string())?;
        let mut file_digest = Sha256::new();
        let mut file = tokio::fs::File::open(&path)
            .await
            .map_err(|error| format!("打开上传原片失败：{error}"))?;
        for number in 1..=status.total_parts {
            check(control)?;
            let size = part_size(&status, number);
            file.seek(std::io::SeekFrom::Start(
                (number as u64 - 1) * status.part_size_bytes,
            ))
            .await
            .map_err(|error| error.to_string())?;
            let mut bytes = vec![0; size as usize];
            file.read_exact(&mut bytes)
                .await
                .map_err(|error| format!("读取上传分片失败：{error}"))?;
            file_digest.update(&bytes);
            let digest = Sha256::digest(&bytes);
            let checksum = hex(&digest);
            if let Some(part) = status
                .confirmed_parts
                .iter()
                .find(|part| part.part_number == number)
            {
                if !part.checksum_sha256.eq_ignore_ascii_case(&checksum) {
                    return Err("已确认分片摘要与原片不一致，已停止续传".into());
                }
                continue;
            }
            state
                .observe(&job.job_id, |value| value.status = JobStatus::Uploading)
                .await;
            let signed = client.presign(&status.upload_id, number, &checksum).await?;
            if signed.part_number != number
                || signed.size_bytes != size
                || signed.expires_in_seconds == 0
                || signed
                    .headers
                    .iter()
                    .find(|(key, _)| key.eq_ignore_ascii_case("x-amz-checksum-sha256"))
                    .map(|(_, value)| value.as_str())
                    != Some(base64(&digest).as_str())
            {
                return Err("云端预签名分片计划无效".into());
            }
            check(control)?;
            ApiClient::put_part(signed, bytes, control).await?;
            check(control)?;
            status = client.confirm(&status.upload_id, number).await?;
            validate_status(&status, &job)?;
            observe_status(state, &job, &status, JobStatus::Uploading).await;
        }
        check(control)?;
        let final_metadata = tokio::fs::metadata(path)
            .await
            .map_err(|error| error.to_string())?;
        if hex(&file_digest.finalize()) != expected_file_sha256
            || original_metadata.len() != final_metadata.len()
            || original_metadata.modified().ok() != final_metadata.modified().ok()
        {
            return Err("传输期间原片发生变化，未完成云端合并".into());
        }
        status = client.complete(&status.upload_id).await?;
        validate_status(&status, &job)?;
    }
    Ok(status)
}

/// S3 请求头使用 SHA-256 原始字节的 Base64，而 API 使用十六进制摘要。
pub(crate) fn base64(bytes: &[u8]) -> String {
    const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut output = String::new();
    for chunk in bytes.chunks(3) {
        let word = (chunk[0] as u32) << 16
            | (chunk.get(1).copied().unwrap_or(0) as u32) << 8
            | chunk.get(2).copied().unwrap_or(0) as u32;
        output.push(ALPHABET[((word >> 18) & 63) as usize] as char);
        output.push(ALPHABET[((word >> 12) & 63) as usize] as char);
        output.push(if chunk.len() > 1 {
            ALPHABET[((word >> 6) & 63) as usize] as char
        } else {
            '='
        });
        output.push(if chunk.len() > 2 {
            ALPHABET[(word & 63) as usize] as char
        } else {
            '='
        });
    }
    output
}
