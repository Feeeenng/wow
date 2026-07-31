# 当前工作交接

更新时间：2026-07-31（Asia/Shanghai）

## 当前状态

- 项目级 AI 上下文目录已迁移到根目录 `.agents/`。
- 已建立长期上下文、当前交接、历史索引和按月对话记录四层结构。
- 产品方向已调整为 Windows 客户端采集上传、云端处理、Web 多视角时间线复盘。
- 技术栈已明确为 Rust/Tauri、libobs、NVENC、FFmpeg、S3 Multipart、FastAPI、MinIO、PostgreSQL、Celery、Redis 和 HLS.js。
- Web 复盘同一时间只播放一个成员第一视角，点击成员后保持当前 Pull 时间切换视频，不做多路并排播放。
- 已确认每个运行桌面 Agent 的参战成员都上传完整 CombatLog 和第一视角录像，由云端汇总、去重和补缺，不采用主日志上传者模式。
- 已将 MVP 上传时机收敛为 Pull 结束后上传；约 5 秒目标指 Web 出现 Pull 和处理状态，不承诺视频在 5 秒内完成上传并可播放。
- 已明确平台用户 ID 负责权限和上传归属，CombatLog 角色 GUID 负责游戏角色及第一视角关联。
- 已创建 `docs/DEVELOPMENT_PLAN.md`，将第一版拆为 M0–M7；包含双视角 Web 复盘的 P0 技术闭环预计 39–55 个全职工作日，完成可靠性收尾的第一版预计 44–62 个全职工作日。
- 当前没有进行中的代码实现任务，下一阶段应先做 P0 技术验证。

## 最近完成

- 重写 `docs/PRODUCT.md`，将原有排轴和 WCL 核心方向替换为端云多视角复盘闭环。
- 在 `CLAUDE.md` 中补充 Windows 客户端、对象存储、媒体处理和可靠上传架构约束。
- 明确第一阶段的实时上传不是直播，并将排轴、STT、NSRT 和 WCL 主入口降为后续能力。
- 确认 Redis 同时用于 Celery Broker 和 MVP 缓存，业务最终状态继续保存于 PostgreSQL。
- 将原多路并排播放方案收敛为单播放器的成员第一视角切换。
- 将日志上传策略确定为全员完整上传，云端统一生成事件流并保留成员日志与录像映射。
- 已检查本地 `D:\work\code\wow-recorder` 主分支源码，确认其使用 Electron + React + 原生 `noobs/libobs`，采用持续缓冲、CombatLog 触发、FFmpeg stream copy 和 Pull 结束后整文件上传。
- 已确认 `wow-recorder` 只上传视频和精简 JSON 元数据，不上传原始 CombatLog；100 MB 起使用串行 S3 Multipart，每 Part 100 MB，不属于边录边传方案。
- 根据当前 MVP 时延要求，取消战斗中视频分片上传的 P0 强制要求，改为 Pull 结束后提交元数据、完整日志和视频。
- 第一版开发顺序确定为工程骨架、录制 Spike、CombatLog、本地 Pull、账号团队、可靠上传、云端同步、媒体与 Web、端到端验收。

## 阻塞与风险

- `wow-recorder` 根 `LICENSE` 是 GPL v2，但 `package.json` 声明 `Creative Commons Attribution-NonCommercial`，`release/app/package.json` 又声明 MIT，许可证元数据冲突；复用任何源码前必须取得作者澄清或独立实现。
- 尚未单独核对 `noobs`、OBS、FFmpeg 及其插件和编解码组件的完整再分发边界。
- 非 NVIDIA 设备的编码降级策略仍需确定。
- CombatLog 与多成员视频同步的误差阈值需要真实团本样本验证。
- 多份完整 CombatLog 的事件指纹、冲突选择和补缺规则需要真实样本验证。
- `wow-recorder` 的日志增量读取没有保留跨读取块的不完整尾行，且日志时间解析丢弃小数秒；本项目不能照搬这两处实现。

## 下一步

- 从开发计划 M0 开始建立三端最小骨架和本地 PostgreSQL、Redis、MinIO 环境。
- M0 的首个纵向切片为：Tauri 启动独立 Recorder Host 并完成 `ping/pong` IPC，同时打通 FastAPI 健康检查、Celery 探活、React 调用和本地基础设施。
- 随后执行 M1 Recorder Spike，对比 `libobs` 持续缓冲和滚动短文件方案，只保留实测通过的一种实现。
- 实测 Pull 结束后状态在约 5 秒内可见，并记录不同码率和上行带宽下视频完整可播放的实际耗时。
- 针对本项目实现独立的完整 CombatLog 区间上传、断点状态、不完整行缓冲和毫秒级时间解析，不复用 `wow-recorder` 的本地元数据模型。
- 根据实测确定视频分片、同步误差、Redis 可靠性配置和播放器切换性能。
- 验证 20 份日志并行上传、云端去重和统一事件流生成的吞吐与存储成本。
