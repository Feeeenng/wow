"""在既有公共报告版本内按需读取死亡窗口，不修改关键时间轴快照。"""

from collections import deque
import hashlib
import json
import time

from app.services.wcl.adapter import WclError
from app.services.wcl.normalization import integer, metadata, normalization_indexes
from app.services.wcl.review.normalization import relevant, review_event


def read_window(client, settings, snapshot, death: dict, common_start: int, prior: list[dict], prior_truncated: bool) -> dict:
    """完整读取后才发布有界最近窗口；迟到页、换版或时间乱序不会混入结果。"""
    data = snapshot.metadata_json
    victim, end = death["targetActorId"], death["pullTimeMs"]
    start = max(0, end - settings.death_review_window_ms)
    document = {"revision": "", "sourceKind": "wcl", "availability": "ready", "message": None,
        "death": death, "windowStartMs": start, "windowEndMs": end, "events": [], "priorAuras": prior,
        "total": 0, "observedCount": 0, "truncated": False, "priorAurasTruncated": prior_truncated,
        "parseErrors": 0, "pairedRowsRemoved": 0, "victimRecordingIds": [], "relatedRecordingIds": []}
    deadline = time.monotonic() + settings.death_review_timeout_seconds
    report = client.report(snapshot.report_code)
    def matches(report):
        """报告及已选fight/masterData必须与已发布不可变来源一致。"""
        try:
            _, current = metadata(report, snapshot.fight_id, {"actorBindings": data["actorBindings"]})
        except WclError:
            return False
        return report.get("revision") == snapshot.report_revision and report.get("startTime") == snapshot.report_started_at_unix_ms and current == data
    if not matches(report):
        return {**document, "availability": "reportChanged", "message": "WCL报告已变化，请重新导入标准事件后读取死亡窗口。", "priorAuras": []}
    # 查询时间为报告相对毫秒；共同战斗零点与报告起点不能混用。
    query_fight = {**data["fight"], "startTime": max(data["fight"]["startTime"], common_start + start - snapshot.report_started_at_unix_ms),
        "endTime": common_start + end - snapshot.report_started_at_unix_ms + 1}
    indexes = normalization_indexes(data)
    retained = deque(maxlen=settings.death_review_max_rows)
    ordinal, previous, total_bytes, death_seen = 0, None, 0, False
    for page in client.pages(snapshot.report_code, query_fight, snapshot.report_revision, deadline, include_resources=True):
        for raw in page:
            ordinal += 1
            stamp = integer(raw.get("timestamp"))
            if stamp is None or previous is not None and stamp < previous:
                raise WclError("WCL死亡窗口含缺失或乱序时间，未返回不完整结果")
            previous = stamp
            event = review_event(raw, snapshot.report_code, snapshot.report_started_at_unix_ms, ordinal, data, indexes,
                common_start, f"wcl-review:{snapshot.id}:{death['eventId']}:{ordinal}")
            if not event or not start <= event["pullTimeMs"] <= end or not relevant(event, victim):
                continue
            if event["kind"] == "death" and event["targetActorId"] == victim and event["pullTimeMs"] == end:
                event = death
                death_seen = True
            if event["targetActorId"] != victim:
                event.update({"health": None, "maxHealth": None})
            document["observedCount"] += 1
            total_bytes += len(json.dumps(event, ensure_ascii=False).encode())
            if total_bytes > settings.death_review_max_bytes:
                raise WclError("WCL死亡窗口超过读取预算，未返回不完整结果")
            retained.append(event)
    if time.monotonic() >= deadline:
        raise WclError("WCL死亡窗口读取超过整体等待预算")
    if not matches(client.report(snapshot.report_code)) or not death_seen:
        return {**document, "availability": "reportChanged", "message": "WCL死亡记录或报告版本已变化，请重新导入。", "events": [], "priorAuras": [], "observedCount": 0}
    document.update({"events": list(retained), "total": len(retained), "truncated": document["observedCount"] > len(retained)})
    document["revision"] = hashlib.sha256(json.dumps(document, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    return document
