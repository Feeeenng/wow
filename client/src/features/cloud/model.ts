export interface CloudTeam {
  teamId: string;
  name: string;
  role: "leader" | "analyst" | "member";
}

export interface CloudIdentity {
  userId: string;
  displayName: string;
  teams: CloudTeam[];
}

export interface CloudSettings {
  connectionKey: string;
  endpoint: string;
  teamId: string | null;
  deviceId: string;
  hasToken: boolean;
  identity: CloudIdentity | null;
}

/** token 仅在用户提交时传给 Rust，读取接口不返回该字段。 */
export interface CloudSettingsInput {
  endpoint: string;
  teamId: string | null;
  token?: string;
}

export interface CloudUploadJob {
  teamPullId?: string | null;
  jobId: string;
  pullId: string;
  origin: string;
  teamId: string;
  encounterName: string;
  intent: "queued" | "paused" | "cancelRequested" | "cancelled" | "completed";
  status: "unverified" | "queued" | "checking" | "hashing" | "registering" | "uploading"
    | "paused" | "cancelling" | "cancelled" | "uploaded" | "failed";
  uploadedBytes: number;
  fileSizeBytes: number;
  recordingStatus: string | null;
  verification: string | null;
  fullFileSha256Verified: boolean;
  error: string | null;
}
