# Web个人布局持久化验证

日期：2026-10-17，时区：Asia/Shanghai。用户已明确授权新增偏好表及迁移，本阶段完成服务端保存及跨刷新恢复；没有执行正式生产迁移、部署或Git提交。后续开发优先客户端。

## 实现

新增第五版迁移20261017_05，replay_preferences按team_id／user_id联合主键保存文档、版本和带时区更新时间；外键指向成员关系，删除成员级联清理。GET／PUT /api/v1/teams/{team_id}/preferences/replay只使用认证身份，普通成员可管理本人布局，团长不能代读代写。缺行GET返回默认版本零且不插入，PUT锁成员行并原子校验版本，冲突409不覆盖。

文档仅保存个人轨道、来源技能覆盖、轨高、图标比例与缩放，拒绝未知字段、无效目标、控制字符、非有限数值及超限。八条轨道、1024条规则、160字节ASCII来源键可完整往返。桌面LocalStateStore不变；Web账号级Provider按团队保存快照和草稿，显式保存后跨刷新／设备恢复，退出销毁未保存内容，不使用localStorage。

首次读取失败禁止写入默认布局，失败／冲突保留草稿，重新读取有修改时确认替换。读取前及在途新增编辑不能被回包抹掉，保存期间编辑同样保留；迟到请求不串团队／账号。修复加载图标暂时改变保存按钮可访问名称的问题，按钮使用稳定aria-label。

## 实际验证

| 命令或入口 | 结果 |
|---|---|
| backend/.venv/Scripts/python.exe -m pytest -q --tb=short，显式隔离PG／S3／Redis环境 | 122通过、0失败、0跳过，31.39秒；1项上游Starlette弃用提示 |
| 同一pytest的test_replay_preferences_postgres.py最终定向重跑 | 6通过，7.12秒；初建／已有CAS各一胜一409、隔离、撤权竞态／级联、迁移回退重升、完整最大布局 |
| tests/unit/test_contracts.py及test_migration.py定向 | 6通过，0.90秒；十五业务表与Alembic版本表、外键及离线DDL |
| web目录npm run build／npm run test:unit | 均退出0；5645模块；纯模块7通过 |
| web/tests/browser-preferences.cjs | 7组通过、pageErrors为空；真实数据库／API／私有媒体及两个浏览器账号会话 |
| web/tests/browser-tracks.cjs／browser-replay.cjs | 7／21组通过、pageErrors为空；真实服务、媒体及受控WCL协议，非线上WCL |
| client目录npm run build | 退出0；共享身份类型调整兼容 |
| client/src-tauri目录cargo test --lib | 121通过、0失败、3辅助忽略，16.81秒；含死亡窗口基础4项，不等于死亡界面完成 |

浏览器七组覆盖：保存真实拖轨和外观后刷新登录恢复；独立浏览器冲突与确认；保存中编辑；重新读取中编辑；实际数据库表暂时不可用后的恢复／首次读取失败草稿；迟到团队读取及普通成员本人布局；保存期间退出与撤权。故障仅发生在随机schema，服务端正式错误处理器返回503，不替换接口响应。网络屏障只延迟真实请求，云端只上传固定合成媒体。

实际浏览器命令为node web/tests/browser-preferences.cjs，另显式传--output、--playwright、--python、--private、--fixture；私有配置只在进程内读取，未记录凭证。结果位于临时wow-replay-phase2-20261017目录的web-preferences-complete、web-preferences-tracks、web-preferences-core，各控制器均报告随机schema／私有桶／测试进程清理成功。原始日志及录像未写入或上传。

## 交付与限制

当前Web静态包web/artifacts/wow-replay-web_0.1.0_20261017.zip，2079661字节，SHA256 5aafd2e3941d60a8bb15127d858f492c6e365eb63c8c54d99ea6a33df40684c9。746条目CRC及逐字节一致，741张JPEG逐SHA匹配原资源，许可原文一致；index-CD6yB--9.js／index-Cn-NYB41.css。不包含Tauri、绝对项目路径、录像、日志或凭证。

后端需显式升级至20261017_05，未执行正式部署。令牌仍只在内存，刷新重新登录后恢复已保存布局；未保存布局及标注草稿不跨刷新。当前仅Windows Edge／MSE验证，线上WCL、Linux生产及Safari尚无验收证据。桌面现有安装包为上一轨道阶段版本；当前死亡窗口基础尚未接界面，待客户端功能完成后统一构建，完整目标保持进行中。
