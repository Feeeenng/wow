use crate::recording::{events::parser::parse_flags, model::RecordingPlayer};
use std::collections::BTreeMap;
const AFFILIATION_MINE: u64 = 0x1;

pub(crate) fn player_identity(guid: &str, full_name: &str) -> Option<RecordingPlayer> {
    if !guid.starts_with("Player-") || full_name.is_empty() || full_name == "nil" {
        return None;
    }
    let parts = full_name.split('-').collect::<Vec<_>>();
    let (name, server_name) = if parts.len() >= 3 && parts.last() == Some(&"CN") {
        (
            parts[..parts.len() - 2].join("-"),
            Some(parts[parts.len() - 2].to_string()),
        )
    } else if parts.len() >= 2 {
        (
            parts[..parts.len() - 1].join("-"),
            Some(parts[parts.len() - 1].to_string()),
        )
    } else {
        (full_name.to_string(), None)
    };
    Some(RecordingPlayer {
        actor_id: None,
        guid: guid.to_string(),
        name,
        server_name,
        full_type: None,
    })
}

pub(crate) fn collect_players(
    fields: &[String],
    players: &mut BTreeMap<String, RecordingPlayer>,
) -> Option<String> {
    let mut local_player = None;
    for (guid_index, name_index, flags_index) in [(1, 2, 3), (5, 6, 7)] {
        let flags = fields
            .get(flags_index)
            .filter(|value| value.starts_with("0x"))
            .and_then(|value| parse_flags(value));
        let Some(flags) = flags else {
            continue;
        };
        let Some(player) = fields
            .get(guid_index)
            .zip(fields.get(name_index))
            .and_then(|(guid, name)| player_identity(guid, name))
        else {
            continue;
        };
        if flags & AFFILIATION_MINE != 0 {
            local_player = Some(player.name.clone());
        }
        players.entry(player.guid.clone()).or_insert(player);
    }
    local_player
}

#[cfg(test)]
mod tests {
    use super::{collect_players, player_identity};
    use crate::combat_log::parser::parse_csv_fields;
    use std::collections::BTreeMap;

    #[test]
    fn chinese_server_names_and_combatant_numeric_fields_are_not_confused() {
        let player = player_identity("Player-1", "角色-罗宁-CN").unwrap();
        assert_eq!(player.name, "角色");
        assert_eq!(player.server_name.as_deref(), Some("罗宁"));
        let fields = parse_csv_fields("COMBATANT_INFO,Player-1,1,253,70,0,0,0,0,0").unwrap();
        let mut players = BTreeMap::new();
        assert_eq!(collect_players(&fields, &mut players), None);
        assert!(players.is_empty());
    }
}
