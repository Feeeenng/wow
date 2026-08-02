/** 浏览器建立 WebRTC 连接所需的 ICE 服务信息。 */
export interface LiveIceServer {
  urls: string[];
  username: string | null;
  credential: string | null;
}

/** Rust 返回的正式直播会话及其本地录像归属。 */
export interface PersonalLiveSession {
  sessionId: string;
  startedAtUnixMs: number;
  recordingActive: boolean;
  recordingStartedBySession: boolean;
  iceServers: LiveIceServer[];
}

/** Rust 完成 WHEP 信令后返回的远端 SDP。 */
export interface WhepAnswer {
  playbackId: string;
  answerSdp: string;
}
