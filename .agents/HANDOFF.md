# 当前工作交接

## 最新：时间轴展开、真实技能说明与本地录像管理

- 用户确认只删客户端成片，保留导入原片／OBS源／所有日志。已接通左栏更多→本地录像管理：搜索、状态／收藏筛选、播放、收藏、目录和确认删除；Rust核验路径／上传／状态，收藏走LocalStateStore。普通失败回滚；异常目录保守拒删，强杀／断电暂存恢复未覆盖。
- 默认时间轴每秒64px、30px图标、52px单排、32px轨距，异技能重叠换排、同技能来源类型才分组；悬停秒／毫秒，点击标尺真实定位，保留平移缩放及本人身份隔离。原生发现高倍首尾标签重叠已修复并补回归。
- 技能说明1157项，Boss169／176、盘卷M48／50；缺失9项见spell-tooltips-source.json，动态伤害不猜。REA确认竞品使用Wowhead Tooltip；本项目使用固定版本离线说明和全局主题，不引入远程脚本。
- 验证退出均0：npm回放42；窗口／说明／资源14（5资源与42重复）；Rust130通过／4辅助忽略；管理6是子集；浏览器8组；原生7组（真实历史M、176资料／128图标、精确8.756秒seek、11.64倍及收藏重启、仅删除副本且旁车／源文件保留、再次重启索引不复活）。原生pageErrors／CDN请求空、强杀0，50受保护源文件SHA不变，独立AppData已清理。目录打开仅验证IPC／边界，未做Explorer窗口视觉验收。
- 正式debug与Release NSIS均重建退出0：debug30838784字节，release21824000；嵌入index-DuRi_Iyz.js／index-Ezb5VTvG.css，各831项资源与NOTICE一致。安装包125414735字节，SHA87df8a68b685f976253f263b8b05dd5ad6ff8977058d060c32d04962abf4879a。未安装、卸载或启动正式应用。此前“NSIS未重打”已被本条替代。
- 本地模块提交：93a76bc资料、027bcd2时间轴／说明、6e1dc13录像管理、555a4c6浏览器／原生验收；文档及交接另行收尾，不推送。新随包JSON按既有资源规则保留CRLF，分批用git -c core.whitespace=cr-at-eol diff --cached --check，均0，不改变Git配置。报告docs/research/client-replay-library-validation-2026-10-18.md；TEMP/wow-replay-library-20261018中browser-acceptance、native-acceptance及build-artifacts.json为最新证据。
- 尚未覆盖：9项源表缺失说明、未观测史诗首领／热修、强杀删除事务恢复、Explorer视觉及安装卸载矩阵、WHEP长时和生产WCL／多人同步。本轮不扩展Web／数据库／依赖；不把历史回放或单场验收当全产品完成。

更新时间：2026-10-18（Asia/Shanghai）。恢复历史按INDEX.md查询，不默认加载全部月度记录。

## 最高优先工作规则：后续自动本地提交

- 用户已长期授权自动提交Git，后续任务完成修改及已授权验证后直接按模块本地commit，不再等用户提醒或重复确认。已同步根AGENTS.md第9节和CONTEXT，测试授权不变，不自动push或改写历史，不混入无关用户修改。
- 当前增量已提交a9f0346（Boss资源）、261dc89（技能ID／时间窗）、93c5ebd（原生／窗口验收）、4762a26（报告／截图）；自动提交规则与本交接单独收尾。最终提交号见git log。
- 本次执行暂存差异／格式检查及本地commit，不重跑测试或构建；沿用上一任务明确验证结果和NSIS尚未重打等边界。提交后检查工作区干净。下文所有“不自动提交／旧授权不延续／未提交”均为已被本条取代的历史阶段说明。

## 最新：技能ID、12.1M补图及可见时间窗已实现

