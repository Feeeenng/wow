use crate::{
    cloud::{
        api::client::ApiClient,
        auth::credentials,
        config::MAX_QUEUE_JOBS,
        state::CloudState,
        upload::{
            model::{JobStatus, JobView, Observation, StoredJob, UploadIntent},
            source::video_path,
        },
    },
    local_state::LocalStateStore,
    recording::capture::state::RecordingState,
};
use tauri::{AppHandle, Manager, State};

/// 返回持久化意图与当前进程观测，未核验记录不冒充正在上传。
#[tauri::command]
pub async fn get_cloud_uploads(state: State<'_, CloudState>) -> Result<Vec<JobView>, String> {
    if let Some(error) = &state.recovery_error {
        return Err(error.clone());
    }
    let jobs = state.jobs.lock().await.clone();
    let observations = state.observations.read().await;
    Ok(jobs
        .into_iter()
        .map(|job| {
            let observed = observations
                .get(&job.job_id)
                .cloned()
                .unwrap_or_else(Observation::default);
            JobView {
                team_pull_id: job.team_pull_id,
                job_id: job.job_id,
                pull_id: job.pull_id,
                origin: job.origin,
                team_id: job.team_id,
                intent: job.intent,
                encounter_name: job.encounter_name,
                status: observed.status,
                uploaded_bytes: observed.uploaded_bytes,
                file_size_bytes: job.file_size_bytes,
                recording_status: observed.recording_status,
                verification: observed.verification,
                full_file_sha256_verified: observed.full_file_sha256_verified,
                error: observed.error,
            }
        })
        .collect())
}

/// 只有用户显式指定索引 Pull ID 才建立上传意图，不扫描历史录像自动外发。
#[tauri::command]
pub async fn enqueue_cloud_upload(
    app: AppHandle,
    pull_id: String,
    team_pull_id: Option<String>,
    state: State<'_, CloudState>,
    store: State<'_, LocalStateStore>,
) -> Result<String, String> {
    if team_pull_id
        .as_ref()
        .is_some_and(|id| uuid::Uuid::parse_str(id).is_err())
    {
        return Err("指定团队场次身份无效".into());
    }
    if let Some(error) = &state.recovery_error {
        return Err(error.clone());
    }
    let settings = state.settings.lock().await.clone();
    let identity = ApiClient::new(
        &settings.endpoint,
        credentials::reveal(&settings.protected_token)?,
    )?
    .me()
    .await?;
    if settings.user_id.as_ref() != Some(&identity.user_id) {
        return Err("云端账号与已保存设置不一致，请重新配置".into());
    }
    let team = settings.team_id.clone().ok_or("请先选择上传团队")?;
    if !identity.teams.iter().any(|entry| entry.team_id == team) {
        return Err("当前账号不属于上传团队".into());
    }
    let recording = app.state::<RecordingState>();
    let pull = recording
        .index
        .lock()
        .await
        .pulls
        .iter()
        .find(|pull| pull.pull_id == pull_id)
        .cloned()
        .ok_or("本地录像不存在")?;
    let video = video_path(&pull)?;
    let size = tokio::fs::metadata(video)
        .await
        .map_err(|error| error.to_string())?
        .len();
    state.publish_identity(&settings, identity.clone()).await?;
    let id = state
        .update_jobs(&store, |jobs| {
            if let Some(existing) = jobs.iter().find(|job| {
                job.pull_id == pull_id
                    && job.origin == settings.endpoint
                    && job.user_id == identity.user_id
                    && job.team_id == team
                    && !matches!(
                        job.intent,
                        UploadIntent::Completed | UploadIntent::Cancelled
                    )
            }) {
                if existing.team_pull_id != team_pull_id {
                    return Err("该录像已有其他场次关联的上传任务，请先处理已有任务".into());
                }
                return Ok(existing.job_id.clone());
            }
            if jobs.len() >= MAX_QUEUE_JOBS {
                return Err("上传队列已达到条目上限".into());
            }
            let id = uuid::Uuid::new_v4().to_string();
            jobs.push(StoredJob {
                job_id: id.clone(),
                pull_id,
                origin: settings.endpoint,
                user_id: identity.user_id,
                team_id: team,
                device_id: settings.device_id,
                encounter_name: pull.encounter_name,
                team_pull_id,
                intent: UploadIntent::Queued,
                file_size_bytes: size,
                registration: None,
                upload_id: None,
                restart_requested: false,
            });
            Ok(id)
        })
        .await?;
    state
        .observe(&id, |observation| observation.status = JobStatus::Queued)
        .await;
    Ok(id)
}

pub(super) async fn change_intent(
    id: &str,
    intent: UploadIntent,
    state: &CloudState,
    store: &LocalStateStore,
) -> Result<(), String> {
    state
        .update_jobs(store, |jobs| {
            let job = jobs
                .iter_mut()
                .find(|job| job.job_id == id)
                .ok_or("上传任务不存在")?;
            if job.intent == UploadIntent::Completed {
                return Err("文件已经上传完成".into());
            }
            job.restart_requested = intent == UploadIntent::Queued;
            job.intent = intent.clone();
            Ok(())
        })
        .await?;
    if intent != UploadIntent::Queued {
        state.interrupt(Some(id)).await;
    }
    state
        .observe(id, |observation| {
            observation.error = None;
            observation.status = match intent {
                UploadIntent::Queued => JobStatus::Queued,
                UploadIntent::Paused => JobStatus::Paused,
                _ => JobStatus::Cancelling,
            };
        })
        .await;
    Ok(())
}

#[tauri::command]
pub async fn retry_cloud_upload(
    job_id: String,
    state: State<'_, CloudState>,
    store: State<'_, LocalStateStore>,
) -> Result<(), String> {
    change_intent(&job_id, UploadIntent::Queued, &state, &store).await
}
#[tauri::command]
pub async fn pause_cloud_upload(
    job_id: String,
    state: State<'_, CloudState>,
    store: State<'_, LocalStateStore>,
) -> Result<(), String> {
    change_intent(&job_id, UploadIntent::Paused, &state, &store).await
}
#[tauri::command]
pub async fn cancel_cloud_upload(
    job_id: String,
    state: State<'_, CloudState>,
    store: State<'_, LocalStateStore>,
) -> Result<(), String> {
    change_intent(&job_id, UploadIntent::CancelRequested, &state, &store).await
}
