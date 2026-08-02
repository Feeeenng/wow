# 项目开发指南

本文件是项目技术栈、目录架构、开发方式和测试结构的统一入口。Agent 开始任务前必须先阅读本文件；产品范围和业务验收以 `docs/PRODUCT.md` 为准，执行行为和提交要求以 `AGENTS.md` 为准。

## 1. 技术栈

- 前端：React 19、Ant Design 6.5
- 后端：Python 3.11、FastAPI
- Windows 桌面 Agent：Rust、Tauri 2、React、TypeScript、Ant Design，Rust 负责系统能力与业务编排，WebView 负责客户端界面
- 录制与编码：Rust 后端通过 OBS Studio WebSocket 控制专属场景、音视频来源和录制；回放缓冲和上传边界待 P0 验证
- 数据库：PostgreSQL
- 托管数据库：Supabase PostgreSQL
- 对象存储：MinIO、S3 Multipart Upload
- 任务与缓存：Celery、Redis；业务最终状态不得只保存在 Redis
- 媒体处理：FFmpeg、ffprobe、CMAF/fMP4、HLS
- Web 播放：`Media Chrome` React 控件框架、原生 `HTMLVideoElement`、HLS.js，单播放器按成员切换第一视角
- 部署：Docker，支持连接 Supabase 或自建 PostgreSQL
- 时区：`Asia/Shanghai`

Supabase 当前只作为托管 PostgreSQL 使用。Auth、Storage、Realtime 等能力仅在需求明确后接入，不得默认引入。

## 2. 架构原则

- 前后端分离，前端通过 HTTP API 调用后端。
- Windows 客户端通过后端签发的受控上传流程，在 Pull 结束后提交本场完整原始日志和视频文件，不直接写业务数据库。
- FastAPI 是业务数据和权限校验的唯一后端入口；前端不得绕过后端直接写业务表。
- PostgreSQL 是唯一关系型数据库，Supabase 与 Docker PostgreSQL 必须保持相同 schema 和迁移结果。
- PostgreSQL 只保存结构化元数据和事件索引；视频、原始日志与转码产物保存到私有对象存储。
- 上传、日志解析、视频处理和跨成员时间同步必须设计为幂等、可恢复的异步流程。
- Celery 使用 Redis 作为 Broker；Redis 缓存必须设置 TTL，缓存未命中时回源 PostgreSQL。
- 同一 Pull 可以关联多名成员的第一视角录像，但 Web 端同一时间只播放一个视角；切换成员时保持统一 Pull 时间位置。
- 每个参与活动且运行桌面 Agent 的成员都上传自己的完整原始 CombatLog 和第一视角录像；云端保留各自来源，通过事件去重与补缺生成统一战斗时间线。
- 平台 `user_id` 负责鉴权、团队归属和上传者审计；CombatLog 角色 GUID 只负责游戏角色与录像视角关联，不得替代登录身份或上传授权。
- MVP 不要求边录边传；Pull 结束后先提交元数据并优先上传压缩日志，使处理状态目标在约 5 秒内可见，再并行或随后上传视频。大视频可使用 S3 Multipart 恢复上传，但必须完成整个对象后才能播放。
- 业务配置通过环境变量注入，仓库只提交无敏感信息的示例配置。
- 业务模块按领域组织，公共模块必须业务中立且存在多个真实消费者。
- 依赖方向保持单向：页面或 API → Service → 数据访问或外部适配器。

### 2.1 Windows 客户端界面边界

