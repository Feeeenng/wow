import type { LocalTimelineEvent, LocalTimelineEventKind } from "@/shared/replay/model";
import { eventActorKey } from "@/shared/replay/identity";

export type ReviewEventKind = LocalTimelineEventKind | "damage" | "heal" | "absorb" | "healAbsorb";

/** 数值沿用来源记录，未知量为null，不由相邻事件补造生命值或有效治疗。 */
export interface ReviewEvent extends Omit<LocalTimelineEvent, "kind" | "owner" | "identityNamespace"> {
  kind: ReviewEventKind;
  identityNamespace?: string | null;
  amount: number | null;
  absorbed: number | null;
  overkill: number | null;
  overheal: number | null;
  health: number | null;
  maxHealth: number | null;
  relatedSourceGuid?: string | null;
  relatedSourceName?: string | null;
}

export interface DeathReview {
  revision: string;
  sourceKind: "combatLog" | "wcl";
  availability: "ready" | "missingLog" | "unsupportedLog" | "sourceChanged" | "notConfigured" | "reportChanged";
  message: string | null;
  death: ReviewEvent;
  windowStartMs: number;
  windowEndMs: number;
  events: ReviewEvent[];
  priorAuras: ReviewEvent[];
  total: number;
  observedCount: number;
  truncated: boolean;
  priorAurasTruncated: boolean;
  parseErrors: number;
  pairedRowsRemoved: number;
  victimRecordingIds: string[];
  relatedRecordingIds: string[];
}

export interface DeathReviewPage extends DeathReview {
  nextCursor: string | null;
  hasMore: boolean;
}

/** 只计已提供的来源记录值；不能将缺失字段视作零或改称有效DPS／HPS。 */
export function reviewAmounts(events: ReviewEvent[]) {
  const summarize = (kind: "damage" | "heal") => {
    const rows = events.filter((event) => event.kind === kind);
    const values = rows.filter((event) => event.amount !== null && Number.isFinite(event.amount));
    const amount = values.reduce((sum, event) => sum + event.amount!, 0), overflow = !Number.isFinite(amount) || Math.abs(amount) > Number.MAX_SAFE_INTEGER;
    return { count: rows.length, knownCount: values.length, amount: values.length && !overflow ? amount : null, overflow };
  };
  return { damage: summarize("damage"), healing: summarize("heal") };
}

/** 仅归纳已观测光环，窗口前记录不完整或来源不明的移除不能冒充完整状态。 */
export function observedAuras(prior: ReviewEvent[], events: ReviewEvent[], death: ReviewEvent) {
  const active = new Map<string, ReviewEvent>(); let ambiguousRemoval = false;
  const victim = eventActorKey(death, "target");
  for (const event of [...prior, ...events].filter((item) => item.pullTimeMs <= death.pullTimeMs && eventActorKey(item, "target") === victim).sort((a, b) => a.pullTimeMs - b.pullTimeMs)) {
    if (!event.kind.startsWith("buff") && !event.kind.startsWith("debuff")) continue;
    const source = eventActorKey(event, "source"), prefix = event.kind.startsWith("buff") ? "buff" : "debuff", key = prefix + ":" + event.spellId + ":" + source;
    if (event.kind.endsWith("Remove") || event.stackCount === 0 && event.kind.endsWith("Stack")) {
      if (source) active.delete(key);
      else { for (const [id, value] of active) if (value.spellId === event.spellId && value.kind.startsWith(prefix)) active.delete(id); ambiguousRemoval = true; }
    } else active.set(key, event);
  }
  return { events: [...active.values()], ambiguousRemoval };
}

/** 列表身份来自真实目标GUID或报告actor，不按同名合并死亡记录。 */
export const deathActorKey = (event: LocalTimelineEvent | ReviewEvent) => eventActorKey(event, "target");
