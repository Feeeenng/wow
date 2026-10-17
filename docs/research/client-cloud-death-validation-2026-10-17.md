# 客户端团队死亡复盘验证

日期：2026-10-17（Asia/Shanghai）。本轮优先客户端，Web界面不扩展，沿用客户端全局主题；没有新增数据库结构、迁移或依赖，没有自动提交／推送。

本报告保留团队死亡阶段的分层证据与当时产物。后续已补资源请求开关、原生HTML5拖放及客户端到真实后端的15组整链路，当前验收及安装包以[原生拖轨与真实服务专项](client-native-drag-fullstack-2026-10-17.md)和阶段总表为准；WCL上游仍是明确协议服务，不是生产报告。

## 实现与兼容

团队时间轴中的玩家死亡现在按WCL报告内actor识别，空游戏GUID不再导致入口被过滤。客户端通过Rust调用团队死亡API，平台令牌和WCL凭证均不进入React。窗口与本地死亡面板共用展示契约，但读取器明确区分combatLog和wcl来源，不能将两种分页混合。

现有WCL导入只保存关键时间轴，不含伤害和治疗明细。本轮保留导入和表结构，由后端按已发布快照绑定的报告、fight、版本和死亡身份按需读取默认死前15秒。API为GET /api/v1/teams/{team_id}/recordings/{recording_id}/death-review，参数event_id、cursor、limit及显式refresh。成员权限、录像范围、当前已发布快照与玩家死亡身份每页重新检查，缓存不代表授权。

后端review领域的query负责授权、既有PG查询及显式录像actor绑定；reading负责有界WCL分页和前后报告核对；normalization负责来源字段投影；snapshots负责Redis短期快照与独立用途的HMAC游标，配置位于既有Settings模块。没有把业务逻辑堆入API或入口，也没有通过负ordinal或扩展时间轴类型偷存明细。

窗口最多保留最近5000条、每页250条，截断明确披露；前置光环从既有完整关键事件读取，保留最多2000条，不能代表开战前完整状态。读取整体默认20秒、单个WCL请求最多5秒，响应和暂存均有预算。数值只认已提供且合法的记录值，零值保留，负哨兵、布尔和超出安全整数的量保持未知；targetResources才可成为目标生命采样，sourceResources不能冒充死者生命值。

