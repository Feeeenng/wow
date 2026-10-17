"""独立使用Python CSV读取死前窗口，核对生产解析的伤害／治疗数值与本人生命采样。"""

import argparse
from collections import Counter
import csv
from datetime import datetime
import json
from pathlib import Path
from zoneinfo import ZoneInfo


def audit(index_path: Path, pull_id: str, event_id: str) -> dict:
    """只读原日志与指定隔离索引，不导入项目生产解析器。"""
    index = json.loads(index_path.read_text(encoding="utf-8"))
    pull = next(row for row in index["pulls"] if row["pullId"] == pull_id)
    death = next(row for row in pull["timelineEvents"] if row["eventId"] == event_id)
    victim = death["targetGuid"]
    source = Path(pull["logFileId"].rsplit("#", 1)[0])
    last = int(event_id.rsplit(":", 1)[1])
    rows, classification_rows = [], []
    with source.open("rb") as reader:
        header = reader.readline().decode("utf-8-sig")
        assert "COMBAT_LOG_VERSION,22,ADVANCED_LOG_ENABLED,1" in header
        reader.seek(pull["logStartOffset"])
        while reader.tell() <= last:
            offset = reader.tell()
            line = reader.readline()
            if not line:
                break
            stamp, payload = line.decode("utf-8").rstrip("\r\n").split("  ", 1)
            fields = next(csv.reader([payload]))
            if len(fields) < 9 or (fields[5] != victim and fields[1] != victim):
                continue
            raw = fields[0]
            if raw.endswith("_SUPPORT"):
                continue
            kind = "heal" if raw in {"SPELL_HEAL", "SPELL_PERIODIC_HEAL"} else "damage" if raw in {
                "SPELL_DAMAGE", "SPELL_PERIODIC_DAMAGE", "RANGE_DAMAGE", "DAMAGE_SHIELD", "DAMAGE_SPLIT",
                "SWING_DAMAGE", "SWING_DAMAGE_LANDED", "ENVIRONMENTAL_DAMAGE"} else None
            when = datetime.strptime(stamp, "%m/%d/%Y %H:%M:%S.%f").replace(tzinfo=ZoneInfo("Asia/Shanghai"))
            # 源日志含亚毫秒；业务毫秒截断，不使用浮点四舍五入跨越死亡边界。
            epoch = datetime(1970, 1, 1, tzinfo=ZoneInfo("UTC"))
            elapsed = when - epoch
            time = elapsed.days * 86400000 + elapsed.seconds * 1000 + elapsed.microseconds // 1000 - pull["encounterStartUnixMs"]
            if not max(0, death["pullTimeMs"] - 15000) <= time <= death["pullTimeMs"]:
                continue
            classification_kind = {"SPELL_CAST_SUCCESS": "castSuccess", "SPELL_AURA_APPLIED": "buffApply", "SPELL_AURA_APPLIED_DOSE": "buffStack", "SPELL_HEAL": "heal", "SPELL_PERIODIC_HEAL": "heal"}.get(raw)
            if classification_kind and len(fields) > 11 and (not raw.startswith("SPELL_AURA_") or fields[12] == "BUFF"):
                classification_rows.append({"eventId": f"{pull_id}:{offset}", "kind": classification_kind, "spellId": int(fields[9]), "pullTimeMs": time, "sourceGuid": fields[1], "targetGuid": fields[5]})
            if kind is None or fields[5] != victim:
                continue
            base, position = (9, 28) if raw.startswith("SWING_DAMAGE") else (9, 29) if raw == "ENVIRONMENTAL_DAMAGE" else (12, 31)
            assert len(fields) > position + 3

            def number(position):
                """负哨兵或缺字段保持未知，原始记录值不转成有效量。"""
                try:
                    value = int(fields[position])
                    return value if value >= 0 else None
                except (IndexError, ValueError):
                    return None

            sample = fields[base] == victim
            current, maximum = number(base + 2), number(base + 3)
            sample = sample and current is not None and maximum is not None and maximum > 0 and current <= maximum
            rows.append({"eventId": f"{pull_id}:{offset}", "rawType": raw, "kind": kind, "pullTimeMs": time,
                "sourceGuid": fields[1], "sourceName": fields[2],
                "amount": number(position), "absorbed": number(position + (3 if kind == "heal" else 6)),
                "overkill": number(position + 2) if kind == "damage" else None,
                "overheal": number(position + 2) if kind == "heal" else None,
                "health": current if sample else None, "maxHealth": maximum if sample else None,
                "pair": (stamp, fields[1], fields[5], tuple(fields[position:])) if raw.startswith("SWING_DAMAGE") else None})
    landed = Counter(row["pair"] for row in rows if row["rawType"] == "SWING_DAMAGE_LANDED")
    retained, removed = [], 0
    for row in rows:
        pair = row.pop("pair")
        if row["rawType"] == "SWING_DAMAGE" and landed[pair] > 0:
            landed[pair] -= 1
            removed += 1
        else:
            retained.append(row)
    return {"pullId": pull_id, "eventId": event_id, "victimGuid": victim, "rows": retained,
        "pairedRowsRemoved": removed, "sourceBytes": source.stat().st_size, "classificationRows": classification_rows}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--index", type=Path, required=True)
    parser.add_argument("--pull", required=True)
    parser.add_argument("--event", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = audit(args.index, args.pull, args.event)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"rows": len(result["rows"]), "pairedRowsRemoved": result["pairedRowsRemoved"]}))
