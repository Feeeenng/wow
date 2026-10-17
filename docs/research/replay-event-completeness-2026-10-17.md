# 实战事件补全与大索引播放竞争修复

日期：2026-10-17，时区：Asia/Shanghai。本轮延续录制复盘持续任务，不使用 superpower skills，不提交或推送 Git。

本报告保留事件v3阶段当时的测试及产物摘要；之后[团队共享校准](shared-calibration-validation-2026-10-17.md)已完成并更新安装包，当前完整结果及有效包摘要以[阶段总表](replay-final-acceptance-2026-10-17.md)为准。

## 本轮行为

| 原始事件 | 时间轴类型 | 处理约束 |
|---|---|---|
| SPELL_AURA_REFRESH，BUFF | 增益刷新 | 独立于获得、叠层，不虚构层数 |
| SPELL_AURA_REFRESH，DEBUFF | 减益刷新 | 保留目标人物和事件时间 |
| SPELL_EMPOWER_START | 蓄力开始 | 没有明确等级时为未知 |
| SPELL_EMPOWER_END | 蓄力释放 | 原始第13字段保存为empowerLevel |
| SPELL_EMPOWER_INTERRUPT | 蓄力中断 | 保存真实等级，包括0，不冒充普通打断 |
| SPELL_RESURRECT | 复活 | 保留来源和被复活者，不推断确认复活或存活区间 |

本轮直接只读核对用户提供日志中的五种原始事件布局。光环、死亡、复活按受影响人物分类，施法和蓄力按施法者分类；敌人对团员施加的减益不会再被归为敌方个人状态，原始sourceGuid及targetGuid不改。独立CSV审计按相同业务定义计数，不调用生产解析器。

事件可独立筛选，刷新进入光环轨，其余沿用人物所属轨道；蓄力等级显示在详情，图标、事件提前回看、拖轨及Rust偏好校验贯通。事件类型筛选改为按中文label搜索，避免输入“死亡”被英文内部值过滤为空。

本地TIMELINE_VERSION从2升至3。原日志仍在时只重建该Pull字节范围，事件ID继续使用Pull ID及原字节偏移；日志缺失／截断时保留旧索引并提示不完整。原视频、日志、导入目录和旁车只读，录像身份及书签不变。光环归属修正后，绑定旧owner的个人显示覆盖不会猜测迁移；可按修正后事件重新拖轨。

