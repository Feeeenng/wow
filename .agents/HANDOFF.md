# 当前工作交接

更新时间：2026-10-17（Asia/Shanghai）。恢复历史按INDEX.md查询，不默认加载全部月度记录。

## 当前目标与约束

- 优先客户端，Web暂不扩展；客户端统一使用自身全局Ant Design版本主题，不能与ReviewTool完全一样。不使用superpower skills，不自动提交／推送，不运行正式用户应用或安装包。
- 用户本次明确要求将全部现有修改按工作模块提交；已完成资源ae3f1ad、解析6e1e8e2、客户端复盘6eb02f6、退出保存7392463、验收脚本3e25141及验收文档c35fde4，并另行提交项目交接记录。仅本地提交，没有推送；后续新改动仍按阶段提醒，不延续本批授权自动提交。
- 指定两份CombatLog与D:/wcl/warcraft-live原片只读。云端测试只传合成媒体，不上传原片／日志。当前本轮只改客户端及共享显示规则，没有后端／迁移／依赖或Web功能扩展。

## 最新完成：轨道详情及正常退出保存

- 客户端分组详情20项分页，后续页可用方向键／回车选择目标及按原时间回看。同一归属／来源／技能／类型才可整体拖动，混合规则组禁拖；缺失来源、nil及零GUID不能新建覆盖，WCL报告actor仍可用，旧规则格式不迁移。
- 反馈使用全局主题边框，换源／索引版本／不可操作时取消拖动，规则判定随数据／布局计算而不随每帧游标重扫。新组合框读屏名称为技能／人物／时间，不暴露内部事件ID。
- 新增正常关闭前排空最新回放偏好及在途保存，失败取消关闭并全局提示；成功解除自身监听后走现有close权限，不增加destroy权限。防抖500ms保留，关闭中冻结新的偏好更新，启动未成功读取时不以默认值覆盖源数据，LocalStateStore格式不变。
- 验证发现原生脚本误用waitForFunction异步谓词会提前结束，改用waitUntil显式await后轮询并新增2项回归。修正等待后原普通写盘／重启正常；再用旧独立EXE明确复现防抖内立即关闭未保存（退出后高度仍30而非31）。当前修复后的实际磁盘30→31、重启31，原生验收强杀次数0。

## 当前验证与边界

- 纯模块40通过，死亡／异步等待附加8通过；当前浏览器28通过、pageErrors空，含75项密集后页键盘移轨、同名GUID隔离、同规则真实拖拽、未知来源禁用、关闭失败／恢复（此失败为明确IPC夹具）。
- 当前独立Tauri／WebView2实际原生5组通过，真实38850事件、26项混合分组第2页，验证键盘写入Rust、重启恢复、返回默认删除覆盖、全量事件摘要不变及立即离页关闭保存。forcedStops为0，索引及client-state按字节恢复、原片／HLS／源索引SHA不变，正式产物未被测试修改。
- 当前死亡恢复回归7组通过，包含真实窗口数值与独立CSV、本人／关联控制视角、日志缺失／不支持／换源及恢复。关联视角为同源媒体控制记录，不冒充其他成员实拍；正常UI错误片段在临时目录完成后删除。
- Rust业务源码本轮未改，122通过／3辅助忽略为上一死亡阶段基线，后端与Web矩阵未重跑；临时Rust诊断已移除。之前三场死亡975／38850／12644事件、明细37／656／314及独立数值20／312／120的原生证据仍保留。100ms媒体容差不是实战采集同步精度。

## 当前产物

- 正式debug与Release NSIS均构建退出0。安装包client/src-tauri/target/release/bundle/nsis/WoW Recorder_0.1.0_x64-setup.exe为125119733字节，SHA256 83d6357b13ab159f8de92418e3bf0ba29d63716aefb7993c6fda0826c39edb96。
- Release EXE21281792字节／SHA 65cfc86e99f07e2e4b3db5a2758fd7926a9c590a8d791b2addcecc5921b14963；debug30505984字节／SHA b3100186eeba8b8e9f14becebfbcfa9768b0cc48cea94c4378deb690282e1c2e。两套x64、正式标识且无验收标识或临时诊断，Release为GUI子系统2；各743资料及8探测文件大小／SHA一致，许可原文一致。
- 当前前端index-B3hv3wKy.js／index-CbFP4sl8.css，替代之前死亡阶段包。未安装／卸载或启动正式用户应用，Web包未重建。
- docs/research/client-track-details-validation-2026-10-17.md及阶段总表为最新入口。images/client-track-details-native-1440／1080-20261017.png为真实26项分组第2页，截图没有构造其他成员视角。上一死亡阶段截图及记录保留为历史。
- 临时wow-replay-phase2-20261017中client-track-details-native-large-group、client-track-details-native-exit-verified、client-track-details-death-regression、client-track-details-browser-modular各report.json，以及client-track-details-build-artifacts.json可追溯；client-track-details-browser-final为适配拆分前同构建结果，client-track-details-close-repro为旧EXE先失败证据。浏览器入口与IPC夹具已拆分，原生不加载mock。不要打印private.json或令牌／服务凭证。

## 后续

- 继续客户端深入死亡分析：可靠减伤／耗材分类、明确致死关联、云端死亡明细、阶段分析和自动漂移，不按名称或相邻事件猜测事实。当前本地死前15秒及生命离散采样／已观测光环已可用。
- 仍有11项样本技能缺图、私有WCL OAuth／账号邀请、地城组合轴／外部播放器以及实战跨设备精度／硬件长录／磁盘／安装卸载／Linux生产矩阵未完成。触摸硬件未专项验收，强杀／断电不等于正常退出保存保证。
- 基础测试服务上一轮已停止，本轮原生测试不启动PG／S3／Redis；最终端口／进程复查见临时验收文件。完整目标继续进行，不因当前安装包或阶段测试通过而标记全产品完成。
