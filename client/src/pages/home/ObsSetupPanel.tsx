import { useEffect, useRef, useState } from "react";
import { Button, Input, Select } from "antd";
import {
  Check,
  CircleDot,
  FolderOpen,
  RefreshCw,
  ShieldCheck,
  Video,
} from "lucide-react";
import {
  bitrateOptions,
  encoderOptions,
  frameRateOptions,
  resolutionOptions,
} from "./options";
import type { ObsConnectionState, TestRecordingState } from "./types";
import "./ObsSetupPanel.css";

const DEFAULT_RECORDING_PATH = "D:\\WoW\\Recordings";

/** 提供参考图中的 OBS 参数面板与前端模拟检测。 */
export function ObsSetupPanel() {
  const [connectionState, setConnectionState] =
    useState<ObsConnectionState>("connected");
  const [recordingState, setRecordingState] =
    useState<TestRecordingState>("idle");
  const [encoder, setEncoder] = useState("nvenc-h264");
  const [recordingPath, setRecordingPath] = useState(DEFAULT_RECORDING_PATH);
  const timers = useRef<number[]>([]);

  useEffect(
    () => () => timers.current.forEach((timer) => window.clearTimeout(timer)),
    [],
  );

  /** 模拟重新探测 OBS 进程并恢复已连接状态。 */
  const detectObs = () => {
    setConnectionState("detecting");
    timers.current.push(
      window.setTimeout(() => setConnectionState("connected"), 900),
    );
  };

  /** 模拟短测试录制并展示检查结果。 */
  const startTestRecording = () => {
    setRecordingState("recording");
    timers.current.push(
      window.setTimeout(() => setRecordingState("complete"), 2400),
    );
  };

  return (
    <section className="dashboard-panel obs-panel" aria-labelledby="obs-panel-title">
      <div className="panel-heading">
        <div>
          <h2 id="obs-panel-title"><Video aria-hidden="true" /> OBS 设置</h2>
          <p>配置 OBS 推流与录制参数</p>
        </div>
        <span className={`status-pill status-${connectionState}`}>
          <CircleDot size={13} />
          {connectionState === "detecting" ? "检测中" : "已连接"}
        </span>
      </div>

      <div className="obs-settings">
        <div className="connection-row">
          <span>连接状态</span>
          <strong><i className={`connection-light ${connectionState}`} /> OBS 31.0.2 (64-bit)</strong>
          <Button
            icon={<RefreshCw size={14} />}
            loading={connectionState === "detecting"}
            onClick={detectObs}
          >
            重新检测
          </Button>
        </div>

        <label className="setting-field">
          <span>视频编码器</span>
          <Select
            aria-label="视频编码器"
            value={encoder}
            options={encoderOptions}
            onChange={setEncoder}
          />
        </label>
        <label className="setting-field">
          <span>输出分辨率</span>
          <Select aria-label="输出分辨率" defaultValue="1920x1080" options={resolutionOptions} />
        </label>
        <label className="setting-field">
          <span>帧率 (FPS)</span>
          <Select aria-label="帧率" defaultValue="60" options={frameRateOptions} />
        </label>
        <label className="setting-field">
          <span>视频码率</span>
          <Select aria-label="视频码率" defaultValue="8000" options={bitrateOptions} />
        </label>
        <label className="setting-field">
          <span>录制路径</span>
          <Input
            aria-label="录制路径"
            value={recordingPath}
            prefix={<FolderOpen size={14} />}
            onChange={(event) => setRecordingPath(event.target.value)}
          />
        </label>

        <div className="test-recording-row">
          <Button
            type="primary"
            icon={recordingState === "complete" ? <Check size={15} /> : <ShieldCheck size={15} />}
            loading={recordingState === "recording"}
            disabled={connectionState !== "connected"}
            onClick={startTestRecording}
          >
            {recordingState === "complete" ? "测试录制正常" : "开始测试录制"}
          </Button>
          <p>
            {recordingState === "recording"
              ? "正在验证画面与编码参数"
              : recordingState === "complete"
                ? "画面与编码参数检查完成"
                : "进行 30 秒测试录制，验证配置是否正常"}
          </p>
        </div>
      </div>

      <div className="obs-diagnostics">
        <span><i /> OBS 未运行</span>
        <span><i /> 推流：未检测到</span>
        <span><i /> 录制：未检测到</span>
      </div>
    </section>
  );
}
