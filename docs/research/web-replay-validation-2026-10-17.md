# 独立Web复盘核心入口与双端映射验证

日期：2026-10-17，时区：Asia/Shanghai。延续ReviewTool风格录制复盘目标。本阶段实现独立Web核心入口，未使用superpower skills、未提交／推送、未部署正式站点或运行正式安装包。

本文记录Web核心与标注阶段的实际版本及包摘要，属于阶段历史；后续已补Web WCL导入面板，最新功能、产物及验证见[WCL增量报告](web-wcl-validation-2026-10-17.md)和[阶段总表](replay-final-acceptance-2026-10-17.md)。下文“当前”均指本报告阶段。

## 实现范围

Web使用独立package与静态构建，依赖版本固定为当前桌面已安装版本，不升级client锁定依赖。页面复用既有平台访问令牌身份及团队权限，令牌只驻留当前会话；退出取消请求，刷新后重新验证。

目录按中国日期／首领／难度展示，元数据有界分页；选场后单独获取本场全部视角。人物按真实GUID关联，不按名字猜视角，职业／专精取已有fullType，无录像和未就绪成员禁用。单播放器切换保持共同时间、播放意图、音量、静音与倍速；缺片不覆盖目标时保留原视角。

浏览器通过固定API路径读取HLS，逐片带Bearer及playbackVersion，S3凭证不进入网页，旧发布版本不能混片。没有Tauri全局模拟，不直接连接S3，也不依赖第三方图片站。741张已有离线JPEG和原许可进入哈希静态资源，未知技能保持缺图提示。

标准事件完整分页后才显示完整筛选，最近三路驻留内存；类型／人物／技能筛选、同名WCL人物命名空间、图标分组、事件前文定位沿用实际事实。共享／本机偏移只叠加一次，支持冲突草稿、换版停用及明确复核。时间点链接只含资源和共同时间，接收者需要登录及团队权限。

工作台与视频全屏、T快捷键、1440／1080／390视口均有执行证据。六种标注的画笔／箭头／方框／圆圈／文字／团队标记、选择移动／属性、撤销重做、时段显隐、团队CAS保存与只读权限已接入Web。草稿按账号工作台内存与录像隔离，切视角保留，刷新页面丢弃；冲突须明确确认后读取最新。独立密码／OAuth／邀请、WCL导入面板、Web个人轨道及高级死亡窗口仍未完成，不声称完整ReviewTool克隆或全浏览器矩阵。

## 真实共用模块

shared/replay包含model、mapping、identity、events、calibration、markers及config，均不依赖Tauri、React状态、系统文件或网络实现。桌面生产代码、Node测试和Web直接使用同一实现；旧模型／映射路径已删除，不保留兼容转发。

shared/annotations根部为纯契约及限制，editor子目录为两端直接使用的React/SVG编辑器、工具栏和媒体几何观察；外部注入文档和操作，桌面仍经Rust，本次Web经团队HTTP保存。迁移同步修改生产导入和测试，不保留旧路径包装；Vite dedupe与TS路径让共享React模块使用当前端的同一依赖实例。

新增浏览器用例实际发现并修正了视频元素重建后旧观察器残留、兄弟组件key重复导致双视频、标注文字继承Media Chrome零行高、保存加载图标改变按钮可访问名称的问题。编辑器随视角／发布或重载标识重建，文档草稿留在外层；弹层进入当前播放器支持视频全屏，SVG裁切到实际内容范围，避免贴边标注进入控制栏。失败轮次保留，不计通过。

桌面及Web的Vite／TS路径同步修改，开发服务器仅增加共享目录白名单。后端选场manifest补齐与平铺目录一致的timelineRevision／eventCount／complete／WCL状态、结果及组规模；额外查询有固定次数，不逐视角发SQL。真实PG测试同时核对manifest与事件页的视角版本。

## 复现并修复的跨段偏移

原逻辑在找到原区间后直接加媒体偏移，只检查总媒体时长，可能跨到另一拼接段。独立反向换算也可能把其他片段误算为前一段。新增Node用例实际先失败：预期gap却返回mapped；后端覆盖用例也先失败，错误接受跨段5000ms。

现在前向目标及反向原画面都必须留在同一真实连续片段，越界保持gap；后端也按每段自己的视频范围检查有效覆盖。偏移方向和原始区间不改，不以其他片段或未声明尾部填缺口。现有连续媒体及区间内部偏移保持兼容。

Node回归覆盖正负偏移、双向跨段拒绝及合法逆映射。Web真实服务用例保存缺片视角500ms，再在3.8秒尝试跨段，确认保留原视角／画面；后端实际拒绝整段5000ms。桌面真实React／HLS浏览器另验证前向拒绝和进度反算不跳游标。

## 已执行结果

