import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Button, Empty, Input, Spin } from "antd";
import { businessDate, businessClock, durationLabel, difficultyLabel } from "@/replay/catalog/model";
import type { LocalRecording } from "@/shared/replay/model";

interface Props { rows: LocalRecording[]; selected: string | null; loading: boolean; hasMore: boolean; onMore: () => void; onSelect: (pull: string) => void; children?: ReactNode; }

/** 按实际中国日期、Boss和难度分组；分页未完整时不伪造全活动Pull序号。 */
export function CatalogSidebar({ rows, selected, loading, hasMore, onMore, onSelect, children }: Props) {
  const [search, setSearch] = useState("");
  const pulls = useMemo(() => [...new Map(rows.map((item) => [item.cloudTeamPullId!, item])).values()], [rows]);
  const groups = useMemo(() => {
    const values = new Map<string, LocalRecording[]>();
    const text = search.trim().toLocaleLowerCase();
    for (const pull of pulls) {
      const views = rows.filter((item) => item.cloudTeamPullId === pull.cloudTeamPullId);
      const label = businessDate(pull.encounterStartUnixMs);
      if (text && !(pull.encounterName + label + views.map((item) => item.playerName).join(" ")).toLocaleLowerCase().includes(text)) continue;
      const key = label + " · " + pull.encounterName + " · " + difficultyLabel(pull.difficultyId);
      const group = values.get(key) ?? []; group.push(pull); values.set(key, group);
    }
    return [...values];
  }, [rows, pulls, search]);
  return <aside className="catalog-sidebar" aria-label="团队战斗目录">
    <div className="catalog-summary"><strong>团队复盘</strong><span>已加载 {pulls.length} 场 · {rows.length} 视角</span></div>
    <Input.Search aria-label="搜索战斗" placeholder="搜索首领、日期、人物" value={search} onChange={(event) => setSearch(event.target.value)} allowClear />
    {children}
    <div className="catalog-groups">
      {groups.map(([name, values]) => <section key={name}><h3>{name}</h3>{values.map((pull) => {
        const views = rows.filter((item) => item.cloudTeamPullId === pull.cloudTeamPullId), ready = views.filter((item) => item.state === "ready").length;
        return <button className={"pull-card" + (selected === pull.cloudTeamPullId ? " selected" : "")} key={pull.cloudTeamPullId}
          aria-label={"打开" + pull.encounterName + " " + businessClock(pull.encounterStartUnixMs)} aria-pressed={selected === pull.cloudTeamPullId}
          onClick={() => onSelect(pull.cloudTeamPullId!)}>
          <strong>{businessClock(pull.encounterStartUnixMs)} <span>{durationLabel(((pull.encounterEndUnixMs ?? 0) - pull.encounterStartUnixMs) / 1000)}</span></strong>
          <span>{pull.success === true ? "击杀" : pull.success === false ? "未击杀" : "结果未知"} · 已加载 {ready} 个可用视角</span>
        </button>;
      })}</section>)}
      {loading && <div role="status"><Spin size="small" /> 正在读取战斗目录</div>}
      {!loading && !groups.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={search ? "没有符合搜索的战斗" : "团队暂无录像"} />}
      {hasMore && <Button block loading={loading} onClick={onMore}>加载更多战斗</Button>}
    </div>
    <a className="data-notice" href="/game-data-NOTICE.txt" target="_blank" rel="noreferrer">资料与许可</a>
  </aside>;
}
