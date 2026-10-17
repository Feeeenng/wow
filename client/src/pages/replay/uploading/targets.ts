import type { LocalRecording } from "@/shared/replay/model";

export interface TeamPullTarget { id: string; encounterName: string; startedAtUnixMs: number; recordingCount: number; }

/** 只列明确团队场次身份且首领／难度相同的元数据，时间不用于自动关联。 */
export function uploadTargets(records: LocalRecording[], recording: LocalRecording): TeamPullTarget[] {
  const targets = new Map<string, TeamPullTarget>();
  for (const item of records) {
    const id = item.cloudTeamPullId;
    if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
      || item.encounterId !== recording.encounterId || item.difficultyId !== recording.difficultyId) continue;
    const previous = targets.get(id);
    if (previous) previous.recordingCount++;
    else targets.set(id, { id, encounterName: item.encounterName, startedAtUnixMs: item.encounterStartUnixMs, recordingCount: 1 });
  }
  return [...targets.values()];
}