- 用户本轮要求悬浮技能ID、Boss不要问号且优先12.1M、连续缩放细化；异步明确“移除当前时间和设置”。已实现名称／ID优先弹层，Boss名称标注和真实图片，未知图片显示真实ID不冒充已知；本人技能隔离不变。
- 只读扫描16日两份及17日对应日志：176种已观测敌方施法均有图，含M盘卷祭坛22次50种。原1036样本保留，新增126技能、69JPEG／5CASC PNG，总1166／825；boss-abilities.json记录来源和边界。未观测M首领不宣称完成。
- 可见时间窗模块位于timeline/viewport：普通轮／拖标尺／底部Slider平移，Ctrl轮按鼠标锚点缩放，按钮优先当前视频点。取消4倍固定上限，最细窗口1毫秒；事件保留原绝对Pull时间，渲染仅可见部分，Boss名称及计数不撑宽。Rust持久化接受有限>=1倍率，旧偏好兼容，Web不扩展。
- 验证：npm回放42通过，窗口纯逻辑5通过，Rust偏好8通过／120过滤，浏览器6通过，原生3通过（176资料／128图标本地协议解码，真实M录像、ID及11.64倍重启恢复）。末端毫秒标签预留80px，原生断言不重叠、悬浮不平移、Boss名称不撑宽。原生pageErrors／CDN请求空、强杀0、50份源索引／原片／HLS摘要不变；独立AppData清理，WTL已停止。
- 正式开发构建恢复com.wow.recorder；前端Dc8CbCKD／mO3WRDja，最终大小／SHA及829项资源和NOTICE比对以前述formal-debug-build.json为准，不沿用旧构建摘要。未运行正式应用或重打NSIS。
- 新报告client-boss-skills-viewport-validation-2026-10-18.md；TEMP证据wow-boss-timeline-20261018/native-complete及formal-debug-build.json，浏览器wow-skill-viewport-browser-20261018/complete。图片client-mythic-boss-timeline-20261018.png及client-skill-id-tooltip-20261018.png。本轮未提交／推送，HEAD仍68dc39d，旧提交授权不自动延续。

## 最新：本批修改已按模块提交本地Git

- 用户明确授权提交当前所有积累改动；以cf7fe86为基线，先完成dd8e123技能图标／校验、25b0514暂停定位、e827543真实单场成片验收、e392a6f回放布局／本人轨道／逐秒标尺、600017e验证文档及截图，本交接记录独立提交收尾。最终交接提交号通过git log查询，不在自身内容内写自身摘要。
- 资源／源码／验收资料均纳入本批，未提交target／dist／安装包／临时原始证据或凭据；仅本地提交，不推送，不创建分支或改写历史。下文“未提交”是该阶段历史，已由本批提交状态替代。
- 本次只做Git差异和暂存区检查，不重新运行测试／构建；既有构建、8项新布局、3项本人视角及真实录制证据保留原边界。旧全量UI／死亡入口脚本尚未整体适配精简布局，不宣称它们全部通过；原生最新布局／WHEP及新NSIS仍未补验／重包。
- 提交后需核对git status无残留及6条提交顺序；后续新增修改不得自动沿用本次提交授权。

## 最新：已执行顶部去重与左栏更多操作

- 用户授权参考ReviewTool删除重复无用UI。已删除ReplayHeader及对应CSS，视频上方不再重复Boss／日期、全目录下拉、结果／就绪标签或成片时长；左栏负责场次和视角，播放器／时间轴各显示媒体／战斗时长。
- 新ReplayActions进入左栏标题区，“更多录像操作”收纳导入、上传／团队标准事件、刷新；28px管理按钮，无录像也可导入。上传禁用原因与权限不变，失败重试保留。新More的Tooltip曾挡数据源切换，已改原生title，回归验证通过。
- 最终npm run build退出0，当前CkZTZyMT／BYwPEK0d。实际Edge两视口及管理流程8项通过（含导入完成、上传确认、空列表、刷新不重建媒体、失败重试、团队标准事件），当前视角3项通过，页面／控制台异常均空。TEMP证据wow-replay-simplified-layout-20261018，最新截图client-replay-simplified-20261018.png。
- 这次按布局分区参考并沿用自身主题，未新增分享／外部平台／恢复隐藏分析入口。未重跑原生／WHEP或重包NSIS，未提交／推送；原旧28组UI脚本含已移除入口，不能沿用全量通过结论。

## 最新：顶部工具栏与ReviewTool对照，仅分析

