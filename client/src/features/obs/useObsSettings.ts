import { useCallback, useEffect, useState } from "react";
import type {
  ObsAudioInput,
  ObsCaptureSettings,
  ObsInstallationStatus,
  ObsSettingsSnapshot,
  ObsStatus,
  ObsVideoSettings,
} from "@/features/obs/model";
import {
  defaultCaptureSettings,
  defaultInstallationStatus,
  defaultVideoSettings,
  disconnectedObsStatus,
} from "@/features/obs/model";
import { obsService } from "@/features/obs/obsService";

/** 管理设置页的 OBS 安装、连接、配置与录制状态。 */
export function useObsSettingsController() {
  const [status, setStatus] = useState<ObsStatus>(disconnectedObsStatus);
  const [installation, setInstallation] = useState<ObsInstallationStatus>(defaultInstallationStatus);
  const [video, setVideo] = useState<ObsVideoSettings>(defaultVideoSettings);
  const [capture, setCapture] = useState<ObsCaptureSettings>(defaultCaptureSettings);
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

  const applySnapshot = useCallback((snapshot: ObsSettingsSnapshot) => {
    setVideo(snapshot.video);
    setCapture(snapshot.capture);
    setAudioInputs(snapshot.audioInputs);
  }, []);

  const refresh = useCallback(async () => {
    const [nextInstallation, nextStatus] = await Promise.all([
      obsService.installation(),
      obsService.status(),
    ]);
    setInstallation(nextInstallation);
    setStatus(nextStatus);
    setError(nextStatus.error);
    if (nextStatus.connected) {
      applySnapshot(await obsService.settingsSnapshot());
    }
  }, [applySnapshot]);

  useEffect(() => {
    let active = true;
    void run("refresh", async () => {
      const cached = await obsService.cachedSettings();
      if (active && cached) {
        applySnapshot(cached);
      }
      if (active) {
        await refresh();
      }
    });
    const timer = window.setInterval(() => {
      void refresh().catch((reason) => {
        setError(reason instanceof Error ? reason.message : String(reason));
      });
    }, 2000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [applySnapshot, refresh, run]);

  return {
    status,
    installation,
    video,
    capture,
    audioInputs,
    busyAction,
    error,
    refresh: () => run("refresh", refresh),
    install: () => run("install", async () => {
      setInstallation(await obsService.install());
    }),
    setVideo: (nextVideo: ObsVideoSettings) => run("video", async () => {
      await obsService.setVideoSettings(nextVideo);
      applySnapshot(await obsService.settingsSnapshot());
    }),
    setCapture: (nextCapture: ObsCaptureSettings) => run("capture", async () => {
      await obsService.configureGameCapture(nextCapture);
      applySnapshot(await obsService.settingsSnapshot());
    }),
    setAudio: (inputName: string, enabled: boolean, volumePercent: number, sourceId?: string) =>
      run(`audio-${inputName}`, async () => {
        await obsService.setAudioSettings({ inputName, enabled, volumePercent, sourceId: sourceId ?? null });
        applySnapshot(await obsService.settingsSnapshot());
      }),
    toggleRecording: () => run("recording", async () => {
      setStatus(status.recordingActive ? await obsService.stopRecording() : await obsService.startRecording());
    }),
    toggleLive: () => run("live", async () => {
      if (status.liveActive) {
        await obsService.stopLive();
      } else {
        await obsService.startLive();
      }
      setStatus(await obsService.status());
    }),
    chooseRecordDirectory: () => run("record-directory", async () => {
      const directory = await obsService.chooseRecordDirectory(status.outputDirectory);
      if (!directory) {
        return;
      }
      await obsService.setRecordDirectory(directory);
      setStatus(await obsService.status());
    }),
  };
}
