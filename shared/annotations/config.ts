/** 视频标注的默认样式、保存边界和撤销上限，与原生／服务端协议一致。 */
export const ANNOTATION_DEFAULT_COLOR = "#E51039";
export const ANNOTATION_DEFAULT_WIDTH = 3;
export const ANNOTATION_DEFAULT_DURATION_MS = 5_000;
export const ANNOTATION_MAX_DURATION_SECONDS = 60;
export const ANNOTATION_MAX_WIDTH = 12;
export const ANNOTATION_MAX_ITEMS = 200;
export const ANNOTATION_MAX_POINTS = 512;
export const ANNOTATION_MAX_TEXT = 500;
export const ANNOTATION_HISTORY_LIMIT = 20;
/** 绘制时至少移动两像素才追加采样点，减少高频鼠标事件造成冗余笔迹。 */
export const ANNOTATION_POINT_STEP_PX = 2;
