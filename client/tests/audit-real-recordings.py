"""只读扫描真实日志与录像旁车，输出战斗边界及字段布局证据。"""

import argparse
import csv
import datetime as dt
import hashlib
import json
import re
import subprocess
from collections import Counter
from pathlib import Path

TIMELINE_EVENTS = {
    "SPELL_CAST_START": "castStart", "SPELL_CAST_SUCCESS": "castSuccess",
    "SPELL_EMPOWER_START": "empowerStart", "SPELL_EMPOWER_END": "empowerEnd",
    "SPELL_EMPOWER_INTERRUPT": "empowerInterrupt", "SPELL_RESURRECT": "resurrect",
    "UNIT_DIED": "death", "SPELL_INTERRUPT": "interrupt", "SPELL_DISPEL": "dispel",
    "SPELL_AURA_APPLIED": "Apply", "SPELL_AURA_REMOVED": "Remove",
    "SPELL_AURA_REFRESH": "Refresh",
    "SPELL_AURA_APPLIED_DOSE": "Stack", "SPELL_AURA_REMOVED_DOSE": "Stack",
}


def count_timeline_event(fields, active):
    """使用标准 CSV 解析结果独立统计契约内事件，供 Rust 实战回归对照。"""
    event = fields[0]
    if event not in TIMELINE_EVENTS:
        return
    source_flags, target_flags = int(fields[3], 16), int(fields[7], 16)
    source_group = fields[1].startswith("Player-") and source_flags & 7
    target_group = fields[5].startswith("Player-") and target_flags & 7
    hostile = fields[1].startswith(("Creature-", "Vehicle-")) and source_flags & 0x40
    aura, death = event.startswith("SPELL_AURA_"), event == "UNIT_DIED"
    resurrect = event == "SPELL_RESURRECT"
    if ((death or resurrect) and not target_group) or (not death and not (source_group or target_group or hostile)):
        return
    kind = TIMELINE_EVENTS[event]
    if aura:
        kind = ("buff" if fields[12] == "BUFF" else "debuff") + kind
    uses_target = death or aura or resurrect
    own = (target_flags if uses_target else source_flags) & 1
    classified_hostile = fields[5].startswith(("Creature-", "Vehicle-")) and target_flags & 0x40 if uses_target else hostile
    owner = "player" if own else "boss" if classified_hostile else "team"
    active["timelineCount"] += 1
    active["timelineKindCounts"][kind] = active["timelineKindCounts"].get(kind, 0) + 1
    active["timelineOwnerCounts"][owner] = active["timelineOwnerCounts"].get(owner, 0) + 1
    if event in {"SPELL_EMPOWER_END", "SPELL_EMPOWER_INTERRUPT"}:
        key = f"{kind}:{int(fields[12])}"
        levels = active["timelineEmpowerLevelCounts"]
        levels[key] = levels.get(key, 0) + 1


def timestamp_ms(value):
    """将日志时间按中国标准时间解析，保留毫秒精度。"""
    date, clock = value.split(" ", 1)
    month, day, year = map(int, date.split("/"))
    hms, fraction = clock.split(".")
    hour, minute, second = map(int, hms.split(":"))
    moment = dt.datetime(year, month, day, hour, minute, second,
                         int((fraction + "000000")[:6]),
                         tzinfo=dt.timezone(dt.timedelta(hours=8)))
    return int(moment.timestamp() * 1000)


def scan_log(path):
    """流式扫描，不将完整日志载入内存，也不修改日志。"""
    encounters, samples, active = [], {}, None
    counts = Counter()
    digest = hashlib.sha256()
    offset, lines = 0, 0
    with path.open("rb", buffering=4 * 1024 * 1024) as stream:
        for raw in stream:
            digest.update(raw)
            lines += 1
            split = raw.rstrip(b"\r\n").split(b"  ", 1)
            if len(split) == 2:
                stamp, payload = split
                event = payload.split(b",", 1)[0].decode("ascii", "replace")
                counts[event] += 1
                if event in set(TIMELINE_EVENTS) | {"ENCOUNTER_START", "ENCOUNTER_END", "COMBAT_LOG_VERSION",
                             "COMBATANT_INFO", "UNIT_DIED", "SPELL_INTERRUPT", "SPELL_DISPEL",
                             "SPELL_AURA_APPLIED_DOSE", "SPELL_CAST_START", "SPELL_CAST_SUCCESS"}:
                    fields = next(csv.reader([payload.decode("utf-8", "replace")]))
                    if event not in samples:
                        samples[event] = {"offset": offset, "timestamp": stamp.decode(), "fields": fields}
                    if event == "ENCOUNTER_START":
                        if active:
                            encounters.append(active)
                        active = {"startOffset": offset, "startTimestamp": stamp.decode(),
                                  "startMs": timestamp_ms(stamp.decode()), "startFields": fields,
                                  "events": [], "deaths": [], "timelineCount": 0,
                                  "timelineKindCounts": {}, "timelineOwnerCounts": {}, "timelineEmpowerLevelCounts": {}}
                    elif event == "ENCOUNTER_END" and active:
                        active.update(endOffset=offset + len(raw), endTimestamp=stamp.decode(),
                                      endMs=timestamp_ms(stamp.decode()), endFields=fields)
                        encounters.append(active)
                        active = None
                    elif active:
                        count_timeline_event(fields, active)
                        occurred = timestamp_ms(stamp.decode())
                        own = len(fields) > 3 and fields[3].lower() in {"0x511", "0x111"}
                        if (event == "UNIT_DIED" or (own and event in {"SPELL_CAST_START", "SPELL_CAST_SUCCESS"})):
                            entry = {"timestamp": stamp.decode(), "timeMs": occurred - active["startMs"],
                                     "offset": offset, "fields": fields}
                            if event == "UNIT_DIED":
                                active["deaths"].append(entry)
                            elif len(active["events"]) < 30:
                                active["events"].append(entry)
            offset += len(raw)
    if active:
        encounters.append(active)
    return {"file": str(path), "bytes": offset, "lines": lines, "sha256": digest.hexdigest(),
            "eventCounts": dict(counts), "samples": samples, "encounters": encounters}