- 用户截图要求核对右上角UI及缺项；没有改业务代码。ReviewTool所查模板将来源／分享／绘制／设置／全屏／Pull时长放在时间轴右侧竖栏，报告／日期／场次在左栏或Electron标题槽，非当前横向本地管理工具条。
- 当前实际Edge检查：上传／导入24px，下拉／刷新32px，标签22px；下拉重复首领／状态且易截断；1080px下可回放标签被隐藏。顶部时长是成片时长，不是竞品相应位置的Pull时长。建议先去重及统一尺寸／时间语义，不恢复用户已隐藏的图标。
- 真缺口为桌面带时间分享；第三方媒体源选择属范围差异。标注、设置、播放器全屏已有，不计缺失；灰上传有Tooltip禁用原因，不判坏。
- 对照报告reviewtool-playback-scope-comparison-2026-10-18.md末节；TEMP证据wow-replay-header-audit-20261018两视口测量及截图，退出0且页面／控制台异常空。未重新运行测试／构建或ReviewTool目标运行，未提交／推送。

## 最新：拉开两轨、逐秒标尺、隐藏标题

- 用户截图反馈过密且缺逐秒刻度，要求去掉“战斗时间轴”。现间距从8增至24px，删除可见标题；新增TimelineRuler，秒刻度用重复背景绘制，1秒短／5秒长；标签按宽度选整秒间隔，保留首尾。每秒至少8px，长战斗轴内滚动，缩放同步放大，不再六等分标签。
- 本轮继续读取REA同包08ra的nc等定位代码，确认毫秒悬停时间；未发现足够证据证明竞品本身具有完全相同逐秒标尺，本次按用户明确需求实现，不宣称复刻竞品刻度。
- npm run build退出0，当前前端-8jAAcio／BLCTpGtp。Edge两视口×0／10／113.5／300秒×1／4倍共16组通过，24px、秒宽、端点、标签不重叠及页面不溢出均验证；另当前视角3项回归通过，页面／控制台错误空。
- 证据TEMP的wow-timeline-ruler-20261018（after、pov-regression、verify-ruler.cjs）；报告client-timeline-spacing-validation-2026-10-18.md末节和最新裁剪截图。旧8px／16px均为历史；未运行原生／WHEP或重包NSIS，未提交／推送。

## 最新：玩家技能仅显示当前视角本人

- 用户纠正“玩家技能”不应合并所有玩家。EventTimeline现只消费owner=player，不再包含team；本地Rust已按录像GUID／本人标志判定，WCL按当前录像显式actor绑定标记。无需新增职业或人物筛选；Boss轨道及8px间距不变，直播回看共用生效。
- 修改前浏览器明确复现队友技能泄漏；修复后实际Edge网页3项通过：只显示本人且排除队友对本人施法、切换同场视角更新本人技能且Boss不变、本人事件缺失不回退全团队。pageErrors／consoleErrors空；夹具是合成数据及IPC，不冒充多人物实拍。
- npm run build退出0，前端CHNCOCPG／BRDQo88Z。TEMP证据wow-current-pov-20261018/before及after/report.json，验证脚本verify-current-pov.cjs。记录追加到client-timeline-spacing-validation-2026-10-18.md；未重跑原生／WHEP、未重包NSIS，未提交／推送。

## 最新：进一步精简视频下方与时间轴，最终8px

- 用户要求隐藏录像信息、右侧图标、对齐微调及时间轴人物选择。ReplayPage删除信息工具条／状态说明／工作台全屏按钮及校准面板，失败重试保留到提示区；LivePage同步隐藏微调。EventTimeline不再显示人物筛选，也不应用旧actorGuid，仍保留缩放与外观。
- REA同身份提取源码核对：C_Gj17VL默认轨高30px、比例80%→图标24px；08ra时间轴纵向flex无额外gap，来源轨道边线分隔。默认额外间距0、相邻普通图标约6px，不是运行界面实测。本项目从16px收至8px，旧记录16px仅为前阶段。
- npm run build退出0；当前构建B_WhlEeV／BRDQo88Z。Edge六组视口／行高／100%图标验证8px，无溢出或页面／控制台错误；不可见入口、忽略旧筛选及点击5秒→媒体7秒均验证。证据TEMP的wow-timeline-spacing-20261018/simplified，报告client-timeline-spacing-validation-2026-10-18.md后续节，含最新截图。
- 未重跑原生UI或重包NSIS，未提交／推送；当前安装包不包含本轮修改。保留已有媒体offset与错误处理，未删除底层校准／分析能力。

## 最新：修复两条技能轨道过密

