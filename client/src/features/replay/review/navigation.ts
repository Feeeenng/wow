import type { LocalRecording } from "@/shared/replay/model";
import type { DeathReview } from "@/shared/review/model";
import { pullToVideo } from "@/shared/replay/mapping";
import { effectiveOffset } from "@/shared/replay/calibration";
import type { ReplayPreferences } from "@/features/replay/preferences";

/** 只在相同来源及明确同场范围复用快照，不按同名首领猜测。 */
export function reviewScopeMatches(recording: LocalRecording, scope: { pullId: string; battleKey: string | null; source?: "local" | "cloud" }) {
  return (recording.sourceKind === "cloud") === (scope.source === "cloud") && (recording.pullId === scope.pullId || !!scope.battleKey && recording.battleKey === scope.battleKey);
}

/** 优先回看死前窗口，缺片时仅退到实际覆盖的死亡点，否则禁用视角入口。 */
export function reviewViewTarget(recording: LocalRecording, scope: { pullId: string; battleKey: string | null; source?: "local" | "cloud" }, review: DeathReview,
  preferences: Pick<ReplayPreferences, "offsetsMs" | "offsetVersions">): number | null {
  if (!reviewScopeMatches(recording, scope) || !recording.playbackUrl || !["ready", "partial"].includes(recording.state)) return null;
  for (const time of [review.windowStartMs, review.death.pullTimeMs]) {
    if (pullToVideo(recording, time / 1000, effectiveOffset(recording, preferences)).kind === "mapped") return time / 1000;
  }
  return null;
}
