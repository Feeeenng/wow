import { eventActorKey } from "@/shared/replay/identity";
import type { DeathReview, ReviewEvent } from "@/shared/review/model";
import { mechanicCatalog } from "@/shared/review/mechanics/catalog";

export type MechanicKind = "reduction" | "absorb" | "immunity" | "transfer" | "consumable";
export type MechanicScope = "personal" | "external" | "group" | "unknown";
const catalog = new Map<number, (typeof mechanicCatalog)[number]>(mechanicCatalog.map((entry) => [entry.spellId, entry]));

/** 无效GUID不能变成已确认的本人或外部来源；报告actor仍由共享身份契约处理。 */
function actor(event: ReviewEvent, side: "source" | "target") {
  const key = eventActorKey(event, side);
  return !key || key === "nil" || /^(?:0x)?0+$/.test(key) ? "" : key;
}

/** 固定资料只解释事件种类；不推算冷却、实际减伤量、有效覆盖或未使用结论。 */
export function classifiedMechanic(event: ReviewEvent, death: ReviewEvent) {
  const entry = catalog.get(event.spellId), victim = actor(death, "target");
  if (!entry || !victim || event.pullTimeMs > death.pullTimeMs) return null;
  const source = actor(event, "source"), target = actor(event, "target");
  const cast = event.kind === "castSuccess";
  const aura = event.kind === "buffApply" || event.kind === "buffStack";
  if (!cast && !aura && event.kind !== "heal") return null;
  // 对其他人物施放不代表保护死者；无目标的本人成功施法单列为使用记录。
  if (target !== victim && !(cast && source === victim && !target)) return null;
  if (entry.items.length && source === victim && (cast || event.kind === "heal")) {
    return { event, kinds: ["consumable"] as MechanicKind[], scope: "personal" as MechanicScope, itemIds: entry.items.map((item) => item.itemId) };
  }
  if (event.kind === "heal" || !entry.effects.length) return null;
  const kinds = [...new Set(entry.effects.map((effect) => effect.kind))] as MechanicKind[];
  const group = entry.effects.some((effect) => [35, 65].includes(effect.effect));
  const scope: MechanicScope = group ? "group" : !source ? "unknown" : source === victim ? "personal" : source.startsWith("Player-") || source.startsWith("WCL-") ? "external" : "unknown";
  return { event, kinds, scope, itemIds: [] as number[] };
}

/** 只列窗口内实际观测的成功施法／增益／治疗，不把窗口前光环当本次使用。 */
export function reviewMechanics(review: DeathReview) {
  if (review.sourceKind !== "combatLog") return [];
  return review.events.filter((event) => event.pullTimeMs >= review.windowStartMs && event.pullTimeMs <= review.windowEndMs)
    .map((event) => classifiedMechanic(event, review.death)).filter((entry) => entry !== null);
}
