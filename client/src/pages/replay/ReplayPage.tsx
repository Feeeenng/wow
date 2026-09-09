import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Button, Empty, Spin } from "antd";
import { useLocalRecordings } from "@/features/recording/useLocalRecordings";
import { EventTimeline } from "@/pages/replay/components/EventTimeline";
import { RecordingPanel } from "@/pages/replay/components/RecordingPanel";
import { ReplayHeader } from "@/pages/replay/components/ReplayHeader";
import { ReplayPlayer } from "@/pages/replay/components/ReplayPlayer";
import {
  encounterEndVideoSeconds,
  encounterStartVideoSeconds,
  isRecordingPlayable,
  recordingDurationSeconds,
} from "@/pages/replay/model";

/** 组合本地录像列表、HLS 播放器与 CombatLog Pull 边界时间轴。 */
export function ReplayPage() {
  const { recordings, loading, refreshing, error, refresh } = useLocalRecordings();
  const [selectedPullId, setSelectedPullId] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [mediaDuration, setMediaDuration] = useState(0);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const recording = recordings.find((item) => item.pullId === selectedPullId) ?? null;

  useEffect(() => {
    if (recordings.length === 0) {
      setSelectedPullId(null);
      return;
    }
    if (!recordings.some((item) => item.pullId === selectedPullId)) {
      setSelectedPullId(recordings[0].pullId);
    }
  }, [recordings, selectedPullId]);

  useEffect(() => {
    setCurrentTime(0);
    setMediaDuration(recording ? recordingDurationSeconds(recording) : 0);
    setPlaybackError(null);
  }, [recording?.pullId]);

  const handleRecordingChange = (pullId: string) => {
    setSelectedPullId(pullId);
  };

  const handleTimeChange = (time: number) => {
    const video = videoRef.current;
    if (video && Number.isFinite(time)) {
      const duration = mediaDuration || (recording ? recordingDurationSeconds(recording) : 0);
      const nextTime = Math.min(Math.max(0, time), duration);
      video.currentTime = nextTime;
      setCurrentTime(nextTime);
    }
  };

  const handleCurrentTimeChange = useCallback((time: number) => {
    setCurrentTime(time);
  }, []);
  const handleDurationChange = useCallback((duration: number) => {
    setMediaDuration(duration);
  }, []);
  const handlePlaybackError = useCallback((message: string | null) => {
    setPlaybackError(message);
  }, []);

  return (
    <div className="mx-auto w-full max-w-[1420px] space-y-4">
      <ReplayHeader
        recording={recording}
        recordings={recordings}
        selectedPullId={selectedPullId}
        refreshing={refreshing}
        onRecordingChange={handleRecordingChange}
        onRefresh={() => void refresh()}
      />

      {error && (
        <Alert
          type="error"
          showIcon
          message="读取本地录像失败"
          description={error}
          action={<Button size="small" onClick={() => void refresh()}>重新读取</Button>}
        />
      )}

      {loading ? (
        <section className="flex min-h-[520px] items-center justify-center rounded-[6px] border border-[var(--app-border)] bg-[var(--app-surface)]">
          <Spin tip="正在读取本地录像" size="large" />
        </section>
      ) : recording ? (
        <div className="grid min-w-0 grid-cols-[minmax(180px,220px)_minmax(0,1fr)] gap-4 max-[1180px]:grid-cols-1">
          <RecordingPanel recording={recording} />
          <div className="min-w-0 space-y-4">
            <ReplayPlayer
              recording={recording}
              videoRef={videoRef}
              playbackError={playbackError}
              onCurrentTimeChange={handleCurrentTimeChange}
              onDurationChange={handleDurationChange}
              onPlaybackError={handlePlaybackError}
            />
            <EventTimeline
              currentTime={currentTime}
              duration={mediaDuration || recordingDurationSeconds(recording)}
              encounterStartTime={encounterStartVideoSeconds(recording)}
              encounterEndTime={encounterEndVideoSeconds(recording)}
              success={recording.success}
              disabled={recording.state === "partial" || !isRecordingPlayable(recording) || playbackError !== null}
              onTimeChange={handleTimeChange}
            />
          </div>
        </div>
      ) : (
        <section className="flex min-h-[520px] items-center justify-center rounded-[6px] border border-[var(--app-border)] bg-[var(--app-surface)] px-6">
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前没有本地 Boss 录像" />
        </section>
      )}
    </div>
  );
}
