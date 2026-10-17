"""死亡窗口保留WCL实际字段与报告actor，不将API数值改称有效量。"""

from app.services.wcl.adapter import WclError
from app.services.wcl.normalization import integer, normalize, unsigned


def stored_event(payload: dict, common_start: int) -> dict:
    """已发布关键事件补充明确的未知数值，不让缺字段冒充零值。"""
    result = {key: value for key, value in payload.items() if key not in {"owner", "classificationActorId", "absoluteTimeMs"}}
    result["pullTimeMs"] = payload["absoluteTimeMs"] - common_start
    result.update({key: None for key in ["amount", "absorbed", "overkill", "overheal", "health", "maxHealth", "relatedSourceGuid", "relatedSourceName"]})
    return result


def recorded_number(raw: dict, key: str) -> int | None:
    """缺失、负哨兵、布尔及超出网页安全整数的量保持未知。"""
    value = integer(raw.get(key))
    return value if value is not None and 0 <= value <= (1 << 53) - 1 else None


def review_event(raw: dict, code: str, report_start: int, ordinal: int, data: dict,
                 indexes: tuple, common_start: int, event_id: str) -> dict | None:
    """数值事件按明确target投影，环境伤害不因未知source而丢失。"""
    numeric_kind = {"damage": "damage", "heal": "heal", "absorbed": "absorb"}.get(raw.get("type"))
    source, target = integer(raw.get("sourceID")), integer(raw.get("targetID"))
    if numeric_kind:
        stamp = integer(raw.get("timestamp"))
        if stamp is None:
            raise WclError("WCL死亡窗口缺少有效事件时间")
        actors, abilities, _, _ = indexes
        ability = raw.get("abilityGameID")
        if ability is None and isinstance(raw.get("ability"), dict):
            ability = raw["ability"].get("gameID", raw["ability"].get("guid"))
        spell = unsigned(ability)
        result = {"kind": numeric_kind, "absoluteTimeMs": report_start + stamp,
            "identityNamespace": "wcl:" + code, "sourceActorId": source, "targetActorId": target,
            "sourceGuid": "", "targetGuid": "", "sourceName": (actors.get(source) or {}).get("name", "未知来源"),
            "targetName": (actors.get(target) or {}).get("name", "未知目标"),
            "sourceIsPlayer": (actors.get(source) or {}).get("type") == "Player",
            "targetIsPlayer": (actors.get(target) or {}).get("type") == "Player",
            "spellId": spell or 0, "spellName": (abilities.get(spell) or {}).get("name", ""),
            "stackCount": None, "extraSpellId": None, "empowerLevel": None, "rawType": raw["type"]}
    else:
        result = normalize(raw, code, report_start, ordinal, data, indexes)
        if result is None:
            return None
        result.pop("owner", None)
        result.pop("classificationActorId", None)
    result["eventId"] = event_id
    result["pullTimeMs"] = result.pop("absoluteTimeMs") - common_start
    result.update({"amount": recorded_number(raw, "amount") if numeric_kind else None,
        "absorbed": recorded_number(raw, "absorbed") if numeric_kind else None,
        "overkill": recorded_number(raw, "overkill") if numeric_kind == "damage" else None,
        "overheal": recorded_number(raw, "overheal") if numeric_kind == "heal" else None,
        "health": None, "maxHealth": None, "relatedSourceGuid": None, "relatedSourceName": None})
    # targetResources明确属于事件目标；sourceResources不能当死者生命采样。
    resources = raw.get("targetResources")
    if isinstance(resources, dict):
        health, maximum = recorded_number(resources, "hitPoints"), recorded_number(resources, "maxHitPoints")
        if health is not None and maximum is not None and 0 < maximum and health <= maximum:
            result.update({"health": health, "maxHealth": maximum})
    return result


def relevant(event: dict, victim: int) -> bool:
    """伤害／治疗／光环必须明确指向死者；成功施法及打断可保留死者本人记录。"""
    if event["targetActorId"] == victim:
        return True
    return event["sourceActorId"] == victim and event["kind"] in {"castStart", "castSuccess", "empowerStart", "empowerEnd", "interrupt", "dispel"}
