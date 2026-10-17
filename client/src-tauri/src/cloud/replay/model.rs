use serde::Deserialize;
use serde_json::{json, Value};

use crate::recording::model::{ClipInterval, RecordingPlayer};

/// 仅接受服务端授权目录的公开展示字段，不读取远端返回的任意文件或媒体地址。
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudReplayEntry {
    pub team_id: String,
    pub team_pull_id: String,
    pub recording_id: String,
    #[serde(default)]
    pub shared_calibration: Option<super::calibration::SharedCalibration>,
    pub encounter_id: u32,
    pub encounter_name: String,
    pub difficulty_id: u32,
    pub encounter_start_unix_ms: i64,
    pub encounter_end_unix_ms: i64,
    pub character_guid: String,
    pub character_name: String,
    pub status: String,
    pub video_zero_ms: i64,
    pub video_duration_ms: u64,
    #[serde(default)]
    pub intervals: Vec<ClipInterval>,
    #[serde(default)]
    pub players: Vec<RecordingPlayer>,
    #[serde(default)]
    pub has_gap: bool,
    #[serde(default)]
    pub clock_discontinuous: bool,
    #[serde(default)]
    pub media_calibrated: bool,
    pub calibration_error: Option<String>,
    pub processing_error: Option<String>,
    pub playback_version: Option<String>,
    pub success: Option<bool>,
    pub group_size: Option<u32>,
    #[serde(default)]
    pub can_retry_processing: bool,
    pub timeline_revision: Option<String>,
    #[serde(default)]
    pub timeline_event_count: u64,
    #[serde(default)]
    pub timeline_complete: bool,
    pub wcl_status: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    fn entry(status: &str) -> CloudReplayEntry {
        serde_json::from_value(json!({"teamId":"11111111-1111-4111-8111-111111111111","teamPullId":"22222222-2222-4222-8222-222222222222",
            "recordingId":"33333333-3333-4333-8333-333333333333","encounterId":1,"encounterName":"测试首领","difficultyId":16,
            "encounterStartUnixMs":10000,"encounterEndUnixMs":20000,"characterGuid":"Player-1","characterName":"测试角色",
            "status":status,"videoZeroMs":-1000,"videoDurationMs":9000,"players":[],"playbackVersion":null})).unwrap()
    }
    #[test]
    fn uploaded_does_not_become_playable_and_ready_requires_published_version() {
        let normalized = entry("uploaded")
            .normalize("connection", "11111111-1111-4111-8111-111111111111")
            .unwrap();
        assert_eq!(normalized["state"], "waitingForPlayback");
        assert!(normalized["playbackUrl"].is_null());
        assert_eq!(normalized["mapping"]["videoZeroMs"], -1000);
        assert!(entry("ready")
            .normalize("connection", "11111111-1111-4111-8111-111111111111")
            .is_err());
        let mut ready = entry("ready");
        ready.playback_version = Some("44444444-4444-4444-8444-444444444444".into());
        let normalized = ready
            .normalize("connection", "11111111-1111-4111-8111-111111111111")
            .unwrap();
        assert!(normalized["playbackUrl"]
            .as_str()
            .unwrap()
            .contains("cloud-replay.localhost/connection/11111111-1111-4111-8111-111111111111"));
        assert!(entry("uploaded")
            .normalize("connection", "99999999-9999-4999-8999-999999999999")
            .is_err());
    }
}

impl CloudReplayEntry {
    /// 统一到现有单播放器契约；上传完成与媒体就绪始终是两个阶段。
    pub fn normalize(self, connection: &str, expected_team: &str) -> Result<Value, String> {
        if let Some(snapshot) = &self.shared_calibration {
            snapshot.validate()?;
        }
        for value in [&self.team_id, &self.team_pull_id, &self.recording_id] {
            uuid::Uuid::parse_str(value).map_err(|_| "云端录像身份格式无效")?;
        }
        if self.team_id != expected_team
            || self.encounter_end_unix_ms <= self.encounter_start_unix_ms
        {
            return Err("云端录像团队或战斗边界无效".into());
        }
        let state = match self.status.as_str() {
            "ready" => "ready",
            "failed" => "failed",
            "pendingUpload" => "waitingForSource",
            "uploaded" => "waitingForPlayback",
            "processing" => "processing",
            _ => return Err("云端录像处理状态无效".into()),
        };
        let playback_url = if state == "ready" {
            let version = self
                .playback_version
                .as_ref()
                .ok_or("就绪云端录像缺少已发布版本")?;
            uuid::Uuid::parse_str(version).map_err(|_| "云端回放版本无效")?;
            Some(format!(
                "{}/{}/{}/{}/{}/index.m3u8",
                super::config::PLAYBACK_ORIGIN,
                connection,
                self.team_id,
                self.recording_id,
                version
            ))
        } else {
            None
        };
        let clip_start = self
            .encounter_start_unix_ms
            .checked_sub(self.video_zero_ms)
            .ok_or("云端媒体起点溢出")?;
        let clip_end = clip_start
            .checked_add(i64::try_from(self.video_duration_ms).map_err(|_| "云端媒体时长无效")?)
            .ok_or("云端媒体终点溢出")?;
        Ok(json!({
            "pullId":self.recording_id,"battleKey":format!("{}:{}",self.team_id,self.team_pull_id),
            "sourceKind":"cloud","cloudStatus":self.status,"importedSource":null,"recordingPlayerGuid":self.character_guid,
            "canRetryProcessing":self.can_retry_processing,"cloudTeamPullId":self.team_pull_id,"wclStatus":self.wcl_status,
            "cloudPlaybackVersion":self.playback_version,"sharedCalibration":self.shared_calibration,
            "encounterId":self.encounter_id,"encounterName":self.encounter_name,"difficultyId":self.difficulty_id,
            "groupSize":self.group_size.unwrap_or(self.players.len() as u32),"success":self.success,
            "encounterStartUnixMs":self.encounter_start_unix_ms,"encounterEndUnixMs":self.encounter_end_unix_ms,
            "clipStartUnixMs":clip_start,"clipEndUnixMs":clip_end,"state":state,"playerName":self.character_name,
            "timelineEvents":[],"timelineEventCount":self.timeline_event_count,"timelineRevision":self.timeline_revision,"timelineComplete":self.timeline_complete,"timelineParseErrors":0,
            "players":self.players,"mapping":{"actualStartUnixMs":clip_start,"actualEndUnixMs":clip_end,"videoZeroMs":self.video_zero_ms,
                "hasGap":self.has_gap,"intervals":self.intervals,"mediaDurationMs":self.video_duration_ms,
                "mediaCalibrated":self.media_calibrated,"calibrationError":self.calibration_error,"clockDiscontinuous":self.clock_discontinuous},
            "videoPath":null,"playbackPath":null,"playbackUrl":playback_url,"error":self.processing_error
        }))
    }
}
