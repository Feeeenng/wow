"""将只读日志审计、固定DB2和已校验图片合并到随包Boss技能资料，不改原始事件。"""

import argparse
import csv
import hashlib
import json
import pathlib
import re
import shutil


def read_json(path):
    """读取显式指定的UTF-8审计文件。"""
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path, value):
    """保留中文内容并固定换行，便于逐字节复核。"""
    path.write_bytes((json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))


def describe(path):
    """生成来源及发行文件的大小和内容摘要。"""
    data = path.read_bytes()
    return {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def main():
    """所有图片验证完成后再合并，拒绝未映射技能、错误页和图片路径穿越。"""
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ["audit", "spellmisc", "listfile", "resources"]:
        parser.add_argument(f"--{name}", type=pathlib.Path, required=True)
    args = parser.parse_args()
    inventory = read_json(args.audit / "boss-inventory.json")
    downloads = {row["fileDataId"]: row for row in read_json(args.audit / "icon-downloads.json")}
    casc = read_json(args.audit / "casc-extraction.json")
    local = {row["fileDataId"]: row for row in casc["files"]}
    pack = read_json(args.resources / "spells.json")
    mapping = read_json(args.resources / "source-map.json")
    manifest = read_json(args.resources / "manifest.json")
    records = {row["spellId"]: row for row in pack["spells"]}
    wanted = {row["spellId"] for row in inventory["spells"]}
    db2 = {}
    with args.spellmisc.open(encoding="utf-8") as stream:
        for row in csv.DictReader(stream):
            spell = int(row["SpellID"])
            if spell in wanted:
                db2.setdefault(spell, []).append(row)
    file_names = {}
    with args.listfile.open(encoding="utf-8") as stream:
        for line in stream:
            file_id, separator, name = line.strip().partition(";")
            if separator and file_id.isdigit():
                file_names[int(file_id)] = name.lower()
    resolved, pending = [], {}
    for spell in inventory["spells"]:
        rows = sorted(db2[spell["spellId"]], key=lambda row: (int(row["DifficultyID"]) != 16, int(row["DifficultyID"]) != 0, int(row["ID"])))
        row = rows[0]
        file_id = int(row["SpellIconFileDataID"]) or int(row["ActiveIconFileDataID"])
        name = file_names[file_id]
        assert name.startswith("interface/icons/") and downloads[file_id]["file"] == name
        if file_id in local:
            icon = f"filedataid_{file_id}.png"
            source = args.audit / "icons" / icon
            evidence = local[file_id]
            original = source.with_suffix(".blp").read_bytes()
            assert hashlib.md5(original).hexdigest() == evidence["contentMd5"]
            expected = evidence["png"]
            image_source, url = "localCasc", None
        else:
            evidence = downloads[file_id]
            assert "errors" not in evidence
            icon = evidence["icon"]
            source = (args.resources / "icons" if evidence.get("bundledExisting") else args.audit / "icons") / icon
            expected = evidence
            image_source, url = "verifiedFileName", evidence.get("url")
        assert re.fullmatch(r"[a-z0-9_-]+\.(?:jpg|png)", icon)
        data = source.read_bytes()
        assert data.startswith((b"\xff\xd8\xff", b"\x89PNG\r\n\x1a\n")) and len(data) <= 256 * 1024
        assert hashlib.sha256(data).hexdigest() == expected["sha256"]
        pending[icon] = source
        record = records.get(spell["spellId"])
        if record:
            # 旧玩家样本的映射已经核验；同ID不覆盖其图标或来源。
            icon = record["icon"]
            data = (args.resources / "icons" / icon).read_bytes()
        else:
            records[spell["spellId"]] = {"spellId": spell["spellId"], "name": spell["name"], "icon": icon,
                "source": f"Wago SpellMisc {mapping['build']}; observed boss casts" + (f"; CASC artwork {casc['build']}" if image_source == "localCasc" else "")}
        resolved.append({**spell, "fileDataId": file_id, "file": name, "difficultyId": int(row["DifficultyID"]), "db2RowId": int(row["ID"]),
                         "icon": icon, "imageSource": image_source, "downloadUrl": url, "iconSha256": hashlib.sha256(data).hexdigest()})
    for icon, source in pending.items():
        target = args.resources / "icons" / icon
        if source.resolve() != target.resolve():
            shutil.copyfile(source, target)
    boss = {"schemaVersion": 1, "mappingBuild": mapping["build"], "artworkBuild": casc["build"],
            "scope": "指定日志中已观测的敌方施法，优先史诗团本，不代表全副本全难度资料",
            "sources": inventory["sources"], "encounters": inventory["encounters"], "spells": resolved,
            "db2": describe(args.spellmisc), "verifiedListfile": describe(args.listfile), "localCasc": casc}
    write_json(args.resources / "boss-abilities.json", boss)
    pack["spells"] = sorted(records.values(), key=lambda row: row["spellId"])
    write_json(args.resources / "spells.json", pack)
    mapping["bossCoverage"] = {"catalog": "boss-abilities.json", "observedSpellCount": len(resolved),
        "mythicRaidSpellCount": len({sid for encounter in inventory["encounters"] if encounter["difficulty"] == 16 for sid in encounter["spellIds"]}), "missing": []}
    write_json(args.resources / "source-map.json", mapping)
    paths = [args.resources / row["file"] for row in manifest["files"]]
    paths += [args.resources / "boss-abilities.json", *(args.resources / "icons" / icon for icon in pending)]
    manifest["files"] = [{"file": path.relative_to(args.resources).as_posix(), **describe(path)} for path in sorted(set(paths))]
    write_json(args.resources / "manifest.json", manifest)
    print(json.dumps({"spells": len(records), "bossCoverage": mapping["bossCoverage"]}, ensure_ascii=True))


if __name__ == "__main__":
    main()
