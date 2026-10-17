# Web公开WCL报告导入与播放连续性验证

日期：2026-10-17，时区：Asia/Shanghai。延续ReviewTool风格复盘目标。本轮增加独立Web的报告关联和导入面板，没有使用superpower skills、自动提交／推送或上传用户实战资料。

本文保留WCL阶段的实际版本和包摘要；之后已补会话内个人轨道，最新构建与剩余范围见[轨道阶段](web-tracks-validation-2026-10-17.md)及[总表](replay-final-acceptance-2026-10-17.md)。

## 实现与兼容

- 当前战斗顶部新增“标准事件”，显式输入公开报告链接／16位代码及fight。新输入清除旧fight，官方链接可提取编号；非法来源不发请求。报告完整日志仍由Archon上传，网页不重复上传CombatLog，也不接收应用client secret。
- 平台当前团队成员可读，leader／analyst可导入，权限由既有后端判定。实际未配置服务端凭证时明确禁用，已有媒体仍可播放。
- 首次完整导入后提供报告玩家列表；录像逐路选择actor编号，允许不绑定，不用同名角色猜测本人。提交只包含报告代码、fight、明确录像／actor绑定和刷新标志。
- 面板打开且任务运行时轮询，关闭停止观察，不取消后端持久任务；重新打开读取当前进度。失败显示错误并保留完整旧快照，可以显式重试。表单草稿在本场面板关闭／打开之间保留，换团队或场次后销毁。
- WCL完整发布使用保留视角的元数据刷新，更新事件版本；视频元素、HLS连接、播放意图和共同游标保持。手动“刷新团队录像”继续保留原有重新读取行为。
- 工作台全屏下抽屉仍在当前工作台内，手机布局无横向溢出；截图等待抽屉动画结束，避免把过渡帧当最终布局。

两端共用shared/replay/reports.ts的纯数据契约及官方链接解析，输入和轮询限制进入shared/replay/config.ts。原client模型已迁移，生产代码、测试及命令导入同步更新，没有旧路径转发。没有新增依赖、数据库表／迁移或后端接口。

## 执行证据

独立Web测试通过真实FastAPI／PostgreSQL／私有MinIO／Redis／独立Celery worker及beat建立三路合成H264/AAC媒体。上游是随机回环端口的受控WCL HTTP服务；没有浏览器API假响应，不访问线上WCL，不使用用户凭证、实战日志或录像。

WCL场景8项完整退出0、pageErrors为空：

1. 初次未绑定、非法链接禁用、表单输入不触发全屏、新报告清旧fight及关面板保留草稿。
2. 真实worker首次导入、7条完整事件发布；视频原DOM标记仍在、继续播放，HLS清单未重载。
3. 两名同名角色按#1／#2绑定到明确录像；实际后端快照核对绑定，个人轨道读取新版本。
4. 受控上游暂停时旧版本和媒体保持，关面板停止轮询，恢复后后台独立完成，再打开看到新版本。
5. 真正不推进的事件分页导致失败，旧快照／7事件保持，界面重试成功才发布新快照。
6. 只读成员界面禁用，实际POST返回403，视频仍正常。
7. 工作台全屏和1440／390尺寸抽屉处于可见范围，关闭后回到原战斗，页面及内容不横向滚动。
8. 另起无WCL应用凭证的真实服务，界面正确禁用，媒体保持可播。

受控上游累计27次HTTP请求，主命名空间发布4个快照；主环境和缺凭证环境均由finally清理schema、私有桶、队列及API／worker。中间失败轮次均保留，不计为通过。开发中修正字段可访问标记；测试另外等待下拉关闭、后台新版本与抽屉动画，并将受控上游的“恢复传输”和“改变报告版本”分开，避免验证用例自身混入另一项版本保护场景。

| 命令／层级 | 本轮结果 |
|---|---|
| web npm run build | 退出0，5638模块，index-D5nG3Oox.js／index-DV5gX7K4.css |
| web npm run test:unit | 7通过、0失败、0跳过 |
| client npm run test:replay | 37通过、0失败、0跳过 |
| client npm run build | 退出0，4951模块，index-CBZDylnZ.js |
| 桌面WCL浏览器 | 7项完整退出0、页面异常为空；保存边界为受控IPC，区别于Web全栈 |
| Web原核心回归 | 21项完整退出0、页面异常为空，覆盖媒体／标注／校准／分页／撤权 |

本轮没有修改Rust或后端业务源码，Rust117通过／3辅助忽略、后端完整真实服务116通过／0跳过／失败为前一阶段同源完整基线，没有声称重复运行。上述用例部分重叠，不能把数量相加作为独立覆盖总数。

## 复现与范围

在仓库根运行node web/tests/browser-wcl.cjs，传入--python、--private、--fixture、--output及--playwright。路径均显式限定为隔离服务和固定合成媒体。证据在临时wow-replay-phase2-20261017/web-wcl-final；其他回归为web-wcl-regression、desktop-wcl-shared，构建日志为web-wcl-build.log、client-wcl-shared-build.log及wcl-formal-*-build.log。

截图：[1440面板](images/web-wcl-1440-20261017.png)、[390手机面板](images/web-wcl-390-20261017.png)。画面均为合成媒体；不能用它证明真实WoW同步精度。

当前仍只支持公开报告。真实线上应用凭证／报告、私有用户OAuth、实际地域与配额尚未验收；此报告不替代这些环境。Web个人轨道和深入死亡／伤害／治疗／阶段分析，以及硬件长录／磁盘／安装卸载／Linux部署仍属于未完成或未验证范围。完整交付状态以[阶段总表](replay-final-acceptance-2026-10-17.md)为准。

## 最终产物与清理

默认正式debug及Release NSIS均退出0。NSIS125037857字节，SHA256 523597be3fe2e8e34031e191fcfbda6617af0df269eff45fbfded37f2146622e；Release EXE21189632字节，SHA256 11802907cb294b95c3186b55cff2fffbae430bf4e977afceae47baa702c76b66，为x64 GUI子系统2，正式标识且无验收标识。两套743个资料清单文件逐大小／SHA一致，未安装或启动正式应用。

Web静态包web/artifacts/wow-replay-web_0.1.0_20261017.zip为2074573字节，SHA256 064b80ae85b7d68526d28d86315c5728ab87edfae8292d926298ad0b8511b0c2；746条目CRC及逐字节与当前dist一致，741张JPEG摘要集合及许可原文与源相同。详细临时证据web-wcl-build-artifacts.json。

所有成功及中间失败控制器均正常finally清理；最终复查随机原生schema与私有桶均为0，自建PG／MinIO／Redis已停止，七个相关端口关闭，测试／媒体进程无残留。324个新增文本编码／空白、无新增超500行代码、PowerShell BOM、根.env不存在及git diff --check检查通过。未提交／推送，用户既有删除保留。
