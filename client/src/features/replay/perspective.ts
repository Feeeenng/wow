import type { LocalRecording } from "@/shared/replay/model";

/** 仅明确属于同一报告战斗或同一日志区间的录像可作为视角切换，不按 Boss 和近似时间猜测。 */
export function sameBattle(current: LocalRecording | null, next: LocalRecording): boolean {
  return Boolean(current?.battleKey && next.battleKey && current.battleKey === next.battleKey);
}
