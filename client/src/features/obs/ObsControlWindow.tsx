import { useState } from "react";
import { Button, Input, InputNumber } from "antd";
import { CircleDot, Link2, Radio, RefreshCw, Square, Video } from "lucide-react";
import { WindowControls } from "@/components/layout/WindowControls";
import { useObsConnection } from "@/features/obs/useObsConnection";
import "@/features/obs/ObsControlWindow.css";

/** 独立 OBS WebSocket 连接与录制控制窗口。 */
export function ObsControlWindow() {
  const [host, setHost] = useState("127.0.0.1");
  const [port, setPort] = useState(4455);
  const [password, setPassword] = useState("");
  const { status, busy, error, refresh, connect, disconnect, startRecording, stopRecording } = useObsConnection();

  return (
    <div className="obs-window">
      <header data-tauri-drag-region><div><Video size={19} /><strong>OBS 连接与录制</strong></div><WindowControls /></header>
      <main>
        <section className="obs-window-status">
          <div className={status.connected ? "connected" : ""}><CircleDot size={18} /><span>{status.connected ? "OBS WebSocket 已连接" : "等待连接 OBS Studio"}</span></div>
          <Button icon={<RefreshCw size={14} />} loading={busy} onClick={() => void refresh()}>刷新状态</Button>
        </section>
        <section className="obs-connect-form">
          <h2>连接设置</h2>
          <div className="obs-field-row"><label>主机地址<Input value={host} onChange={(event) => setHost(event.target.value)} disabled={status.connected} /></label><label>端口<InputNumber min={1} max={65535} value={port} onChange={(value) => setPort(value ?? 4455)} disabled={status.connected} /></label></div>
          <label>WebSocket 密码<Input.Password value={password} placeholder="在 OBS 工具 → WebSocket 服务器设置中查看" onChange={(event) => setPassword(event.target.value)} disabled={status.connected} /></label>
          <div className="obs-connect-actions">
            {status.connected ? <Button danger onClick={() => void disconnect()} loading={busy}>断开连接</Button> : <Button type="primary" icon={<Link2 size={15} />} onClick={() => void connect({ host, port, password })} loading={busy}>连接 OBS</Button>}
            <span>仅允许连接本机 OBS WebSocket 5.x</span>
          </div>
          {error && <p className="obs-window-error">{error}</p>}
        </section>
        <section className="obs-record-control">
          <div><h2>录制控制</h2><p>OBS {status.obsVersion ?? "未检测"} · WebSocket {status.websocketVersion ?? "未检测"}</p></div>
          <div className="record-state"><Radio size={17} /><strong>{status.recordingActive ? "正在录制" : "待机中"}</strong></div>
          <div className="record-buttons">
            <Button type="primary" icon={<Video size={15} />} disabled={!status.connected || status.recordingActive} loading={busy} onClick={() => void startRecording()}>开始测试录制</Button>
            <Button icon={<Square size={14} />} disabled={!status.connected || !status.recordingActive} loading={busy} onClick={() => void stopRecording()}>停止录制</Button>
          </div>
          <div className="output-path"><span>最近输出文件</span><strong>{status.outputPath ?? "尚无输出文件"}</strong></div>
        </section>
      </main>
    </div>
  );
}
