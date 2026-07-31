# 当前工作交接

更新时间：2026-07-31（Asia/Shanghai）

## 当前状态

- 项目级 AI 上下文目录已迁移到根目录 `.agents/`。
- 已建立长期上下文、当前交接、历史索引和按月对话记录四层结构。
- 产品方向已调整为 Windows 客户端采集上传、云端处理、Web 多视角时间线复盘。
- 技术栈已明确为 Rust/Tauri、libobs、NVENC、FFmpeg、S3 Multipart、FastAPI、MinIO、PostgreSQL、Celery、Redis 和 HLS.js。
- Web 复盘同一时间只播放一个成员第一视角，点击成员后保持当前 Pull 时间切换视频，不做多路并排播放。
- 当前没有进行中的代码实现任务，下一阶段应先做 P0 技术验证。

## 最近完成

- 重写 `docs/PRODUCT.md`，将原有排轴和 WCL 核心方向替换为端云多视角复盘闭环。
- 在 `CLAUDE.md` 中补充 Windows 客户端、对象存储、媒体处理和可靠上传架构约束。
- 明确第一阶段的实时上传不是直播，并将排轴、STT、NSRT 和 WCL 主入口降为后续能力。
- 确认 Redis 同时用于 Celery Broker 和 MVP 缓存，业务最终状态继续保存于 PostgreSQL。
- 将原多路并排播放方案收敛为单播放器的成员第一视角切换。

## 阻塞与风险

- 尚未核对 `wow-recorder`、OBS 及其依赖的许可证和再分发边界。
- 非 NVIDIA 设备的编码降级策略仍需确定。
- CombatLog 与多成员视频同步的误差阈值需要真实团本样本验证。
- 本次环境没有可用的内置浏览器会话，未直接核对两个参考项目页面。

## 下一步

- 调研 `aza547/wow-recorder` 的架构、许可证、OBS 集成和 CombatLog 处理方式。
- 用两台 Windows 设备制作 P0 原型，验证录制、日志增量读取、断点续传和双视角同步。
- 根据实测确定视频分片、同步误差、Redis 可靠性配置和播放器切换性能。
