use super::{
    model::DeathReview,
    reading::{self, ReviewRequest},
};
use crate::recording::{
    capture::state::RecordingState,
    config::{
        DEATH_REVIEW_CACHE_SIZE, DEATH_REVIEW_CURSOR_MAX_BYTES, DEATH_REVIEW_PAGE_DEFAULT,
        DEATH_REVIEW_PAGE_LIMIT,
    },
};
use std::{collections::VecDeque, time::SystemTime};
use tauri::State;
use tokio::sync::Mutex;

#[derive(PartialEq, Eq)]
struct Stamp {
    path: std::path::PathBuf,
    length: u64,
    modified: Option<SystemTime>,
    scope: Vec<u8>,
}
struct Cached {
    stamp: Stamp,
    review: DeathReview,
}

/// 缓存仅在当前进程，首次请求按源变化重读，后续页固定已读快照。
#[derive(Default)]
pub struct DeathReviewState {
    cache: Mutex<VecDeque<Cached>>,
}

fn page(
    mut review: DeathReview,
    cursor: Option<&str>,
    limit: usize,
) -> Result<DeathReview, String> {
    let start = if let Some(cursor) = cursor {
        let (revision, offset) = cursor.rsplit_once(':').ok_or("死亡明细游标无效")?;
        if revision != review.revision {
            return Err("死亡明细版本变化，请重新读取".into());
        }
        offset.parse::<usize>().map_err(|_| "死亡明细游标无效")?
    } else {
        0
    };
    if start > review.total {
        return Err("死亡明细游标超出范围".into());
    }
    review.events = review.events.into_iter().skip(start).take(limit).collect();
    let next = start + review.events.len();
    review.has_more = next < review.total;
    review.next_cursor = Some(format!("{}:{next}", review.revision));
    if start > 0 {
        review.prior_auras.clear();
    }
    Ok(review)
}

/// 仅接受当前录像和稳定死亡ID，文件及范围完全由Rust索引解析。
#[tauri::command]
pub async fn get_local_death_review(
    pull_id: String,
    event_id: String,
    cursor: Option<String>,
    limit: Option<usize>,
    state: State<'_, RecordingState>,
    reviews: State<'_, DeathReviewState>,
) -> Result<DeathReview, String> {
    let limit = limit.unwrap_or(DEATH_REVIEW_PAGE_DEFAULT);
    if limit == 0
        || limit > DEATH_REVIEW_PAGE_LIMIT
        || cursor
            .as_ref()
            .is_some_and(|value| value.len() > DEATH_REVIEW_CURSOR_MAX_BYTES)
    {
        return Err("死亡明细分页参数无效".into());
    }
    let request = ReviewRequest::from_index(&*state.index.lock().await, &pull_id, &event_id)?;
    let scope = serde_json::to_vec(&(&request.death, &request.prior_auras, &request.views))
        .expect("固定快照字段可序列化");
    let metadata = std::fs::metadata(&request.path).ok();
    let stamp = Stamp {
        path: request.path.clone(),
        length: metadata.as_ref().map(|value| value.len()).unwrap_or(0),
        modified: metadata.and_then(|value| value.modified().ok()),
        scope,
    };
    {
        let cache = reviews.cache.lock().await;
        if let Some(hit) = cache.iter().find(|hit| {
            hit.stamp == stamp
                || cursor
                    .as_ref()
                    .is_some_and(|cursor| cursor.starts_with(&format!("{}:", hit.review.revision)))
                    && hit.stamp.path == stamp.path
                    && hit.stamp.scope == stamp.scope
        }) {
            return page(hit.review.clone(), cursor.as_deref(), limit);
        }
    }
    let review = tauri::async_runtime::spawn_blocking(move || reading::read(&request))
        .await
        .map_err(|_| "死亡明细读取任务异常")??;
    if review.availability == "ready" {
        let mut cache = reviews.cache.lock().await;
        cache.retain(|hit| hit.stamp != stamp);
        cache.push_back(Cached {
            stamp,
            review: review.clone(),
        });
        while cache.len() > DEATH_REVIEW_CACHE_SIZE {
            cache.pop_front();
        }
    }
    page(review, cursor.as_deref(), limit)
}
