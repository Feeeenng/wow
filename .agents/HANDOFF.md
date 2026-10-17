# 当前工作交接

更新时间：2026-10-17（Asia/Shanghai）。恢复历史按INDEX.md查询，不默认加载全部月度记录。

## 最新：按模块提交当前全部改动

- 用户再次明确授权将全部修改按工作模块提交。已完成本地提交：分类资料678e53b、团队死亡API及快照4c1334d、客户端死亡复盘babd6cf、原生拖放505bfca、验收脚本dd803e4、已有导入排序731da67、验收文档908d2bd；项目交接另作本批最后提交。没有推送，后续新增改动不自动继承本批提交授权。
- 本次重新执行git diff --check及各批git diff --cached --check，均退出0；客户端node死亡／分类／等待回归16通过、0失败，退出0。57个改动文件的私钥、GitHub令牌及AWS密钥特征扫描无命中；不将特征扫描称为完整安全审计。本次未重新运行后端、Rust、构建或原生整链路，既有证据见下文。
- 技能缺图仍有11项，尚未补入新图片。公开精确图片及tooltip请求403；已核对本机游戏12.1.5.70448，与资料70391分开记录。候选作者工具WoW.tools.local 0.9.9支持按FileDataID读取BLP／PNG，可隔离临时目录后评估；本轮未下载或启动该工具，不把来源调研当作资源完成。

## 当前目标与约束

- 优先客户端，Web暂不扩展；客户端统一使用自身全局Ant Design版本主题，不能与ReviewTool完全一样。不使用superpower skills，不自动提交／推送，不运行正式用户应用或安装包。
- 用户本次明确要求将全部现有修改按工作模块提交；已完成资源ae3f1ad、解析6e1e8e2、客户端复盘6eb02f6、退出保存7392463、验收脚本3e25141及验收文档c35fde4，并另行提交项目交接记录。仅本地提交，没有推送；后续新改动仍按阶段提醒，不延续本批授权自动提交。
- 指定两份CombatLog与D:/wcl/warcraft-live原片只读。云端测试只传合成媒体，不上传原片／日志。本轮客户端及必要团队死亡API同步接通，没有数据库结构／迁移／依赖或Web界面扩展。

## 最新完成：原生拖轨与真实服务死亡整链路

- 修复WCL死亡窗口未请求资源：定向回归先1失败，再为窗口开启includeResources:true；默认关键事件导入保留原查询，新的HTTP协议服务不开资源就不提供生命字段。相关29项通过，默认后端115通过／16服务跳过；PG／Redis／API显式2项通过，不能把跳过算通过。
- 修复Windows真实鼠标拖放：Tauri主窗口dragDropEnabled:false。旧版OS输入只有dragstart／dragend且无规则写入，新版实际drop、DOM及Rust写盘确认；只读文件导入仍用选择器，不加原生文件拖放权限或依赖。
- 当前真实服务整链路15组通过：两路Multipart首片后正常退出／恢复、完整SHA、独立worker转码与私有HLS、WCL导入、263条死亡明细250＋13页、Redis命中／签名、关联定位、真实鼠标个人轨道／重启、画笔PG保存／CAS／权限、换版及真实撤权。WCL上游是本地协议数据，不是生产WCL报告；媒体为合成图，用户原片／日志不上传。
- 当前Windows原生协议矩阵13组通过，包含实际OS移轨及播放位置／参数不变；本地实战回归9组通过，38850事件及真实治疗石／药水继续与独立CSV一致。所有本轮通过原生矩阵pageErrors空、forcedStops为0、隔离状态逐字节恢复，测试期间正式产物不变。测试schema／桶／缓存键清理0，临时PG／MinIO／Redis均停止。
- Node信号退出的exitCode仍可为null，新增processExited并用两个真实子进程回归，死亡／分类／等待合计16通过；Rust在独立Cargo目录124通过／3辅助忽略，16.71秒。遇到一次异常启动后控制器等待信号退出的错误，已停止明确属于本次的挂起控制器，独立状态与受保护备份逐字节一致。
- 正式MediaMTX占用默认debug运行时文件，未停止该正式进程。改用target/native-drag-validation构建；正式debug EXE在没有正式主进程运行时单独更新，原运行时文件不覆盖。验收必须用临时client-native-visible-validation.json与client-native-visible-build/wow-recorder-client.exe，visible:true／dragDropEnabled:false；OS模式加--windows-mouse，旧隐藏配置不算OS验收。
- 最新报告docs/research/client-native-drag-fullstack-2026-10-17.md，原生15证据client-real-cloud-death-visible-final/report.json，原生13为client-visible-drag-os-final/report.json，本地9为client-native-drag-local-regression/report.json。Windows输入驱动位于client/tests/timeline/windows，验证PID／EXE／元素／命中归属；Orca运行时不稳定路径未计为通过，没有使用superpower skills。
- 本阶段完成时HEAD为7dd52bf；其减伤／团队死亡增量现已纳入顶部所列本地模块提交。backend/app/api/replay.py的已有import排序单独提交，未混入功能改动。

