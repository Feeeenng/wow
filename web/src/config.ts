/** 生产使用同源反向代理；独立API地址只能由构建环境提供。 */
export const API_ROOT = import.meta.env.VITE_API_URL || window.location.origin;
export const API_PREFIX = "/api/v1";
/** 目录及事件均按页加载，页面离开后不继续遍历历史。 */
export const CATALOG_PAGE_SIZE = 100;
export const EVENT_PAGE_SIZE = 1000;
/** 限制单次JSON响应，错误不显示服务器回传的敏感输入。 */
export const MAX_API_RESPONSE_BYTES = 4 * 1024 * 1024;
export const API_TIMEOUT_MS = 20_000;
/** 定位容差是浏览器媒体行为边界，不表示日志同步精度。 */
export const SEEK_TOLERANCE_SECONDS = 0.1;
export const SEEK_TIMEOUT_MS = 12_000;
export const EVENT_LEAD_SECONDS = 3;
export const DEATH_LEAD_SECONDS = 15;
export const PROGRESS_INTERVAL_MS = 50;
export const OFFSET_STEP_MS = 100;
export const TIMELINE_ICON_PX = 24;
/** 登录输入只支持平台颁发的访问令牌，限制异常粘贴体积。 */
export const MAX_TOKEN_CHARS = 4096;
/** 战斗轴末端留一毫秒，避免定位到下一不存在帧。 */
export const END_MARGIN_SECONDS = 0.001;
/** 最近三路完整事件驻留内存，避免遍历全团历史缓存。 */
export const EVENT_CACHE_SIZE = 3;
/** 分组详情按页渲染，避免大事件簇一次创建大量图形控件。 */
export const EVENT_DETAILS_PAGE_SIZE = 20;
/** 统一事件轨道的缩放及键盘步进范围。 */
export const TIMELINE_ZOOM_STEP = 0.5;
export const TIMELINE_KEY_STEP_SECONDS = 1;
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
