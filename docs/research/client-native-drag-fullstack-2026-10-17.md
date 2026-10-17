# 客户端原生拖轨与真实服务死亡复盘验收

日期：2026-10-17（Asia/Shanghai）。继续优先客户端，沿用全局Ant Design主题，Web界面未扩展；没有新增依赖、数据库结构或迁移，没有自动提交／推送。

## 修复内容

本轮将团队死亡面板接到实际Rust、FastAPI、PostgreSQL、Redis、私有MinIO及独立Celery worker／beat，使用两路明确合成录像完整上传、转码和播放。只有WCL上游为本地HTTP协议服务，没有把它称为真实生产WCL报告，也没有上传用户原片或日志。

核对官方接口后发现死亡读取没有显式开启includeResources，原来的协议数据直接返回生命字段，掩盖了默认关闭的问题。先将回归改为要求显式资源请求，实际得到1项失败；再为死亡窗口单独开启includeResources:true，整场关键事件导入保留原查询。新的HTTP协议服务在不开启资源时移除资源字段，同一事实集同时服务整场导入与死亡窗口。依据：[WCL事件接口说明](https://de.warcraftlogs.com/v2-api-docs/warcraft/report.doc.html)。

真实Windows鼠标也复现了默认Tauri窗口接管拖放的问题：浏览器层模拟能产生drop，但OS输入仅出现dragstart／dragend，没有dragover／drop，Rust规则未写入。主窗口新增dragDropEnabled:false，允许HTML5技能移轨；现有文件导入使用原生选择器，代码没有原生文件拖放监听。依据：[Tauri WindowConfig说明](https://docs.rs/tauri-utils/latest/tauri_utils/config/struct.WindowConfig.html)。没有用模拟drop或强制写入偏好冒充拖放通过。

验收脚本同时修正三个边界：Node信号退出时exitCode仍为null，需要同时检查signalCode；独立数据先保存备份，异常路径仍恢复；切视角允许重绑实际视频元素，检查的是单路媒体、时间及参数保持，而死亡窗口打开／重读必须保留当前媒体。新增真实子进程正常退出和信号退出回归各1项。

## 验证方式与结果

| 验证入口 | 结果与实际范围 |
|---|---|
| pytest死亡读取定向回归 | 修复前资源开关1失败，修复后死亡／资源HTTP协议／原WCL适配器29通过 |
| backend目录pytest tests -q | 115通过、16服务测试跳过、0失败，10.51秒；不把跳过计为通过 |
| 显式隔离环境tests/integration/test_wcl_postgres.py | 真实PG／Redis／API及loopback WCL协议2通过，0失败；包括签名、缓存、换版、缺配置及权限 |
| 独立CARGO_TARGET_DIR下cargo test --lib -- --quiet | 124通过、3辅助忽略、0失败，16.71秒；不启动正式用户应用 |
| node --test --test-reporter=spec tests/replay-review.test.cjs tests/review/mechanics.test.cjs tests/wait-until.test.cjs | 16通过、0失败，包含新增实际子进程信号退出回归 |
| native-cloud-replay.cjs --death-review --drag-trace --windows-mouse | 当前13组通过，实际Windows鼠标drop、DOM轨道及Rust规则写盘，移轨前后播放位置／参数不变；另含260条死亡窗口、异常恢复及换凭证隔离。API及媒体为明确协议夹具 |
| native-real-cloud.cjs --with-death-review --with-annotations --windows-mouse | 当前15组通过，实际两路Multipart／首片确认后正常退出恢复／完整SHA、独立worker发布、私有HLS、WCL关键事件导入、死亡快照、真实鼠标个人轨道及重启、画笔PG保存／CAS／角色隔离、换版及真实撤权 |
| native-real-workbench.cjs --death-review --pull-index 1 | 当前9组通过，38850个实战关键事件，指定原日志／本人原片／既有HLS只读，数值、生命采样、治疗石及药水仍与独立CSV一致；关联视角为同源控制样本，不冒充其他成员实拍 |

真实服务中的WCL事实集267条，关键时间轴仍为7条；死亡窗口263条分250＋13两页，伤害记录值27040、治疗记录值6630、一个明确目标生命采样80／100。来源不是用户实战数据，不推断有效量。窗口两页都显式请求资源，后续IPC分页命中真实Redis，TTL有效，跨视角／篡改游标被拒绝，普通成员可读、撤权后当前有效死亡游标返回403。

关联视角按明确绑定定位窗口起点，暂停、1.25倍速、0.35音量及静音保持；打开／重读死亡面板不重建当前视频。个人规则经真实鼠标移入自定义轨道、Rust写盘、原生重启及删除恢复，原云事件及视频映射不变。撤权检查先确认当前媒体地址200，再用同一地址验证失败，避免把换凭证前已失效的旧地址误当撤权证据。

原生13组与真实服务15组pageErrors均为空、forcedStops均为0，隔离index／client-state逐字节恢复；真实服务schema、私有桶和Redis键清理成功、API与worker进程停止。用户实战回归的原片、HLS、源索引以及测试期间保护的正式产物摘要不变。

最新证据在临时wow-replay-phase2-20261017的client-real-cloud-death-visible-final、client-visible-drag-os-final及client-native-drag-local-regression各report.json；资源开关服务联调为client-real-cloud-death-resource-service-tests.txt。真实服务界面[截图](images/client-real-cloud-death-native-20261017.png)显示的是合成媒体及WCL协议数据，不是生产报告或其他成员实拍。

## 原生输入与现场保护

OS鼠标路径使用Windows UI Automation读取当前独立窗口的实际元素矩形，再通过SendInput发送鼠标；调用方继续核对网页drop、显示归属和Rust持久值。发送成功本身不算功能通过。依据：[Microsoft MOUSEINPUT说明](https://learn.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-mouseinput)。源／目标点、PID、EXE路径及验收标识均先检查，释放鼠标及恢复临时置前状态有finally保护，不向其他应用发送输入。

原来的隐藏窗口、启动隐藏标志及不合适的坐标等待导致若干验收假失败，已改用启动即显示的独立验收配置；工具日志保留实际失败证据。computer-use路径因Orca运行时反复退出而不可用，未计为通过；后续Windows驱动及实际写盘证据独立成立。SVG交互仍由实际WebView2中的CDP鼠标完成，技能移轨另走OS输入，不混称全部都是实体鼠标硬件验收。

调试目录中的正式MediaMTX进程占用了其EXE，默认调试构建曾返回os error 32。没有停止该正式进程，改用target/native-drag-validation独立Cargo目录构建；正式调试EXE在没有正式主进程运行时单独更新，运行时资源不覆盖。没有运行正式用户应用或安装包，也没有关闭全局WSL或其他用户服务。

## 尚未完成

真实生产WCL公共报告及私有OAuth、多人实拍对齐精度、明确致死关联、技能分类覆盖／热修证据、阶段分析、自动漂移、触摸／多DPI及长时间硬件录制／发行矩阵仍需补齐。完整目标保持进行中，本轮结果不能证明以上未覆盖项完成。

## 交付产物

正式debug和Release NSIS构建均退出0；没有执行正式应用或安装包。当前安装包client/src-tauri/target/release/bundle/nsis/WoW Recorder_0.1.0_x64-setup.exe为125140416字节，SHA256 c21b4848053f5c269c1216b99bce86cbd91d59fa6f83754b688bf3039f138724，包含原生HTML5拖放窗口配置。

当前debug为30619648字节、SHA256 33a781590ec4bc942a6c07f285822ba068ad7eb38ed7580a0e85f5d5bfc49123；Release为21539328字节、SHA256 0561f03be6d9b9034b14df5079a2fd4368a08b809327ea86ec78f733ee80b3fb。两套x64、正式标识且无验收标识／临时诊断，Release为GUI子系统2；每套743项资料及8项探测文件逐大小／SHA一致，许可原文一致。最终摘要为临时client-native-drag-build-artifacts.json。

原生验收使用client-native-visible-validation.json及单独保存的client-native-visible-build/wow-recorder-client.exe，窗口visible:true、dragDropEnabled:false，实际OS鼠标模式还带--windows-mouse。旧隐藏配置只能用于对应的浏览器层检查，不能据其CDP截图宣称真实桌面鼠标已通过。前端仍为此前已核对的index-BAQphv4C.js／index-DC5zoM1x.css，本轮没有修改React业务源码。

收尾确认测试schema、私有桶及缓存键0残留，临时PG／MinIO／Redis均已停止，相关开发／测试服务端口无监听，没有验收客户端／FFmpeg／ffprobe残留。正式MediaMTX进程属于已有正式配置，保持运行，未将它算成本轮验收进程或强行停止。
