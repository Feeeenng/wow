import type { LocalRecording } from "@/shared/replay/model";
import type { DeathReview } from "@/shared/review/model";
import { pullToVideo } from "@/shared/replay/mapping";
import { effectiveOffset } from "@/shared/replay/calibration";
import type { ReplayPreferences } from "@/features/replay/preferences";

/** 仅当前本地录像或明确同场允许复用死亡快照，不按同名首领猜测。 */
export function reviewScopeMatches(recording: LocalRecording, scope: { pullId: string; battleKey: string | null }) {
  return recording.sourceKind !== "cloud" && (recording.pullId === scope.pullId || !!scope.battleKey && recording.battleKey === scope.battleKey);
}

/** 优先回看死前窗口，缺片时仅退到实际覆盖的死亡点，否则禁用视角入口。 */
export function reviewViewTarget(recording: LocalRecording, scope: { pullId: string; battleKey: string | null }, review: DeathReview,
  preferences: Pick<ReplayPreferences, "offsetsMs" | "offsetVersions">): number | null {
  if (!reviewScopeMatches(recording, scope) || !recording.playbackUrl || !["ready", "partial"].includes(recording.state)) return null;
  for (const time of [review.windowStartMs, review.death.pullTimeMs]) {
    if (pullToVideo(recording, time / 1000, effectiveOffset(recording, preferences)).kind === "mapped") return time / 1000;
  }
  return null;
}
