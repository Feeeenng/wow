# Web个人轨道与双端显示规则验证

此为会话轨道阶段的历史记录，后续已获用户明确授权并实现跨刷新保存；当前功能与验证以[个人偏好报告](web-preferences-validation-2026-10-17.md)及阶段总表为准，下文保留当时边界。

日期：2026-10-17，时区：Asia/Shanghai。持续补齐ReviewTool风格回放；本阶段完成个人轨道交互及会话隔离，没有使用superpower skills或自动Git提交／推送。跨刷新云端偏好尚未实现，数据库方案单独等待明确授权。

## 实现与规则

Web可新增、改名、删除个人轨道，拖动技能改变显示位置，逐条／按目标清除覆盖、恢复默认轨道；轨高20～50、图标50%～100%、缩放1～4也已接入。当前会话按账号和团队保存，切视角／团队／组件重建保留，退出和刷新页面清空，不能当作云端已保存。

覆盖键由事件固有归属、技能、类型和真实来源身份组成。未绑定WCL人物仍用报告命名空间／actor区分，同名不合并；另一视角固有分类不同时不误套原覆盖。删除只移除显示规则，不写事件、媒体或共享团队数据；从事件点击回看仍使用原战斗时刻。

同一显示规则的分组允许拖动，混合规则分组禁止整体拖动，避免误把所有不同来源当同一技能。每个事件详情有目标轨道选择，供触屏或键盘操作；大分组详情每页最多20项控件，可逐页定位原事件，不一次挂载大量Ant Design控件。

原客户端timeline/model已整体迁至shared/replay/tracks.ts，布局契约、分轨、名称、删除和赋值逻辑均由两端真实消费，没有薄包装或旧路径。外观及名称边界统一shared/replay/config.ts；客户端既有Rust持久化协议／字段不改。名称按Unicode字符计数，输入框允许32个非BMP字符，提交仍拒绝超长、控制字符及个人轨道重名。

存储测试发现Media Chrome默认写media-chrome-pref-muted，已用库提供的noMutedPref／noVolumePref／noSubtitlesLangPref关闭正式回放控件的浏览器偏好。Web继续使用账号内存，桌面继续LocalStateStore；最终测试localStorage与sessionStorage均为空，媒体参数仍可切视角恢复。

## 验证结果

所有云端验证只上传固定合成H264/AAC，经过真实FastAPI／PG／私有MinIO Multipart／Redis及独立Celery worker，WCL为回环受控HTTP，不访问线上报告或用户实战资料。

| 验证 | 结果与边界 |
|---|---|
| client npm run test:replay | 39通过、0失败／跳过；新增Unicode、名称、外来规则拒绝、不可变事件及独立默认对象检查 |
| web npm run test:unit | 7通过、0失败／跳过，鉴权／媒体／目录／链接纯模块 |
| Web个人轨道浏览器 | 最终7项完整退出0，pageErrors空；实际鼠标、触屏等价选择、两团队／两账号及1057事件 |
| Web核心回归 | 当前控件偏好关闭后21项完整退出0，页面异常空，包含音量／静音／倍速保时切视角、标注／校准／分页／撤权 |
| 桌面回放浏览器 | 共享规则迁移后26项通过；最终控件偏好关闭后亦复验当前前端 |
| 独立Tauri真实全栈 | 当前独立标识10项退出0，含完整上传／重启恢复、两路媒体、WCL、32个emoji名称实际Rust写盘、个人轨道拖入／原生重启恢复和事件不变性，以及权限／撤权 |

7项Web检查分别覆盖新增／重名／32emoji／稳定UUID及不改媒体／事件，切视角来源隔离与刷新保留，详情移轨及手机混合分组，两团队和另一成员隔离，外观／缩放／清除／删除，8条上限及退出／无浏览器保存，1057条真实事件大簇20项分页和后页原时刻回看。所有偏好操作不发送团队写请求。

本轮没有修改Rust领域或后端业务源码，Rust117通过／3辅助忽略与后端完整真实服务116通过保留前阶段同源基线，没有虚称全部重跑。各行覆盖部分重叠，不相加为独立覆盖总数。

## 复现与范围

Web命令node web/tests/browser-tracks.cjs，显式传入--python、--private、--fixture、--output、--playwright。最终临时证据web-tracks-final、web-tracks-core-final、desktop-tracks-shared-final及native-tracks-shared/real-final。原生脚本client/tests/native-real-cloud.cjs使用独立cloudvalidation构建、--with-wcl及同组路径参数；不允许正式应用EXE或用户录像。

截图：[1440个人轨道](images/web-tracks-1440-20261017.png)、[390混合分组](images/web-tracks-390-20261017.png)。均为合成视频，显示布局能力，不是实战时钟精度证明。

跨刷新／设备保存需要新的个人偏好表与API，方案在[待授权方案](../plans/2026-10-17-web-replay-preferences.md)。按AGENTS.md第103行“未经用户明确要求，不修改依赖、根配置、CI、环境模板、数据库结构或迁移”，已发起异步确认，未收到授权前不创建第五版迁移／偏好表，也不用共享manifest或浏览器存储替代。其余复盘能力继续推进。

## 当前构建和清理

Web5644模块index-BXYyEtcw.js／index-DWoEVcJM.css，桌面4951模块index-C2H3PoPV.js。正式debug及Release NSIS均退出0，Release为x64 GUI子系统2且无验收标识；两套743项资料逐大小／SHA一致，没有安装或启动正式应用。

NSIS125036277字节，SHA256 cb76b9f936c6c54723e48e4b24ef4de2c1eb25dda41695e6bce5c73781c09905。Release EXE21189632字节／SHA ed06aa8d4b196f35c2d81a2b4322eb8251d2f88c9b39a7843ff9ea4faedebf40；debug30285824字节／SHA cc8758e250ea57bf7faf13d690eb99b8eec7adda20c41b6f6e066d27925d8fb5。

Web ZIP2078671字节／SHA256 656ea5c20c683a1ad371117ce89ab2a40517041bc976cda6ffafd57bc48a1bdc；746条目CRC及逐字节与dist一致，741图摘要集合和许可原文相同。完整临时证据web-tracks-build-artifacts.json，最新包路径仍见[阶段总表](replay-final-acceptance-2026-10-17.md)。

最终原生随机schema、私有桶及Redis前缀均复查为0，所有控制器正常finally清理；自建PG／MinIO／Redis停止，七个相关端口关闭，没有运行的测试／媒体进程。原始用户日志／录像保持只读、没有上传。数据库迁移仍为原四版；未进行Git提交／推送，用户既有删除保留。

最终332个新增文本UTF-8／行尾空白检查无异常，无新增超过500行代码，PowerShell BOM保留，根.env不存在；git diff --check退出0。这些为非执行式检查，不计入测试通过数。