- 根因是.replay-tracks只有外边距、行间距0；默认30px／80%图标相邻只有约6px空隙，100%图标贴边。CSS改Grid／16px行间距／上下12px外边距，不修改偏好与事件。
- npm run build退出0；实际Edge网页测量2种视口×3种行高、100%图标，共6组间距从0变16px，无页面横向溢出／pageErrors／consoleErrors。仍只有两轨，三个已隐藏入口不可见。报告docs/research/client-timeline-spacing-validation-2026-10-18.md，含真实网页夹具截图。
- TEMP证据wow-timeline-spacing-20261018含前后截图／报告及验证脚本；未运行原生UI或重包NSIS，未提交／推送。ReviewTool最终计算像素未实测，不声称完全复刻。

## 最新：执行客户端时间轴精简

- 用户要求仅Boss技能和玩家技能，隐藏光环、技能资料导入、轨道布局及死亡明细；已修改共享客户端EventTimeline，回放／直播回看同步生效，团队归玩家，死亡／复活也不显示。
- 不读取旧事件类型筛选与布局覆盖，避免隐藏光环的旧筛选导致技能全空；不清除原始日志或已存偏好。移轨控件与拖动在无编辑回调时不可用，ReplayPage不再挂载死亡面板。Web及全局旧分析基础能力未删除。
- 复用REA已确认同包源：ReviewTool有cast／applydebuff选项和光环类型支持，不能说其完全没有光环；本项目按用户要求隐藏。本轮首次编译发现直播调用方旧playerName属性，已同步移除并重验；完整结果以本轮交付为准。未提交／推送。
- 本轮验证：npm run build退出0（tsc及Vite，保留大包体积提示）；node --test tests/replay-events.test.cjs为7通过／0失败。未重跑原生UI或重新打包NSIS，现有安装包仍为先前版本；浏览器／原生旧验收脚本包含移轨和死亡入口假设，后续执行前需按新范围调整。

## 最新：REA回放对照与范围精简建议

- 用户要求用REA比较ReviewTool回放并评估死亡分析是否多余；本轮只分析，不修改功能。报告：docs/research/reviewtool-playback-scope-comparison-2026-10-18.md。
- 补正：旧“死亡复盘”仍有主工具栏及事件详情入口，ReplayPage和全局Provider仍挂载；此前只撤下新扩展，不能声称整套分析已移除。建议收敛到视频＋时间轴，撤下分析入口但保留普通死亡标记定位，尚未执行。
- 实际差距：技能搜索／显隐及预设、本地收藏／删除／容量操作、逐帧及能力允许的画中画。当前POV专属轨道、地下城组合轴、外部平台等可延后；DVR和过渡快照已有实现，不重复开发。ReviewTool录像管理证据是云端VOD，不冒充本地文件管理。
- 本轮REA两项补充静态分析退出0、共5份JS解析0失败，安装包身份及8项提取摘要已核对。未运行目标程序或远程业务、未运行本项目测试／构建、未提交或推送；精简方向为建议，等待后续实施要求。

## 最高优先：单场战斗视角录制及视频回放

- 2026-10-18用户要求总结完成与缺口：当前单场录制／成片／回放／时间轴已实际核验；多视角、DVR及私有上传等已有实现和分层证据，但多人实拍精度、生产WCL、长录／异常磁盘／安装升级卸载等仍需补验，私有WCL OAuth及完整账号邀请尚未补齐。死亡分析及Web扩展按用户要求暂缓，不再列为当前必做项。最新修改仍未提交／推送，本次状态核对未重跑测试。

- 最终补正：正式客户端已有实际非导入录制88d4219c…，2026-10-17 20:10:26英雄盘魂者内克扎莉击杀。1080p／30fps、H264／AAC、293.989秒，覆盖完整282660ms；原始17日日志精确开战／结束与索引一致，源片闭合存在，无缺口，片尾保留拾取。当前原生播放45044事件、11补图通过，MP4／HLS完整解码退出0、页面异常空、强杀0、隔离状态恢复，41个正式文件大小／SHA不变。证据formal-capture-audit-20261018，报告client-recording-replay-validation-2026-10-18.md最终节。单场实际闭环已核验，先前漏查正式索引而要求重新打一场已撤回；用户无需为此再进游戏。
- 正式索引共3条ready、8条failed，8条均缺少可用闭合源片，原状保留，不补造或声称已修复。以下“现场未验证／等待开游戏”是本次补正前的历史过程，不得再作为当前阻塞。后续不得自行扩大到死亡分析或新增功能；安装包及生产代码未因本次只读核验改变，修改未提交／推送。

