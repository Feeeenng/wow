export interface RecordingImportPreferences {
  directory: string;
  logPaths: string[];
}

export interface RecordingImportProgress {
  taskId: string | null;
  status: "idle" | "scanning" | "indexing" | "completed" | "cancelled" | "failed";
  totalRecordings: number;
  processedRecordings: number;
  importedCount: number;
  skippedCount: number;
  failedCount: number;
  bytesRead: number;
  totalBytes: number;
  currentFile: string | null;
  error: string | null;
  issues: string[];
  pullIds: string[];
}

export const emptyImportPreferences: RecordingImportPreferences = { directory: "", logPaths: [] };
export const emptyImportProgress: RecordingImportProgress = {
  taskId: null, status: "idle", totalRecordings: 0, processedRecordings: 0,
  importedCount: 0, skippedCount: 0, failedCount: 0, bytesRead: 0, totalBytes: 0,
  currentFile: null, error: null, issues: [], pullIds: [],
};

/** 导入任务状态轮询间隔；任务由 Rust 持有，页面导航不启动新任务。 */
export const RECORDING_IMPORT_POLL_MS = 500;

export const isImportRunning = (progress: RecordingImportProgress) => progress.status === "scanning" || progress.status === "indexing";
