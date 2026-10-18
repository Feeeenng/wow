# 单场视角录制与视频回放验证

日期：2026-10-18（Asia/Shanghai）。用户明确将当前目标收敛为一场战斗的当前玩家视角完整录制、成片保存和视频回放，视频与时间轴优先，Web暂不推进，死亡分析暂不考虑。

最终补正：只检查当前进程曾漏掉正式客户端已保存的真实录制。现已核验2026-10-17 20:10:26的英雄盘魂者内克扎莉击杀录像：非导入、1920×1080／30fps、H264／AAC、293.989秒，完整覆盖282660ms战斗，并在当前客户端读取45044事件及回放通过。片尾有击杀后的拾取画面，实际单场录制闭环已有证据，无需为此重新打一场。下文“尚缺现场证据”属于发现正式索引前的历史状态，最终结论以末节为准。

## 当前改动

本轮未交付的致死分析及独立死亡选择工作流均已撤下，相关临时client-fatal-*及client-death-playback-*结果只保留为历史，不作为当前功能或验收。没有提交或推送，没有新增依赖、数据库结构或配置开关。

当前保留一般视频问题修复：useVideoSeek收到明确play:false时会调用pause，undefined继续保持原播放意图。原行为只在true时调用play，没有处理false，导致从播放状态请求暂停定位时画面继续前进。该现象曾在真实浏览器回归中复现，修复后暂停／连续跳转及视角切换保持通过。本地、团队及全屏用语统一为“回放”；既有死亡明细降为次级入口，没有作为录制或播放前提。

前阶段技能补图继续保留，指定样本1036项技能均有图，当前资料1040项技能、751张图片；来源及构建边界详见[补图验证](client-local-icons-validation-2026-10-17.md)。

## 录制及媒体实测

执行既有native-obs-whip.cjs，真实启动独立便携OBS32.2.1及随机回环端口MediaMTX，唯一输入是合成色条和正弦音频。8项全部通过、退出0、errors为空。产生两份H264／AAC录像，18.047秒及3.370秒，共21.417秒，全部完整解码；同时验证实际WHIP、WHEP、HLS、录像暂停恢复、手动分片、媒体节点中断后本地录像继续及恢复。

没有启动游戏，没有捕捉屏幕或麦克风，没有读取正式OBS用户配置，没有停止已有正式MediaMTX。原OBS公共运行时摘要未变，ownProcessesExited为true，结束后无本轮OBS、FFmpeg、验收客户端残留。该结果证明本机编码及媒体链路，不代表真实WoW捕捉、硬件编码、长录或实际战斗自动识别已经现场通过。

证据：临时wow-replay-phase2-20261017/single-battle-recording-20261018/report.json。

## 实际执行的验证

| 命令／入口 | 结果与范围 |
|---|---|
| cargo test --lib -- --quiet，独立CARGO_TARGET_DIR | 124通过、3辅助忽略、127总计，退出0；16.77秒，含战斗状态机、录制来源、时钟、媒体成片及帧映射 |
| 显式WOW_REPLAY_REAL_SAMPLE_DIR下cargo test --lib rebuild_real_encounters_matches_independent_audit -- --ignored --nocapture | 1项通过、126过滤、退出0；13.61秒，四场用户授权实战索引与独立CSV一致，不写正式应用索引 |
| node client/tests/native-obs-whip.cjs | 8项通过，真实OBS录出文件及完整解码，合成输入边界如上 |
| npm run build | TypeScript及Vite退出0，4964模块；DIcewbNX.js／DC5zoM1x.css，保留既有大包提示 |
| browser-replay.cjs | 当前28项通过、pageErrors和consoleErrors均为空；真实浏览器／HLS，IPC为明确夹具，覆盖播放暂停、连续定位、时间轴、校准、跨页／跨视角及最小窗口 |
| native-real-workbench.cjs --spell-icons并提供独立--audit | 当前真实Tauri／WebView2通过，38850实战事件、原视频播放及11项补图本地协议／解码；pageErrors空、forcedStops为0，索引及client-state逐字节恢复，原片／HLS／源索引及测试期间正式产物不变 |

浏览器证据client-recording-replay-browser-final/report.json，原生证据client-recording-replay-native-final/report.json。两种窗口截图均目视核对，工作台保持视频在上、战斗时间轴在下，不使用分析面板遮挡视频。实际录像属于用户提供的实战样本，不能把播放它称为本项目刚刚录制的真实游戏画面。

当前[实战视频回放界面](images/client-recording-replay-20261018.png)沿用统一主题，主内容保持原录像和时间轴，没有本轮撤下的死亡选择控件。

## 当前交付产物

正式debug no-bundle与Release NSIS均构建退出0，没有执行正式应用或安装包。调试构建沿用独立Cargo目标目录，避免占用已有正式MediaMTX的EXE；只在无正式主进程时更新调试EXE，没有停止该正式媒体进程。两套正式EXE均为x64，包含当前index-DIcewbNX.js资源名、正式标识且无验收标识，Release为GUI子系统2。

安装包：client/src-tauri/target/release/bundle/nsis/WoW Recorder_0.1.0_x64-setup.exe，125173673字节，SHA-256 `374decc92a0a81e85ff6a436c0fb6e24cc1b7e1216f2e899295b35b603a78119`。

Release EXE21539328字节，SHA-256 `12733d4a9b707309502da4ee68cdb7aa420f375a6499f7c243a85481fcb6ac76`；debug30619648字节，SHA-256 `468f2d2a64d4751faf92bc1f6c7bef8d702ef4e326150471cbf1d72c7c46eb03`。两套各754项资料的大小及SHA匹配源清单，NOTICE逐字节一致；最终摘要在NSIS完成后读取，见临时client-recording-replay-build-artifacts.json。

