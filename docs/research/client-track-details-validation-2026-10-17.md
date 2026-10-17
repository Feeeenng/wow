# 客户端轨道详情与退出保存验证

日期：2026-10-17（Asia/Shanghai）。本轮继续客户端，Web暂不扩展；保持项目自身全局主题，不复制ReviewTool外观，没有自动提交／推送或运行正式安装包。

## 实现与兼容

时间轴分组详情新增目标轨道组合框，方向键与回车可操作。详情按20项分页，后续页同样能定位和移轨，界面说明同一归属、来源、技能及类型的事件会统一应用规则。分组只有全部事件属于同一显示规则才允许整体拖动；混合来源或类型不能整体拖动，保留逐项选择入口。

真实GUID及WCL报告内actor身份均可生成覆盖，缺失来源、nil或零GUID不能创建新覆盖，避免按同名或未知身份合并。旧存储格式及已有规则不迁移，仍可通过布局管理清除；共享赋值函数加强来源检查，Web本轮未新增界面或验证。所有操作保持日志事件、来源、时间及团队配置原样，只修改个人显示规则。

拖动反馈使用全局主题边框，数据源／索引版本／可操作性变化时撤销当前拖动。分组同规则判定在事件或布局变化时计算，播放游标更新不重新扫描整场来源身份。组合框可访问名称包含技能、人物和实际时间，内部事件ID只用于数据身份及测试定位。

## 正常退出边界与验证修正

原生验收脚本误用waitForFunction的异步谓词：Promise对象被当作满足，解析为false后也不再轮询。修正为显式await读取与条件的waitUntil，并新增回归，证明false时继续等待、超时必须失败、读取错误不能被吞掉。当前client/tests中已无异步waitForFunction谓词。

等待修正后，旧独立EXE的实际写盘及重启正常，但另一个真实边界被明确复现：将高度30改为31后立即离页关闭，500ms防抖未触发，退出后磁盘仍是30。旧版本前4组通过，第5组失败，不能把未落盘误称已保存数据丢失。

ReplayProvider因此增加主窗口正常关闭前排空最新快照及在途保存。关闭中冻结新的偏好更新，保存失败保留窗口并以全局主题消息提示；成功解除自身监听，再走原有close权限，不需要新增destroy权限或修改能力配置。启动尚未成功加载偏好时不写默认值覆盖源数据，LocalStateStore格式不变，瞬时连接／播放状态不持久化。

修复后，实际退出前文件仍是30，正常关闭后已是31，重启读取为31，同时刚删除的自定义轨道没有重新出现。原生重启验收明确禁止依赖测试强杀，forcedStops为0。强杀／断电仍不等同正常关闭，不保证最后未落盘的修改。

## 实际验证

| 命令／入口 | 结果与边界 |
|---|---|
| client目录npm run build | TypeScript及Vite成功；保留既有大chunk提示 |
| client目录npm run test:replay | 40通过、0失败，新增未知来源禁止覆盖及WCL actor可用回归 |
| node --test tests/replay-review.test.cjs tests/wait-until.test.cjs | 8通过、0失败；含死亡逻辑及异步等待回归 |
| client/tests/browser-replay.cjs | 当前28项通过，pageErrors为空；真实React／HLS.js／合成媒体，IPC为明确夹具 |
| 75项密集分组及一个未知来源事件 | 混合禁拖、后续页键盘移轨、同名不同GUID隔离、同规则分组真实鼠标拖拽、移回默认后删除覆盖、后续页原时刻定位、原事件JSON及媒体实例不变 |
| 浏览器关闭失败／恢复 | IPC夹具模拟写入失败，取消关闭且状态保留；恢复后关闭快照包含最新值，不代表真实磁盘故障硬件测试 |
| native-real-workbench.cjs --track-details --pull-index 1 | 当前独立Tauri／Rust／WebView2原生5组通过：真实26项混合分组第二页移轨、键盘写盘、重启恢复、返回固有轨道／全量事件不变、立即离页关闭保存；原始38850事件摘要一致，forcedStops为0 |
| native-real-workbench.cjs --death-review --pull-index 1 | 当前7组回归通过，死亡数值仍与独立CSV一致，包含源缺失／不支持／换源及恢复 |

两个原生入口均显式提供独立EXE、隔离源索引、审计目录及Playwright路径，拒绝正式应用标识。当前原生脚本读取实际IPC结果，等待进程真实退出后才重启，不用内存值或观察超时推断成功。原片、HLS及源索引SHA不变，隔离索引和client-state按字节恢复，测试进程已停止。

原生最终证据位于临时wow-replay-phase2-20261017的client-track-details-native-large-group、client-track-details-death-regression；client-track-details-native-exit-verified为同版本前一次退出验证，浏览器适配拆分后的结果为client-track-details-browser-modular，之前同构建结果为client-track-details-browser-final。浏览器入口与明确IPC适配器分离，原生不加载该适配器。旧EXE快速关闭失败证据为client-track-details-close-repro。Rust业务代码本轮未改，122通过／3辅助忽略是上一死亡阶段基线，不声称本轮重跑全部Rust、后端或Web矩阵。

真实日志分组第二页界面：[1440×900](images/client-track-details-native-1440-20261017.png)、[1080×720](images/client-track-details-native-1080-20261017.png)。样本只含真实本人录像，没有构造其他成员视角；大组逐页读取并确认多种规则，随后选择第2页实际记录进行移轨。

## 产物与限制

正式debug及Release NSIS构建均退出0。当前安装包client/src-tauri/target/release/bundle/nsis/WoW Recorder_0.1.0_x64-setup.exe为125119733字节，SHA256 83d6357b13ab159f8de92418e3bf0ba29d63716aefb7993c6fda0826c39edb96。

Release EXE为21281792字节，SHA256 65cfc86e99f07e2e4b3db5a2758fd7926a9c590a8d791b2addcecc5921b14963；debug为30505984字节，SHA256 b3100186eeba8b8e9f14becebfbcfa9768b0cc48cea94c4378deb690282e1c2e。两套x64、正式标识且无验收标识／临时诊断，Release为GUI子系统2，各743项资料及8项探测文件逐大小／SHA一致，许可原文一致。

当前前端index-B3hv3wKy.js／index-CbFP4sl8.css；摘要见临时client-track-details-build-artifacts.json。未安装／卸载或启动正式用户应用，触摸硬件未专项验收。阶段分析、减伤耗材可靠分类、自动漂移、实战跨设备精度和其余发行矩阵仍待完成，不能据本轮通过宣称全产品完成。

收尾重新核对安装包摘要、分别包含28／5／7组场景的三份报告及49个变更文本的UTF-8／行尾空白，未发现异常，新增或修改代码没有超过500行项；git diff --check退出0。浏览器入口已拆出明确IPC适配，client/tests不存在异步waitForFunction谓词。1420／1421／1422及25432／29000／29001／26379端口无监听，当前验收应用／FFmpeg／ffprobe进程残留0；这些非执行式检查不重复计入业务测试通过数量。
