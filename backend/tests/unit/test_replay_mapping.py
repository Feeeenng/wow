"""多视角统一基准的正负偏移与两个入口一致性。"""

import copy
from unittest.mock import MagicMock
from uuid import uuid4

from app.models.identity import TeamMember
from app.models.recordings import Recording, TeamPull
from app.services.identity.access import Principal
from app.services.replay.mapping import common_pull_mapping
from app.services.replay.query import ReplayService
from app.utils.time_utils import cst_now


def test_positive_negative_local_starts_and_unknown_gap_preserve_original():
    """本地起点晚／早时符号相反，缺片位置未知时不补造连续区间。"""
    for delta in [1000, -2000]:
        original = {"encounterStartUnixMs": 10_000 + delta, "videoZeroMs": 5000, "videoDurationMs": 20000,
            "intervals": [{"pullStartMs": 0, "pullEndMs": 12000, "videoStartMs": 5000, "videoEndMs": 17000}], "hasGap": True}
        snapshot = copy.deepcopy(original)
        result = common_pull_mapping(original, 10000)
        assert result["videoZeroMs"] == 5000 - delta
        assert result["intervals"][0]["pullStartMs"] == delta
        assert result["intervals"][0]["pullEndMs"] == 12000 + delta
        assert result["intervals"][0]["videoStartMs"] == 5000
        assert 4000 + result["videoZeroMs"] == 4000 - delta + original["videoZeroMs"]
        assert original == snapshot
    unknown = common_pull_mapping({**snapshot, "intervals": []}, 10000)
    assert unknown["hasGap"] is True and unknown["intervals"] == []


def test_manifest_and_flat_catalog_share_one_common_battle_reference(settings):
    """两个公开入口都以 TeamPull 为基准，不因视角切换重解释统一时间。"""
    principal = Principal(uuid4(), "测试")
    team, pull_id = uuid4(), uuid4()
    pull = TeamPull(id=pull_id, team_id=team, encounter_id=1, encounter_name="测试", difficulty_id=16,
                    started_at_unix_ms=10000, ended_at_unix_ms=22000, association_status="unverified", created_at=cst_now())
    recordings = [Recording(id=uuid4(), team_id=team, team_pull_id=pull_id, user_id=principal.user_id,
        character_guid=f"Player-{index}", character_name="测试", status="uploaded", updated_at=cst_now(),
        manifest={"encounterStartUnixMs": 10000 + delta, "videoZeroMs": 5000, "videoDurationMs": 20000,
                  "intervals": [{"pullStartMs": 0, "pullEndMs": 12000, "videoStartMs": 5000, "videoEndMs": 17000}], "players": []})
        for index, delta in enumerate([1000, -2000])]
    session = MagicMock()
    service = ReplayService(session, principal, settings)
    session.scalar.side_effect = [TeamMember(role="member"), pull]
    session.execute.return_value.all.return_value = [(recording, "uploaded") for recording in recordings]
    session.execute.return_value.first.return_value = None
    manifest = service.manifest(team, pull_id)
    session.scalar.side_effect = [TeamMember(role="member")]
    session.execute.return_value.all.return_value = [(recording, pull, None, None) for recording in recordings]
    catalog = service.recordings(team, 0, 100)
    for view, entry, delta in zip(manifest["views"], catalog, [1000, -2000]):
        assert view["videoZeroMs"] == entry["videoZeroMs"] == 5000 - delta
        assert view["intervals"] == entry["intervals"]
        assert entry["encounterStartUnixMs"] == 10000
        assert view["timelineRevision"] == entry["timelineRevision"]
        assert view["timelineComplete"] is False and view["wclStatus"] == "unbound"
