import { useEffect, useState } from "react";
import type { LocalTimelineEvent } from "@/shared/replay/model";
import { spellMetadataService } from "@/features/replay/metadata/service";
import type { SpellMetadata, SpellTooltip } from "@/features/replay/metadata/service";

/** 技能说明按真实ID离线查询；不把施法流水或未知动态伤害伪装成技能说明。 */
export function SkillTooltip({ event, metadata }: { event: LocalTimelineEvent; metadata?: SpellMetadata }) {
  const [detail, setDetail] = useState<SpellTooltip | null>(null);
  const [status, setStatus] = useState("正在读取技能说明…");
  useEffect(() => {
    let active = true;
    setDetail(null);
    setStatus("正在读取技能说明…");
    void spellMetadataService.tooltips([event.spellId]).then((values) => {
      if (!active) return;
      setDetail(values[0] ?? null);
      setStatus("当前版本暂无该技能的说明资料");
    }).catch(() => { if (active) setStatus("技能说明读取失败，请重新悬停重试"); });
    return () => { active = false; };
  }, [event.spellId]);
  return <article className="replay-skill-tooltip" aria-label="技能详情">
    <header>
      {metadata?.iconUrl && <img src={metadata.iconUrl} alt="" />}
      <div><strong>{detail?.name || metadata?.name || event.spellName || `技能 ${event.spellId}`}</strong>
        {detail?.englishName && <small>{detail.englishName}</small>}</div>
    </header>
    {detail ? <>
      <div className="replay-skill-facts">{[detail.rangeText, detail.costText, detail.castTimeText, detail.cooldownText].filter(Boolean).map((text, index) => <span key={index}>{text}</span>)}</div>
      <p>{detail.description}</p>
      {detail.descriptionNote && <small>{detail.descriptionNote}</small>}
    </> : <p role="status">{status}</p>}
    <footer>技能 ID：{event.spellId}{detail?.build ? ` · ${detail.build} 基础资料` : ""}</footer>
  </article>;
}
