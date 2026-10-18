import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { CaretRightOutlined, DesktopOutlined, SearchOutlined, SortAscendingOutlined, TeamOutlined } from "@ant-design/icons";
import { Button, Input, Segmented, Tooltip } from "antd";
import type { LocalRecording } from "@/shared/replay/model";
import { distinctRecordingBattles, formatDifficulty, formatRecordingTime, isRecordingPlayable, recordingDurationSeconds, recordingStatusLabel } from "@/pages/replay/model";
import { formatTime } from "@/shared/replay/markers";

interface Props {
  actions: ReactNode;
  recordings: LocalRecording[];
  selected: LocalRecording | null;
  onSelect: (pullId: string) => void;
  source: "local" | "team";
  onSourceChange: (source: "local" | "team") => void;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  retryableIds: Set<string>;
  retryingPullId: string | null;
  onRetry: (pullId: string) => void;
}

/** 按真实日期、Boss 与难度组织本地 Pull，不把日志成员冒充录像视角。 */
export function ReplaySidebar({ recordings, selected, onSelect, source, onSourceChange, hasMore, loadingMore, onLoadMore, retryableIds, retryingPullId, onRetry, actions }: Props) {
  const [search, setSearch] = useState("");
  const [ascending, setAscending] = useState(false);
  const groups = useMemo(() => {
    const result = new Map<string, { title: string; date: string; pulls: LocalRecording[] }>();
    const ordered = distinctRecordingBattles(recordings, selected?.pullId ?? null).sort((a, b) => (ascending ? 1 : -1) * (a.encounterStartUnixMs - b.encounterStartUnixMs));
    for (const recording of ordered) {
      const date = formatRecordingTime(recording.encounterStartUnixMs).slice(0, 10);
      const title = `${recording.encounterName} · ${formatDifficulty(recording.difficultyId)}`;
      if (search && !`${title} ${date} ${recording.playerName ?? ""}`.toLowerCase().includes(search.toLowerCase())) continue;
      const key = `${date}:${recording.encounterId}:${recording.difficultyId}`;
      const group = result.get(key) ?? { title, date, pulls: [] };
      group.pulls.push(recording);
      result.set(key, group);
    }
    return [...result].map(([key, group]) => ({ key, ...group }));
  }, [recordings, selected?.pullId, search, ascending]);
  const views = selected ? recordings.filter((item) => item.pullId === selected.pullId || !!selected.battleKey && item.battleKey === selected.battleKey) : [];
  const players = [...(selected?.players ?? [])];
  for (const view of views) {
    if (!players.some((player) => view.recordingPlayerGuid ? player.guid === view.recordingPlayerGuid : player.name === view.playerName)) {
      players.push({ guid: view.recordingPlayerGuid ?? view.pullId, name: view.playerName ?? (view.importedSource ? "导入视角" : "本机视角") });
    }
  }
  return <aside className="replay-sidebar" aria-label={source === "team" ? "团队录像与人物" : "本地录像与人物"}>
    <div className="replay-sidebar-heading">
      <strong>{source === "team" ? "团队回放" : "本地回放"}</strong>
      <div className="flex items-center gap-1"><span>{distinctRecordingBattles(recordings, selected?.pullId ?? null).length} 场 · {recordings.length} 视角</span>{actions}</div>
    </div>
    <div className="replay-sidebar-search">
      <Segmented block size="small" className="mb-3" aria-label="回放数据源" options={[{ value: "local", label: "本地录像" }, { value: "team", label: "团队录像" }]} value={source} onChange={onSourceChange} />
      <Input size="small" allowClear prefix={<SearchOutlined />} placeholder="搜索首领、日期、人物" aria-label={source === "team" ? "搜索团队录像" : "搜索本地录像"} value={search} onChange={(event) => setSearch(event.target.value)} />
    </div>
    {selected && <details open className="replay-players">
      <summary><TeamOutlined /> 人物与视角 <span>{players.length}</span></summary>
      <div className="replay-player-grid">
        {players.map((player) => {
          const candidates = views.filter((view) => view.recordingPlayerGuid ? view.recordingPlayerGuid === player.guid : view.playerName ? view.playerName === player.name : view.pullId === player.guid);
          const view = candidates.find((item) => item.pullId === selected.pullId) ?? candidates.find(isRecordingPlayable) ?? candidates[0];
          const active = view?.pullId === selected.pullId;
          return <div key={player.guid} className="min-w-0 space-y-1"><Tooltip styles={{ root: { pointerEvents: "none" } }} title={!view ? "当前没有该人物的录像" : `${source === "team" ? "团队录像" : view.importedSource ? "导入录像" : "本机录制"} · ${recordingStatusLabel(view)}`}>
            <button type="button" className={`replay-pov w-full ${active ? "active" : ""}`} aria-pressed={active} aria-label={`观看${player.name}视角`} disabled={!view || !isRecordingPlayable(view)} onClick={() => { if (view) onSelect(view.pullId); }}>
              {view && <DesktopOutlined />}<span>{player.name}</span>{!view ? <span className="replay-no-pov">无录像</span> : !isRecordingPlayable(view) && <span className="replay-no-pov">{recordingStatusLabel(view)}</span>}
            </button>
          </Tooltip>{view && retryableIds.has(view.pullId) && <Button block size="small" className="!px-1 !text-[10px]" aria-label={`重试${player.name}的云端处理`} disabled={retryingPullId !== null} loading={retryingPullId === view.pullId} onClick={() => onRetry(view.pullId)}>重试处理</Button>}</div>;
        })}
      </div>
    </details>}
    <div className="replay-list-heading">
      <strong>首领与战斗</strong>
      <Tooltip title={ascending ? "当前按时间正序，点击倒序" : "当前按时间倒序，点击正序"}>
        <Button size="small" type="text" icon={<SortAscendingOutlined rotate={ascending ? 0 : 180} />} aria-label="切换录像时间排序" onClick={() => setAscending((value) => !value)} />
      </Tooltip>
    </div>
    <div className="replay-pull-list">
      {groups.map((group) => <details key={group.key} open className="replay-encounter">
        <summary><CaretRightOutlined /><span>{group.title}<small>{group.date}</small></span><span>{group.pulls.length}</span></summary>
        <div className="replay-pull-group">
          {group.pulls.map((recording, index) => <button key={recording.pullId} data-replay-pull={recording.pullId} type="button" className={`replay-pull ${recording.pullId === selected?.pullId ? "selected" : ""}`} aria-pressed={recording.pullId === selected?.pullId} onClick={() => onSelect(recording.pullId)}>
            <span className="replay-pull-main"><strong>Pull {ascending ? index + 1 : group.pulls.length - index}</strong><span>{formatTime(recordingDurationSeconds(recording))}</span><span className={recording.success ? "replay-kill" : "replay-wipe"}>{recording.success === true ? "击杀" : recording.success === false ? "未击杀" : "未结束"}</span></span>
            <span className="replay-pull-meta"><time>{formatRecordingTime(recording.encounterStartUnixMs).slice(11)}</time><span>{recordingStatusLabel(recording)}</span></span>
          </button>)}
        </div>
      </details>)}
      {groups.length === 0 && <p className="replay-list-empty">{search ? "没有符合搜索条件的录像" : source === "team" ? "尚无团队录像" : "尚无本地首领录像"}</p>}
      {hasMore && <Button block size="small" loading={loadingMore} aria-label="加载更多团队录像" onClick={onLoadMore}>加载更多团队录像</Button>}
    </div>
    <p className="replay-sidebar-footer">{source === "team" ? "团队授权目录" : "本地日志与录像"} · 中国标准时间</p>
  </aside>;
}
