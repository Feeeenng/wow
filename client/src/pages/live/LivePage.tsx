import { useEffect, useRef, useState } from "react";
import type { HistorySeekRequest } from "@/features/live/history/model";
import { Alert, Button, Select } from "antd";
import { useReplayState } from "@/features/replay/ReplayProvider";
import { useLiveHistory } from "@/features/live/history/useLiveHistory";
import { EventTimeline } from "@/pages/replay/timeline/EventTimeline";
import { REPLAY_EVENT_LEAD_SECONDS, REPLAY_DEATH_LEAD_SECONDS } from "@/features/replay/config";
import { usePersonalLiveSession } from "@/features/live/usePersonalLiveSession";
import { useObsSettings } from "@/features/obs/ObsSettingsProvider";
import { recordingService } from "@/features/recording/recordingService";
import { historyCovers } from "@/features/live/history/mapping";
import { LivePreviewPanel } from "@/pages/live/components/LivePreviewPanel";
import { PersonalViewPanel } from "@/pages/live/components/PersonalViewPanel";

interface LivePageProps {
  visible: boolean;
  onOpenSettings: () => void;
  onOpenReplay: () => void;
}

/** 常驻展示本机 WHEP/WebRTC 个人视角，由上层控制可见性。 */
export function LivePage({ visible, onOpenSettings, onOpenReplay }: LivePageProps) {
  const { status, error: obsError } = useObsSettings();
  const session = usePersonalLiveSession(status.liveActive);
  const history = useLiveHistory(session.session?.sessionId ?? null);
  const [request, setRequest] = useState<HistorySeekRequest | null>(null);
  const [positionMs, setPositionMs] = useState<number | null>(null);
  const [selectedBattleId, setSelectedBattleId] = useState<string | null>(null);
  const battles = [history.manifest?.activeBattle, ...(history.manifest?.recentBattles ?? [])].filter((item) => item != null);
  const battle = battles.find((item) => item.pullId === selectedBattleId) ?? battles[0];
  const { preferences, update } = useReplayState();
  const offsetMs = battle ? preferences.offsetsMs[battle.pullId] ?? 0 : 0;
  const battleDuration = battle ? Math.max(0, ((battle.endedAtUnixMs ?? Date.now()) - battle.startedAtUnixMs) / 1_000) : 0;
  const battlePosition = battle ? Math.min(battleDuration, Math.max(0, ((positionMs ?? history.ranges.at(-1)?.endMs ?? battle.startedAtUnixMs) - battle.startedAtUnixMs - offsetMs) / 1_000)) : 0;
  const lastPosition = useRef<{ pullId: string; seconds: number } | null>(null);
  const [archive, setArchive] = useState<{ pullId: string; seconds: number } | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  if (session.session && battle) lastPosition.current = { pullId: battle.pullId, seconds: battlePosition };
  useEffect(() => {
    if (session.session) { setArchive(null); setArchiveError(null); }
    else if (lastPosition.current) setArchive(lastPosition.current);
  }, [session.session?.sessionId]);
  useEffect(() => { setRequest(null); setPositionMs(null); setSelectedBattleId(null); }, [session.session?.sessionId]);
  const seekBattle = (seconds: number) => {
    if (battle && session.session) setRequest((current) => ({ id: (current?.id ?? 0) + 1, sessionId: session.session!.sessionId, unixMs: battle.startedAtUnixMs + seconds * 1_000 + offsetMs }));
  };
  const selectBattle = (id: string) => {
    setSelectedBattleId(id);
    const next = battles.find((item) => item.pullId === id);
    if (!next || !session.session) return;
    const range = history.ranges.find((item) => item.endMs > next.startedAtUnixMs && item.startMs < (next.endedAtUnixMs ?? Date.now()));
    if (range) setRequest((current) => ({ id: (current?.id ?? 0) + 1, sessionId: session.session!.sessionId, unixMs: Math.max(next.startedAtUnixMs, range.startMs) }));
  };
  const openArchive = async () => {
    if (!archive) return;
    try {
      const recordings = await recordingService.list();
      if (!recordings.some((item) => item.pullId === archive.pullId)) { setArchiveError("该场录像尚未进入本地目录，请在战斗结束后再试。"); return; }
      update((current) => ({ ...current, catalogSource: "local", selectedPullId: archive.pullId, bookmarksMs: { ...current.bookmarksMs, [archive.pullId]: Math.round(archive.seconds * 1_000) } }));
      onOpenReplay();
    } catch (failure) { setArchiveError(String(failure)); }
  };

  return (
    <div className="mx-auto w-full max-w-[1420px]">
      {obsError && (
        <Alert
          className="mb-4"
          type="warning"
          showIcon
          message="个人视角暂时不可用"
          description={obsError}
        />
      )}
      <div className="space-y-4">
        {archive && !session.session && <Alert type="info" showIcon message="直播已结束，可以在本地录像中继续复盘。" description={archiveError}
          action={<Button onClick={() => void openArchive()}>打开该场录像</Button>} />}
        <LivePreviewPanel
          status={status}
          session={session.session}
          loading={session.loading}
          error={session.error}
          visible={visible}
          onGoLive={onOpenSettings}
          history={history}
          request={request}
          onPositionChange={setPositionMs}
        />
        {session.session && history.error && <Alert type="info" showIcon message="历史回看暂不可用，实时直播仍可继续" description={history.error} />}
        {battle && <div className="flex items-center justify-between gap-3 text-xs text-[var(--app-text-secondary)]">
          <div className="flex flex-wrap items-center gap-3">
            <Select aria-label="直播回看战斗" className="min-w-56" value={battle.pullId} onChange={selectBattle}
              options={battles.map((item, index) => ({ value: item.pullId, label: `${item.encounterName} · ${item.endedAtUnixMs == null ? "进行中" : `历史战斗 ${battles.length - index}`}` }))} />
          </div>
        </div>}
        {battle && <EventTimeline events={[]} pullId={battle.pullId} eventRevision={battle.eventRevision} indexComplete={battle.indexComplete}
          currentTime={battlePosition}
          duration={battleDuration} success={null}
          disabled={history.ranges.length === 0 || Boolean(history.error)} onTimeChange={seekBattle}
          onEventTimeChange={(seconds, kind) => {
            const lead = Math.max(0, seconds - (kind === "death" ? REPLAY_DEATH_LEAD_SECONDS : REPLAY_EVENT_LEAD_SECONDS));
            seekBattle(historyCovers(history.ranges, battle.startedAtUnixMs + lead * 1_000 + offsetMs) ? lead : seconds);
          }} />}
        <PersonalViewPanel status={status} playerName={history.manifest?.activeBattle?.playerName ?? null} />
      </div>
    </div>
  );
}
