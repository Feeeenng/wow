import { Button, Slider, Tooltip } from "antd";
import { useRef, useState } from "react";
import type { HistoryRange } from "@/features/live/history/model";

interface Props {
  ranges: HistoryRange[];
  mode: "live" | "history";
  positionMs: number | null;
  error: string | null;
  onSeek: (unixMs: number) => void;
  onLive: () => void;
}

/** 只展示已发布历史区间，缺片目标由控制器拒绝，不把尚未生成的尾部当作可回看。 */
export function LiveHistoryControls({ ranges, mode, positionMs, error, onSeek, onLive }: Props) {
  const start = ranges[0]?.startMs ?? 0;
  const end = ranges.at(-1)?.endMs ?? start;
  const span = Math.max(0, end - start);
  const behind = positionMs === null ? 0 : Math.max(0, (end - positionMs) / 1_000);
  const [preview, setPreview] = useState<number | null>(null);
  const gesture = useRef<{ start: number; span: number } | null>(null);
  return <div className="flex shrink-0 items-center gap-3 border-t border-white/10 bg-[#10151c] px-3 py-1.5 text-xs text-white/75">
    <Tooltip title={error ?? "历史窗口随已发布分片更新，断流缺口不可定位"}>
      <span className="shrink-0">{span > 0 ? `可回看 ${Math.floor(span / 60_000)}:${String(Math.floor(span / 1_000) % 60).padStart(2, "0")}` : "历史片段准备中"}</span>
    </Tooltip>
    <Slider className="!my-1 min-w-12 flex-1" ariaLabelForHandle="直播历史时间" min={0} max={Math.max(gesture.current?.span ?? span, 1)}
      value={preview ?? (mode === "live" || positionMs === null ? span : Math.max(0, positionMs - start))} disabled={span <= 0 || Boolean(error)}
      tooltip={{ formatter: (value) => `距窗口末端 ${Math.round((span - (value ?? 0)) / 1_000)} 秒` }}
      onChange={(value) => { gesture.current ??= { start, span }; setPreview(Number(value)); }}
      onChangeComplete={(value) => { const origin = gesture.current?.start ?? start; gesture.current = null; setPreview(null); onSeek(origin + Number(value)); }} />
    <span className="min-w-14 tabular-nums">{mode === "live" ? "实时" : `回看 -${Math.round(behind)}秒`}</span>
    <Button size="small" type={mode === "live" ? "default" : "primary"} onClick={onLive} disabled={mode === "live"}>返回直播</Button>
  </div>;
}
