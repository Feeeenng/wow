import type { LocalRecording, LocalRecordingState } from "@/shared/replay/model";

const difficultyNames: Record<number, string> = {
  14: "普通",
  15: "英雄",
  16: "史诗",
  17: "随机团队",
};

const stateLabels: Record<LocalRecordingState, string> = {
  recording: "录制中",
  waitingForTail: "正在保留结束画面",
  waitingForSource: "等待录像文件",
  waitingForPlayback: "正在生成播放文件",
  processing: "处理中",
  ready: "可回放",
  partial: "可回放但存在缺片",
  failed: "处理失败",
  interrupted: "录像已中断",
};

/** 将 WoW 难度 ID 转换为本地回放展示名称。 */
export function formatDifficulty(difficultyId: number) {
  return difficultyNames[difficultyId] ?? `难度 ${difficultyId}`;
}

/** 将 Unix 毫秒按项目统一的中国标准时间展示。 */
export function formatRecordingTime(unixMs: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .format(new Date(unixMs))
    .replaceAll("/", "-");
}

/** 返回录像当前处理阶段的中文说明。 */
export function recordingStateLabel(state: LocalRecordingState) {
  return stateLabels[state];
}

/** 只有完成 HLS 产物的完整或缺片录像可以进入播放器。 */
export function isRecordingPlayable(recording: LocalRecording) {
  return (
    (recording.state === "ready" || recording.state === "partial")
    && recording.playbackUrl !== null
  );
}

/** 团队文件上传、处理和发布分开显示，状态 ready 仍需真实播放地址。 */
export function recordingStatusLabel(recording: LocalRecording) {
  switch (recording.cloudStatus) {
    case "pendingUpload": return "等待文件上传";
    case "uploaded": return "文件已上传，待处理";
    case "processing": return "云端处理中";
    case "ready": return isRecordingPlayable(recording) ? "云端可回放" : "等待发布播放文件";
    case "failed": return "云端处理失败";
    default: return recordingStateLabel(recording.state);
  }
}

/** 使用实际映射范围计算本地视频时长，处理阶段则退回请求裁切范围。 */
export function recordingDurationSeconds(recording: LocalRecording) {
  if (recording.mapping) {
    if (recording.mapping.mediaDurationMs != null) return recording.mapping.mediaDurationMs / 1_000;
    return Math.max(0, (recording.mapping.actualEndUnixMs - recording.mapping.actualStartUnixMs) / 1_000);
  }
  if (recording.clipEndUnixMs !== null) {
    return Math.max(0, (recording.clipEndUnixMs - recording.clipStartUnixMs) / 1_000);
  }
  return 0;
}

/** 仅用明确战斗身份折叠多视角，不以首领名或相近时间猜测同场。 */
export function distinctRecordingBattles(recordings: LocalRecording[], selectedPullId: string | null) {
  const battles = new Map<string, LocalRecording>();
  for (const recording of recordings) {
    const key = recording.battleKey ? `battle:${recording.battleKey}` : `pull:${recording.pullId}`;
    if (!battles.has(key) || recording.pullId === selectedPullId) battles.set(key, recording);
  }
  return [...battles.values()];
}
