import { useEffect, useRef } from "react";
import { ICE_GATHERING_TIMEOUT_MS } from "@/features/live/config";
import { liveService } from "@/features/live/liveService";
import type { PersonalLiveSession } from "@/features/live/model";

interface WhepVideoProps {
  session: PersonalLiveSession;
  onPlayingChange: (playing: boolean) => void;
  onAudioAvailabilityChange: (available: boolean) => void;
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

/** 使用 WHEP 接收云端直播流，并挂载到 Media Chrome 的原生视频元素。 */
export function WhepVideo({
  session,
  onPlayingChange,
  onAudioAvailabilityChange,
  onPlaybackError,
}: WhepVideoProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !window.RTCPeerConnection) {
      onPlaybackError("当前 WebView 不支持 WebRTC 直播播放");
      return;
    }
    let active = true;
    let playbackId: string | null = null;
    const remoteStream = new MediaStream();
    const peer = new RTCPeerConnection({
      iceServers: session.iceServers.map((server) => ({
        urls: server.urls,
        username: server.username ?? undefined,
        credential: server.credential ?? undefined,
      })),
    });

    peer.addTransceiver("video", { direction: "recvonly" });
    peer.addTransceiver("audio", { direction: "recvonly" });
    peer.ontrack = (event) => {
      if (!remoteStream.getTracks().some((track) => track.id === event.track.id)) {
        remoteStream.addTrack(event.track);
      }
      video.srcObject = event.streams[0] ?? remoteStream;
      if (event.track.kind === "audio") {
        onAudioAvailabilityChange(true);
      }
      void video.play().catch(() => undefined);
    };
    peer.onconnectionstatechange = () => {
      if (active && peer.connectionState === "failed") {
        onPlaybackError("直播 WebRTC 连接失败");
      }
    };

    const connect = async () => {
      try {
        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        await waitForIceGathering(peer);
        const offerSdp = peer.localDescription?.sdp;
        if (!offerSdp) {
          throw new Error("浏览器未生成直播 SDP Offer");
        }
        const answer = await liveService.negotiatePlayback(session.sessionId, offerSdp);
        playbackId = answer.playbackId;
        if (!active) {
          await liveService.releasePlayback(answer.playbackId);
          return;
        }
        await peer.setRemoteDescription({ type: "answer", sdp: answer.answerSdp });
      } catch (reason) {
        if (active) {
          onPlaybackError(reason instanceof Error ? reason.message : String(reason));
        }
      }
    };

    void connect();
    return () => {
      active = false;
      onAudioAvailabilityChange(false);
      video.srcObject = null;
      peer.close();
      if (playbackId) {
        void liveService.releasePlayback(playbackId);
      }
    };
  }, [session, onAudioAvailabilityChange, onPlaybackError]);

  return (
    <video
      ref={videoRef}
      slot="media"
      className="h-full w-full object-cover"
      autoPlay
      muted
      playsInline
      onPlaying={() => onPlayingChange(true)}
      onPause={() => onPlayingChange(false)}
      onWaiting={() => onPlayingChange(false)}
    />
  );
}
