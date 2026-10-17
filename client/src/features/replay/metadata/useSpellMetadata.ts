import { useEffect, useMemo, useState } from "react";
import type { LocalTimelineEvent } from "@/shared/replay/model";
import { REPLAY_ICON_BATCH_SIZE } from "@/features/replay/config";
import { spellMetadataService } from "@/features/replay/metadata/service";
import type { SpellMetadata } from "@/features/replay/metadata/service";

/** 同一技能列表只查询一次；资料失败不影响视频与事件事实。 */
export function useSpellMetadata(events: readonly Pick<LocalTimelineEvent, "spellId">[]) {
  const key = useMemo(() => [...new Set(events.map((event) => event.spellId).filter((id) => id > 0))].sort((a, b) => a - b).join(","), [events]);
  const [revision, setRevision] = useState(0);
  const [metadata, setMetadata] = useState<Map<number, SpellMetadata>>(new Map());
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setMetadata(new Map());
    setError(null);
    const ids = key ? key.split(",").map(Number) : [];
    void (async () => {
      for (let offset = 0; offset < ids.length; offset += REPLAY_ICON_BATCH_SIZE) {
        const values = await spellMetadataService.get(ids.slice(offset, offset + REPLAY_ICON_BATCH_SIZE));
        if (!active) return;
        setMetadata((current) => new Map([...current, ...values.map((item) => [item.spellId, item] as const)]));
      }
    })().catch((failure) => { if (active) setError(String(failure)); });
    return () => { active = false; };
  }, [key, revision]);
  return { metadata, error, refresh: () => setRevision((value) => value + 1) };
}
