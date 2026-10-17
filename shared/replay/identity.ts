export interface EventActorIdentity {
  sourceGuid: string;
  targetGuid: string;
  identityNamespace?: string | null;
  sourceActorId?: number | null;
  targetActorId?: number | null;
  sourceIsPlayer?: boolean;
  targetIsPlayer?: boolean;
}

/** 保留真实 GUID；WCL 报告内 actor 使用明确命名空间键，不冒充游戏 GUID。 */
export function eventActorKey(event: EventActorIdentity, side: "source" | "target"): string {
  const guid = side === "source" ? event.sourceGuid : event.targetGuid;
  if (guid) return guid;
  const actorId = side === "source" ? event.sourceActorId : event.targetActorId;
  const report = /^wcl:([A-Za-z0-9]{16})$/.exec(event.identityNamespace ?? "");
  return report && Number.isSafeInteger(actorId) && (actorId ?? 0) > 0 ? `WCL-${report[1]}-${actorId}` : "";
}

/** 人物筛选只列明确的玩家身份，未知角色不依名称推断。 */
export function eventActorIsPlayer(event: EventActorIdentity, side: "source" | "target"): boolean {
  const guid = side === "source" ? event.sourceGuid : event.targetGuid;
  return guid?.startsWith("Player-") || (side === "source" ? event.sourceIsPlayer : event.targetIsPlayer) === true;
}
