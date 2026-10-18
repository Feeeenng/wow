import type { ManagedRecording } from "@/features/recording/management";
import { formatRecordingTime, isRecordingPlayable } from "@/pages/replay/model";

export type LibraryStatus = "all" | "playable" | "busy" | "failed";

/** 管理页搜索沿用中国标准时间，仅筛选本地摘要，不读取或转换原片。 */
export function filterLibrary(recordings: ManagedRecording[], search: string, status: LibraryStatus, favoritesOnly: boolean) {
  const query = search.trim().toLocaleLowerCase();
  return recordings.filter((recording) => {
    if (favoritesOnly && !recording.isFavorited) return false;
    if (query && !`${recording.encounterName} ${recording.playerName ?? ""} ${formatRecordingTime(recording.encounterStartUnixMs)}`.toLocaleLowerCase().includes(query)) return false;
    if (status === "playable") return isRecordingPlayable(recording);
    if (status === "failed") return recording.state === "failed" || recording.state === "interrupted";
    if (status === "busy") return !["ready", "partial", "failed", "interrupted"].includes(recording.state);
    return true;
  });
}

export function formatManagedBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}
