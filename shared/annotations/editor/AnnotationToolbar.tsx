import { Alert, Button, ColorPicker, ConfigProvider, Input, InputNumber, Popconfirm, Select, Switch, Tag } from "antd";
import type { AnnotationDocument, AnnotationKind, VideoAnnotation } from "@/shared/annotations/model";
import { ANNOTATION_MAX_DURATION_SECONDS, ANNOTATION_MAX_ITEMS, ANNOTATION_MAX_TEXT, ANNOTATION_MAX_WIDTH } from "@/shared/annotations/config";
import { formatTime } from "@/shared/replay/markers";

export type DrawingTool = AnnotationKind | "select";
export const drawingToolLabels: Record<DrawingTool, string> = { select: "选择", pen: "画笔", arrow: "箭头", rect: "方框", ellipse: "圆圈", text: "文字", marker: "团队标记" };
export interface AnnotationStyle { color: string; width: number; text: string; durationMs: number; }
interface Props {
  document: AnnotationDocument; expanded: boolean; onToggle: () => void; visible: boolean; onVisible: (visible: boolean) => void;
  tool: DrawingTool; onTool: (tool: DrawingTool) => void; style: AnnotationStyle; onStyle: (style: AnnotationStyle) => void;
  selected: VideoAnnotation | undefined; onSelect: (id: string | undefined) => void;
  onUndo: () => void; onRedo: () => void; onClear: () => void; onDelete: () => void; onSave: () => void; onReload: () => void; disabled: boolean;
  frameUnavailable?: boolean;
}

/** 图形工具与属性只编辑当前录像草稿，保存成功后才显示已保存。 */
export function AnnotationToolbar(props: Props) {
  const { document: documentState, expanded, style, selected } = props;
  const dirty = documentState.items !== documentState.savedItems;
  const locked = props.disabled || !documentState.canEdit || documentState.loading || documentState.saving;
  return <ConfigProvider getPopupContainer={(trigger) => trigger?.closest<HTMLElement>("media-controller") ?? document.body}><div className="annotation-toolbar" data-annotation-toolbar>
    <div className="annotation-toggle">
      {dirty && <Tag>标注未保存</Tag>}
      <Button size="small" aria-label="视频标注工具" onClick={props.onToggle}>{expanded ? "收起标注" : "视频标注"}</Button>
    </div>
    {expanded && <div className="annotation-editor">
      <div className="annotation-controls">
        <Select aria-label="标注工具" className="annotation-medium" size="small" value={props.tool} disabled={locked}
          options={Object.entries(drawingToolLabels).map(([value, label]) => ({ value, label }))} onChange={props.onTool} />
        <ColorPicker aria-label="标注颜色" size="small" disabledAlpha value={style.color} disabled={locked} onChange={(value) => props.onStyle({ ...style, color: value.toHexString().toUpperCase() })} />
        <InputNumber aria-label="标注线宽" size="small" className="annotation-small" min={1} max={ANNOTATION_MAX_WIDTH} value={style.width} disabled={locked} suffix="px" onChange={(value) => { if (value != null) props.onStyle({ ...style, width: value }); }} />
        <InputNumber aria-label="标注显示秒数" size="small" className="annotation-medium" min={1} max={ANNOTATION_MAX_DURATION_SECONDS} value={style.durationMs / 1000} disabled={locked} suffix="秒" onChange={(value) => { if (value != null) props.onStyle({ ...style, durationMs: Math.round(value * 1000) }); }} />
        <Switch size="small" checked={props.visible} onChange={props.onVisible} aria-label="显示视频标注" />
      </div>
      {(props.tool === "text" || props.tool === "marker" || selected?.kind === "text" || selected?.kind === "marker") && <Input aria-label="标注文字" size="small" maxLength={ANNOTATION_MAX_TEXT} value={style.text} disabled={locked} placeholder="输入文字后点击画面"
        onChange={(event) => props.onStyle({ ...style, text: event.target.value })} />}
      <div className="annotation-controls">
        <Select aria-label="选择已有标注" className="annotation-picker" size="small" allowClear value={selected?.id} placeholder="选择已有标注"
          options={documentState.items.map((item) => ({ value: item.id, label: `${formatTime(item.atMs / 1000)} · ${drawingToolLabels[item.kind]}${item.text ? ` · ${item.text.slice(0, 16)}` : ""}` }))} onChange={props.onSelect} />
        <Button size="small" aria-label="撤销标注" disabled={locked || documentState.past.length === 0} onClick={props.onUndo}>撤销</Button>
        <Button size="small" aria-label="重做标注" disabled={locked || documentState.future.length === 0} onClick={props.onRedo}>重做</Button>
        <Button size="small" disabled={locked || !selected} onClick={props.onDelete}>删除选中</Button>
        <Button size="small" disabled={locked || documentState.items.length === 0} onClick={props.onClear}>清空标注</Button>
        <Button aria-label="保存标注" type="primary" size="small" loading={documentState.saving} disabled={locked || !dirty} onClick={props.onSave}>保存标注</Button>
        {dirty ? <Popconfirm title="读取已保存版本将替换当前未保存草稿" onConfirm={props.onReload}><Button size="small" disabled={documentState.loading || documentState.saving}>刷新标注</Button></Popconfirm>
          : <Button size="small" disabled={documentState.loading || documentState.saving} onClick={props.onReload}>刷新标注</Button>}
      </div>
      {documentState.error && <Alert type="warning" showIcon message={documentState.conflict ? "标注版本已更新，当前草稿仍保留" : "标注读取或保存失败"} description={documentState.error}
        action={dirty ? <Popconfirm title="读取已保存版本将替换当前未保存草稿" onConfirm={props.onReload}><Button size="small">读取最新</Button></Popconfirm>
          : <Button size="small" onClick={props.onReload}>重新读取</Button>} />}
      {!documentState.loading && !documentState.canEdit && <span className="annotation-notice">当前只可查看标注。</span>}
      {documentState.loading && <span className="annotation-notice">正在读取标注。</span>}
      {props.frameUnavailable && <p className="annotation-notice">当前画面不在可定位的战斗范围内，返回战斗时间后可编辑标注。</p>}
      <p className="annotation-hint">{selected ? `正在编辑 ${formatTime(selected.atMs / 1000)} 的标注属性` : "标注按当前战斗时刻保存，进入绘制会暂停视频。"} · {documentState.items.length}/{ANNOTATION_MAX_ITEMS} · Ctrl+Z 撤销 · Ctrl+Y 重做</p>
    </div>}
  </div></ConfigProvider>;
}
