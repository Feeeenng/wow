import { useMemo, useState } from "react";
import { Input, Select } from "antd";
import type { LocalRecording } from "@/shared/replay/model";

/** 名单来自上传的真实人物元数据，无录像角色保持禁用，不用名字猜视角。 */
export function ViewSelector({ views, selected, onSelect }: { views: LocalRecording[]; selected: string | null; onSelect: (view: LocalRecording) => void }) {
  const [search, setSearch] = useState(""), [fullType, setFullType] = useState<string>();
  const roster = useMemo(() => {
    const values = new Map<string, LocalRecording["players"][number]>();
    for (const view of views) {
      for (const player of view.players) values.set(player.guid, player);
      if (view.recordingPlayerGuid && !values.has(view.recordingPlayerGuid)) values.set(view.recordingPlayerGuid, { guid: view.recordingPlayerGuid, name: view.playerName ?? "未知人物" });
    }
    return [...values.values()];
  }, [views]);
  const types = useMemo(() => [...new Set(roster.map((item) => item.fullType).filter(Boolean))].map((value) => ({ value: value!, label: value! })), [roster]);
  return <section className="view-selector"><div className="section-heading"><span>人物与视角</span><span>{roster.length}</span></div>
    <Input aria-label="搜索人物视角" placeholder="搜索人物" size="small" allowClear value={search} onChange={(event) => setSearch(event.target.value)} />
    {types.length > 0 && <Select aria-label="筛选职业专精" placeholder="全部职业与专精" allowClear options={types} value={fullType} onChange={setFullType} />}
    <div className="view-grid">{roster.filter((person) => person.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()) && (!fullType || person.fullType === fullType)).map((person) => {
      const recording = views.find((item) => item.recordingPlayerGuid === person.guid);
      const label = !recording ? "暂无录像" : recording.state === "ready" ? recording.mapping?.hasGap ? "部分可回放" : "可回放" : recording.state === "failed" ? "处理失败" : recording.cloudStatus === "pendingUpload" ? "等待上传" : recording.cloudStatus === "uploaded" ? "等待处理" : "处理中";
      return <button key={person.guid} disabled={!recording || recording.state !== "ready"} aria-pressed={selected === recording?.pullId}
        aria-label={"观看" + person.name + "视角"} title={recording?.error ?? person.name + " · " + label}
        onClick={() => { if (recording) onSelect(recording); }}><strong>{person.name}</strong><span>{label}</span></button>;
    })}</div>
  </section>;
}
