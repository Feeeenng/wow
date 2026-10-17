import type { LocalClipInterval, LocalRecording } from "@/shared/replay/model";

export type ReplayPosition =
  | { kind: "mapped"; seconds: number }
  | { kind: "gap" }
  | { kind: "unavailable" };

/** 缺片旧录像缺少区间依据时保持不可定位，不补造连续时间线。 */
export function replayIntervals(recording: LocalRecording): LocalClipInterval[] {
  const mapping = recording.mapping;
  if (!mapping) return [];
  if (mapping.clockDiscontinuous) return [];
  if (mapping.mediaCalibrated && mapping.intervals.length > 0) {
    return mapping.intervals;
  }
  if (mapping.hasGap) return [];
  const duration = mapping.mediaDurationMs ?? (mapping.actualEndUnixMs - mapping.actualStartUnixMs);
  if (duration <= 0) return [];
  return [{
    pullStartMs: -mapping.videoZeroMs,
    pullEndMs: duration - mapping.videoZeroMs,
    videoStartMs: 0,
    videoEndMs: duration,
  }];
}

/** 以同一分段契约换算双向时间，用户正偏移表示视频向后移动。 */
function mapPosition(
  recording: LocalRecording, seconds: number, offsetMs: number, reverse: boolean,
): ReplayPosition {
  if (!Number.isFinite(seconds) || !Number.isFinite(offsetMs)) return { kind: "unavailable" };
  const intervals = replayIntervals(recording);
  if (intervals.length === 0) return { kind: "unavailable" };
  const value = seconds * 1_000 - (reverse ? offsetMs : 0);
  const interval = intervals.find((item) => {
    const start = reverse ? item.videoStartMs : item.pullStartMs;
    const end = reverse ? item.videoEndMs : item.pullEndMs;
    return value >= start && value < end;
  });
  if (!interval) return { kind: "gap" };
  // 微调不能把原片段内的事件或画面推到另一拼接片段，缺失部分仍保持不可定位。
  if (reverse && (seconds * 1_000 < interval.videoStartMs || seconds * 1_000 >= interval.videoEndMs)) return { kind: "gap" };
  const sourceStart = reverse ? interval.videoStartMs : interval.pullStartMs;
  const sourceEnd = reverse ? interval.videoEndMs : interval.pullEndMs;
  const targetStart = reverse ? interval.pullStartMs : interval.videoStartMs;
  const targetEnd = reverse ? interval.pullEndMs : interval.videoEndMs;
  if (sourceEnd <= sourceStart || targetEnd <= targetStart) return { kind: "unavailable" };
  const target = targetStart + (value - sourceStart) * (targetEnd - targetStart) / (sourceEnd - sourceStart)
    + (reverse ? 0 : offsetMs);
  if (!reverse && (target < interval.videoStartMs || target >= interval.videoEndMs || target < 0 || (recording.mapping?.mediaDurationMs != null
    && target >= recording.mapping.mediaDurationMs))) return { kind: "gap" };
  return { kind: "mapped", seconds: target / 1_000 };
}

/** 将统一战斗时间映射到当前录像；缺片时返回 gap。 */
export function pullToVideo(recording: LocalRecording, seconds: number, offsetMs = 0) {
  return mapPosition(recording, seconds, offsetMs, false);
}

/** 将播放器时间反算为战斗时间，不把拼接后的缺口压缩到战斗轴。 */
export function videoToPull(recording: LocalRecording, seconds: number, offsetMs = 0) {
  return mapPosition(recording, seconds, offsetMs, true);
}
