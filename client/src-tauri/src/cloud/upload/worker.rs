use std::{
    collections::HashMap,
    sync::Arc,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager};

use crate::{
    cloud::{
        api::client::ApiClient,
        auth::{credentials, model::StoredSettings},
        config::{QUEUE_POLL_MS, SERVER_STATUS_POLL_MS},
        state::CloudState,
        upload::{
            model::{JobStatus, StoredJob, UploadIntent},
            multipart::{check, observe_status, upload_parts, validate_status},
            source,
            state::TransferControl,
        },
    },
    local_state::LocalStateStore,
    recording::capture::{runtime::ffmpeg_path, state::RecordingState},
};

/// 单任务始终先核验账号和服务器状态，再按真实确认分片恢复。
async fn transfer(
    app: &AppHandle,
    state: &CloudState,
    store: &LocalStateStore,
    settings: &StoredSettings,
    mut job: StoredJob,
    control: &TransferControl,
) -> Result<(), String> {
    if settings.endpoint != job.origin || settings.user_id.as_ref() != Some(&job.user_id) {
        return Err("任务所属服务或账号与当前连接不同，请切回对应连接后重试".into());
    }
    check(control)?;
    let client = ApiClient::new(&job.origin, credentials::reveal(&settings.protected_token)?)?;
    let identity = client.me().await?;
    if identity.user_id != job.user_id
        || !identity
            .teams
            .iter()
            .any(|team| team.team_id == job.team_id)
    {
        return Err("当前账号没有该上传任务的团队权限".into());
    }
    state.publish_identity(settings, identity).await?;
    check(control)?;
    let mut status = if let Some(id) = &job.upload_id {
        Some(client.status(id).await?)
    } else {
        None
    };
    if let Some(status) = &status {
        validate_status(status, &job)?;
    }
    if status
        .as_ref()
        .is_some_and(|status| status.upload_status == "uploaded")
    {
        let status = status.as_ref().expect("已确认服务器有上传状态");
        state
            .update_jobs(store, |jobs| {
                jobs.iter_mut()
                    .find(|item| item.job_id == job.job_id)
                    .ok_or("上传任务不存在")?
                    .intent = UploadIntent::Completed;
                Ok(())
            })
            .await?;
        observe_status(state, &job, status, JobStatus::Uploaded).await;
        return Ok(());
    }
    if job.intent == UploadIntent::CancelRequested {
        state
            .observe(&job.job_id, |value| value.status = JobStatus::Cancelling)
            .await;
        if let Some(upload) = status {
            let aborted = client.abort(&upload.upload_id).await?;
            observe_status(state, &job, &aborted, JobStatus::Cancelled).await;
        }
        state
            .update_jobs(store, |jobs| {
                jobs.iter_mut()
                    .find(|item| item.job_id == job.job_id)
                    .ok_or("上传任务不存在")?
                    .intent = UploadIntent::Cancelled;
                Ok(())
            })
            .await?;
        state
            .observe(&job.job_id, |value| value.status = JobStatus::Cancelled)
            .await;
        return Ok(());
    }
    if job.intent != UploadIntent::Queued {
        if let Some(status) = &status {
            observe_status(
                state,
                &job,
                status,
                if job.intent == UploadIntent::Cancelled {
                    JobStatus::Cancelled
                } else {
                    JobStatus::Paused
                },
            )
            .await;
        } else {
            state
                .observe(&job.job_id, |value| {
                    value.status = if job.intent == UploadIntent::Cancelled {
                        JobStatus::Cancelled
                    } else {
                        JobStatus::Paused
                    }
                })
                .await;
        }
        return Ok(());
    }
    check(control)?;
    state
        .observe(&job.job_id, |value| value.status = JobStatus::Hashing)
        .await;
    let recording = app.state::<RecordingState>();
    let pull = recording
        .index
        .lock()
        .await
        .pulls
        .iter()
        .find(|pull| pull.pull_id == job.pull_id)
        .cloned()
        .ok_or("本地录像已不存在")?;
    let (path, registration) =
        source::registration(&job, &pull, ffmpeg_path(app)?, control).await?;
    if job.registration.is_none() {
        state
            .update_jobs(store, |jobs| {
                jobs.iter_mut()
                    .find(|item| item.job_id == job.job_id)
                    .ok_or("上传任务不存在")?
                    .registration = Some(registration.clone());
                Ok(())
            })
            .await?;
        job.registration = Some(registration.clone());
    }
    check(control)?;
    if status.is_none() {
        state
            .observe(&job.job_id, |value| value.status = JobStatus::Registering)
            .await;
        let registered = client.register(&registration).await?;
        validate_status(&registered, &job)?;
        state
            .update_jobs(store, |jobs| {
                jobs.iter_mut()
                    .find(|item| item.job_id == job.job_id)
                    .ok_or("上传任务不存在")?
                    .upload_id = Some(registered.upload_id.clone());
                Ok(())
            })
            .await?;
        job.upload_id = Some(registered.upload_id.clone());
        status = Some(registered);
    }
    let mut status = status.ok_or("云端没有返回上传状态")?;
    if status.upload_status == "aborted" {
        if !job.restart_requested {
            return Err("云端上传已中止，请显式重试以重新建立上传".into());
        }
        check(control)?;
        status = client.restart(&status.upload_id).await?;
        validate_status(&status, &job)?;
    }
    state
        .update_jobs(store, |jobs| {
            jobs.iter_mut()
                .find(|item| item.job_id == job.job_id)
                .ok_or("上传任务不存在")?
                .restart_requested = false;
            Ok(())
        })
        .await?;
    status = upload_parts(
        &client,
        &path,
        state,
        &job,
        control,
        status,
        &registration.file_sha256,
    )
    .await?;
    if status.upload_status != "uploaded" {
        return Err("云端尚未确认整个文件上传完成".into());
    }
    state
        .update_jobs(store, |jobs| {
            jobs.iter_mut()
                .find(|item| item.job_id == job.job_id)
                .ok_or("上传任务不存在")?
                .intent = UploadIntent::Completed;
            Ok(())
        })
        .await?;
    observe_status(state, &job, &status, JobStatus::Uploaded).await;
    Ok(())
}

