import type { VideoAnnotation } from "@/shared/annotations/model";
import type { PointerEvent } from "react";

interface Props { item: VideoAnnotation; width: number; height: number; selected: boolean; onSelect: (event: PointerEvent<SVGGElement>) => void; selectable: boolean; }

/** SVG 仅由受限图形字段生成，文字直接作为文本节点，不接受 HTML 或任意路径。 */
export function AnnotationShape({ item, width, height, selected, onSelect, selectable }: Props) {
  const points = item.points.map((point) => ({ x: point.x * width, y: point.y * height }));
  const first = points[0], last = points.at(-1);
  if (!first || !last) return null;
  const common = { stroke: item.color, strokeWidth: item.width, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, fill: "none" };
  const x = Math.min(first.x, last.x), y = Math.min(first.y, last.y), w = Math.abs(last.x - first.x), h = Math.abs(last.y - first.y);
  const angle = Math.atan2(last.y - first.y, last.x - first.x), size = 10 + item.width * 2;
  return <g data-annotation-id={item.id} data-annotation-kind={item.kind} style={{ pointerEvents: selectable ? "all" : "none", cursor: selectable ? "pointer" : undefined }}
    onPointerDown={selectable ? (event) => { event.stopPropagation(); onSelect(event); } : undefined}>
    {item.kind === "pen" && <polyline {...common} points={points.map((point) => `${point.x},${point.y}`).join(" ")} />}
    {item.kind === "arrow" && <><line {...common} x1={first.x} y1={first.y} x2={last.x} y2={last.y} />
      <polygon fill={item.color} points={`${last.x},${last.y} ${last.x - size * Math.cos(angle - Math.PI / 6)},${last.y - size * Math.sin(angle - Math.PI / 6)} ${last.x - size * Math.cos(angle + Math.PI / 6)},${last.y - size * Math.sin(angle + Math.PI / 6)}`} /></>}
    {item.kind === "rect" && <rect {...common} x={x} y={y} width={w} height={h} />}
    {item.kind === "ellipse" && <ellipse {...common} cx={(first.x + last.x) / 2} cy={(first.y + last.y) / 2} rx={w / 2} ry={h / 2} />}
    {item.kind === "text" && <text x={first.x} y={first.y} fill={item.color} fontSize={16} fontWeight="600">{item.text.split("\n").map((line, index) => <tspan key={index} x={first.x} dy={index ? 19 : 0}>{line}</tspan>)}</text>}
    {item.kind === "marker" && <><circle cx={first.x} cy={first.y} r={10} fill={item.color} stroke="white" strokeWidth={1} />
      <text x={first.x} y={first.y + 4} fill="white" fontSize={12} textAnchor="middle">●</text>
      <text x={first.x + 15} y={first.y + 5} fill={item.color} fontSize={16} fontWeight="600">{item.text || "标记"}</text></>}
    {selected && <rect x={x - 5} y={y - 5} width={Math.max(10, w + 10)} height={Math.max(10, h + 10)} fill="none" stroke="white" strokeWidth={1} strokeDasharray="4 3" />}
  </g>;
}