Redis只缓存带完整内容摘要的ready窗口，默认120秒TTL；不可用或过期则回源。游标绑定团队、录像、已发布快照、死亡、窗口内容摘要和位置；回源后内容变化必须重新读取，不能拼接新旧页。官方说明事件数据可能变化，不能仅凭报告revision认为数据永远不变，参见[WCL Report事件接口](https://cn.warcraftlogs.com/v2-api-docs/warcraft/report.doc.html)。显式重新读取绕过缓存；未配置、报告变化和读取失败区别完整空窗口。

本人／相关录像只认报告中的显式actorBindings和同团队／同Pull，不按姓名或角色GUID猜WCL角色。客户端换账号、团队或凭证代次清除云端快照，迟到响应由Rust连接检查和Provider范围检查共同隔离；导航保留当前进程最近三份快照，不写浏览器存储。目录显示的标准事件版本变化时，旧窗口提示重新选择死亡。光环标签也使用报告actor键，避免空GUID导致不同来源同技能重复React键。

WCL面板明确说明来源口径不同，不能跨来源直接相加；当前未将本地固定版本减伤资料应用于WCL，仍保留完整施法、增益和数值记录。不推断直接致死技能、责任、实际减伤量或未使用结论。

## 已执行验证

| 命令／入口 | 结果与边界 |
|---|---|
| backend目录.venv/Scripts/python.exe -m pytest tests/unit -q | 104通过、0失败，退出0 |
| backend目录.venv/Scripts/python.exe -m pytest tests -q | 默认矩阵114通过、16服务测试跳过、0失败、退出0，14.76秒；其中WCL的2个真实服务测试另以显式环境执行，不将跳过项算通过 |
| tests/unit/test_wcl_death_review.py及test_wcl_death_snapshots.py，连同原WCL适配器 | 30通过、0失败，覆盖字段投影、同名隔离、错时／缺死亡、内容签名、缓存损坏与TTL参数 |
| tests/integration/test_wcl_postgres.py，显式隔离PG及Redis环境 | 2通过、0失败，真实迁移、PG、API、Redis及loopback WCL HTTP；包含多页数值、前置光环、明确关联视角、跨团队403、坏游标422、跨视角409、内容变化409、未配置及报告变化；原关键时间轴3条及发布版本不变 |
| 真实Redis缓存 | 后续页不再请求WCL，TTL在1～120秒；删除该测试的明确缓存键模拟失效后，变化内容拒绝旧游标；撤销成员后仍403，测试schema及缓存键清理为0 |
| cargo test --lib -- --quiet | 124通过、0失败、3辅助忽略，127总计，18.84秒；包含2个新增云端明细解码测试 |
| client目录原test:replay六个文件，使用node --test --test-reporter=spec | 40通过、0失败，退出0 |
| node --test --test-reporter=spec tests/replay-review.test.cjs tests/review/mechanics.test.cjs tests/wait-until.test.cjs | 14通过、0失败，退出0 |
| npm run build | TypeScript及Vite退出0，保留既有大chunk提示；最终index-BAQphv4C.js／index-DC5zoM1x.css |
| native-cloud-replay.cjs --death-review | 更新后12组通过：真实独立Tauri／Rust／DPAPI／WebView2／HLS；260条云端快照、两个来源同技能光环、后续页、关联定位、未配置／换版恢复、换凭证清空及迟到页隔离、原媒体协议与重启恢复；HTTP及媒体为明确合成夹具 |
| browser-replay.cjs | 更新后28组通过、pageErrors为空；现有回放、密集轨道及退出保存回归，IPC为明确夹具 |
| native-real-workbench.cjs --death-review --pull-index 1 | 更新后9组通过，使用用户指定真实日志和本人原片／既有HLS，38850个关键事件、独立CSV数值与真实治疗石／药水仍一致；关联视角为同源控制记录，不冒充其他成员实拍 |

首次原生增量的死亡三组已通过，但后续旧协议检查仍使用换凭证前的媒体URL，HEAD按设计返回503。脚本改为重新读取当前URL后，完整12组重跑通过；没有放宽旧URL失效规则。原生脚本同时改为等待真正正常退出并逐字节恢复隔离index／client-state，不再用固定3秒后强杀代替保存验证。

最终原生证据：临时wow-replay-phase2-20261017/client-cloud-death-native-final/report.json及client-cloud-death-local-final/report.json；浏览器为client-cloud-death-browser-final/report.json，PG／Redis为client-cloud-death-postgres-redis-tests.txt。两套原生pageErrors为空、forcedStops为0，隔离状态已恢复；本地实战的原片／HLS／源索引及测试时保护的正式产物摘要不变。团队界面[原生截图](images/client-cloud-death-native-20261017.png)使用合成媒体和离线协议数据，不能当成真实WCL报告或其他成员实拍证据。

## 验证限制与后续

上述后端真实服务与原生HTTP夹具为分层验证，没有宣称原生已经连通真实生产WCL报告／私有报告。仍需真实公共报告、多人实拍与长时间运行对照；私有WCL OAuth、直接致死关联、WCL技能分类、阶段分析、自动漂移和完整硬件／发行矩阵尚未完成。没有运行正式用户应用或安装包。

## 当前产物及收尾

正式debug与Release NSIS均构建退出0。当前安装包client/src-tauri/target/release/bundle/nsis/WoW Recorder_0.1.0_x64-setup.exe为125151270字节，SHA256 cd16da0c1357f8f13a36f7f75f16811d1b25b7ad7850970f89e16351beca5e35，已包含本轮团队死亡入口。

NSIS完成后Release EXE为21539328字节、SHA256 515ebb6af657a30d89304bebe8456c835d7ff1024836298b37778a1b6875ea45；debug为30619648字节、SHA256 a992dc6688415299209af190a0e447b3a1d2894d14c01be41eae75d29cd989df。两套均x64、正式标识且无验收标识或临时诊断，Release为Windows GUI子系统2；每套743项资料及8项探测文件逐大小／SHA一致，许可原文一致。最终摘要为临时client-cloud-death-build-artifacts.json。

独立PG schema及Redis死亡缓存键已确认0残留，PG正常停止；Redis按本次PID及可执行文件验证所有权后正常shutdown。相关开发／服务端口无监听，没有验收应用／FFmpeg／ffprobe残留；全局WSL和其他用户服务未被关闭。git diff --check通过，新增／修改代码没有超过500行；未自动提交或推送。