云端新导入快照使用eventSchema=2，将refreshbuff／refreshdebuff保留为刷新，增加empowerstart／empowerend／resurrect。类型依据[WCL蓄力开始文档](https://de.warcraftlogs.com/scripting-api-docs/warcraft/interfaces/RpgLogs.EmpowerStartEvent.html)、[蓄力结束文档](https://de.warcraftlogs.com/scripting-api-docs/warcraft/interfaces/RpgLogs.EmpowerEndEvent.html)及[复活文档](https://de.warcraftlogs.com/scripting-api-docs/warcraft/interfaces/RpgLogs.ResurrectEvent.html)。文档中的empowermentLevel仅在实际JSON提供有效非负整数时读取；未取得真实线上v2事件，缺少时保持未知。不猜测未确认的WCL中断事件类型。既有发布快照不重写，用户显式刷新导入才产生新快照；服务端和客户端需配套更新。

## 实战与测试证据

两份日志重新完整只读审计，仍为5780237行、22场完整战斗、17份唯一匹配录像，SHA及字节数与上一轮完全相同。原始五种新增事件在全文件中均有实证；战斗范围、友敌及人物过滤后才计入时间轴。

| 录像战斗起点 | 当前生产事件数 | 真实人物 | 解析失败 |
|---|---:|---:|---:|
| 20:12:53 | 975 | 20 | 0 |
| 20:15:00 | 38850 | 20 | 0 |
| 20:18:49 | 86791 | 20 | 0 |
| 20:36:41 | 12644 | 20 | 0 |

四场的总数、每类事件、归属及蓄力等级分布与独立CSV审计逐一相符。第三场包含1条真实复活，蓄力释放等级1／3和中断等级0／1均有记录。新增战斗中日志本人未死亡，测试明确保留“没有本人死亡锚点”，不虚构零毫秒死亡；原三场仍逐项验证本人死亡时间及GUID。

- npm run test:replay：32通过，0失败，0跳过。
- npm run build：退出0，4944模块；最终前端index-CtvaKNNn.js，保留既有大chunk提示。
- node tests/browser-replay.cjs：25项通过，pageErrors为空；六种新增类型逐个中文筛选、真实鼠标点击、蓄力等级及实际媒体定位通过。
- 后端.venv/Scripts/python.exe -m pytest tests/unit tests/api -q：92通过，0失败；包含11项新增WCL分支及未知等级边界。
- 同虚拟环境pytest tests/integration/test_wcl_postgres.py -q，显式WOW_RUN_SERVICE_TESTS=1和独立临时PG：1通过；真实HTTP／PostgreSQL发布10条含新增类型的事件，分页、SELF、等级、失败保旧及撤权通过。与上面92项不重叠，不把旧全栈89项计数当本轮完整结果。
- 四场生产Rust显式实战测试rebuild_real_encounters_matches_independent_audit：1通过，0失败，11.63秒；原三场辅助测试已更名并扩为四场。
- 原生云端协议夹具9项通过，真实Rust IPC保留新增类型、等级和报告人物身份；35次HTTP、23次媒体请求均鉴权。该项为本机假HTTP，不替代上一项真实PG。

完整证据位于%TEMP%/wow-replay-phase2-20261017：real-samples-events-v3、replay-browser-events-v3-label、native-cloud-events-v3及backend-events-v3-wcl.log。

## 真实播放复查发现的竞争条件

首场975事件的原生升级和真实画面播放通过；第二场38850事件时，原生媒体返回PipelineStatus::DEMUXER_ERROR_COULD_NOT_PARSE。进一步捕获实际网络响应，唯一请求index.m3u8为HTTP503、51字节“本地录像索引正忙”，并不是媒体文件内容。普通Edge经HTTP加载同三场既有HLS全部成功，进一步排除HLS损坏。

根因是本地媒体同步协议使用try_lock；较大事件分页／升级持有索引时，正常锁竞争直接变成媒体错误。现在采用与云端／直播历史一致的异步协议注册，等待索引获得最小路径快照后释放锁，再异步读盘，不阻塞窗口线程。响应明确no-store，避免同路径重建后继续复用旧响应。

新增真实锁竞争测试media_waits_for_index_contention_and_reads_after_lock_is_released：先持锁确认请求保持等待，释放后返回200及正确字节，并检查HEAD、404和目录越界403。初次定向运行1通过、0失败，0.03秒。

修复后cargo test --lib完整回归：118总数、115通过、0失败、3辅助忽略，退出0，16.40秒；完整结果为cargo-lib-events-v3-protocol.log。

重新构建独立标识客户端后，原生三场全部通过：975／38850／12644事件分别读取1／39／13页，原事件ID全部保留，1920×1080真实游戏画面在媒体8.3秒成功解码，pageErrors为空。每场捕获8次清单／初始化段／媒体分片响应，全部200且逐个SHA与原HLS一致。原片、旧索引、源HLS、正式构建产物均未改，隔离状态按字节恢复，测试进程退出。证据native-events-v3/first-fixed、second-fixed、third-fixed；两尺寸首场截图已更新到research/images。

同一修复后独立客户端执行native-local-annotations.cjs，3项通过、0失败、pageErrors为空，真实本地标注写盘／重启恢复和预滚尾滚守卫仍正常。普通Edge三场HTTP播放另全部通过，详情browser-real-media-events-v3-final，实际pageerror监听为空；这些测试互相包含，不能直接相加当成独立功能覆盖。

默认正式标识debug构建退出0（前端8.81秒、Rust17.15秒），Release NSIS构建也退出0（前端8.48秒、Rust52.82秒、生成1个安装包）。安装包125033426字节，SHA256 f71e7c201a36185055944183e670f8c3975137670b2836d99cc075e70df4309d，替代上一轮包。Release实际PE为x64／GUI子系统2，debug／release均为正式标识，743项游戏资料大小及SHA全部一致；证据events-v3-build-artifacts.json，配套EXE摘要见阶段总表。未安装／未启动正式应用，测试进程无残留，5432／25432／29000／26379端口均关闭实测通过。

## 中间失败与边界

首次浏览器复验暴露中文搜索缺陷，修复label过滤后25项通过。首次扩展实战测试错误地要求新增场次也存在本人死亡，改为只对原三场强制死亡锚点，新增场保留未死亡事实；四场总数／分类／等级断言未放宽。旧导入测试原先断言敌方施加的友方光环归为Boss，已改为验证受影响团员归属且保留敌方来源，和云端语义一致。

首次PG复验因临时集群未带隔离端口启动而连接超时；按回环25432重启后测试通过，未连接正式数据库。协议修复前原生第二场失败及其网络证据保留在native-events-v3/second*。原始数据及旧隔离状态均已恢复，不把失败轮次计入通过。

本轮仍不证明跨设备实战500ms同步精度、线上WCL真实JSON或硬件长录矩阵。其他剩余范围以[阶段总表](replay-final-acceptance-2026-10-17.md)为准。