/// 只有显式入队的用户意图才会上传，重启时先核验已有会话，不扫描历史成片。
pub(crate) fn next_job<'a>(
    jobs: &'a [StoredJob],
    verified: &HashMap<String, Instant>,
    now: Instant,
) -> Option<&'a StoredJob> {
    jobs.iter()
        .find(|job| {
            matches!(
                job.intent,
                UploadIntent::Queued | UploadIntent::CancelRequested
            )
        })
        .or_else(|| jobs.iter().find(|job| !verified.contains_key(&job.job_id)))
        .or_else(|| {
            jobs.iter()
                .filter(|job| {
                    job.upload_id.is_some()
                        && verified.get(&job.job_id).is_some_and(|last| {
                            now.saturating_duration_since(*last)
                                >= Duration::from_millis(SERVER_STATUS_POLL_MS)
                        })
                })
                .min_by_key(|job| verified.get(&job.job_id).copied())
        })
}

/// 队列按用户意图执行，周期核验已存在会话的处理状态。
pub async fn maintain(app: AppHandle) {
    let state = app.state::<CloudState>();
    let store = app.state::<LocalStateStore>();
    let mut verified = HashMap::<String, Instant>::new();
    loop {
        tokio::time::sleep(Duration::from_millis(QUEUE_POLL_MS)).await;
        if state.recovery_error.is_some() {
            continue;
        }
        if state.settings.lock().await.endpoint.is_empty() {
            continue;
        }
        let selected = next_job(&state.jobs.lock().await, &verified, Instant::now())
            .map(|job| job.job_id.clone());
        let Some(id) = selected else {
            continue;
        };
        let control = Arc::new(TransferControl::default());
        *state.active.lock().await = Some((id.clone(), control.clone()));
        let selected = state
            .jobs
            .lock()
            .await
            .iter()
            .find(|job| job.job_id == id)
            .cloned();
        let settings = state.settings.lock().await.clone();
        if let Some(job) = selected {
            state
                .observe(&id, |value| {
                    value.status = JobStatus::Checking;
                    value.error = None;
                })
                .await;
            let result = transfer(&app, &state, &store, &settings, job, &control).await;
            if let Err(error) = result {
                let intent = state
                    .jobs
                    .lock()
                    .await
                    .iter()
                    .find(|job| job.job_id == id)
                    .map(|job| job.intent.clone());
                if control.interrupted() {
                    state
                        .observe(&id, |value| {
                            value.status = if intent == Some(UploadIntent::CancelRequested) {
                                JobStatus::Cancelling
                            } else {
                                JobStatus::Paused
                            }
                        })
                        .await;
                } else {
                    let _ = state
                        .update_jobs(&store, |jobs| {
                            if let Some(job) = jobs.iter_mut().find(|job| job.job_id == id) {
                                job.intent = UploadIntent::Paused;
                            }
                            Ok(())
                        })
                        .await;
                    state
                        .observe(&id, |value| {
                            value.status = JobStatus::Failed;
                            value.error = Some(error);
                        })
                        .await;
                }
            }
        }
        *state.active.lock().await = None;
        verified.insert(id, Instant::now());
    }
}
