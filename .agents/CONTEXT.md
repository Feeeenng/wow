# 长期项目上下文

本文件只保存跨任务、跨设备仍然有效的事实和决定。失效内容应及时替换，具体讨论过程保留在月度历史中。

## 开发者与工作方式

- 项目由个人开发者维护，会在多台 Windows 设备上使用不同 AI 编程助手。
- 项目级 AI 上下文使用本目录中的 Markdown 文件保存，并通过 Git 同步。
- 不为 AI 上下文引入数据库、Redis 或额外云服务。
- 优先保证新设备能快速恢复当前状态，同时控制多年历史的文件体积和上下文读取量。

## 项目依据

- 技术栈、目录架构、开发方式和测试约定以根目录 `CLAUDE.md` 为准。
- 产品行为和验收范围以 `docs/PRODUCT.md` 为准。
- Agent 工作与交付规则以根目录 `AGENTS.md` 为准。

## 上下文管理决定

- `.agents/CONTEXT.md` 保存长期稳定信息。
- `.agents/HANDOFF.md` 保存当前交接状态。
- `.agents/INDEX.md` 提供历史定位入口。
- 对话历史按年、月拆分保存在 `.agents/conversations/`。
- 对话历史采用结构化摘要，不保存逐字聊天和敏感信息。

## 当前产品方向

- 产品定位为魔兽世界中国区正式服团队的多视角云端战斗复盘平台。
- Windows 桌面 Agent 使用 Rust 与 Tauri 2，独立 Recorder Host 使用 `libobs` 和 NVENC 录制编码；Agent 增量读取 CombatLog，并通过 S3 Multipart 可靠上传到 MinIO。
- 云端使用 FastAPI、PostgreSQL、Celery、Redis 和 FFmpeg，负责日志解析、Pull 关联、视频处理和跨成员时间对齐。
- Web 端使用 HLS.js 和单个原生视频播放器；一个团队可以有约 20 个成员视角，但同一时间只播放一个，点击成员后保持当前 Pull 时间并切换到其第一视角。
- “实时上传”当前指边录边传和近实时可见，不包含公开直播。
- `reviewtool.gg` 作为产品体验参考，`aza547/wow-recorder` 作为客户端技术路线参考；复用前必须完成许可证和兼容性评估。
- WCL 导入、团本排轴、STT 和 NSRT 不再属于第一阶段核心闭环。
