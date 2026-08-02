export interface ObsStatus {
  connected: boolean;
  obsVersion: string | null;
  recordingActive: boolean;
  recordingPaused: boolean;
  liveActive: boolean;
  runtimeSeconds: number;
  outputDirectory: string | null;
  sceneReady: boolean;
  videoReady: boolean;
  captureReady: boolean;
  audioReady: boolean;
  ready: boolean;
  readinessMessage: string;
  error: string | null;
}

export interface ObsInstallationStatus {
  expectedVersion: string;
  installed: boolean;
  installing: boolean;
  installDir: string;
  progressPercent: number;
  installPhase: string;
}

export interface ObsVideoSettings {
  baseWidth: number;
  baseHeight: number;
  outputWidth: number;
  outputHeight: number;
  fpsNumerator: number;
  fpsDenominator: number;
  encoderId: string;
  encoderName: string;
  encoders: ObsSelectOption[];
}

export interface ObsSelectOption {
  id: string;
  name: string;
}

export interface ObsCaptureSettings {
  inputKind: string;
  autoCapture: boolean;
  window: string | null;
  captureCursor: boolean;
  inputKinds: ObsSelectOption[];
  windows: ObsSelectOption[];
}

export interface ObsAudioSettings {
  inputName: string;
  enabled: boolean;
  volumePercent: number;
  sourceId: string | null;
}

export interface ObsAudioSourceOption {
  id: string;
  name: string;
}

export interface ObsAudioInput {
  name: string;
  enabled: boolean;
  volumePercent: number;
  meterDb: number | null;
  kind: "desktop" | "microphone";
  sourceId: string;
  sources: ObsAudioSourceOption[];
}

export interface ObsSettingsSnapshot {
  video: ObsVideoSettings;
  capture: ObsCaptureSettings;
  audioInputs: ObsAudioInput[];
}

export const disconnectedObsStatus: ObsStatus = {
  connected: false,
  obsVersion: null,
  recordingActive: false,
  recordingPaused: false,
  liveActive: false,
  runtimeSeconds: 0,
  outputDirectory: null,
  sceneReady: false,
  videoReady: false,
  captureReady: false,
  audioReady: false,
  ready: false,
  readinessMessage: "等待 OBS 启动",
  error: null,
};

export const defaultInstallationStatus: ObsInstallationStatus = {
  expectedVersion: "32.2.1",
  installed: false,
  installing: false,
  installDir: "客户端安装目录\\obs",
  progressPercent: 0,
  installPhase: "等待安装",
};

export const defaultVideoSettings: ObsVideoSettings = {
  baseWidth: 1920,
  baseHeight: 1080,
  outputWidth: 1920,
  outputHeight: 1080,
  fpsNumerator: 60,
  fpsDenominator: 1,
  encoderId: "",
  encoderName: "",
  encoders: [],
};

export const defaultCaptureSettings: ObsCaptureSettings = {
  inputKind: "game_capture",
  autoCapture: true,
  window: null,
  captureCursor: false,
  inputKinds: [],
  windows: [],
};