四场实战索引当前分别975／38850／86791／12644条，与独立CSV相符。它们证明事件事实及来源没有丢失，不证明实际采集时钟精度或本轮新录制了这些历史战斗。

## 单场录制就绪检查与边界

只读检查现有正式设置：指定WoW Logs目录存在、monitoring为true；game_capture目标包含Wow.exe，输出1920×1080、30fps。没有改写正式设置或启动正式用户应用。

代码链路是游戏画面捕捉就绪后持续录像，CombatLog的ENCOUNTER_START／END形成单场窗口，尾帧结束后切分来源并异步成片。Rust默认矩阵及真实OBS／媒体验证分层覆盖这些能力；没有运行中的WoW，无法在本轮完成“实际进入一场战斗并录出当前角色画面”的最终现场验收。日志与视频的物理同步精度也不能用播放器0.1秒定位容差证明。

当前后续只围绕实际单场采集、成片完整性、视频播放和时间轴定位继续。死亡归因、伤害治疗、减伤耗材及阶段分析不进入当前工作目标；不把隔离测试或旧分析测试当成完整产品目标已完成。

## 补充：真实单场成片验证

新增显式忽略的processes_one_real_battle_with_production_clip_pipeline验收入口，读取授权样本第二份录像及原始日志，调用生产map_clip_sources／process_clip，生成全新的隔离MP4、HLS及旁车，不覆盖已有文件。通过WOW_REPLAY_REAL_SAMPLE_DIR及WOW_REPLAY_REAL_CLIP_OUTPUT显式指定输入和全新TEMP输出目录；命令cargo test --lib processes_one_real_battle_with_production_clip_pipeline -- --ignored --nocapture退出0，1通过、127过滤，用例38.10秒。新增的是验收代码，没有修改生产成片行为；此前默认124／3的结果仍为新增此忽略用例前的基线，不能把默认忽略当通过。

新成片约183.233秒、190455123字节，覆盖完整174663ms战斗及前后画面；MP4和HLS都通过严格完整解码。独立ffprobe检查确认MP4保留原始6条音轨，HLS沿用产品约定的第一条音轨。新MP4 SHA-256为5b242c62f3cf350af0bab92a4962ce9d16ef21df5e858ec34b0330878df12665，原视频SHA及原metadata.json逐字节保持不变。

进一步独立提取开战、战斗中点、战斗结束三处源视频／新成片画面：按实际PTS校准映射，在一帧（30fps）范围内均找到完全相同的解码帧摘要。这证明基于原旁车映射的画面保留，没有证明游戏日志与采集时钟的物理同步精度。

证据在临时single-real-battle-clip-20261018的validation.json、stream-verification.json及frame-verification.json。这是从既有实战录像派生的单场文件，不是本轮实时捕捉WoW。安装包及生产代码未因此变化，正式产物仍以本报告当前交付产物为准。

新成片又经真实Tauri／WebView2回放，38850个事件及11项补图读取通过，pageErrors空、forcedStops为0，隔离状态恢复，源片／HLS／索引和正式产物摘要未变。第一次验收索引仍将旧片标为新片来源，客户端正确拒绝“原片路径与索引不一致”；仅修正TEMP验收索引，将新MP4作为该次回放的只读导入源，没有修改或放宽生产路径保护。最终证据single-real-battle-native-verified-20261018/report.json。

## 最终：正式客户端已保存的实际录制

正式recording-index.json有11条记录，其中3条ready、8条failed；本次选取最近的非导入ready记录88d4219c266a7af0d142ff1116f66ac52364419ef0f2b846485828b910c3fb0e。其源片为OBS生成的C:/Users/Admin/Videos/2026-10-17 20-08-15.mp4，正式成片和HLS均已存在，不是此前D:/wcl原片的导入，也不是本轮合成画面。未启动或改写正式应用。

实际录像参数为H264、1920×1080、30fps及AAC，文件293.989323秒、368152241字节。原始WoWCombatLog-101726_171833.txt的精确字节边界分别为ENCOUNTER_START／END，CST时间2026-10-17 20:10:26.541至20:15:09.201，encounterId3470、击杀成功，与正式索引逐项相同。映射无缺口并覆盖完整282660ms战斗，相关闭合源片仍存在。首、中、结束及片尾画面均目视确认是WoW实战，片尾包括击杀后的拾取，不是黑屏或只录到开场。

对正式MP4和HLS分别执行FFmpeg -xerror完整视频／音频解码，均退出0且stderr为空。将只读录像及索引快照挂载到独立验收AppData后，当前真实Rust／WebView2成功播放、读取45044事件及11项补图；pageErrors空、forcedStops0、隔离状态恢复。正式索引、client-state、MP4及HLS共41个受保护文件的前后大小／SHA全部一致。该验证只将正式产物作为隔离播放的只读输入，原始正式索引的importedSource始终为null。

证据位于临时formal-capture-audit-20261018：boundary-verification.json、media-info.json、mp4-decode.json、hls-decode.json、final-audit.json及native-playback/report.json。已目视核对[当前客户端实际录像回放](images/client-actual-recording-replay-20261018.png)和[片尾拾取画面](images/client-actual-recording-tail-20261018.png)。

8条历史失败均没有可用的闭合源录像：前三条时间上有旧来源但无仍可用的闭合文件，后五条没有对应时间段来源。没有把它们改成成功、删除或尝试补造画面。它们不影响本次已核验的完整实际单场；本结论不代表所有历史失败已修复、所有硬件／长录／跨设备精度或生产云端矩阵完成。

此前因未查正式索引而提出的“需要再打一场才有实际采集证据”已撤回。按用户最终收敛的单场视角录制及回放目标，实际闭环现已核验；没有新增死亡分析，未提交或推送，正式安装包摘要保持不变。