- 用户于2026-10-18最终明确：做回放，不是复盘；核心视频与时间轴，当前只需一场战斗的当前视角完整录制下来。暂不做死亡分析，也不继续新增独立死亡工作流。本轮未交付的致死分析与死亡回放控件及其专项测试均已撤下；client-fatal-*及client-death-playback-*仅是已撤下方案历史，不是当前功能。
- 当前只保留一般视频暂停定位修复（明确play:false会真正pause，undefined保留原意图），本地／团队／全屏用语改为“回放”，已有“死亡明细”为次级入口。前阶段11项补图仍保留，未自动提交或推送。
- 录制隔离实测8项通过：真实OBS合成输入录出2片共21.417秒，H264／AAC完整解码，暂停／分片／断流恢复通过，原OBS公共运行时不变、ownProcessesExited真。证据single-battle-recording-20261018/report.json；不能冒充真实WoW捕捉，检查时无WoW或OBS正式进程。
- Rust默认124通过／3辅助忽略，127总计、16.77秒；显式实战索引1通过／126过滤，13.61秒。当前前端DIcewbNX／DC5zoM1x构建成功，当前浏览器28通过、pageErrors／consoleErrors空；单场38850实战事件原生播放及11补图通过，forcedStops0、隔离状态恢复、原片／HLS／源索引及当时正式产物不变。证据client-recording-replay-browser-final与client-recording-replay-native-final。
- 正式日志路径存在且监控开启，现有捕捉目标为Wow.exe，1080p／30fps；只读检查，未改写正式配置。正式debug及Release NSIS构建均退出0，已验证DIcewbNX当前前端及各754项清单资料，最终摘要见client-recording-replay-build-artifacts.json。报告docs/research/client-recording-replay-validation-2026-10-18.md；真实WoW采集尚缺现场一场战斗，不能把合成OBS或播放旧实战片当成新采集通过。
- 补充新增显式忽略的processes_one_real_battle_with_production_clip_pipeline验收入口：使用授权第二场实战源，实际生产process_clip生成全新TEMP MP4／HLS，1通过／127过滤，38.10秒。183.233秒成片覆盖174663ms完整战斗，MP4保留6音轨、HLS1音轨，完整解码均退出0，开战／中点／结束三处解码帧在1帧范围与源片一致，原片／旁车未变。新增用例仅测试代码，未重新构建或修改生产包；此前默认124／3是新增此忽略用例前基线，当前总测试数128，不能把忽略当通过。
- 新成片实际原生回放通过，38850事件、11项补图，页面异常空、强杀0、隔离状态及受保护文件不变。证据single-real-battle-clip-20261018与single-real-battle-native-verified-20261018；第一次验收索引引用不一致被正确拒绝，仅修正TEMP导入源，不放宽路径保护。已异步询问用户能否启动WoW完成一场首领战，等待外部游戏状态；未收到回复不得将离线文件当成现场新录制。

## 最新：指定实战技能缺图清零

- 在cf7fe86完成上一批模块提交后继续客户端补图，新增改动未提交或推送。指定17场实战1036项技能全部有图，包共1040项技能、741张JPEG及10张PNG；11项补图技能中两项棱彩飞弹共用一个FileDataID，不代表全游戏覆盖。
- 映射仍为SpellMisc70391，图片从固定本机CASC70448按FileDataID读取；原BLP内容MD5逐项匹配固定清单，PNG保留原解码，local-icons.json保存工具／配置／清单及原始摘要。8268563没有已验证文件名，继续为null，下载URL为null。WoW.tools.local0.9.9发布包大小及GitHub SHA核验，临时运行并已停止，不增加项目依赖或运行时网络源。20个游戏元数据／索引文件前后SHA未变。
- 当前npm run test:replay为41通过，python tests/spell-resources.test.py为4通过，10PNG独立FFmpeg完整解码退出0；隔离重建756文件逐字节一致。原生最终11项真实IPC／本地协议／WebView2解码与9组死亡复盘通过，38850实战事件，pageErrors空、forcedStops0、隔离状态恢复、原片／日志／HLS及正式产物不变。第一条命令漏传--audit导致旧30467期望超时，保留失败；补正确独立审计后通过。另修截图等待面板收起完成，最终两尺寸均目视核对。
- 原生证据client-local-icons-native-final/report.json；资源及产物证据spell-icon-completion。报告docs/research/client-local-icons-validation-2026-10-17.md。debug与Release NSIS均构建退出0，各754项清单资源及NOTICE核对；本次未重跑Rust／后端／真实团队服务／硬件直播，不把前阶段结果当本轮执行。