def main():
    """由显式路径构造隔离的调查报告。"""
    parser = argparse.ArgumentParser()
    parser.add_argument("--logs", nargs="+", required=True)
    parser.add_argument("--videos", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--probe")
    parser.add_argument("--ffmpeg")
    parser.add_argument("--frame", action="append", default=[], help="录像序号:视频秒数，可重复")
    args = parser.parse_args()
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    logs = []
    for value in args.logs:
        item = scan_log(Path(value))
        logs.append(item)
        (output / (Path(value).stem + ".json")).write_text(
            json.dumps(item, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps({"file": value, "lines": item["lines"],
                          "encounters": len(item["encounters"])}, ensure_ascii=False), flush=True)
    videos = []
    for folder in sorted(Path(args.videos).glob("2026-10-16*")):
        metadata_path = folder / "metadata.json"
        if not metadata_path.exists():
            continue
        metadata = json.loads(metadata_path.read_text(encoding="utf-8-sig"))
        candidates = [(log, encounter) for log in logs for encounter in log["encounters"]
                      if encounter["startFields"][1] == str(metadata["encounter"]["id"])
                      and abs(encounter["startMs"] - metadata["startTime"]) < 10000]
        item = {"folder": str(folder), "metadata": metadata,
                "media": [{"file": str(path), "bytes": path.stat().st_size} for path in folder.glob("*.mp4")],
                "matches": [{"log": log["file"], "startOffset": enc["startOffset"],
                             "startMs": enc["startMs"], "endMs": enc.get("endMs"),
                             "sidecarStartDifferenceMs": metadata["startTime"] - enc["startMs"],
                             "sidecarEndDifferenceMs": metadata["endTime"] - enc["endMs"] if "endMs" in enc else None}
                            for log, enc in candidates]}
        videos.append(item)
    report = {"logs": [{key: value for key, value in item.items() if key not in {"samples", "encounters"}}
                       for item in logs], "videos": videos,
              "precisionBoundary": "旁车与日志匹配仅证明战斗身份，画面偏移需要独立画面锚点验证"}
    (output / "inventory.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"videos": len(videos), "matched": sum(bool(item["matches"]) for item in videos)}, ensure_ascii=False))
    if args.probe:
        probes = []
        for index, video in enumerate(videos):
            result = subprocess.run([args.probe, "-v", "error", "-show_format", "-show_streams",
                                     "-of", "json", video["media"][0]["file"]],
                                    capture_output=True, check=True)
            probes.append({"videoIndex": index, "probe": json.loads(result.stdout)})
        (output / "media-probes.json").write_text(json.dumps(probes, ensure_ascii=False, indent=2), encoding="utf-8")
    frames = []
    for specification in args.frame:
        if not args.ffmpeg:
            parser.error("--frame 必须同时指定 --ffmpeg")
        index_text, seconds_text = specification.split(":", 1)
        index = int(index_text)
        video = videos[index]["media"][0]["file"]
        result = subprocess.run([args.ffmpeg, "-hide_banner", "-loglevel", "info", "-copyts",
                                 "-ss", seconds_text, "-i", video, "-frames:v", "1", "-an",
                                 "-vf", "showinfo", "-f", "image2pipe", "-vcodec", "png", "pipe:1"],
                                capture_output=True, check=True)
        filename = f"anchor-{index}-{seconds_text}.png"
        (output / filename).write_bytes(result.stdout)
        stderr = result.stderr.decode("utf-8", "replace")
        pts = re.search(r"n:\s*0\s+pts:\s*\d+\s+pts_time:([\d.]+)", stderr)
        frames.append({"videoIndex": index, "requestedSeconds": float(seconds_text),
                       "actualPtsSeconds": float(pts.group(1)) if pts else None,
                       "file": filename, "sha256": hashlib.sha256(result.stdout).hexdigest(),
                       "exitCode": result.returncode})
    if frames:
        (output / "anchor-frames.json").write_text(json.dumps(frames, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
