# 团队共享校准与录像换版复核

日期：2026-10-17，时区：Asia/Shanghai。延续ReviewTool风格复盘目标，本轮补齐团队共享偏移，不使用superpower skills，不自动提交／推送，不连接线上WCL或上传用户实战录像。

## 功能与边界

- 每路团队录像有独立共享偏移，正值对应更晚视频。当前生效值为“该发布版本的团队偏移＋该发布版本的本机个人偏移”，双向换算、事件定位、标注、书签和切视角使用同一函数，不重复相加。
- 上传者、团长、分析员可显式保存；其他团队成员可读。读取／保存均重新验证当前账号及团队，客户端不自报权限。
- 共享值写现有Recording.manifest的sharedCalibration独立区段，不改videoZeroMs、区间、原始角色、请求摘要或媒体字节；未新增表／迁移／依赖。该领域在services/replay/calibration.py承担校准业务，与查询、私有媒体和授权模块保持职责分离。
- 保存同时比较编辑版本与playbackVersion。并发同版本最多一个成功，冲突不覆盖原值，界面保留草稿；显式读取最新值需要先确认替换未保存草稿。
- 共享值绑定已发布媒体版本。换版后旧值不再应用，但保留供人工复核；用户显式保存后才能应用于新版本。
- 本机个人微调仍经Rust LocalStateStore的replay区段保存，新增offsetVersions绑定云端发布版本。旧未绑定或换版后的非零个人值暂停生效，明确提示并允许“复核并应用原本机偏移”；本地录像的旧偏好保持兼容。
- 保存完成只更新当前应用级目录中的该路快照，保留已加载分页和共同战斗位置。其他客户端需重新读取目录／校准；当前没有实时推送校准变更。
- 单一偏移不能修复未知缺片或时钟不连续。服务端拒绝此类保存，并要求偏移后至少还有一段有效战斗画面；客户端继续按原映射拒绝缺片或越界定位。

## API与配置

GET／PUT /api/v1/teams/{team}/recordings/{recording}/calibration。

PUT正文为{expectedVersion,playbackVersion,offsetMs}，严格整数与UUID，未知权限字段拒绝。返回{version,playbackVersion,savedPlaybackVersion,offsetMs,active,stale,canEdit,updatedAt,minOffsetMs,maxOffsetMs}，updatedAt为中国标准时间字符串，前端不再转换。

团队录像目录及Pull manifest同步返回sharedCalibration。原映射字段不预先叠加共享值，避免客户端再次加偏移。Rust目录适配另暴露cloudPlaybackVersion，旧服务器缺少共享字段时仍兼容；新功能需服务器支持相应接口。

WOW_SHARED_CALIBRATION_MAX_OFFSET_MS默认300000毫秒，允许部署范围1～3600000。限制集中在backend/app/core/config.py，客户端读取服务端上下界。设置为0毫秒属于显式确认零偏移，不代表自动证明帧级同步。

## 已执行验证

| 层级 | 实际结果 |
|---|---|
| 前端纯逻辑 | npm run test:replay：36通过、0失败、0跳过；包含团队／个人相加、各视角独立、发布／旧未绑定个人值失效、显式复核及正反向映射 |
| 类型与前端构建 | npm run build退出0；4948模块，当前index-zzX2PnZX.js；保留既有大chunk提示 |
| Rust完整回归 | cargo test --lib：120总数、117通过、0失败、3辅助忽略，16.47秒；新增响应约束及固定状态码提示 |
| 后端完整真实服务 | .venv/Scripts/python.exe -m pytest -q，显式隔离PG／MinIO／Redis及独立worker／beat：115通过、0跳过、0失败，15.83秒；上游Starlette弃用提示1项 |
| 新增真实PG校准 | 两项测试分别独立schema、每个HTTP请求独立连接；包含两个不同账号同时保存的一次200／一次409、只读／降权／移出团队、目录传播、越界拒绝和媒体版本失效。已包含在上面的115项，不重复计数 |