- 桌面客户端 UI 使用 Tauri 2 WebView + React/TypeScript，不使用 GPUI。
- Rust 层负责 WoW/OBS 进程检测、CombatLog、SQLite、本地上传队列、OBS WebSocket 连接和 Tauri command/event；React 不直接访问系统资源，也不运行后端模块。
- 客户端与 Web 端可以共享无运行时依赖的 API 类型、校验规则和设计 Token，第一版不提前抽取跨端业务组件库。
- 当前不建设独立 Recorder Host，也不在 Tauri 进程中直接链接 `libobs`。Tauri Rust 后端通过 `obws` 连接 OBS Studio WebSocket，由 OBS Studio 承担采集、编码和文件输出；React 只通过 Tauri command/event 读取连接与录制状态。
- OBS 固定安装在客户端可执行文件同级目录并由 Rust 管理生命周期；客户端运行期间保持监听，OBS 意外或手动退出后自动重新启动。所有采集源使用固定 `WoW Recorder` 专属场景，React 不提供手动连接入口。
- Rust OBS 领域按业务边界组织：`obs/runtime/` 负责安装、配置、连接和进程生命周期，`obs/settings/` 负责音频、画面捕捉和视频参数；根目录只保留领域入口及跨域共享工具。
- 桌面客户端持久化采用 Rust `LocalStateStore` 管理的 `client-state.json`，按业务 section 保存用户偏好和可恢复设置；React 通过应用级 Provider 保留跨页面内存状态，不直接使用浏览器存储。OBS 在线、录制、安装进度、实时电平等瞬时状态仍以 Rust 和 OBS 实时检测为准。
- 正式直播架构以 `docs/LIVE_ARCHITECTURE.md` 为准：Rust 控制 OBS 通过 WHIP/WebRTC 发布并代理 WHEP HTTP 信令，React 只创建 `RTCPeerConnection` 和挂载远端媒体；桌面端与网页端共用 Media Chrome 播放器。直播同时进行 OBS 本地录像和云端分片录像，不保留 Virtual Camera、截图轮询或本机 HLS 等替代路线。历史回放统一使用 CMAF/fMP4 HLS 和 HLS.js，并通过 CombatLog/WCL 的统一 Pull 时间映射到每个成员视频。
- 只有当产品出现高频自绘画布、编辑器级排版或 WebView 无法满足的确定性能瓶颈时，才重新评估 GPUI。

## 3. 目标目录架构

以下是项目目标结构。目录和文件只在有真实职责时创建，不为占位而提前生成。

```text
wow/
├─ AGENTS.md                 # Agent 行为、代码和提交规则
├─ CLAUDE.md                 # 技术栈、架构、开发和测试指南
├─ README.md                 # 项目介绍与快速开始
├─ docs/
│  └─ PRODUCT.md             # 产品范围与验收标准
├─ client/                   # Windows 采集客户端，技术验证后再建立具体结构
├─ web/                      # React 前端
│  ├─ src/
│  │  ├─ app/                # 应用入口、路由和全局 Provider
│  │  ├─ pages/              # 按业务能力组织的页面
│  │  ├─ components/         # 多页面复用的业务中立组件
│  │  ├─ services/           # HTTP 请求与接口适配
│  │  ├─ hooks/              # 多处复用的通用 Hook
│  │  ├─ types/              # 前端共享类型
│  │  ├─ utils/              # 无状态纯工具函数
│  │  └─ styles/             # 全局样式与主题变量
│  └─ tests/                 # 前端集成测试与测试工具
├─ backend/                  # FastAPI 后端
│  ├─ app/
│  │  ├─ api/                # 路由、依赖注入和请求校验
│  │  ├─ core/               # 配置、安全和基础设施入口
│  │  ├─ db/                 # 数据库会话和数据访问基础设施
│  │  ├─ models/             # 数据库模型
│  │  ├─ schemas/            # API 请求与响应模型
│  │  ├─ services/           # 按业务域组织的 Service
│  │  ├─ integrations/       # Supabase、WCL 等外部适配器
│  │  ├─ utils/              # 无状态纯工具函数
│  │  └─ main.py             # FastAPI 应用入口
│  └─ tests/
│     ├─ unit/               # 纯逻辑与单模块测试
│     ├─ integration/        # 数据库和外部适配测试
│     └─ api/                # HTTP 接口契约测试
├─ migrations/               # PostgreSQL schema 迁移
├─ docker/                   # 容器配置和启动脚本
├─ compose.yaml              # 本地或自托管服务编排
└─ .env.example              # 无敏感信息的环境变量示例
```

## 4. 前端代码结构

- 使用 React 函数组件和 Hooks，不新增 class component。
- Ant Design 作为基础组件库；优先复用其组件、Token 和主题能力，避免重复实现基础控件。
- 页面状态留在页面或业务 Hook；跨页面共享且长期存在的状态才进入全局状态层。
- 请求集中在 `services/`，页面和组件不得散落拼接 endpoint。
- 页面专属组件、类型、Hook 和样式与页面就近组织；公共目录只放多处复用内容。
- API 数据与 UI 展示模型不一致时，在请求适配层显式转换。
- 后端返回的 `YYYY-MM-DD HH:mm:ss` 时间按 `Asia/Shanghai` 直接展示，不做浏览器时区二次转换。

