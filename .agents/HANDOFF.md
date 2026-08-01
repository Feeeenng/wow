# 当前工作交接

更新时间：2026-08-01（Asia/Shanghai）

## 当前状态

- 项目级 AI 上下文目录已迁移到根目录 `.agents/`。
- 已建立长期上下文、当前交接、历史索引和按月对话记录四层结构。
- 产品方向已调整为 Windows 客户端采集上传、云端处理、Web 多视角时间线复盘。
- 技术栈已明确为 Rust、Tauri 2、React/TypeScript WebView、OBS Studio WebSocket、FFmpeg、S3 Multipart、FastAPI、MinIO、PostgreSQL、Celery、Redis 和 HLS.js。
- 桌面 UI 已确定使用 Tauri WebView + React，不采用 GPUI；P0 OBS 预览使用独立原生窗口。
- OBS 生态已确认，独立 Recorder Host 和直接链接 libobs 已移出技术路线；Rust 后端已通过 `obws` 实现 OBS Studio WebSocket 最小控制链路。
- React 只负责 UI，录制、配置、文件、CombatLog、上传和进程生命周期等后端能力全部由 Rust 实现。
- Web 复盘同一时间只播放一个成员第一视角，点击成员后保持当前 Pull 时间切换视频，不做多路并排播放。
- 已确认每个运行桌面 Agent 的参战成员都上传完整 CombatLog 和第一视角录像，由云端汇总、去重和补缺，不采用主日志上传者模式。
- 已澄清产品流程：所有团员安装本项目客户端，各自自动录制并上传自己的第一视角，云端按同一团队和 Pull 统一汇总；OBS 仅是客户端内部实现，不要求用户连接外部 OBS。
- 已将 MVP 上传时机收敛为 Pull 结束后上传；约 5 秒目标指 Web 出现 Pull 和处理状态，不承诺视频在 5 秒内完成上传并可播放。
- 已明确平台用户 ID 负责权限和上传归属，CombatLog 角色 GUID 负责游戏角色及第一视角关联。
- 已创建 `docs/DEVELOPMENT_PLAN.md`，将第一版拆为 M0–M7；包含双视角 Web 复盘的 P0 技术闭环预计 39–55 个全职工作日，完成可靠性收尾的第一版预计 44–62 个全职工作日。
- 已建立 `client/` 的 Tauri 2、React 19 和 Ant Design 6.5 最小骨架，并按 `index-01.png` 完成模块化首页；OBS 摘要读取 Rust 状态，连接与测试录制位于独立 Tauri 子窗口。
- 前端路径别名已统一为 `@/`，现有 `client/src` 内部导入已清除相对路径；全部 CSS 已改为多行规则格式，约束写入根目录 `AGENTS.md`。

## 最近完成

- 统一格式化 `client/src` 下全部 CSS，每条声明单独占行；为 TypeScript 和 Vite 配置 `@/` 到 `src/` 的路径别名，并迁移全部内部导入。
- 按 `docs/images/index-01.png` 重新校准 1680×940 首页，拆分侧栏、标题栏、快速开始、OBS、战斗日志、最近记录和状态总览业务组件，并完成桌面实机截图核对。
- 新增 Rust `obs` 领域模块，使用 `obws 0.15` 提供本机地址校验、连接、断开、状态查询、开始录制和停止录制命令；React 只负责表单和状态展示。
- 新增独立 `obs-control` Tauri 子窗口；修复同步 IPC 创建窗口导致 WebView2 白页的问题，改为异步命令创建，并验证 OBS 未运行时错误可见且主进程不崩溃。
- 已彻底移除 `recorder-host/`、noobs 源码、构建缓存和实验录像，不再将 Recorder Host 作为产品主要技术路线。
- 录制方向调整为后续专项研究 OBS Studio WebSocket，连接和控制逻辑必须位于 Rust 后端。
- 已合并多设备上的产品路线决策与客户端原型实现记录，冲突文件按“决策在前、实现随后”保留双方有效内容。
- 参考 `docs/images/index-01.png` 完成深色桌面首页，包含侧栏、快速开始横幅、OBS 设置、战斗日志、最近记录和状态总览；首页横幅直接从参考图裁取。
- 为无边框 Tauri 窗口实现最小化、最大化和关闭按钮；浏览器预览时窗口按钮保持无副作用。
- 新增无参数 `client/package.ps1`，已成功生成 `WoW Recorder_0.1.0_x64-setup.exe`；脚本自动补入 Rustup Cargo 路径，避免安装 Rust 后必须重启终端。
- 修复 release 客户端启动时同时出现黑色控制台窗口的问题；Rust 入口现仅在非调试构建使用 Windows GUI 子系统，已验证进程只创建 `WoW Recorder` 主窗口。
- 安装客户端 npm 依赖并生成 `package-lock.json`，补充 `client/.gitignore`，未接入 Rust IPC、`libobs` 或真实文件选择。
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

- 已验证 OBS 未运行时的连接失败路径；真实 OBS Studio 的版本兼容、鉴权、进程发现、断线恢复、回放缓冲和文件完成信号仍待验证。
- `wow-recorder` 根 `LICENSE` 是 GPL v2，但 `package.json` 声明 `Creative Commons Attribution-NonCommercial`，`release/app/package.json` 又声明 MIT，许可证元数据冲突；复用任何源码前必须取得作者澄清或独立实现。
- 尚未单独核对 OBS、FFmpeg 及其插件和编解码组件的完整再分发边界。
- 非 NVIDIA 设备的编码降级策略仍需确定。
- 当前 NSIS 安装包未进行代码签名，首次安装可能触发 Windows 安全提示。
- 前端 release 包存在单个 JavaScript chunk 超过 500 kB 的 Vite 警告，当前原型不影响运行，后续页面增加时需按路由拆包。
- CombatLog 与多成员视频同步的误差阈值需要真实团本样本验证。
- 多份完整 CombatLog 的事件指纹、冲突选择和补缺规则需要真实样本验证。
- `wow-recorder` 的日志增量读取没有保留跨读取块的不完整尾行，且日志时间解析丢弃小数秒；本项目不能照搬这两处实现。

## 下一步

- 启动真实 OBS Studio 并开启 WebSocket 5.x，验证鉴权、连续开始/停止录制、输出路径和断线恢复。
- 继续建立 FastAPI、Celery、React、PostgreSQL、Redis 和 MinIO 的本地健康链路，完成 M0 其余骨架。
- 随后执行 M1 OBS WebSocket Spike，验证录制、回放缓冲和 Pull 结束文件上传边界。
- 实测 Pull 结束后状态在约 5 秒内可见，并记录不同码率和上行带宽下视频完整可播放的实际耗时。
- 针对本项目实现独立的完整 CombatLog 区间上传、断点状态、不完整行缓冲和毫秒级时间解析，不复用 `wow-recorder` 的本地元数据模型。
- 根据实测确定视频分片、同步误差、Redis 可靠性配置和播放器切换性能。
- 验证 20 份日志并行上传、云端去重和统一事件流生成的吞吐与存储成本。