## 前阶段：客户端团队死亡窗口（分层验证）

- 后端新增services/wcl/review，按已发布报告／fight／版本及玩家死亡按需读取默认15秒；既有关键事件导入和数据库结构不变。伤害／治疗保留实际字段，未知不补零，只认targetResources为目标生命采样；前置光环取既有有界关键事件。
- Redis完整ready快照默认TTL120秒，每页先鉴权及确认发布快照。HMAC游标绑定团队／录像／快照／死亡／内容摘要；缓存失效回源内容变化拒绝混页，显式refresh绕过缓存。未配置／报告变化区别完整空窗口，不猜直接致死或责任。
- Rust新增get_cloud_death_review，校验页大小、时间、actor命名空间与数值，连接变化拒绝迟到响应；React按本地／WCL来源读取，空GUID仍可进入团队玩家死亡。账号／团队／凭证变化清除旧快照，三份进程缓存不持久化，标准版本变化提示重新选择。关联录像只认明确绑定，光环React键按actor隔离，不把WCL套入本地减伤资料。
- 当前默认后端114通过／16服务测试跳过；其中WCL真实PG及Redis联调另行显式执行2通过，单元104通过是其中子集。Rust124通过／3辅助忽略，127总计，18.84秒；回放40、死亡／分类／等待14、浏览器28、云端原生12及本地实战原生9均通过，不相加冒充独立覆盖。
- 原生云端是实际Rust／DPAPI／WebView2／HLS加明确HTTP协议夹具，260明细及两个来源同技能光环；后端另用真实PG／Redis／API和loopback WCL验证权限及源版本，尚未声称真实生产WCL报告端到端。先发现旧脚本换凭证后继续用旧媒体URL，改为重新签发后完整12组通过，没有放宽旧URL失效。
- 最新证据client-cloud-death-native-final／client-cloud-death-local-final／client-cloud-death-browser-final的report.json；源数值及真实治疗石药水继续与独立CSV一致。两套原生pageErrors空、forcedStops为0、隔离状态逐字节恢复；本地原片／HLS／源索引及当时保护产物不变。测试schema和缓存键清理为0，独立PG及Redis均已正常停止。
- 专项报告docs/research/client-cloud-death-validation-2026-10-17.md，截图images/client-cloud-death-native-20261017.png使用明确合成媒体／协议数据，已目视核对。代码未提交，HEAD仍7dd52bf；此前减伤分类增量亦未提交。
- 收尾发现backend/app/api/replay.py有非本轮写入的import排序变化，保留未处理，不归入本轮功能实现；默认后端矩阵已覆盖当前工作区。

## 前阶段：死亡减伤与治疗耗材分类

- shared/review/mechanics保存固定12.1.5.70391的84项样本分类及输入摘要，生成器client/tests/review/build-mechanic-catalog.py读取四份公开DB2快照。减伤要求负承伤效果，吸收／免疫／分摊保留行证据，不按技能名猜测。
- 治疗石5512／恶魔治疗石224464及直接治疗药水共关联4个样本技能。发现物品39163复用治疗链1064，已排除该误判。UI区分成功施法、治疗及增益记录，按真实人物身份标注，团队范围只认明确效果；不推算实际量、完整覆盖、冷却或未使用结论。
- 当前纯回放40、死亡／分类／等待13、浏览器28及实际原生9组通过。真实本人窗口分类3条，与独立CSV候选254条核对一致；另一个真实死亡窗口同时验证治疗石6262与药水1262857的成功施法／治疗各1条。该死者无本人录像，未伪造成员实拍；分类按钮定位当前真实视频且媒体实例不变。
- 原生9组报告client-mechanics-native-potion-stone/report.json，pageErrors空、forcedStops为0，原片／HLS／源索引不变、隔离状态按字节恢复，测试进程已停。新代码尚未提交；上一批授权提交以7dd52bf结束，不自动提交或推送本轮增量。

## 前阶段：轨道详情及正常退出保存

- 客户端分组详情20项分页，后续页可用方向键／回车选择目标及按原时间回看。同一归属／来源／技能／类型才可整体拖动，混合规则组禁拖；缺失来源、nil及零GUID不能新建覆盖，WCL报告actor仍可用，旧规则格式不迁移。
- 反馈使用全局主题边框，换源／索引版本／不可操作时取消拖动，规则判定随数据／布局计算而不随每帧游标重扫。新组合框读屏名称为技能／人物／时间，不暴露内部事件ID。
- 新增正常关闭前排空最新回放偏好及在途保存，失败取消关闭并全局提示；成功解除自身监听后走现有close权限，不增加destroy权限。防抖500ms保留，关闭中冻结新的偏好更新，启动未成功读取时不以默认值覆盖源数据，LocalStateStore格式不变。
- 验证发现原生脚本误用waitForFunction异步谓词会提前结束，改用waitUntil显式await后轮询并新增2项回归。修正等待后原普通写盘／重启正常；再用旧独立EXE明确复现防抖内立即关闭未保存（退出后高度仍30而非31）。当前修复后的实际磁盘30→31、重启31，原生验收强杀次数0。

