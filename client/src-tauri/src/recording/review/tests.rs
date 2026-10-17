use super::{
    parser::{parse_line, supported_header},
    reading::{self, ReviewRequest},
};
use crate::{combat_log::parser::parse_timestamp, recording::model::RecordingIndex};
use std::{fs, path::PathBuf};

const VICTIM: &str = "Player-Victim";
const HEADER: &str = "10/16/2026 20:00:00.0000  COMBAT_LOG_VERSION,22,ADVANCED_LOG_ENABLED,1,BUILD_VERSION,12.1.5,PROJECT_ID,1\n";

fn start() -> i64 {
    parse_timestamp("10/16/2026 20:00:00.0000", 2026).unwrap()
}

fn fields(kind: &str, count: usize) -> Vec<String> {
    let mut fields = vec!["nil".to_string(); count];
    for (index, value) in [
        (0, kind),
        (1, "Creature-Attacker"),
        (2, "敌方"),
        (3, "0xa48"),
        (4, "0x0"),
        (5, VICTIM),
        (6, "同名角色"),
        (7, "0x511"),
        (8, "0x0"),
    ] {
        fields[index] = value.into();
    }
    fields
}

fn line(fields: Vec<String>) -> String {
    format!("10/16/2026 20:00:05.0000  {}\n", fields.join(","))
}

fn damage(kind: &str, amount: u32) -> String {
    let swing = kind.starts_with("SWING");
    let mut row = fields(kind, if swing { 38 } else { 42 });
    let base = if swing {
        9
    } else {
        row[9] = "123".into();
        row[10] = "伤害测试".into();
        row[11] = "0x1".into();
        12
    };
    row[base] = if kind == "SWING_DAMAGE" {
        "Creature-Attacker".into()
    } else {
        VICTIM.into()
    };
    row[base + 1] = "0000000000000000".into();
    row[base + 2] = "7000".into();
    row[base + 3] = "8000".into();
    let metric = if swing { 28 } else { 31 };
    for (index, value) in [
        (metric, amount.to_string()),
        (metric + 1, "1200".into()),
        (metric + 2, "-1".into()),
        (metric + 3, "1".into()),
        (metric + 4, "0".into()),
        (metric + 5, "0".into()),
        (metric + 6, "100".into()),
    ] {
        row[index] = value;
    }
    line(row)
}

fn parse(value: &str) -> super::model::ReviewEvent {
    parse_line(value, 2026, start(), 0, 10000, "pull:1".into(), VICTIM)
        .unwrap()
        .unwrap()
}

#[test]
fn source_header_is_explicit_and_damage_resources_belong_to_the_victim() {
    assert!(supported_header(HEADER));
    assert!(!supported_header(&HEADER.replace(",22,", ",21,")));
    assert!(!supported_header(&HEADER.replace("ENABLED,1", "ENABLED,0")));
    let row = parse(&damage("SPELL_DAMAGE", 1000));
    assert_eq!(row.amount, Some(1000.0));
    assert_eq!(row.absorbed, Some(100.0));
    assert_eq!(row.overkill, None);
    assert_eq!((row.health, row.max_health), (Some(7000.0), Some(8000.0)));
    let attacker = parse(&damage("SWING_DAMAGE", 1000));
    assert_eq!(attacker.health, None);
    let landed = parse(&damage("SWING_DAMAGE_LANDED", 1000));
    assert_eq!(landed.health, Some(7000.0));
}

#[test]
fn swing_echo_pairing_is_exact_and_preserves_multiplicity_and_unpaired_hits() {
    let (base, landed) = (
        parse(&damage("SWING_DAMAGE", 1000)),
        parse(&damage("SWING_DAMAGE_LANDED", 1000)),
    );
    let (rows, removed) = reading::remove_swing_echoes(vec![base.clone(), base, landed]);
    assert_eq!(removed, 1);
    assert_eq!(rows.len(), 2);
    assert_eq!(rows.last().unwrap().raw_type, "SWING_DAMAGE_LANDED");
    let (rows, removed) = reading::remove_swing_echoes(vec![
        parse(&damage("SWING_DAMAGE", 1000)),
        parse(&damage("SWING_DAMAGE_LANDED", 999)),
    ]);
    assert_eq!((rows.len(), removed), (2, 0));
    assert!(parse_line(
        &damage("SPELL_DAMAGE_SUPPORT", 1000),
        2026,
        start(),
        0,
        10000,
        "id".into(),
        VICTIM
    )
    .unwrap()
    .is_none());
}

