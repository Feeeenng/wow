import { useEffect, useRef } from "react";
import {
  ICE_GATHERING_TIMEOUT_MS,
  WHEP_RECONNECT_INITIAL_DELAY_MS,
  WHEP_RECONNECT_MAX_DELAY_MS,
} from "@/features/live/config";
import { liveService } from "@/features/live/liveService";
import type { PersonalLiveSession } from "@/features/live/model";

interface WhepVideoProps {
  session: PersonalLiveSession;
  visible: boolean;
  onPlayingChange: (playing: boolean) => void;
  onAudioAvailabilityChange: (available: boolean) => void;
  onVolumeChange: (volumePercent: number) => void;
  onPlaybackError: (message: string) => void;
}

/** 等待非 Trickle WHEP Offer 收集完整 ICE 候选。 */
function waitForIceGathering(peer: RTCPeerConnection): Promise<void> {
  if (peer.iceGatheringState === "complete") {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      peer.removeEventListener("icegatheringstatechange", handleChange);
      reject(new Error("收集直播网络候选超时"));
    }, ICE_GATHERING_TIMEOUT_MS);
    const handleChange = () => {
      if (peer.iceGatheringState === "complete") {
        window.clearTimeout(timeout);
        peer.removeEventListener("icegatheringstatechange", handleChange);
        resolve();
      }
    };
    peer.addEventListener("icegatheringstatechange", handleChange);
  });
}

/** 判断媒体发布路径稍后就绪后可以恢复的 WHEP 信令错误。 */
function isRetryablePlaybackError(reason: unknown): boolean {
  const message = reason instanceof Error ? reason.message : String(reason);
  return /HTTP (404|409|503)\b/.test(message);
}

/** 等待下一轮建连，并允许直播停止时立即结束等待。 */
function waitForReconnect(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      window.clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = window.setTimeout(finish, delayMs);
    signal.addEventListener("abort", finish, { once: true });
  });
}

/** 使用 WHEP 接收云端直播流，并挂载到 Media Chrome 的原生视频元素。 */
export function WhepVideo({
  session,
  visible,
  onPlayingChange,
  onAudioAvailabilityChange,
  onVolumeChange,
  onPlaybackError,
}: WhepVideoProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mutedBeforeHiddenRef = useRef(true);

  // 页面隐藏时继续解码以便即时恢复，但不能在其他页面继续播放声音。
  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    if (visible) {
      video.muted = mutedBeforeHiddenRef.current;
      void video.play().catch(() => undefined);
      return;
    }
    mutedBeforeHiddenRef.current = video.muted;
    video.muted = true;
  }, [visible]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !window.RTCPeerConnection) {
      onPlaybackError("当前 WebView 不支持 WebRTC 直播播放");
      return;
    }
    video.muted = true;
    let active = true;
    let peer: RTCPeerConnection | null = null;
    let playbackId: string | null = null;
    const abortController = new AbortController();

    const closePeer = (target: RTCPeerConnection) => {
      target.ontrack = null;
      target.onconnectionstatechange = null;
      target.close();
      if (peer === target) {
        peer = null;
      }
    };

    const releasePlayback = async (id: string) => {
      try {
        await liveService.releasePlayback(id);
      } catch {
        // 服务端会在停止直播时统一回收残留资源，清理失败不能阻断重连。
      }
    };

    const connect = async () => {
      let reconnectDelay = WHEP_RECONNECT_INITIAL_DELAY_MS;
      while (active) {
        const remoteStream = new MediaStream();
        const currentPeer = new RTCPeerConnection({
          iceServers: session.iceServers.map((server) => ({
            urls: server.urls,
            username: server.username ?? undefined,
            credential: server.credential ?? undefined,
          })),
        });
        peer = currentPeer;
        let currentPlaybackId: string | null = null;

        currentPeer.addTransceiver("video", { direction: "recvonly" });
        currentPeer.addTransceiver("audio", { direction: "recvonly" });
        currentPeer.ontrack = (event) => {
          if (!active || peer !== currentPeer) {
            return;
          }
          if (!remoteStream.getTracks().some((track) => track.id === event.track.id)) {
            remoteStream.addTrack(event.track);
          }
          video.srcObject = event.streams[0] ?? remoteStream;
          if (event.track.kind === "audio") {
            onAudioAvailabilityChange(true);
          }
          void video.play().catch(() => undefined);
        };
        currentPeer.onconnectionstatechange = () => {
          if (active && peer === currentPeer && currentPeer.connectionState === "failed") {
            onPlaybackError("直播 WebRTC 连接失败");
          }
        };

        try {
          const offer = await currentPeer.createOffer();
          await currentPeer.setLocalDescription(offer);
          await waitForIceGathering(currentPeer);
          const offerSdp = currentPeer.localDescription?.sdp;
          if (!offerSdp) {
            throw new Error("浏览器未生成直播 SDP Offer");
          }
          const answer = await liveService.negotiatePlayback(session.sessionId, offerSdp);
          currentPlaybackId = answer.playbackId;
          if (!active || peer !== currentPeer) {
            await releasePlayback(answer.playbackId);
            closePeer(currentPeer);
            return;
          }
          await currentPeer.setRemoteDescription({ type: "answer", sdp: answer.answerSdp });
          playbackId = answer.playbackId;
          return;
        } catch (reason) {
          closePeer(currentPeer);
          if (currentPlaybackId) {
            await releasePlayback(currentPlaybackId);
          }
          if (!active) {
            return;
          }
          if (!isRetryablePlaybackError(reason)) {
            onPlaybackError(reason instanceof Error ? reason.message : String(reason));
            return;
          }
          await waitForReconnect(reconnectDelay, abortController.signal);
          reconnectDelay = Math.min(reconnectDelay * 2, WHEP_RECONNECT_MAX_DELAY_MS);
        }
      }
    };

    void connect();
    return () => {
      active = false;
      abortController.abort();
      onAudioAvailabilityChange(false);
      video.srcObject = null;
      if (peer) {
        closePeer(peer);
      }
      if (playbackId) {
        void releasePlayback(playbackId);
      }
    };
  }, [session, onAudioAvailabilityChange, onPlaybackError]);

  return (
    <video
      ref={videoRef}
      slot="media"
      className="h-full w-full object-cover"
      autoPlay
      playsInline
      onPlaying={() => onPlayingChange(true)}
      onPause={() => onPlayingChange(false)}
      onWaiting={() => onPlayingChange(false)}
      onVolumeChange={(event) => onVolumeChange(Math.round(event.currentTarget.volume * 100))}
    />
  );
}
