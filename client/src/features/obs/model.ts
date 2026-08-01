export interface ObsConnectRequest {
  host: string;
  port: number;
  password: string;
}

export interface ObsStatus {
  connected: boolean;
  obsVersion: string | null;
  websocketVersion: string | null;
  recordingActive: boolean;
  recordingPaused: boolean;
  outputPath: string | null;
  error: string | null;
}

export const disconnectedObsStatus: ObsStatus = {
  connected: false,
  obsVersion: null,
  websocketVersion: null,
  recordingActive: false,
  recordingPaused: false,
  outputPath: null,
  error: null,
};