测试服务为原有临时官方PostgreSQL17.11、MinIO2025-09-07、Alpine Redis7.2.11，Windows Python3.12／Celery solo；不是Linux compose部署矩阵。测试用随机schema／私有桶／队列，用户指定日志及D:/wcl/warcraft-live保持只读，原实战媒体不参与本次云端上传。

完整结果位于%TEMP%/wow-replay-phase2-20261017：backend-shared-calibration-full.log、backend-shared-calibration-pg.log、cargo-lib-shared-calibration-versioned.log、node-shared-calibration-final.log。

## 原生验证进展

使用独立com.wow.recorder.cloudvalidation20261017应用、真实Tauri IPC／DPAPI／WebView2／FastAPI／PG／私有S3／Redis／独立Celery，通过两路合成视频检查共享及个人值、界面点击、并发冲突、跨账号读取和重启。

首轮界面保存500ms、PG落盘、个人100ms只加一次及另一视角独立均通过；并发冲突已实际409且333ms草稿保留。原通用传输层只显示HTTP状态，现已在校准领域转换为可操作的中文冲突／权限／范围提示，不回显服务器正文。

第二轮另通过冲突草稿、其他成员读取应用／界面只读／原生写入拒绝和重启恢复。换版用例的初始夹具只改UUID而没有相符媒体前缀，服务端正确拒绝不一致发布；已补齐复制所有真实合成分片到新私有前缀后原子更新发布身份，不能把失配UUID当作正常重处理。失败证据保留native-real-calibration及native-real-calibration-final，随机资源均已清理。

修正发布夹具后，换版停用团队／本机值、显式复核和1080视口边界断言均已执行；最后保存动作在按钮可访问名称精确匹配上超时，固定保存／读取按钮的aria-label后，完整复验成功。原生媒体容差收紧到60ms，严格小于100ms个人值，不能用宽容差掩盖重复叠加。

最终原生9项全部通过、0失败、pageErrors为空，证据native-real-calibration-verified/report.json。13个calibration事实均为true：实际鼠标保存／PG落盘、个人值只加一次、视角独立、并发CAS、冲突保留草稿、其他成员应用、只读及原生拒绝、重启恢复、团队／个人换版失效、显式复核及撤权读写拒绝。

两种窗口均检查弹层在可见范围且没有横向溢出，已查看[1440×900合成媒体界面](images/team-calibration-native-20261017.png)和[1080×720界面](images/team-calibration-native-1080-20261017.png)。最后先确认当前版本媒体200，再移除成员并验证拒绝，避免用早已失效的旧媒体URL冒充撤权通过。随机schema、私有桶、队列及API／worker／beat均清理成功，随后只停止本轮临时PG／MinIO／Redis进程，25432／29000／29001／26379端口关闭实测通过。

本轮最终前端为index-zzX2PnZX.js，保存／读取按钮仅补固定可访问名称；index-BIIUFv_V.js基线本地回放25项通过，映射／本机换版保护逻辑未在此后变更。默认正式标识debug构建退出0（前端9.04秒、Rust16.59秒）；Release NSIS也退出0（前端8.87秒、Rust53.22秒、1个安装包）。未启动正式应用／安装包。

最终安装包125068081字节，SHA256 ae0f8a5c75c51d85c5d7f81d14990bfa8ee48160473339cd5dbf52a01322bcc9，替代旧事件v3包。Release实际PE为x64／GUI子系统2，debug／release均为正式标识且不含验收标识，743项资料大小及SHA全部一致；证据shared-calibration-build-artifacts.json。配套EXE摘要见[阶段总表](replay-final-acceptance-2026-10-17.md)。

## 尚未覆盖

本轮是人工常量偏移共享，不实现多锚点自动漂移拟合，不证明跨设备实战500ms精度。线上WCL、硬件长录、正式安装／卸载及Linux部署矩阵仍需对应环境。独立Web站点、邀请／分享、私有WCL OAuth、地城组合轴和外部播放器仍按总计划推进。
