# 视频画笔与标注界面验证

日期：2026-10-17，时区：Asia/Shanghai。此报告记录已执行证据，不把浏览器保存夹具冒充数据库或原生写盘。

## 实现和保存边界

视频支持自由画笔、箭头、方框、圆圈、纯文本和团队标记；可以选择、拖动移动、修改颜色／线宽／文字／显示时长、删除、清空、撤销和重做。进入编辑暂停视频，标注绑定当前录像及共同战斗毫秒；显示按各条起点和持续时间计算。

最终补正预滚／尾滚边界：播放器的战斗游标会截断到0或结束值，标注不能据此把战斗外画面误存到边界。当前直接按实际video.currentTime及当前映射反算，监听seeking／seeked／timeupdate；战斗范围外或未定位画面隐藏标注并禁用编辑，回到范围恢复，绘制和移动入口再次核验真实帧。

坐标保存为视频内容的 0～1 相对位置。SVG 依据视频真实宽高排除黑边，窗口、工作台全屏和视频全屏都重新测量；媒体控制栏处于画布之上，保留实际鼠标操作。绘图层不读取跨域视频像素，不改变浏览器跨源策略。文字作为 SVG 文本节点渲染，不接收 HTML 或任意 SVG 路径。

应用级 AnnotationProvider 保留导航间草稿及最多 20 步撤销历史。用户显式保存时，本地经过 Rust LocalStateStore 的 replayAnnotations 区段，团队经过当前平台身份调用后端；只有保存成功才前推版本并消除未保存提示。人物或服务切换使用独立文档键。CAS 冲突保留草稿，明确读取最新时才在确认后替换，不能静默覆盖另一编辑者。

单份快照最多 200 条、单笔 512 点、总 20000 点、文字 500 字、线宽 1～12、持续 1～60000ms。Rust 与后端统一拒绝 NUL，保留 Tab／CRLF 及字面标记文字。团队权限及真实 PostgreSQL 并发见 [后端标注验证](team-annotations-validation-2026-10-17.md)。

## 实际执行

- npm run build：退出码 0，最终4944个模块、index-DhEuChGA.js，保留现有单 JS chunk 超过 500kB 的提示。此前4943模块的完整界面回归保留为基线。
- node tests/browser-annotations.cjs --fixture <合成媒体目录> --output <本轮证据目录> --playwright <本机已有 playwright-core>：最终退出码0，9项全部通过，pageErrors为空。
- 标注纯函数测试6项通过，覆盖保存引用、撤销／重做、只读／保存锁、历史上限、真实黑边比例、时段显示及预滚／尾滚／缺片帧范围。合并后的npm run test:replay：31通过、0失败、0跳过。
- cargo test --lib annotations:: -- --nocapture：退出码 0，3 通过、0 失败，109 过滤；覆盖合法图形与额外字段拒绝、原生并发 CAS、保存失败不前推版本及文本 DTO 往返。
- 4943模块基线回归：browser-replay 24 项、browser-live-history 14 项及 browser-wcl-report 7 项全部通过，页面异常为空；直播 WHEP 协商／释放8／8。最终只修改前端标注帧范围，对应新增浏览器及原生用例；Rust和后端生产代码未变，未无故重跑完整套件。

八项浏览器验证包括：真实 HLS 内容比例与暂停；六种 SVG 图形和归一化坐标；元素属性、字面文本与撤销重做；鼠标拖动及切页恢复且不重复读取；保存失败保留旧版和重试；1080 视口／全屏往返及媒体控件命中；只读团队隔离和刷新编辑权限；409 保草稿及显式读取最新。

最终证据目录为%TEMP%/wow-replay-phase2-20261017/annotations-browser-frame-guard，包含report.json及两种尺寸截图；annotations-browser-final保留此前8项基线。已查看两种尺寸截图，无水平溢出。原八项还实际验证Ctrl+Z／Ctrl+Y及Media Chrome视频全屏进入／退出，工作台T全屏同样往返通过。绘图文字测试使用字面script标签，确认不存在script DOM节点。第九项直接定位实际媒体0.5s和13.5s，确认战斗外隐藏SVG、禁用绘制且不能保存伪标注，回到3s恢复原文档。

## 验证中修正与限制

截图检查发现画布高于媒体控制栏，已提高控件层级并增加 elementFromPoint 命中回归。修复了空快照被误显示为未保存、现有 reqwest 未启用 JSON feature、ColorPicker 属性拼写及未启用 tokio macros 等集成问题；未为此修改依赖。

测试夹具另修正了浮点位置严格等值断言、选择器关闭动画等待、按钮的实际可访问名称和全屏退出等待；真实点击和每次唯一 IPC 提交仍有断言，没有使用 force 点击。保存检查读取实际提交及快照版本，而非依赖按钮加载期间的名称稳定性。

上述浏览器用例使用有版本 CAS 的内存 IPC。随后真实 Tauri→PostgreSQL／MinIO／Redis／独立 Celery／WCL 协议／标注的完整 13 项原生验收全部通过，包含实际鼠标箭头、撤销重做、PG 保存、跨视角隔离、并发 CAS、重启恢复、其他成员只读／分析员编辑／上传者成员编辑及移出团队后读写拒绝。证据为 native-real-cloud-annotations-final，详见 [原生云端验证](cloud-client-validation-2026-10-17.md)。没有凭此声称正式安装或实战游戏环境已全部验收。

另补本地非空标注的直接原生闭环：native-local-annotations.cjs最终退出码0，3项通过、pageErrors为空，使用4944模块独立标识客户端。真实鼠标绘制的箭头经客户端按钮保存到client-state.json的replayAnnotations，版本1、坐标及1000ms／5000ms时段与IPC一致；关闭进程重启后，非空快照和实际SVG line恢复，原有哨兵区段保留。第三项验证预滚／尾滚禁绘、范围内恢复，前后实际快照版本及坐标不变。证据native-local-annotations-frame-guard，截图已查看，独立进程已停止。随后恢复默认标识debug并重新生成Release NSIS，新摘要见[阶段总表](replay-final-acceptance-2026-10-17.md)。
