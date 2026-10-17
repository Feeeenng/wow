use std::{collections::BTreeMap, fs, path::PathBuf};

use serde_json::{json, Value};

use crate::recording::{
    events::index::{populate_missing_timelines, TIMELINE_VERSION},
    model::{BossPull, TimelineEventKind, TimelineOwner},
};

/// 从显式授权的只读真实样本目录核对 Python 审计与生产 Rust 索引，不写应用索引。
#[test]
#[ignore = "需要显式 WOW_REPLAY_REAL_SAMPLE_DIR 及用户授权的真实日志"]
fn rebuild_real_encounters_matches_independent_audit() {
    let directory = PathBuf::from(
        std::env::var_os("WOW_REPLAY_REAL_SAMPLE_DIR")
            .expect("请指定 WOW_REPLAY_REAL_SAMPLE_DIR，不自动查找用户日志"),
    );
    let inventory: Value =
        serde_json::from_slice(&fs::read(directory.join("inventory.json")).unwrap()).unwrap();
    let videos = inventory["videos"].as_array().unwrap();
    let mut evidence = Vec::new();
    // 原三场之外增加一场真实复活；避免仅靠合成日志证明战复事件可用。
    for video_index in [0_usize, 1, 2, 4] {
        let video = &videos[video_index];
        assert_eq!(video["matches"].as_array().unwrap().len(), 1);
        let matched = &video["matches"][0];
        let log_path = PathBuf::from(matched["log"].as_str().unwrap());
        let original = fs::metadata(&log_path).unwrap();
        let audit_path = directory
            .join(log_path.file_stem().unwrap())
            .with_extension("json");
        let audit: Value = serde_json::from_slice(&fs::read(audit_path).unwrap()).unwrap();
        let encounter = audit["encounters"]
            .as_array()
            .unwrap()
            .iter()
            .find(|item| item["startMs"] == matched["startMs"])
            .unwrap();
        let mut pull: BossPull = serde_json::from_value(json!({
            "pullId": format!("real-sample-{video_index}"),
            "encounterId": encounter["startFields"][1].as_str().unwrap().parse::<u32>().unwrap(),
            "encounterName": encounter["startFields"][2],
            "difficultyId": encounter["startFields"][3].as_str().unwrap().parse::<u32>().unwrap(),
            "groupSize": encounter["startFields"][4].as_str().unwrap().parse::<u32>().unwrap(),
            "encounterStartUnixMs": encounter["startMs"],
            "encounterEndUnixMs": encounter["endMs"],
            "clipStartUnixMs": encounter["startMs"],
            "logFileId": format!("{}#real-sample", log_path.display()),
            "logStartOffset": encounter["startOffset"],
            "logEndOffset": encounter["endOffset"],
            "state": "ready"
        }))
        .unwrap();
        let (changed, errors) = populate_missing_timelines(std::slice::from_mut(&mut pull), 2026);
        assert!(errors.is_empty(), "真实日志索引失败：{errors:?}");
        assert_eq!(changed, vec![pull.pull_id.clone()]);
        assert_eq!(pull.timeline_parse_errors, 0);
        assert!(pull.timeline_indexed);
        assert_eq!(pull.timeline_version, TIMELINE_VERSION);
        assert_eq!(
            pull.timeline_events.len() as u64,
            encounter["timelineCount"].as_u64().unwrap()
        );

        let mut kinds = BTreeMap::<String, usize>::new();
        let mut owners = BTreeMap::<String, usize>::new();
        let mut empower_levels = BTreeMap::<String, usize>::new();
        let mut event_ids = std::collections::BTreeSet::new();
        for event in &pull.timeline_events {
            let kind = serde_json::to_value(&event.kind).unwrap();
            let owner = serde_json::to_value(&event.owner).unwrap();
            *kinds.entry(kind.as_str().unwrap().into()).or_default() += 1;
            *owners.entry(owner.as_str().unwrap().into()).or_default() += 1;
            if let Some(level) = event.empower_level {
                assert!(matches!(
                    event.kind,
                    TimelineEventKind::EmpowerEnd | TimelineEventKind::EmpowerInterrupt
                ));
                *empower_levels
                    .entry(format!("{}:{level}", kind.as_str().unwrap()))
                    .or_default() += 1;
            } else {
                assert!(!matches!(
                    event.kind,
                    TimelineEventKind::EmpowerEnd | TimelineEventKind::EmpowerInterrupt
                ));
            }
            assert!(event_ids.insert(&event.event_id));
            assert!(
                event.pull_time_ms
                    <= (pull.encounter_end_unix_ms.unwrap() - pull.encounter_start_unix_ms) as u64
            );
        }
        assert_eq!(
            serde_json::to_value(&kinds).unwrap(),
            encounter["timelineKindCounts"]
        );
        assert_eq!(
            serde_json::to_value(&owners).unwrap(),
            encounter["timelineOwnerCounts"]
        );
        assert_eq!(
            serde_json::to_value(&empower_levels).unwrap(),
            encounter["timelineEmpowerLevelCounts"]
        );
        if video_index == 2 {
            assert!(pull
                .timeline_events
                .iter()
                .any(|event| event.kind == TimelineEventKind::Resurrect
                    && event.target_guid.starts_with("Player-")));
        }

        let own_death = encounter["deaths"]
            .as_array()
            .unwrap()
            .iter()
            .find(|event| {
                let flags = event["fields"][7].as_str().unwrap();
                u64::from_str_radix(flags.trim_start_matches("0x"), 16).unwrap() & 1 != 0
                    && event["fields"][5].as_str().unwrap().starts_with("Player-")
            });
        if video_index != 2 {
            assert!(own_death.is_some(), "原三场应保留本人死亡锚点");
        }
        let own_death_pull_ms = own_death.map(|own_death| {
            let actor_guid = own_death["fields"][5].as_str().unwrap();
            let death = pull
                .timeline_events
                .iter()
                .find(|event| {
                    event.kind == TimelineEventKind::Death && event.target_guid == actor_guid
                })
                .unwrap();
            assert_eq!(death.owner, TimelineOwner::Player);
            assert_eq!(death.pull_time_ms, own_death["timeMs"].as_u64().unwrap());
            assert_eq!(death.spell_id, 0);
            assert_eq!(
                death.event_id,
                format!("{}:{}", pull.pull_id, own_death["offset"])
            );
            let local_actor = pull
                .players
                .iter()
                .find(|actor| actor.guid == actor_guid)
                .unwrap();
            let metadata_actor = video["metadata"]["players"]
                .as_array()
                .unwrap()
                .iter()
                .find(|actor| actor["actorId"] == video["metadata"]["actorId"])
                .unwrap();
            assert_eq!(local_actor.name, metadata_actor["name"].as_str().unwrap());
            assert_eq!(
                local_actor.server_name.as_deref(),
                metadata_actor["serverName"].as_str()
            );
            assert_eq!(pull.player_name.as_deref(), Some(local_actor.name.as_str()));
            death.pull_time_ms
        });
        assert_eq!(
            pull.players.len(),
            video["metadata"]["players"].as_array().unwrap().len()
        );
        let saved_events = pull.timeline_events.clone();
        let (changed, errors) = populate_missing_timelines(std::slice::from_mut(&mut pull), 2026);
        assert!(changed.is_empty() && errors.is_empty());
        assert_eq!(pull.timeline_events, saved_events);
        let after = fs::metadata(&log_path).unwrap();
        assert_eq!(original.len(), after.len());
        assert_eq!(original.modified().unwrap(), after.modified().unwrap());
        evidence.push(json!({
            "videoIndex": video_index, "events": pull.timeline_events.len(),
            "players": pull.players.len(), "parseErrors": pull.timeline_parse_errors,
            "kindCounts": kinds, "ownerCounts": owners,
            "empowerLevelCounts": empower_levels,
            "ownDeathPullMs": own_death_pull_ms, "unchangedSourceLog": true
        }));
    }
    fs::write(
        directory.join("rust-index-validation.json"),
        serde_json::to_vec_pretty(&evidence).unwrap(),
    )
    .unwrap();
}
