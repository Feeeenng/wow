"""导入与查询共同使用的 WCL 事件身份及时间转换，不猜 GUID 或视角。"""

import math

from app.services.wcl.adapter import WclError

KINDS = {"begincast": "castStart", "cast": "castSuccess", "death": "death",
    "empowerstart": "empowerStart", "empowerend": "empowerEnd", "resurrect": "resurrect",
    "applybuff": "buffApply", "refreshbuff": "buffRefresh", "removebuff": "buffRemove",
    "applybuffstack": "buffStack", "removebuffstack": "buffStack",
    "applydebuff": "debuffApply", "refreshdebuff": "debuffRefresh", "removedebuff": "debuffRemove",
    "applydebuffstack": "debuffStack", "removedebuffstack": "debuffStack",
    "interrupt": "interrupt", "dispel": "dispel"}


def integer(value) -> int | None:
    """WCL Float 可能表示整数毫秒／ID；非有限值和布尔值不能成为身份。"""
    if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value == int(value):
        return int(value)
    return None


def unsigned(value) -> int | None:
    """可选技能及层数字段限定 u32，负值不传播到原生页反序列化。"""
    parsed = integer(value)
    return parsed if parsed is not None and 0 <= parsed <= (1 << 32) - 1 else None


def actor_sets(fight: dict) -> tuple[set[int], set[int]]:
    """友敌关系来自选中 fight 名单，不将整份报告所有 Player 都当友方。"""
    friendly = {value for value in fight.get("friendlyPlayers", []) if integer(value) is not None}
    enemy = {value for value in fight.get("enemyPlayers", []) if integer(value) is not None}
    for field, result in [("friendlyNPCs", friendly), ("friendlyPets", friendly), ("enemyNPCs", enemy), ("enemyPets", enemy)]:
        result.update(item["id"] for item in fight.get(field, []) if isinstance(item, dict) and integer(item.get("id")) is not None)
    return friendly, enemy


def metadata(report: dict, fight_id: int, request: dict) -> tuple[dict, dict]:
    """验证具体 fight、结束状态和显式 SELF 绑定，保存 API 来源版本。"""
    fight = next((fight for fight in report.get("fights", []) if fight.get("id") == fight_id), None)
    if not fight or fight.get("inProgress"):
        raise WclError("WCL 战斗不存在或尚未结束")
    if integer(report.get("startTime")) is None:
        raise WclError("WCL 报告起点不是有效绝对毫秒")
    master = report.get("masterData") or {}
    actors = [{"actorId": actor.get("id"), "name": actor.get("name") or "未知角色",
        "type": actor.get("type"), "subType": actor.get("subType"), "gameId": actor.get("gameID"),
        "server": actor.get("server"), "petOwner": actor.get("petOwner")}
        for actor in master.get("actors", []) if integer(actor.get("id")) is not None and actor["id"] > 0]
    actor_index = {actor["actorId"]: actor for actor in actors}
    for binding in request["actorBindings"]:
        actor = actor_index.get(binding["actorId"])
        if not actor or actor.get("type") != "Player" or binding["actorId"] not in fight.get("friendlyPlayers", []):
            raise WclError("SELF 绑定必须指向选中战斗的明确友方 Player actor")
    friendly, enemy = actor_sets(fight)
    return fight, {"actors": actors, "actorBindings": request["actorBindings"], "friendlyIds": sorted(friendly),
        "enemyIds": sorted(enemy), "abilities": master.get("abilities", []),
        "gameVersion": master.get("gameVersion"), "logVersion": master.get("logVersion"),
        "fight": fight, "eventSchema": 2, "segments": report.get("segments"), "exportedSegments": report.get("exportedSegments")}


def normalization_indexes(data: dict) -> tuple[dict, dict, set, set]:
    """每次导入建立一次索引，不对每个事件重新扫描角色和技能名单。"""
    return ({item["actorId"]: item for item in data["actors"]},
        {integer(item.get("gameID")): item for item in data["abilities"]},
        set(data["friendlyIds"]), set(data["enemyIds"]))


def normalize(raw: dict, report_code: str, report_start: int, ordinal: int, data: dict, indexes=None) -> dict | None:
    """仅投影现有时间轴支持的关键类型，绝对时间与原始类型保留。"""
    kind = KINDS.get(raw.get("type"))
    if kind is None:
        return None
    stamp = integer(raw.get("timestamp"))
    if stamp is None:
        raise WclError("关键事件缺失有效报告相对毫秒，未发布不完整结果")
    source, target = integer(raw.get("sourceID")), integer(raw.get("targetID"))
    uses_target = kind in {"death", "resurrect"} or kind.startswith(("buff", "debuff"))
    actor = target if uses_target else source
    index, abilities, friendly, enemy = indexes or normalization_indexes(data)
    # 环境或未知 actor 没有可靠轨道分类；明确跳过，原始事件分母单独披露。
    if actor not in friendly and actor not in enemy:
        return None
    ability = raw.get("abilityGameID")
    if ability is None and isinstance(raw.get("ability"), dict):
        ability = raw["ability"].get("gameID", raw["ability"].get("guid"))
    spell_id = integer(ability)
    if kind != "death" and (spell_id is None or spell_id < 0 or spell_id > (1 << 32) - 1):
        raise WclError("关键事件缺少可识别的游戏技能 ID，未将报告局部 ID 冒充 spellID")
    if kind == "death":
        spell_id = unsigned(spell_id) or 0
    name = (abilities.get(spell_id) or {}).get("name") or (raw.get("ability") or {}).get("name", "")
    return {"eventId": f"wcl:{report_code}:{ordinal}", "rawType": raw["type"],
        "identityNamespace": "wcl:" + report_code, "sourceActorId": source, "targetActorId": target,
        "sourceGuid": "", "targetGuid": "", "sourceName": (index.get(source) or {}).get("name", "未知来源"),
        "targetName": (index.get(target) or {}).get("name", "未知目标"),
        "sourceIsPlayer": (index.get(source) or {}).get("type") == "Player",
        "targetIsPlayer": (index.get(target) or {}).get("type") == "Player",
        "kind": kind, "owner": "team" if actor in friendly else "boss", "classificationActorId": actor,
        "spellId": spell_id or 0, "spellName": name, "stackCount": unsigned(raw.get("stack")),
        "empowerLevel": unsigned(raw.get("empowermentLevel")) if kind == "empowerEnd" else None,
        "extraSpellId": unsigned(raw.get("extraAbilityGameID")), "absoluteTimeMs": report_start + stamp}


def serialize_event(payload: dict, own_actor: int | None, common_start: int) -> dict:
    """SELF 使用类型对应 actor；共同零点可以产生负值，不能截断事实。"""
    result = dict(payload)
    if own_actor is not None and result["classificationActorId"] == own_actor:
        result["owner"] = "player"
    result.pop("classificationActorId")
    result["pullTimeMs"] = result.pop("absoluteTimeMs") - common_start
    return result
