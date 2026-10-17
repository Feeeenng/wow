# 当前工作交接

更新时间：2026-10-17（Asia/Shanghai）。历史详情按INDEX.md查阅，不默认加载全部记录。

## 最新要求

- 用户明确要求优先客户端，下一开发任务是接通死亡前15秒复盘界面、定位本人／相关视角并用指定实战样本验证。此次现有改动按12个工作模块提交Git，文档／交接为最后一组；不推送，此次授权不代表以后自动提交。
- 不使用superpower skills，不运行正式应用或安装包；保留用户现场。原有7份旧方案删除此次按“全部改动”要求单独提交，不擅自恢复。
- 实战来源只读：C:/Program Files (x86)/World of Warcraft/_retail_/Logs下WoWCombatLog-101626_200443.txt及WoWCombatLog-101626_223453.txt，录像D:/wcl/warcraft-live。测试云端只传合成媒体，不上传原片／日志。

## 已完成及验证

- 客户端已有暗色工作台、本地导入、事件分页与索引v3、技能图标、缺片／有符号映射、可靠seek、真实同场多视角、个人轨道持久化、六种标注、直播DVR；私有团队上传／恢复、WCL公开报告、共享校准及换版保护已有分层验证。当前基础UI不等同ReviewTool全部功能或逐像素一致。
- Web偏好表及第五版迁移20261017_05已获用户授权并实现，GET／PUT本人布局、成员行锁、版本CAS、级联撤权；显式保存后跨刷新／独立浏览器恢复，失败／冲突保留草稿。首次读取失败后的编辑、保存中及读取中编辑、迟到请求隔离、稳定按钮可访问名称均已补齐。不使用localStorage，正式生产迁移未执行。
- 最新后端完整真实PG／MinIO／Redis／独立Celery122通过、0失败／跳过，31.39秒；偏好最终定向6通过，7.12秒。Rust完整121通过、0失败、3辅助忽略，16.81秒。Web偏好7／轨道7／核心21组通过，pageErrors均空，控制器报告随机schema／桶／进程清理成功；Web纯模块7、客户端纯模块39及双端构建有成功记录。
- 桌面浏览器26与独立标识真实原生全栈10是上一轨道阶段证据，不是新增死亡功能的端到端验证。WCL面板、标注及实际独立OBS8项等历史矩阵见docs/research/replay-final-acceptance-2026-10-17.md。
- 两日志约1.83GB／5780237行，22场完整战斗与17成片匹配；四场事件975／38850／86791／12644与独立CSV审计一致。原片六音轨／HLS及三场原生播放有证据。死亡弹窗差−77～+737ms包含游戏UI延迟，不能作为500ms同步精度通过证据。

## 当前未完成的客户端死亡窗口

- shared/review与recording/review已有22版高级日志解析、有界扫描、近战精确配对、缓存／分页和get_local_death_review命令；Rust基础4项通过。尚无React入口／详情界面，也没有云端死亡明细接口，不得声称功能完成。
- amount只代表来源记录值，不能直接标为有效DPS／HPS。资源字段必须明确属于死者GUID，不能误用攻击者生命值。SWING_DAMAGE与LANDED仅按完全相同时间／双方／伤害尾字段配对，支援归属行不重复计量；缺少确切致死／减伤／耗材事实时显示未知，不按名称猜测。
- 优先客户端UI与原生实战验证，再处理阶段分析／自动漂移、剩余11项缺图、地城组合轴及外部播放器。线上WCL／私有OAuth、账号邀请、真实WoW硬件长录／磁盘／安装卸载及Linux生产仍需补齐或相应环境。

## 产物与临时证据

- 最新Web包web/artifacts/wow-replay-web_0.1.0_20261017.zip，2079661字节，SHA256 5aafd2e3941d60a8bb15127d858f492c6e365eb63c8c54d99ea6a33df40684c9；746条目CRC／逐字节通过，741图与许可一致。5645模块，index-CD6yB--9.js／index-Cn-NYB41.css。
- 现有桌面NSIS是上一轨道阶段，125036277字节，SHA256 cb76b9f936c6c54723e48e4b24ef4de2c1eb25dda41695e6bce5c73781c09905；不含新增死亡命令。客户端死亡功能完成后统一重建与原生验证，不能用旧包摘要冒充当前源码。
- 临时wow-replay-phase2-20261017中web-preferences-complete／web-preferences-tracks／web-preferences-core、preferences-backend-full-release.log、preferences-pg-tests-final.log、preferences-rust-full.log及web-preferences-build-artifacts.json可追溯。private.json只由脚本读取，禁止打印内容。最近检测基础PG25432／MinIO29000、29001／Redis26379仍在运行，勿沿用旧文档的“已停止”；测试随机资源已清理，后续按需使用并收尾。
- 所有功能／验收分层见阶段总表及web-preferences-validation-2026-10-17.md。当前完整目标仍在进行，不因模块提交而标记完成。
- 本批Git覆盖共享契约、资源、云端服务、个人偏好、本地内核、DVR、客户端云端对接、死亡基础、工作台整合、Web、旧方案删除及验收交接；代码提交范围0574612至4fe2d95，最后另附本交接文档提交。只调整必要EOF空白，未在提交整理中重跑业务测试／构建。
