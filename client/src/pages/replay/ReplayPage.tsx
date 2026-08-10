import { useState } from "react";
import { Empty } from "antd";
import { EventTimeline } from "@/pages/replay/components/EventTimeline";
import { MemberPanel } from "@/pages/replay/components/MemberPanel";
import { ReplayHeader } from "@/pages/replay/components/ReplayHeader";
import { ReplayPlayer } from "@/pages/replay/components/ReplayPlayer";
import { replayFixtures } from "@/pages/replay/replayFixtures";

/** 组合回放筛选、成员视角与统一演示时间状态。 */
export function ReplayPage() {
  const [replayId, setReplayId] = useState<string | null>(replayFixtures[0].id);
  const replay = replayFixtures.find((item) => item.id === replayId) ?? null;
  const [selectedMemberId, setSelectedMemberId] = useState(replayFixtures[0].members[0].id);
  const [currentTime, setCurrentTime] = useState(replayFixtures[0].initialTime);

  const handleReplayChange = (nextReplayId: string | null) => {
    setReplayId(nextReplayId);
    const nextReplay = replayFixtures.find((item) => item.id === nextReplayId);
    if (nextReplay) {
      setSelectedMemberId(nextReplay.members[0].id);
      setCurrentTime(nextReplay.initialTime);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1420px] space-y-4">
      <ReplayHeader
        replay={replay}
        replayOptions={replayFixtures}
        selectedReplayId={replayId}
        onReplayChange={handleReplayChange}
      />

      {replay ? (
        <div className="grid min-w-0 grid-cols-[minmax(180px,220px)_minmax(0,1fr)] gap-4">
          <MemberPanel
            members={replay.members}
            selectedMemberId={selectedMemberId}
            onMemberChange={setSelectedMemberId}
          />
          <div className="min-w-0 space-y-4">
            <ReplayPlayer
              currentTime={currentTime}
              duration={replay.durationSeconds}
              member={replay.members.find((member) => member.id === selectedMemberId) ?? replay.members[0]}
            />
            <EventTimeline
              currentTime={currentTime}
              duration={replay.durationSeconds}
              tracks={replay.tracks}
              onTimeChange={setCurrentTime}
            />
          </div>
        </div>
      ) : (
        <section className="flex min-h-[520px] items-center justify-center rounded-[6px] border border-[var(--app-border)] bg-[var(--app-surface)] px-6">
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="当前没有可回放的战斗记录"
          />
        </section>
      )}
    </div>
  );
}