## 最新：按模块提交当前全部改动

- 用户再次明确授权将全部修改按工作模块提交。已完成本地提交：分类资料678e53b、团队死亡API及快照4c1334d、客户端死亡复盘babd6cf、原生拖放505bfca、验收脚本dd803e4、已有导入排序731da67、验收文档908d2bd；项目交接另作本批最后提交。没有推送，后续新增改动不自动继承本批提交授权。
- 本次重新执行git diff --check及各批git diff --cached --check，均退出0；客户端node死亡／分类／等待回归16通过、0失败，退出0。57个改动文件的私钥、GitHub令牌及AWS密钥特征扫描无命中；不将特征扫描称为完整安全审计。本次未重新运行后端、Rust、构建或原生整链路，既有证据见下文。
- 当次提交时尚有11项缺图；后续补图及验证以顶部最新章节为准，不再作为当前缺口。

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

- 正式debug与Release NSIS均构建退出0。当前安装包client/src-tauri/target/release/bundle/nsis/WoW Recorder_0.1.0_x64-setup.exe为125173673字节，SHA256 374decc92a0a81e85ff6a436c0fb6e24cc1b7e1216f2e899295b35b603a78119。
- Release EXE21539328字节／SHA 12733d4a9b707309502da4ee68cdb7aa420f375a6499f7c243a85481fcb6ac76；debug30619648字节／SHA 468f2d2a64d4751faf92bc1f6c7bef8d702ef4e326150471cbf1d72c7c46eb03。两套x64、正式标识且无验收标识，Release为GUI子系统2；各754项清单资料大小／SHA一致，NOTICE原文一致。最终摘要为client-recording-replay-build-artifacts.json，旧补图包摘要仅为历史。
- 当前前端index-DIcewbNX.js／index-DC5zoM1x.css，修复明确暂停定位及回放用语；未安装／卸载或启动正式用户应用，Web包未重建。撤下的分析／死亡控件构建不是当前交付物。
- docs/research/client-recording-replay-validation-2026-10-18.md为最新入口，单场实际回放截图已目视核对。前阶段补图及云端报告保留，不覆盖本轮真实WoW采集、生产WCL或其他成员实拍。
- 当前正式产物摘要为client-recording-replay-build-artifacts.json；spell-icon-completion/build-artifacts.json是补图阶段历史。各阶段测试范围及默认矩阵忽略数量以顶部单场记录和最新报告为准，本次状态核对未重跑测试，不把旧安装包摘要当当前值。
- 临时wow-replay-phase2-20261017中client-track-details-native-large-group、client-track-details-native-exit-verified、client-track-details-death-regression、client-track-details-browser-modular各report.json，以及client-track-details-build-artifacts.json可追溯；client-track-details-browser-final为适配拆分前同构建结果，client-track-details-close-repro为旧EXE先失败证据。浏览器入口与IPC夹具已拆分，原生不加载mock。不要打印private.json或令牌／服务凭证。

## 后续

- 用户最终要求的实际单场录制和回放已核验，以顶部正式录制补正为准。不要因旧结论重复要求重新打一场或自行添加分析。生产WCL、私有OAuth、多人精度及自动漂移保留为后续规划，不作为当前单场录制前置条件；后续扩展等用户新要求。
- 指定样本缺图已清零，未来新增技能／热修仍需独立核对；私有WCL OAuth／账号邀请、地城组合轴／外部播放器以及实战跨设备精度／硬件长录／磁盘／安装卸载／Linux生产矩阵未完成。触摸硬件未专项验收，强杀／断电不等于正常退出保存保证。
- 本轮PG／MinIO／Redis均已正常停止，schema／桶／死亡缓存键0，验收应用／FFmpeg／ffprobe残留0。正式配置的MediaMTX保持运行，后续必须重新核对进程范围，不能按历史PID停止它。完整目标继续进行，不因当前安装包或阶段测试通过而标记全产品完成。