## 5. 后端代码结构

- `api/` 只处理参数、依赖、权限入口、Service 调用和响应，不承载业务计算或 SQL。
- `services/<domain>/` 承载业务流程；Service class 保存数据库会话、当前用户和请求上下文。
- `models/` 只定义持久化模型，`schemas/` 只定义输入输出契约，两者不得混用。
- 数据库访问集中在后端，使用参数化查询和事务；跨多个写操作的业务流程必须明确事务边界。
- `integrations/` 隔离 Supabase、WCL 等外部协议，业务 Service 不直接依赖第三方响应结构。
- 配置统一由配置模块读取环境变量，不在业务模块散落默认值。
- 所有业务时间通过统一时间工具生成、归一化和序列化。

## 6. 数据库约束

- Supabase 和 Docker PostgreSQL 共用同一套迁移文件，禁止分别维护 schema。
- 所有 schema 变化必须通过迁移完成，不直接手工修改生产数据库。
- 表、字段、索引和约束使用清晰一致的英文命名。
- 外键、唯一性、非空和检查约束优先由数据库保证，Service 层补充业务校验。
- 涉及用户或团队的数据必须包含明确的数据归属和权限过滤条件。
- 迁移必须说明升级影响；不可逆迁移、数据回填或历史时间处理必须先给出方案。

## 7. 本地开发

1. 阅读 `AGENTS.md`、本文件和相关产品文档。
2. 根据仓库现有锁文件选择前端包管理器，不混用 npm、pnpm 或 yarn。
3. 后端使用 Python 3.11 独立虚拟环境，并按项目依赖文件安装依赖。
4. 从 `.env.example` 创建本地环境配置，不提交真实凭证。
5. 数据库二选一：连接 Supabase PostgreSQL，或通过 Docker 启动本地 PostgreSQL。
6. 应用数据库迁移后，再分别启动 FastAPI 和 React 开发服务。

实际启动命令以 `README.md`、前端 `package.json` 和后端依赖配置为准；这些文件尚未定义时，不得虚构可用命令。

## 8. 测试结构

### 前端

- 组件测试覆盖关键交互、条件渲染和权限状态。
- 页面集成测试覆盖加载、成功、空数据、失败和无权限状态。
- 请求层测试覆盖数据转换、异常映射和边界响应。
- 测试文件与源码就近放置，跨页面集成测试放入 `web/tests/`。

### 后端

- 单元测试放入 `backend/tests/unit/`，覆盖纯计算和 Service 分支。
- 集成测试放入 `backend/tests/integration/`，覆盖 PostgreSQL、事务和外部适配器边界。
- 接口测试放入 `backend/tests/api/`，覆盖状态码、响应契约、权限和错误路径。
- 数据库测试使用隔离测试库，不连接生产 Supabase 项目。

### 执行规则

- 修改行为时应同步补充或更新相关测试。
- 测试数据必须可重复创建和清理，不依赖人工准备。
- 是否实际运行测试、lint、类型检查或构建，遵循 `AGENTS.md` 的授权要求。

## 9. Docker 部署

- 前端、后端和 PostgreSQL 使用独立容器或服务，禁止将多个进程塞入同一应用容器。
- 后端通过环境变量配置数据库连接；同一镜像应同时支持 Supabase 和自建 PostgreSQL。
- 容器启动时不得自动执行破坏性迁移；生产迁移必须作为独立、可审计步骤执行。
- 健康检查至少覆盖后端服务状态；数据库检查应验证连接可用性。
- 镜像使用固定运行时版本，前端构建产物和 Python 依赖采用多阶段构建或等价方式缩小镜像。
- `.env`、数据库数据目录和运行时密钥不得写入镜像或提交仓库。

## 10. 文档职责

- `docs/PRODUCT.md`：产品范围、功能规则、优先级和验收标准。
- `docs/DEVELOPMENT_PLAN.md`：第一版实施阶段、交付顺序、工作量估算和阶段退出条件。
- `CLAUDE.md`：技术栈、目录架构、开发流程、测试结构和部署方式。
- `AGENTS.md`：Agent 工作方式、代码质量、验证授权和提交规范。
- `README.md`：面向开发者的安装、启动和常用命令。

架构或技术栈发生变化时，必须同步更新本文件；启动命令变化时同步更新 `README.md`。
