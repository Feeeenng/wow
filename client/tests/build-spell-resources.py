"""从已下载的公开 DB2／已验证文件名及匿名技能清单生成可离线验收的图标包。"""

import argparse
import concurrent.futures
import csv
import hashlib
import json
import pathlib
import re
import subprocess
from urllib.parse import quote


def read_json(path):
    """读取 UTF-8 JSON，不解释或执行任何外部内容。"""
    return json.loads(path.read_text(encoding="utf-8"))


def describe(path, url):
    """记录完整原始输入的身份，便于复核来源与重建。"""
    data = path.read_bytes()
    return {"url": url, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def write_json(path, value):
    """统一写入无 BOM 的中文 JSON，资源不包含人物、账号或令牌。"""
    path.write_bytes((json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))


def valid_jpeg(path):
    """下载成功同时验证文件头，避免将错误页作为随包图片。"""
    return path.is_file() and 3 <= path.stat().st_size <= 256 * 1024 and path.read_bytes().startswith(b"\xff\xd8\xff")


def main():
    """仅在显式指定的输出目录写图片和资料，不读取任何应用登录缓存。"""
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ["inventory", "spellmisc", "listfile", "release", "output"]:
        parser.add_argument(f"--{name}", type=pathlib.Path, required=True)
    parser.add_argument("--build", required=True)
    parser.add_argument("--download", action="store_true", help="从现有固定 RPGLogs 源补齐图片")
    args = parser.parse_args()
    inventory = read_json(args.inventory)
    spells = {item["spellId"]: item for item in inventory["spells"]}
    release = read_json(args.release)
    asset = next(item for item in release["assets"] if item["name"] == "verified-listfile.csv")
    list_source = describe(args.listfile, asset["browser_download_url"])
    if list_source["bytes"] != asset["size"] or f"sha256:{list_source['sha256']}" != asset["digest"]:
        raise ValueError("已验证文件名清单长度或 SHA-256 与官方发布元数据不一致")
    source = f"Wago SpellMisc {args.build}; wowdev verified-listfile {release['tag_name']}"
    rows = {}
    conflicts = set()
    with args.spellmisc.open(encoding="utf-8-sig", newline="") as file:
        for row in csv.DictReader(file):
            spell_id = int(row["SpellID"])
            file_id = int(row["SpellIconFileDataID"])
            if spell_id not in spells or file_id == 0:
                continue
            difficulty = int(row["DifficultyID"])
            previous = rows.get(spell_id)
            if previous is None or difficulty == 0:
                rows[spell_id] = {"spellId": spell_id, "fileDataId": file_id, "difficultyId": difficulty}
            elif previous["difficultyId"] != 0 and previous["fileDataId"] != file_id:
                conflicts.add(spell_id)
    for spell_id in conflicts:
        if rows[spell_id]["difficultyId"] != 0:
            del rows[spell_id]
    wanted = {row["fileDataId"] for row in rows.values()}
    filenames = {}
    with args.listfile.open(encoding="utf-8", newline="") as file:
        for file_id, filename in csv.reader(file, delimiter=";"):
            if int(file_id) in wanted and re.fullmatch(r"interface/icons/[a-z0-9_ -]{1,150}\.blp", filename):
                filenames[int(file_id)] = filename
    mappings = []
    for spell_id, row in rows.items():
        filename = filenames.get(row["fileDataId"])
        if filename:
            remote_icon = pathlib.PurePosixPath(filename).stem + ".jpg"
            local_icon = f"filedataid_{row['fileDataId']}.jpg" if " " in remote_icon else remote_icon
            mappings.append({**row, "file": filename, "icon": local_icon, "remoteIcon": remote_icon})
    icons = sorted({row["icon"] for row in mappings})
    remote_icons = {row["icon"]: row["remoteIcon"] for row in mappings}
    previous = read_json(args.output / "source-map.json") if (args.output / "source-map.json").exists() else {}
    previous_urls = {row["icon"]: row.get("downloadUrl") for row in previous.get("mappings", [])}
    previous_attempts = {row["icon"]: row.get("attempts", []) for row in previous.get("failedMappings", [])}
    known_failed = {row["fileDataId"] for row in previous.get("coverage", {}).get("missing", [])
                    if row.get("reason") == "图标图片下载未通过验证"}
    file_ids = {row["icon"]: row["fileDataId"] for row in mappings}
    icon_directory = args.output / "icons"
    icon_directory.mkdir(parents=True, exist_ok=True)

    def download(name):
        """固定来源、超时、有限重试，外部字段不能指定路径或 endpoint。"""
        target = icon_directory / name
        url = f"https://assets.rpglogs.com/img/warcraft/abilities/{quote(remote_icons[name])}"
        if valid_jpeg(target):
            return name, (True, previous_urls.get(name) or url, [])
        if not args.download:
            return name, (False, None, previous_attempts.get(name, []))
        temporary = target.with_suffix(".jpg.tmp")
        attempts = []
        urls = [url, f"https://wow.zamimg.com/images/wow/icons/large/{quote(remote_icons[name])}"]
        if file_ids[name] in known_failed:
            urls = urls[1:]
        for candidate in urls:
            result = subprocess.run(["curl.exe", "--fail", "--silent", "--show-error", "--max-time", "12",
                                     "--max-filesize", "262144", "--output", str(temporary), "--write-out", "%{http_code}",
                                     candidate], capture_output=True)
            attempts.append({"url": candidate, "status": result.stdout.decode("ascii", errors="replace").strip(), "exitCode": result.returncode})
            if result.returncode == 0 and valid_jpeg(temporary):
                temporary.replace(target)
                return name, (True, candidate, attempts)
        temporary.unlink(missing_ok=True)
        return name, (False, None, attempts)

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
        available = dict(executor.map(download, icons))
    existing = read_json(args.output / "spells.json")
    records = {row["spellId"]: {**row, "source": row.get("source", existing["source"])} for row in existing["spells"]}
    for row in mappings:
        if available[row["icon"]][0]:
            records[row["spellId"]] = {"spellId": row["spellId"], "name": spells[row["spellId"]]["name"],
                                       "icon": row["icon"], "source": source}
    matched = [{**row, "downloadUrl": available[row["icon"]][1],
                "iconSha256": hashlib.sha256((icon_directory / row["icon"]).read_bytes()).hexdigest()}
               for row in mappings if available[row["icon"]][0]]
    matched_ids = {row["spellId"] for row in matched}
    mapped_ids = {row["spellId"] for row in mappings}
    missing = [{**spells[spell_id], "fileDataId": rows.get(spell_id, {}).get("fileDataId"),
                "reason": "图标图片下载未通过验证" if spell_id in mapped_ids else "已验证文件名或 DB2 映射缺失"}
               for spell_id in sorted(set(spells) - matched_ids)]
    coverage = {"sampleSpellCount": len(spells), "mappedSpellCount": len(mappings),
                "bundledSampleSpellCount": len(matched), "bundledUniqueIconCount": sum(value[0] for value in available.values()),
                "sampleEventCount": inventory["eventCount"],
                "coveredSampleEventCount": sum(spells[spell_id]["count"] for spell_id in matched_ids),
                "missing": missing}
    pack = {"schemaVersion": 1, "gameVersion": "retail", "source": source,
            "spells": sorted(records.values(), key=lambda row: row["spellId"])}
    write_json(args.output / "spells.json", pack)
    write_json(args.output / "source-map.json", {"schemaVersion": 1, "build": args.build,
        "logBuildVersion": "12.1.5", "exactLogBuildKnown": False, "source": source,
        "coverage": coverage, "mappings": matched,
        "failedMappings": [{**row, "iconSha256": None,
            "candidateUrls": [f"https://assets.rpglogs.com/img/warcraft/abilities/{quote(row['remoteIcon'])}",
                              f"https://wow.zamimg.com/images/wow/icons/large/{quote(row['remoteIcon'])}"],
            "attempts": available[row["icon"]][2]} for row in mappings if not available[row["icon"]][0]]})
    sources = [describe(args.spellmisc, f"https://wago.tools/db2/SpellMisc/csv?build={args.build}"), list_source,
               describe(args.release, release["url"])]
    files = []
    for path in [args.output / "spells.json", args.output / "source-map.json", *sorted(icon_directory.glob("*.jpg"))]:
        record = describe(path, "")
        del record["url"]
        files.append({"file": path.relative_to(args.output).as_posix(), **record})
    write_json(args.output / "manifest.json", {"schemaVersion": 1, "sources": sources, "coverage": coverage, "files": files})
    print(json.dumps(coverage, ensure_ascii=True), flush=True)


if __name__ == "__main__":
    main()
