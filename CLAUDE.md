# 项目开发指南

本文件是项目技术栈、目录架构、开发方式和测试结构的统一入口。Agent 开始任务前必须先阅读本文件；产品范围和业务验收以 `docs/PRODUCT.md` 为准，执行行为和提交要求以 `AGENTS.md` 为准。

## 1. 技术栈

- 前端：React 19、Ant Design 6.5
- 后端：Python 3.11、FastAPI
- 数据库：PostgreSQL
- 托管数据库：Supabase PostgreSQL
- 部署：Docker，支持连接 Supabase 或自建 PostgreSQL
- 时区：`Asia/Shanghai`

Supabase 当前只作为托管 PostgreSQL 使用。Auth、Storage、Realtime 等能力仅在需求明确后接入，不得默认引入。

## 2. 架构原则

- 前后端分离，前端通过 HTTP API 调用后端。
- FastAPI 是业务数据和权限校验的唯一后端入口；前端不得绕过后端直接写业务表。
- PostgreSQL 是唯一关系型数据库，Supabase 与 Docker PostgreSQL 必须保持相同 schema 和迁移结果。
- 业务配置通过环境变量注入，仓库只提交无敏感信息的示例配置。
- 业务模块按领域组织，公共模块必须业务中立且存在多个真实消费者。
- 依赖方向保持单向：页面或 API → Service → 数据访问或外部适配器。

## 3. 目标目录架构

以下是项目目标结构。目录和文件只在有真实职责时创建，不为占位而提前生成。

```text
wow/
├─ AGENTS.md                 # Agent 行为、代码和提交规则
├─ CLAUDE.md                 # 技术栈、架构、开发和测试指南
├─ README.md                 # 项目介绍与快速开始
├─ docs/
│  └─ PRODUCT.md             # 产品范围与验收标准
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
- `CLAUDE.md`：技术栈、目录架构、开发流程、测试结构和部署方式。
- `AGENTS.md`：Agent 工作方式、代码质量、验证授权和提交规范。
- `README.md`：面向开发者的安装、启动和常用命令。

架构或技术栈发生变化时，必须同步更新本文件；启动命令变化时同步更新 `README.md`。
