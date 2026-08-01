import { useCallback, useEffect, useState } from "react";
import type { ObsAudioInput, ObsInstallationStatus, ObsStatus, ObsVideoSettings } from "@/features/obs/model";
import { defaultInstallationStatus, defaultVideoSettings, disconnectedObsStatus } from "@/features/obs/model";
import { obsService } from "@/features/obs/obsService";

/** 管理设置页的 OBS 安装、连接、配置与录制状态。 */
export function useObsSettings() {
  const [status, setStatus] = useState<ObsStatus>(disconnectedObsStatus);
  const [installation, setInstallation] = useState<ObsInstallationStatus>(defaultInstallationStatus);
  const [video, setVideo] = useState<ObsVideoSettings>(defaultVideoSettings);
  const [audioInputs, setAudioInputs] = useState<ObsAudioInput[]>([]);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async <T,>(name: string, action: () => Promise<T>) => {
    setBusyAction(name);
    setError(null);
    try {
      return await action();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      return null;
    } finally {
      setBusyAction(null);
    }
  }, []);

  const refresh = useCallback(async () => {
    const [nextInstallation, nextStatus] = await Promise.all([
      obsService.installation(),
      obsService.status(),
    ]);
    setInstallation(nextInstallation);
    setStatus(nextStatus);
    if (nextStatus.connected) {
      const [nextVideo, nextAudio] = await Promise.all([
        obsService.videoSettings(),
        obsService.audioInputs(),
      ]);
      setVideo(nextVideo);
      setAudioInputs(nextAudio);
    } else {
      setAudioInputs([]);
    }
  }, []);

  useEffect(() => {
    void run("refresh", refresh);
    const timer = window.setInterval(() => {
      void refresh().catch((reason) => {
        setError(reason instanceof Error ? reason.message : String(reason));
      });
    }, 2000);
    return () => window.clearInterval(timer);
  }, [refresh, run]);

  return {
    status,
    installation,
    video,
    audioInputs,
    busyAction,
    error,
    refresh: () => run("refresh", refresh),
    install: () => run("install", async () => {
      setInstallation(await obsService.install());
    }),
    setVideo: (nextVideo: ObsVideoSettings) => run("video", async () => {
      await obsService.setVideoSettings(nextVideo);
      setVideo(nextVideo);
    }),
    configureCapture: (captureAnyFullscreen: boolean, windowName: string | null) =>
      run("capture", () => obsService.configureGameCapture({
        captureAnyFullscreen,
        window: windowName,
        captureCursor: false,
      })),
    setAudio: (inputName: string, enabled: boolean, volumePercent: number, sourceId?: string) =>
      run(`audio-${inputName}`, async () => {
        await obsService.setAudioSettings({ inputName, enabled, volumePercent, sourceId: sourceId ?? null });
        setAudioInputs(await obsService.audioInputs());
      }),
    toggleRecording: () => run("recording", async () => {
      setStatus(status.recordingActive ? await obsService.stopRecording() : await obsService.startRecording());
    }),
    openRecordDirectory: () => run("open-record-directory", () => obsService.openRecordDirectory()),
  };
}
