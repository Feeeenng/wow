import { useEffect, useRef, useState } from "react";
import { Alert, Button, Drawer, Empty, Input, Modal, Spin, Tooltip, message } from "antd";
import { CopyOutlined, FullscreenExitOutlined, FullscreenOutlined, MenuOutlined, ReloadOutlined } from "@ant-design/icons";
import { useCatalog, useBattle } from "@/replay/catalog/useCatalog";
import { CatalogSidebar } from "@/replay/catalog/CatalogSidebar";
import { businessDate, businessClock, difficultyLabel } from "@/replay/catalog/model";
import { ViewSelector } from "@/replay/catalog/ViewSelector";
import { usePlayback } from "@/replay/playback/usePlayback";
import { ReplayPlayer } from "@/replay/playback/ReplayPlayer";
import { EventTimeline } from "@/replay/timeline/EventTimeline";
import { useEvents } from "@/replay/timeline/useEvents";
import { readReplayLink, replayLink } from "@/replay/navigation";
import { replayIntervals } from "@/shared/replay/mapping";
import { CalibrationPanel } from "@/replay/calibration/CalibrationPanel";
import { useAnnotations } from "@/replay/annotations/useAnnotations";
import { WclReportPanel } from "@/replay/reports/WclReportPanel";

/** 单团队工作台拥有当前进程的书签、偏好及数据，离开账号时整体销毁。 */
export function ReplayWorkbench({ team, initial }: { team: string; initial: ReturnType<typeof readReplayLink> }) {
  const catalog = useCatalog(team);
  const [pull, setPull] = useState<string | null>(initial.pull), [selected, setSelected] = useState<string | null>(initial.view);
  const [drawer, setDrawer] = useState(false), [fullscreen, setFullscreen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const battle = useBattle(team, pull);
  const view = battle.views.find((item) => item.pullId === selected) ?? null;
  const playback = usePlayback(view, setSelected, initial.seconds);
  const events = useEvents(team, view);
  const annotations = useAnnotations(team, view?.pullId ?? null);
  const [feedback, holder] = message.useMessage();
  useEffect(() => { if (!pull && catalog.rows.length) setPull(catalog.rows[0].cloudTeamPullId!); }, [catalog.rows, pull]);
  useEffect(() => {
    if (!battle.loading && battle.views.length && !battle.views.some((item) => item.pullId === selected)) {
      setSelected((battle.views.find((item) => item.state === "ready") ?? battle.views[0]).pullId);
    }
  }, [battle.views, battle.loading, selected]);
  useEffect(() => {
    const update = () => setFullscreen(document.fullscreenElement === root.current);
    document.addEventListener("fullscreenchange", update); return () => document.removeEventListener("fullscreenchange", update);
  }, []);
  const toggleFullscreen = async () => { if (document.fullscreenElement) await document.exitFullscreen(); else await root.current?.requestFullscreen(); };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.target instanceof HTMLElement && event.target.closest("input,textarea,select,[contenteditable='true'],[role='combobox']")) return;
      if (event.code === "KeyT") { event.preventDefault(); void toggleFullscreen(); }
    };
    document.addEventListener("keydown", key); return () => document.removeEventListener("keydown", key);
  }, []);
  const choosePull = (id: string) => { if (id !== pull) { setSelected(null); setPull(id); } setDrawer(false); };
  const share = async () => {
    if (!view || !pull) return;
    const address = replayLink(window.location.href, team, pull, view.pullId, playback.time);
    try { await navigator.clipboard.writeText(address); void feedback.success("已复制当前战斗时间点链接，仅授权团队成员可访问。"); }
    catch { Modal.info({ title: "当前时间点链接", content: <Input aria-label="当前时间点链接" readOnly value={address} onFocus={(event) => event.target.select()} /> }); }
  };
  const sidebar = <CatalogSidebar rows={catalog.rows} selected={pull} loading={catalog.loading} hasMore={catalog.hasMore} onMore={() => void catalog.more()} onSelect={choosePull}>
    <ViewSelector views={battle.views} selected={selected} onSelect={(next) => { playback.selectView(next); setDrawer(false); }} />
  </CatalogSidebar>;
  const refresh = () => { void catalog.refresh(); battle.refresh(); };
  const canSeek = !!view && view.state === "ready" && replayIntervals(view).length > 0 && !playback.error;
  return <div className="replay-workspace" ref={root}>
    {holder}<div className="desktop-catalog">{sidebar}</div>
    <Drawer title="团队战斗目录" open={drawer} onClose={() => setDrawer(false)} placement="left" size={320}>{sidebar}</Drawer>
    <main className="replay-main">
      <header className="battle-header">
        <Button className="mobile-catalog-button" icon={<MenuOutlined />} aria-label="打开战斗目录" onClick={() => setDrawer(true)} />
        <div><h1>{view?.encounterName ?? "团队战斗复盘"}</h1><span className="muted">{view ? businessDate(view.encounterStartUnixMs) + " " + businessClock(view.encounterStartUnixMs) + " · " + difficultyLabel(view.difficultyId) : "选择战斗及人物视角"}</span></div>
        <Button icon={<ReloadOutlined />} aria-label="刷新团队录像" loading={catalog.loading || battle.loading} onClick={refresh} />
        <WclReportPanel key={team + ":" + pull} team={team} pull={pull} views={battle.views}
          onPublished={() => { void catalog.refresh(); battle.refreshMetadata(); }} />
        <Button aria-label="复制时间点链接" icon={<CopyOutlined />} disabled={!view} onClick={() => void share()}>复制时间点链接</Button>
        <Tooltip title={fullscreen ? "退出复盘全屏" : "全屏显示视频和时间轴"}><Button aria-label="切换复盘全屏" icon={fullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />} onClick={() => void toggleFullscreen()} /></Tooltip>
      </header>
      {(catalog.error || battle.error) && <Alert type="error" showIcon message={catalog.error ?? battle.error} action={<Button size="small" onClick={refresh}>重新读取</Button>} />}
      {battle.loading ? <div className="loading-panel" role="status"><Spin />正在读取战斗视角</div> : view ? <>
        <ReplayPlayer view={view} team={team} playback={playback} annotations={annotations} onReload={refresh} />
        <div className="review-toolbar"><span className="muted">自动映射仍可能包含采集延迟，可按画面复核。</span>
          <CalibrationPanel key={view.pullId + view.cloudPlaybackVersion} view={view} team={team} playback={playback} onUpdate={battle.update} /></div>
        <EventTimeline team={team} query={events} current={playback.time} duration={playback.duration} disabled={!canSeek} onTime={playback.request} onEvent={playback.seekEvent} />
      </> : <div className="loading-panel"><Empty description={pull ? "本场暂无可查看视角" : "请选择团队战斗"} /></div>}
    </main>
  </div>;
}
