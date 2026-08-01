import { Button } from "antd";
import { CircleDot, ExternalLink, Radio, Video } from "lucide-react";
import { obsService } from "@/features/obs/obsService";
import { useObsConnection } from "@/features/obs/useObsConnection";
import "@/features/obs/ObsSummaryPanel.css";

/** 展示首页 OBS 摘要并打开独立控制子窗口。 */
export function ObsSummaryPanel() {
  const { status, busy, refresh } = useObsConnection();
  const openControl = () => void obsService.openControlWindow();

  return (
    <section className="ornate-panel obs-summary" aria-labelledby="obs-panel-title">
      <div className="panel-heading">
        <div><h2 id="obs-panel-title"><Video /> OBS 设置</h2><p>连接 OBS Studio 并控制录制</p></div>
        <span className={`status-pill ${status.connected ? "" : "offline"}`}><CircleDot size={13} />{status.connected ? "已连接" : "未连接"}</span>
      </div>
      <div className="obs-summary-rows">
        <div><span>连接状态</span><strong><i className={status.connected ? "online" : ""} />{status.connected ? `OBS ${status.obsVersion}` : "等待连接 OBS Studio"}</strong><Button loading={busy} onClick={() => void refresh()}>重新检测</Button></div>
        <div><span>控制方式</span><strong>OBS WebSocket 5.x</strong><small>127.0.0.1:4455</small></div>
        <div><span>视频编码器</span><strong>NVIDIA NVENC (H.264)</strong><small>由 OBS 配置</small></div>
        <div><span>输出分辨率</span><strong>1920 × 1080 (16:9)</strong><small>60 FPS</small></div>
        <div><span>录制状态</span><strong>{status.recordingActive ? "正在录制" : "待机中"}</strong><small>{status.outputPath ?? "尚无输出文件"}</small></div>
      </div>
      <div className="obs-summary-action">
        <Button type="primary" icon={<ExternalLink size={15} />} onClick={openControl}>打开 OBS 控制</Button>
        <p>在独立窗口中连接 OBS WebSocket 并测试录制</p>
      </div>
      <div className="obs-diagnostics"><span><Radio size={13} /> OBS {status.connected ? "已连接" : "未连接"}</span><span>WebSocket：{status.websocketVersion ?? "未检测"}</span><span>录制：{status.recordingActive ? "进行中" : "未开始"}</span></div>
    </section>
  );
}