| 命令／层级 | 实际结果与范围 |
|---|---|
| web npm run test:unit | 7通过、0失败；媒体目标／版本／鉴权头、外域拒绝、退出取消、401不回显、目录边界、链接及CST |
| web npm run build | 退出0，5634模块；index-MRCNCBEJ.js及index-DEMuWJVb.css，保留大chunk提示 |
| Web真实服务浏览器 | 最终21项通过、退出0、pageErrors为空；100次媒体请求全部带Bearer及版本；Windows Edge真实浏览器与合成H264/AAC，含六种图形、实际PG保存／跨成员CAS及控制栏不受画布遮挡 |
| 开发入口 | Web启动、共享模块、许可原文、匿名401／登录200真实API代理通过；桌面新增共享模块HTTP访问3项全200 |
| client npm run test:replay | 37通过、0失败、0跳过，含先失败后修正的跨段用例 |
| client npm run build | 退出0，4951模块，index-BqkG-EME.js；共享编辑器直接打包 |
| 桌面浏览器 | 26项通过，pageErrors为空，含实际媒体跨段及反向游标保护 |
| 桌面标注浏览器 | 迁移后最终9项通过、退出0，页面异常为空；六图形／移动／保存失败恢复／只读／冲突及预尾滚保护 |
| 真实Tauri／LocalStateStore | 重建独立标识后3项通过，含非空标注保存／重启及预滚／尾滚保护 |
| 后端完整pytest | 显式PG／MinIO／Redis及独立Celery，116通过、0跳过、0失败，17.00秒；1项上游Starlette提示 |

Rust业务源码未在本阶段修改，完整Rust117通过／3辅助忽略为上一阶段同源基线，本轮不重复；本轮重建独立及正式标识并运行真实Tauri烟雾验证。浏览器入口及桌面测试互相包含部分场景，不能把数字相加当成独立覆盖总数。

## 数据和授权边界

本次浏览器测试通过真正FastAPI、PG、私有MinIO Multipart、Redis及独立worker／beat准备三路合成媒体，包含正300／负200ms日志起点差和已声明缺片。WCL上游是本机HTTP协议夹具，基础7条及后续1057条为受控协议样本，绝非线上报告或用户实战事件。账号和令牌均为随机隔离测试身份。

整个浏览器层没有替换API响应，选场／事件／校准／权限都通过真实后端；同源静态测试服务器仅转发HTTP。撤权前先验证当前媒体200，撤权后该用户拒绝，而另一成员仍200，避免用早已失效的URL冒充权限通过。现场日志及D:/wcl/warcraft-live没有参与本阶段云端上传。

## 证据与复现入口

Web验收命令为node web/tests/browser-replay.cjs，显式参数--python、--private、--fixture、--output、--playwright；开发验收为web/tests/dev-server.cjs。依赖隔离服务及固定合成媒体，不自动发现用户目录或凭证。

证据位于%TEMP%/wow-replay-phase2-20261017：最终Web为web-annotations-controls-final，桌面标注为annotations-shared-web-release，回放为replay-shared-annotations-release；最新原生为native-annotations-shared/local-final，Web开发代理为web-dev-annotations-final（包含共享React TSX实际转换200），后端为backend-web-full.log，构建为web-annotations-build.log与annotations-formal-*-build.log。初次纯核心成功为web-real-replay-final（17项），历史16项不再代替最新21项。

首次准备合成数据误带本地actorId，后端按既有输入契约正确422，已移除而未放宽schema。第一次无头全屏用模拟Escape退出超时，改用实际T快捷键及播放器全屏按钮，完整复验通过。首次共享目录直接访问403，增加仅共享目录白名单后200。所有失败轮次均不计为通过。

核心恢复用例第一次17个界面步骤执行后，测试代理在断连时重复writeHead导致退出1；已修正代理响应头及连接关闭处理，随后完整退出0。失败轮次遗留的一组随机schema／私有桶／队列，按该轮日志核实的完整UUID定向清理；复查原生随机schema和桶均为0，不清理其他用户数据。最终21项的正常finally清理全部成功。

Web静态包为web/artifacts/wow-replay-web_0.1.0_20261017.zip，2064238字节，SHA256 316f9bb26c15643968b60f0e85b501242830ae266d996baf889e616ee51b2351；746个条目含部署README，CRC及解压逐字节均匹配当前dist，741个JPEG与源图片摘要集合完全一致，许可原文相同。Linux生产部署、真实线上WCL、实战跨设备精度、硬件长录及正式安装／卸载仍待对应环境，60ms合成媒体容差不代表实战同步精度。

最新默认debug及Release NSIS均成功；最终当前前端的独立Tauri3项复验后已恢复正式debug标识。NSIS125044622字节，SHAcadbf431e747c2d65f2285f69d60faf0214f3baef14a7825c35bcb65730e45df，Release为x64／GUI子系统2且无验收标识；两套743项资料逐大小／SHA匹配。完整包摘要为临时web-entry-build-artifacts.json，阶段总表同步更新，未安装或启动正式应用。

所有本次随机资源及进程已清理，基础服务正常停止；1420／1421／1422／25432／29000／29001／26379端口关闭。319个新增文本的UTF-8／空白、无新增超500行代码、PowerShell BOM及git diff --check检查均无异常；根.env未创建。Git仍为工作区改动，用户既有删除保留。

截图：[1440工作台](images/web-replay-1440-20261017.png)、[1080工作台](images/web-replay-1080-20261017.png)、[390手机](images/web-replay-390-20261017.png)、[六种标注](images/web-annotations-1440-20261017.png)。均为受控合成视频，不冒充实战画面；实际WoW工作台证据仍见阶段总表。