## 前阶段验证基线与边界

- 纯模块40通过，死亡／异步等待附加8通过；当前浏览器28通过、pageErrors空，含75项密集后页键盘移轨、同名GUID隔离、同规则真实拖拽、未知来源禁用、关闭失败／恢复（此失败为明确IPC夹具）。
- 当前独立Tauri／WebView2实际原生5组通过，真实38850事件、26项混合分组第2页，验证键盘写入Rust、重启恢复、返回默认删除覆盖、全量事件摘要不变及立即离页关闭保存。forcedStops为0，索引及client-state按字节恢复、原片／HLS／源索引SHA不变，正式产物未被测试修改。
- 当前死亡恢复回归7组通过，包含真实窗口数值与独立CSV、本人／关联控制视角、日志缺失／不支持／换源及恢复。关联视角为同源媒体控制记录，不冒充其他成员实拍；正常UI错误片段在临时目录完成后删除。
- Rust业务源码本轮未改，122通过／3辅助忽略为上一死亡阶段基线，后端与Web矩阵未重跑；临时Rust诊断已移除。之前三场死亡975／38850／12644事件、明细37／656／314及独立数值20／312／120的原生证据仍保留。100ms媒体容差不是实战采集同步精度。

## 当前产物

- 正式debug与Release NSIS均构建退出0。当前含原生HTML5拖放配置的安装包client/src-tauri/target/release/bundle/nsis/WoW Recorder_0.1.0_x64-setup.exe为125140416字节，SHA256 c21b4848053f5c269c1216b99bce86cbd91d59fa6f83754b688bf3039f138724。
- Release EXE21539328字节／SHA 0561f03be6d9b9034b14df5079a2fd4368a08b809327ea86ec78f733ee80b3fb；debug30619648字节／SHA 33a781590ec4bc942a6c07f285822ba068ad7eb38ed7580a0e85f5d5bfc49123。两套x64、正式标识且无验收标识或临时诊断，Release为GUI子系统2；各743资料及8探测文件大小／SHA一致，许可原文一致。Release摘要在NSIS完成后重新读取，不能使用打包过程中未最终补丁的摘要。
- 前端仍为已核对的index-BAQphv4C.js／index-DC5zoM1x.css，本轮未修改React业务源码，未安装／卸载或启动正式用户应用，Web包未重建。
- docs/research/client-native-drag-fullstack-2026-10-17.md及阶段总表为最新入口，images/client-real-cloud-death-native-20261017.png为真实后端与合成媒体／WCL协议数据，已目视检查。历史减伤截图仍显示真实同一死前窗口中的治疗石与药水，任何这些证据都不覆盖生产WCL报告或其他成员实拍。
- 临时client-native-drag-build-artifacts.json为最终摘要，当前Rust124／3、默认后端115／16跳过、显式WCL服务2、原生真实服务15／协议OS13／实战9及纯逻辑16均已执行。前阶段client-cloud-death-*及client-mechanics-*保留为历史，不能将其旧安装包摘要当当前值。
- 临时wow-replay-phase2-20261017中client-track-details-native-large-group、client-track-details-native-exit-verified、client-track-details-death-regression、client-track-details-browser-modular各report.json，以及client-track-details-build-artifacts.json可追溯；client-track-details-browser-final为适配拆分前同构建结果，client-track-details-close-repro为旧EXE先失败证据。浏览器入口与IPC夹具已拆分，原生不加载mock。不要打印private.json或令牌／服务凭证。

## 后续

- 继续客户端深入死亡分析：扩充减伤／耗材分类覆盖与热修版本证据、明确致死关联、真实生产WCL公共报告、阶段分析和自动漂移。当前本地／团队死亡及原生真实服务链路已接通，WCL上游仍是协议服务，不代表生产报告或多人实拍精度。
- 仍有11项样本技能缺图、私有WCL OAuth／账号邀请、地城组合轴／外部播放器以及实战跨设备精度／硬件长录／磁盘／安装卸载／Linux生产矩阵未完成。触摸硬件未专项验收，强杀／断电不等于正常退出保存保证。
- 本轮PG／MinIO／Redis均已正常停止，schema／桶／死亡缓存键0，验收应用／FFmpeg／ffprobe残留0。正式配置的MediaMTX保持运行，后续必须重新核对进程范围，不能按历史PID停止它。完整目标继续进行，不因当前安装包或阶段测试通过而标记全产品完成。
