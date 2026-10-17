use std::{
    collections::VecDeque,
    io::{self, Write},
};

use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::State;

use crate::recording::{
    capture::state::RecordingState,
    config::{REPLAY_EVENT_PAGE_LIMIT, REPLAY_EVENT_QUERY_CACHE_SIZE},
    model::{BossPull, RecordingIndex, TimelineEvent},
};

struct DigestWriter(Sha256);

impl Write for DigestWriter {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        self.0.update(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

fn digest(value: &impl Serialize, previous: Option<&[u8; 32]>) -> [u8; 32] {
    let mut writer = DigestWriter(Sha256::new());
    if let Some(previous) = previous {
        writer.0.update(previous);
    }
    serde_json::to_writer(&mut writer, value).expect("关键事件字段均可序列化");
    writer.0.finalize().into()
}

fn hex(value: &[u8; 32]) -> String {
    value.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[derive(PartialEq, Eq)]
struct EventStamp {
    generation: u64,
    version: u32,
    count: usize,
}

impl From<&BossPull> for EventStamp {
    fn from(pull: &BossPull) -> Self {
        Self {
            generation: pull.event_generation,
            version: pull.timeline_version,
            count: pull.timeline_events.len(),
        }
    }
}

/// 事件变更序号在追加和重建时更新，目录无需扫描所有历史事件计算版本。
pub(crate) fn revision(pull: &BossPull) -> String {
    format!(
        "{}:{}:{}",
        pull.timeline_version,
        pull.event_generation,
        pull.timeline_events.len()
    )
}

/// 缓存仅保存原数组下标和前缀摘要，不复制整场事件或整个 Pull。
struct OrderedSnapshot {
    pull_id: String,
    stamp: EventStamp,
    order: Vec<usize>,
    prefixes: Vec<[u8; 32]>,
    revision: String,
}

impl OrderedSnapshot {
    fn new(pull: &BossPull) -> Self {
        let mut order: Vec<_> = (0..pull.timeline_events.len()).collect();
        // 同毫秒保留日志原始顺序；后到的较早事件会改变前缀并触发重新加载。
        order.sort_by_key(|index| pull.timeline_events[*index].pull_time_ms);
        let mut prefixes = Vec::with_capacity(order.len() + 1);
        let mut previous = digest(&(&pull.pull_id, pull.timeline_version), None);
        prefixes.push(previous);
        for index in &order {
            previous = digest(&pull.timeline_events[*index], Some(&previous));
            prefixes.push(previous);
        }
        Self {
            pull_id: pull.pull_id.clone(),
            stamp: pull.into(),
            order,
            prefixes,
            revision: revision(pull),
        }
    }
}

/// 最近选中战斗保留有界分页缓存，重复页不再扫描整场。
#[derive(Default)]
pub(crate) struct EventQueryCache {
    snapshots: VecDeque<OrderedSnapshot>,
    #[cfg(test)]
    builds: usize,
}

impl EventQueryCache {
    fn snapshot(&mut self, pull: &BossPull) -> &OrderedSnapshot {
        let stamp = EventStamp::from(pull);
        if let Some(index) = self
            .snapshots
            .iter()
            .position(|snapshot| snapshot.pull_id == pull.pull_id)
        {
            let previous = self.snapshots.remove(index).expect("已找到缓存位置");
            if previous.stamp == stamp {
                self.snapshots.push_front(previous);
                return &self.snapshots[0];
            }
        }
        let snapshot = OrderedSnapshot::new(pull);
        self.snapshots.push_front(snapshot);
        self.snapshots.truncate(REPLAY_EVENT_QUERY_CACHE_SIZE);
        #[cfg(test)]
        {
            self.builds += 1;
        }
        &self.snapshots[0]
    }

    pub(crate) fn retain(&mut self, index: &RecordingIndex) {
        let exists = |id: &str| {
            index
                .active_pull
                .iter()
                .chain(index.pulls.iter())
                .any(|pull| pull.pull_id == id)
        };
        self.snapshots.retain(|snapshot| exists(&snapshot.pull_id));
    }

    fn page(
        &mut self,
        pull: &BossPull,
        cursor: Option<&str>,
        limit: Option<usize>,
    ) -> Result<ReplayEventPage, String> {
        let limit = limit.unwrap_or(REPLAY_EVENT_PAGE_LIMIT);
        if !(1..=REPLAY_EVENT_PAGE_LIMIT).contains(&limit) {
            return Err(format!(
                "事件单页数量必须在 1 到 {REPLAY_EVENT_PAGE_LIMIT} 之间"
            ));
        }
        let snapshot = self.snapshot(pull);
        let mut reset = false;
        let offset = if let Some(cursor) = cursor {
            let (offset, expected) = cursor
                .split_once(':')
                .ok_or("事件分页游标无效，请重新加载")?;
            let offset = offset
                .parse::<usize>()
                .map_err(|_| "事件分页游标位置无效")?;
            if snapshot
                .prefixes
                .get(offset)
                .is_none_or(|actual| hex(actual) != expected)
            {
                reset = true;
                0
            } else {
                offset
            }
        } else {
            0
        };
        let end = offset.saturating_add(limit).min(snapshot.order.len());
        let events = snapshot.order[offset..end]
            .iter()
            .enumerate()
            .map(|(index, source_index)| {
                let mut event = pull.timeline_events[*source_index].clone();
                if event.event_id.is_empty() {
                    event.event_id = format!("{}:legacy:{}", pull.pull_id, offset + index);
                }
                event
            })
            .collect();
        Ok(ReplayEventPage {
            revision: snapshot.revision.clone(),
            events,
            total: snapshot.order.len(),
            next_cursor: format!("{end}:{}", hex(&snapshot.prefixes[end])),
            has_more: end < snapshot.order.len(),
            reset,
        })
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplayEventPage {
    pub revision: String,
    pub events: Vec<TimelineEvent>,
    pub total: usize,
    pub next_cursor: String,
    pub has_more: bool,
    pub reset: bool,
}

/// 游标包含已读取前缀摘要；纯追加可续读，重建或重排必须清空旧快照。
#[cfg(test)]
fn page(
    pull: &BossPull,
    cursor: Option<&str>,
    limit: Option<usize>,
) -> Result<ReplayEventPage, String> {
    EventQueryCache::default().page(pull, cursor, limit)
}

/// 查询选中录像或活动战斗，末页游标可用于下一次追加增量查询。
#[tauri::command]
pub async fn list_replay_events(
    state: State<'_, RecordingState>,
    pull_id: String,
    cursor: Option<String>,
    limit: Option<usize>,
) -> Result<ReplayEventPage, String> {
    let index = state.index.lock().await;
    let mut cache = state.event_queries.lock().await;
    query(&index, &mut cache, &pull_id, cursor.as_deref(), limit)
}

fn query(
    index: &RecordingIndex,
    cache: &mut EventQueryCache,
    pull_id: &str,
    cursor: Option<&str>,
    limit: Option<usize>,
) -> Result<ReplayEventPage, String> {
    let pull = index
        .active_pull
        .iter()
        .chain(index.pulls.iter())
        .find(|pull| pull.pull_id == pull_id)
        .ok_or("未找到对应战斗的事件索引")?;
    cache.page(pull, cursor, limit)
}

#[cfg(test)]
mod tests {
    use super::{page, query, revision, EventQueryCache};
    use crate::recording::model::{BossPull, RecordingIndex, TimelineEvent};

    fn pull() -> BossPull {
        serde_json::from_value(serde_json::json!({"pullId":"pull", "encounterId":1,
            "encounterName":"测试", "difficultyId":16,"groupSize":20,"encounterStartUnixMs":0,
            "clipStartUnixMs":0,"logFileId":"file","logStartOffset":0,"state":"recording"}))
        .unwrap()
    }

    fn event(id: &str, time: u64) -> TimelineEvent {
        serde_json::from_value(serde_json::json!({"eventId":id,"pullTimeMs":time,"owner":"team",
            "kind":"castSuccess","sourceName":"玩家","sourceGuid":"Player-1","targetGuid":"Player-2",
            "spellId":17,"spellName":"盾"})).unwrap()
    }

    #[test]
    fn stable_pages_preserve_same_millisecond_targets_and_identity() {
        let mut pull = pull();
        pull.timeline_events = vec![event("b", 200), event("a", 100), event("c", 200)];
        let first = page(&pull, None, Some(2)).unwrap();
        assert_eq!(
            first
                .events
                .iter()
                .map(|e| e.event_id.as_str())
                .collect::<Vec<_>>(),
            ["a", "b"]
        );
        let last = page(&pull, Some(&first.next_cursor), Some(2)).unwrap();
        assert_eq!(last.events[0].event_id, "c");
        assert_eq!(last.events[0].target_guid, "Player-2");
        assert!(!last.has_more);
        assert!(!last.reset);
        assert!(page(&pull, Some(&last.next_cursor), Some(2))
            .unwrap()
            .events
            .is_empty());
    }

    #[test]
    fn appended_events_continue_from_last_cursor_but_rebuilt_prefix_resets() {
        let mut pull = pull();
        pull.timeline_events = vec![event("a", 100), event("b", 200)];
        let first = page(&pull, None, None).unwrap();
        pull.timeline_events.push(event("c", 300));
        let delta = page(&pull, Some(&first.next_cursor), None).unwrap();
        assert!(!delta.reset);
        assert_ne!(delta.revision, first.revision);
        assert_eq!(delta.events.len(), 1);
        assert_eq!(delta.events[0].event_id, "c");
        pull.timeline_events[0].target_guid = "Player-3".into();
        let reset = page(&pull, Some(&delta.next_cursor), None).unwrap();
        assert!(reset.reset);
        assert_eq!(reset.events.len(), 3);
    }

    #[test]
    fn truncation_parser_version_and_cross_pull_cursors_reset_and_legacy_ids_remain_stable() {
        let mut pull = pull();
        pull.timeline_events = vec![event("", 100), event("", 200)];
        let first = page(&pull, None, Some(1)).unwrap();
        assert_eq!(first.events[0].event_id, "pull:legacy:0");
        assert_eq!(
            page(&pull, Some(&first.next_cursor), None).unwrap().events[0].event_id,
            "pull:legacy:1"
        );
        pull.timeline_version += 1;
        assert!(page(&pull, Some(&first.next_cursor), None).unwrap().reset);
        pull.pull_id = "other".into();
        assert!(page(&pull, Some(&first.next_cursor), None).unwrap().reset);
        pull.timeline_events.clear();
        assert!(page(&pull, Some(&first.next_cursor), None).unwrap().reset);
        assert!(page(&pull, Some("garbage"), None).is_err());
        assert!(page(&pull, None, Some(0)).is_err());
        assert!(page(&pull, None, Some(1001)).is_err());
    }

    #[test]
    fn active_pull_appends_then_final_rebuild_invalidates_existing_cursor() {
        let mut active = pull();
        active.timeline_events = vec![event("a", 100)];
        let mut index = RecordingIndex {
            active_pull: Some(active),
            ..RecordingIndex::default()
        };
        let mut cache = EventQueryCache::default();
        let first = query(&index, &mut cache, "pull", None, None).unwrap();
        let active = index.active_pull.as_mut().unwrap();
        active.timeline_events.push(event("b", 200));
        active.event_generation += 1;
        let delta = query(&index, &mut cache, "pull", Some(&first.next_cursor), None).unwrap();
        assert!(!delta.reset);
        assert_eq!(delta.events.len(), 1);
        let mut completed = index.active_pull.take().unwrap();
        completed.timeline_version += 1;
        completed.event_generation += 1;
        completed.timeline_indexed = true;
        completed.encounter_end_unix_ms = Some(300);
        completed.timeline_events[0].target_guid = "Player-3".into();
        index.pulls.push(completed);
        let rebuilt = query(&index, &mut cache, "pull", Some(&delta.next_cursor), None).unwrap();
        assert!(rebuilt.reset);
        assert_eq!(rebuilt.events.len(), 2);
        assert_eq!(rebuilt.events[0].target_guid, "Player-3");
        assert!(query(&index, &mut cache, "missing", None, None).is_err());
    }

    #[test]
    fn one_hundred_thousand_events_build_one_snapshot_for_all_pages_and_directory_polls() {
        let mut pull = pull();
        let template = event("a", 0);
        pull.timeline_events = (0..100_000)
            .map(|index| {
                let mut event = template.clone();
                event.event_id = format!("pull:{index}");
                event.pull_time_ms = index / 2;
                event
            })
            .collect();
        let mut cache = EventQueryCache::default();
        let started = std::time::Instant::now();
        let revision = revision(&pull);
        let mut cursor = None;
        let mut count = 0;
        let mut indexed = std::time::Duration::ZERO;
        loop {
            let result = cache.page(&pull, cursor.as_deref(), None).unwrap();
            if count == 0 {
                indexed = started.elapsed();
            }
            assert!(!result.reset);
            assert_eq!(result.revision, revision);
            assert_eq!(result.events[0].event_id, format!("pull:{count}"));
            count += result.events.len();
            cursor = Some(result.next_cursor);
            if !result.has_more {
                break;
            }
        }
        assert_eq!(count, 100_000);
        assert_eq!(cache.builds, 1, "重复页不得重新排序或重算整场摘要");
        for _ in 0..10 {
            assert_eq!(super::revision(&pull), revision);
        }
        assert_eq!(cache.builds, 1);
        eprintln!(
            "100000 events: index={indexed:?}, index+100 pages={:?}, snapshot builds={}",
            started.elapsed(),
            cache.builds
        );
    }

    #[test]
    fn cached_page_memory_is_bounded_while_directory_revisions_remain_reusable() {
        let mut cache = EventQueryCache::default();
        let mut pulls = Vec::new();
        for index in 0..10 {
            let mut pull = pull();
            pull.pull_id = format!("pull-{index}");
            pull.timeline_events = vec![event("a", 100)];
            cache.page(&pull, None, None).unwrap();
            pulls.push(pull);
        }
        assert_eq!(
            cache.snapshots.len(),
            crate::recording::config::REPLAY_EVENT_QUERY_CACHE_SIZE
        );
        let builds = cache.builds;
        for pull in &pulls {
            revision(pull);
        }
        assert_eq!(cache.builds, builds);
        let index = RecordingIndex {
            pulls: vec![pulls.remove(0)],
            ..RecordingIndex::default()
        };
        cache.retain(&index);
        assert!(cache
            .snapshots
            .iter()
            .all(|snapshot| snapshot.pull_id == index.pulls[0].pull_id));
    }
}
