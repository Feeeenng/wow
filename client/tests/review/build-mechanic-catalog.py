"""从固定DB2快照生成只读分类资料，不根据技能名称或用户导入标签分类。"""

import argparse
import csv
import hashlib
import json
from pathlib import Path


BUILD = "12.1.5.70391"
# 仅核对这两种治疗石；其余杂项耗材可能复用职业技能，不能据物品关联宣称使用。
VERIFIED_HEALTHSTONE_ITEMS = {5512, 224464}


def read_rows(path):
    """按公开CSV字段读取，不执行输入内容。"""
    with path.open(encoding="utf-8-sig", newline="") as stream:
        return list(csv.DictReader(stream))


def generate(source, inventory, output):
    """仅收录实战技能中具有明确效果或直接治疗物品关联的资料。"""
    paths = {name: source / f"{name}-{BUILD}.csv" for name in ["SpellEffect", "ItemEffect", "ItemXItemEffect", "Item"]}
    ids = {int(row["spellId"]) for row in json.loads(inventory.read_text(encoding="utf-8"))["spells"]}
    effects = [row for row in read_rows(paths["SpellEffect"]) if int(row["SpellID"]) in ids and row["DifficultyID"] == "0"]
    # 枚举语义见TrinityCore作者维护的SpellEffect／Aura参考；不复制其实现代码。
    categories = {}
    for row in effects:
        aura, effect, points = int(row["EffectAura"]), int(row["Effect"]), float(row["EffectBasePointsF"])
        kind = "reduction" if aura == 87 and points < 0 else "absorb" if aura == 69 else "immunity" if aura == 39 else "transfer" if aura == 81 and points > 0 else None
        if kind and effect in (6, 35, 65):
            categories.setdefault(int(row["SpellID"]), []).append({"kind": kind, "effectId": int(row["ID"]), "aura": aura, "effect": effect, "points": points})
    healing = {int(row["SpellID"]) for row in effects if int(row["Effect"]) in (10, 67, 136)}
    items = {int(row["ID"]): row for row in read_rows(paths["Item"]) if row["ClassID"] == "0" and (row["SubclassID"] == "1" or int(row["ID"]) in VERIFIED_HEALTHSTONE_ITEMS)}
    uses = {int(row["ID"]): int(row["SpellID"]) for row in read_rows(paths["ItemEffect"]) if row["TriggerType"] == "0" and int(row["SpellID"]) in healing}
    consumables = {}
    for row in read_rows(paths["ItemXItemEffect"]):
        item, use = int(row["ItemID"]), int(row["ItemEffectID"])
        if item in items and use in uses:
            consumables.setdefault(uses[use], []).append({"itemId": item, "itemEffectId": use, "linkId": int(row["ID"]), "subclass": int(items[item]["SubclassID"])})
    entries = [{"spellId": spell, "effects": categories.get(spell, []), "items": sorted(consumables.get(spell, []), key=lambda row: row["itemId"])} for spell in sorted(categories.keys() | consumables.keys())]
    inputs = {name: {"url": f"https://wago.tools/db2/{name}/csv?build={BUILD}", "bytes": path.stat().st_size, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()} for name, path in paths.items()}
    inputs["inventory"] = {"bytes": inventory.stat().st_size, "sha256": hashlib.sha256(inventory.read_bytes()).hexdigest()}
    lines = ["/** 固定版本DB2生成资料；仅作分类，不代表日志热修版本或实际减伤量。 */", f"export const mechanicCatalogBuild = {json.dumps(BUILD)};", "export const mechanicCatalog = ["]
    lines += ["  " + json.dumps(entry, ensure_ascii=False, separators=(",", ":")) + "," for entry in entries]
    lines += ["] as const;", ""]
    output.mkdir(parents=True, exist_ok=True)
    (output / "catalog.ts").write_text("\n".join(lines), encoding="utf-8", newline="\n")
    (output / "sources.json").write_text(json.dumps({"build": BUILD, "inputs": inputs, "spellCount": len(entries), "inventorySpellCount": len(ids)}, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps({"spells": len(entries), "consumableSpells": len(consumables)}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--inventory", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    generate(args.source, args.inventory, args.output)