#[test]
fn heal_absorb_and_missing_amounts_remain_distinct_from_effective_values() {
    let mut heal = fields("SPELL_HEAL", 36);
    for (index, value) in [
        (9, "17"),
        (10, "治疗"),
        (11, "0x2"),
        (12, VICTIM),
        (14, "8000"),
        (15, "8000"),
        (31, "1000"),
        (32, "1200"),
        (33, "600"),
        (34, "40"),
    ] {
        heal[index] = value.into();
    }
    let row = parse(&line(heal.clone()));
    assert_eq!(
        (row.amount, row.overheal, row.absorbed),
        (Some(1000.0), Some(600.0), Some(40.0))
    );
    heal[31] = "NaN".into();
    assert_eq!(parse(&line(heal)).amount, None);
    let mut shield = fields("SPELL_ABSORBED", 22);
    for (index, value) in [
        (9, "123"),
        (10, "原攻击"),
        (12, "Player-Healer"),
        (13, "护盾来源"),
        (16, "17"),
        (17, "护盾"),
        (19, "300"),
        (20, "400"),
    ] {
        shield[index] = value.into();
    }
    let row = parse(&line(shield));
    assert_eq!(row.kind, "absorb");
    assert_eq!(row.amount, None);
    assert_eq!(row.absorbed, Some(300.0));
    assert_eq!(row.source_guid, "Player-Healer");
    assert_eq!(
        row.related_source_guid.as_deref(),
        Some("Creature-Attacker")
    );
    assert_eq!(row.extra_spell_id, Some(123));
}

struct Fixture {
    directory: PathBuf,
    request: ReviewRequest,
}
impl Fixture {
    fn new(count: usize) -> Self {
        let directory =
            std::env::temp_dir().join(format!("wow-death-review-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&directory).unwrap();
        let path = directory.join("WoWCombatLog-101626_200000.txt");
        let mut data = HEADER.to_string();
        for _ in 0..count {
            data.push_str(&damage("SPELL_DAMAGE", 1000));
        }
        let offset = data.len();
        let mut death = fields("UNIT_DIED", 9);
        death[1] = "0000000000000000".into();
        data.push_str(&format!("10/16/2026 20:00:10.0000  {}\n", death.join(",")));
        fs::write(&path, data.as_bytes()).unwrap();
        let index: RecordingIndex = serde_json::from_value(serde_json::json!({"schemaVersion":2,"activePull":null,"pulls":[{
            "pullId":"pull","encounterId":1,"encounterName":"测试","difficultyId":16,"groupSize":20,
            "encounterStartUnixMs":start(),"encounterEndUnixMs":start()+10000,"clipStartUnixMs":start(),
            "logFileId":format!("{}#fixture",path.display()),"logStartOffset":HEADER.len(),"logEndOffset":data.len(),"state":"ready",
            "recordingPlayerGuid":VICTIM,"timelineEvents":[{"eventId":format!("pull:{offset}"),"pullTimeMs":10000,"owner":"player","kind":"death",
                "sourceName":"未知来源","sourceGuid":"","targetGuid":VICTIM,"targetName":"同名角色","spellId":0,"spellName":"死亡"}]}],"sources":[],"diagnostics":[]})).unwrap();
        let request = ReviewRequest::from_index(&index, "pull", &format!("pull:{offset}")).unwrap();
        Self { directory, request }
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.request.path);
        let _ = fs::remove_dir(&self.directory);
    }
}

#[test]
fn bounded_reader_keeps_death_and_expresses_source_changes_and_missing_files() {
    let fixture = Fixture::new(5010);
    let before = fs::read(&fixture.request.path).unwrap();
    let result = reading::read(&fixture.request).unwrap();
    assert_eq!(result.availability, "ready");
    assert_eq!(result.observed_count, 5011);
    assert_eq!(result.events.len(), 5000);
    assert!(result.truncated);
    assert_eq!(result.events.last().unwrap().kind, "death");
    assert_eq!(result.victim_recording_ids, vec!["pull"]);
    assert_eq!(result.parse_errors, 0);
    assert_eq!(fs::read(&fixture.request.path).unwrap(), before);
    let mut wrong = fixture.request.clone();
    wrong.death_offset -= 1;
    assert_eq!(reading::read(&wrong).unwrap().availability, "sourceChanged");
    fs::remove_file(&fixture.request.path).unwrap();
    assert_eq!(
        reading::read(&fixture.request).unwrap().availability,
        "missingLog"
    );
}
