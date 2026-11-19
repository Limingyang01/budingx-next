# agent-observability · Agent 可观测性监控（Langfuse）

状态：**实施完成，代码验证全绿；真实部署/live 三场景 UNVERIFIED**｜版本：v0.3｜依据：SP004 优化需求（USER_CONFIRMED）、路线图 SP004、参考仓 `buding-worker-space` Langfuse 体系只读审计

## 目标

在 budingx-next 的 TUI + Core Agent 运行链路上落地一套**本地自建 Langfuse 监控体系**，让开发者在自己的机器上查看 Agent 任务、模型调用、工具执行与错误记录：

- 一次 `agent.run` 根观测，其下挂 `model.request`（generation）与 `tool.<name>`（tool）子观测，父子层级与 `session.id` 关联可查；
- 默认**只采集结构化元数据**（耗时、模型名、工具名、outcome、token 用量），正文（用户输入/模型响应/工具入参出参）**显式 opt-in** 才采集；
- 追踪关闭、配置缺失、上报失败、平台不可达**都不得改变 Agent 的业务结果**；
- 提供**无界面可重复的验收脚本**，用真实模型跑「成功 / 工具失败 / 模型失败」三场景，并从 Langfuse 公开 API 回查观测记录，自证接入生效。

## 边界

### 本轮交付

1. 本机 Langfuse 部署资产（Compose + 初始化脚本 + 启停控制脚本 + 使用文档）。
2. Core 侧追踪端口契约与运行时埋点（`agent.run` / `model.request` / `tool.<name>`）。
3. 配置加载（显式 env 文件路径 + 白名单变量继承优先）。
4. 无界面验收脚本 + 报告产物。

### 明确排除

| 排除项 | 理由 |
| --- | --- |
| 生产高可用部署、多租户、SSO | 本轮目标是**开发者本机自建**，不是生产观测平台 |
| 云端 Langfuse 托管版默认接入 | 默认离线；显式配置 base URL 才能指向任意兼容端点 |
| 内容采集默认开启 / 自动扫描仓库 `.env` | 隐私与凭据底线，见「边界规则」 |
| 完整性能看板（p50/p95、费用分析、内存） | 属能力矩阵「诊断与性能」行，归 SP007/SP016 |
| 多端共享观测、跨进程 trace 续接 | 属 SP005（会话恢复）/ SP008（宿主契约） |
| 打包发布 Langfuse 到 npm | 部署资产是开发期工具，不进产品制品 |
| 追踪数据作为验收唯一来源 | 平台可查询 ≠ 业务正确；两者分别取证 |

### 边界规则（不可突破）

- **默认关闭**：`BUDINGX_LANGFUSE_ENABLED` 不为 `1` 时完全不初始化追踪器，零 Langfuse 网络请求。
- **凭据只来自显式配置**：不扫描工作区、不自动读取仓库 `.env`、不读取 `~/.claude`；只接受进程环境或用户显式指定的 env 文件绝对路径。
- **正文采集是显式 opt-in**：`BUDINGX_LANGFUSE_CAPTURE_CONTENT=1` 才采集正文；且必须经过凭据脱敏，再从脱敏后的内容按长度上限裁剪。
- **密钥不进 Git**：本机凭据、登录信息、验收报告落在 Git 忽略目录，不提交仓库。
- **追踪不得改变业务结果**：任何埋点异常、上报超时、平台 5xx 都静默降级，不得让 Agent 回合失败。

## 参考对照点（行为锚点，只读机制不抄代码）

来源：参考仓 `ops/langfuse/`（`compose.yaml` / `README.md`）、`scripts/langfuse/`（`init-local.mjs` / `control.ps1` / `configure-plugin.mjs` / `verify-agent.mjs`）、`vscode_plugin/src/host/observability/agentTracing.ts`、`vscode_plugin/src/host/observability/tracingConfig.ts`、`src/server/services/langfuseRuntime.ts`、`vscode_plugin/docs/langfuse.md`、`SP/SP01/agent-observability/STATUS.md`（只读审计，未取用任何源码）。

| 锚点 | 参考行为 | 本轮目标 |
| --- | --- | --- |
| A-01 | 本机 Compose 起 Langfuse 4.78.0（Web/Worker/PostgreSQL 16/ClickHouse/Redis 7/MinIO），仅发布 `127.0.0.1:3000` 与 `127.0.0.1:9090` | **行为等价**：自建 Compose 结构与端口绑定一致；**镜像版本**按本轮实施时可用的稳定版确定并记录 |
| A-02 | `init-local.mjs` 生成 `local.env` / `plugin.env` / `login.json`，随机密钥、幂等重跑不覆盖已有凭据 | **行为等价**：本轮改名为 `local.env` / `agent.env` / `login.json`（本仓无 VS Code 插件语境），保留幂等与「已有文件不完整则报错不覆盖」语义 |
| A-03 | `control.ps1` 支持 start/stop/status/logs；Windows 找不到 Docker CLI 时走 WSL，并用隐藏保活进程让服务在启动器退出后继续可用 | **行为等价**：`stop` 不删数据卷；WSL 保活沿用（记录 pid + started 校验） |
| A-04 | 追踪默认关闭，`initializeTracing` 需要 `BUDINGX_LANGFUSE_ENABLED=1` + public/secret key 才建实例 | **行为等价**：本仓用 `BUDINGX_LANGFUSE_*` 前缀（去掉参考仓的插件语境） |
| A-05 | `AgentTracing` 用 `AsyncLocalStorage` 承载父子 span 上下文 | **行为等价**：本仓在实际回合启动后显式传递根句柄，直接通过现有 OTLP/HTTP 方案写入父子关系。沿用自研 Agent Core，不引入 LangChain、LangGraph 或 OTel SDK。 |
| A-06 | 观测属性用 `langfuse.observation.type`（agent/tool/generation）、`langfuse.observation.metadata.outcome`、`langfuse.observation.level`（ERROR/WARNING）、`langfuse.observation.input/output` | **行为等价**：属性名与语义保持一致，保证 Langfuse UI 能正确归类与着色 |
| A-07 | `outcome` 区分 `success` / `error` / `cancelled` / `blocked`；`blocked` 用于权限拒绝与 hook 拒绝 | **行为等价**：本仓 `blocked` 覆盖 SP003/SP004 的权限拒绝与计划模式阻断 |
| A-08 | `captureContent` 关闭时无正文，开启时脱敏，超限裁剪 | **行为等价**：在 `src/observability` 独立实现脱敏，从脱敏结构生成最长 8000 字符的合法 JSON。 |
| A-09 | `tracingConfig.loadTracingEnvironment` 只导入 5 个白名单变量，继承环境优先，不读工作区设置 | **行为等价**：白名单为 `BUDINGX_LANGFUSE_ENABLED` / `BUDINGX_LANGFUSE_CAPTURE_CONTENT` / `LANGFUSE_BASE_URL` / `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` |
| A-10 | `agent.run` 根观测带 `session.id` 与 `langfuse.trace.metadata.runId`；`model.request` 带 `gen_ai.request.model`；工具观测带 `gen_ai.tool.call.id` | **行为等价**：本仓根观测额外带 `turn.id` 与 `outcome` |
| A-11 | `model.request` 携带 usage（input/output token）；`langfuse.observation.usage_details` | **行为等价**：本仓从 `Usage` 事件取真实 token 数，无则不写该属性 |
| A-12 | `verify-agent.mjs` 无界面跑三场景，轮询 Langfuse `/api/public/v2/observations`，写 `verification.json` | **行为等价**：走本仓生产 Agent 路径，验收同时校验场景节点、级别、父子关系、会话归属与适用的正文内容。 |
| A-13 | 报告必须同时检查场景结果与观测层级，不能只看「有 trace」；正文未采集时该项为 null 不冒称已验证 | **行为等价**：验收报告分 `localExpectationMet` / `platformIndexed` / `hierarchyOk` / `sessionConsistent` / `contentVerified` 五项独立判定 |
| A-14 | 参考仓服务端实现走 `POST /api/public/otel/v1/traces`（OTLP JSON），带 `x-langfuse-ingestion-version: 4` | **行为等价**：本轮自建导出器用同一端点与请求头，`service.name` 用 `budingx-tui` |
| A-15 | 参考仓 `langfuseRuntime` 对 base URL 做协议与凭据校验（http 只允许 localhost/127.0.0.1/[::1]） | **行为等价**：本仓同校验；**放宽到任意 https 端点**（用户显式配置云端时可用），http 仍限本机 |

## TUI 与本轮验收

本需求**不新增 TUI 交互**。追踪状态通过已有 TUI 诊断输出与本机文件体现；TUI 侧只新增**只读**的追踪状态展示入口（诊断类输出），不引入新命令族（斜杠命令面属 SP006）。

验收统一基线、证据与恢复条件见[验收报告](../test-report.md)；独立来源与 AST 复核见[设计 §9](./design/design.zh.md)。

## 验收条件（AC）

### 部署与配置

- **OB-01** Given 已有 Docker Engine/Compose v2，When 执行初始化，Then 在 Git 忽略的本机目录创建 `local.env`、`agent.env`、`login.json`，写入前确保目录与文件限制为当前用户访问。POSIX 以目录 `0o700`、文件 `0o600` 验证，Windows 以实际 NTFS ACL 验证；无法建立或验证权限则停止初始化。
- **OB-02** Given 已存在完整的初始化文件，When 重复执行初始化脚本，Then 不覆盖已有凭据且退出成功；Given 已有文件缺关键键，When 执行初始化，Then 报错并保留原文件，不删除数据卷重来。
- **OB-03** Given Compose 文件，When 启动，Then 拉起 Web/Worker/PostgreSQL/ClickHouse/Redis/MinIO 六个服务，宿主只发布 `127.0.0.1:3000` 与 `127.0.0.1:9090`，数据库端口不对宿主开放。
- **OB-04** Given 服务已启动，When 请求 `http://localhost:3000/api/public/health`，Then 返回 `status: OK` 与版本；健康通过**不等于** Agent 验证通过（两者分别取证）。
- **OB-05** Given 控制脚本 stop，When 执行，Then 仅停止本实例容器，保留数据卷与本机凭据，不影响其他项目容器。
- **OB-06** Given 追踪未启用（`BUDINGX_LANGFUSE_ENABLED` 不为 `1` 或缺 Key），When Agent 运行任意任务，Then 无追踪器、无观测缓冲、无 Langfuse 网络请求，任务结果与未启用时一致。

### 配置加载与安全

- **OB-07** Given 用户在设置中指定 env 文件的**绝对路径**，When 加载配置，Then 仅导入 5 个白名单变量，且进程环境中的同名变量优先于文件值。
- **OB-08** Given env 文件路径为相对路径或不可读，When 加载配置，Then 保留继承环境、输出脱敏诊断、不阻断 Agent 运行。
- **OB-09** Given 加载配置，When 检查导入结果，Then 不导入 `NODE_OPTIONS` 等运行参数，不读取工作区设置，不扫描仓库 `.env`。
- **OB-10** Given `LANGFUSE_BASE_URL` 协议为 `file:`/`ftp:`、URL 内含用户名密码，或为非本机 `http:`，When 初始化追踪，Then 拒绝启用并返回 false，不发出请求。

### 观测内容与结构

- **OB-11** Given 追踪已启用，When 一个实际 Agent 回合开始并分配 `turnId`，Then 只创建一个 `agent.run` 根观测，带 `session.id`、`turn.id`、`langfuse.trace.metadata.runId` 和 `langfuse.observation.type=agent`。排队本身不创建观测，队列输入启动新回合时创建新根，注入当前回合时沿用当前根。
- **OB-12** Given 回合内发生模型请求，When 追踪启用，Then 每次 `ModelProvider.stream()` 调用产生一个 `model.request` 子观测，父为该回合根观测，属性含 `gen_ai.request.model` 与真实 `usage_details`（有 token 时）。
- **OB-13** Given 回合内发生工具调用，When 追踪启用，Then 每个工具调用产生一个 `tool.<name>` 子观测，父为该回合根观测，属性含 `gen_ai.tool.call.id` 与工具名。
- **OB-14** Given 多个回合属于同一会话，When 追踪启用，Then 所有根与子观测的 `session.id` 一致，可按 session 聚合查询。
- **OB-15** Given 回合失败，When 追踪记录 outcome，Then `outcome=error` 且 `langfuse.observation.level=ERROR`；Given 回合被用户取消，Then `outcome=cancelled` 且 level=WARNING；Given 工具被权限拒绝或计划模式阻断，Then 该工具观测 `outcome=blocked` 且 level=WARNING。
- **OB-16** Given 追踪启用但正文采集关闭，When 记录观测，Then `langfuse.observation.input/output` 属性不存在，平台上只看到元数据。
- **OB-17** Given 正文采集开启，When 记录根观测，Then input 为用户消息数组，output 为助手消息数组。模型在产生任何助手消息前失败时，合法 output 为 `[]`。所有已采集正文均经脱敏。
- **OB-18** Given 超长正文，When 写入观测属性，Then 只从已脱敏结构裁剪，输出不超过 8000 字符，带 `truncated` 标记且为合法 JSON；消息数组保留角色与数组形状，裁剪不会重新引入原始密钥。
- **OB-19** Given 观测记录含凭据样式内容（API Key、Bearer Token、私钥块、Cookie），When 写入属性，Then 被替换为 `[redacted]` 或等价标记，平台侧不可读到原值。

### 故障隔离与生命周期

- **OB-20** Given 平台不可达、返回 5xx 或请求挂起，When 完成回合，Then 后台发送整批观测，回合终态与后续输入无需等待网络；单次上报最多 3 秒，缓冲有界，失败或溢出按整批丢弃并计数。
- **OB-21** Given 埋点内部抛出异常，When 发生在回合关键路径上，Then 异常被吞掉并回落到「无追踪」路径，不影响回合状态机与工具执行。
- **OB-22** Given Agent 正常退出，When 宿主关闭追踪器，Then 等待已完成回合的批次发送，总等待最多 3 秒；到期取消在途请求并丢弃剩余批次。未完成回合的观测按整组丢弃。
- **OB-23** Given 宿主在回合中途关闭追踪，When 后续模型或工具继续执行，Then 不再产生新观测，整个未完成回合的观测丢弃，且关闭前后 Agent 行为一致。

### 验收脚本与证据

- **OB-24** Given 已部署且已配置本机 Langfuse，When 运行无界面验收脚本，Then 脚本使用**生产 Agent 路径**（Core Session + 真实 Provider + 只读工具）依次跑「读取存在文件成功」「读取不存在文件工具失败」「不可连接模型端点失败」三场景。
- **OB-25** Given 验收脚本执行完毕，Then 每个场景报告 `localExpectationMet`、`platformIndexed`、`hierarchyOk`、`sessionConsistent`、`contentVerified` 和实际 trace ID（尚未创建时为 `null`）。正文关闭时仍校验平台无正文，`contentVerified` 为 `null`。
- **OB-26** Given 验收报告已生成，Then 只有全部场景的本地行为、平台索引、层级和会话一致性均通过，且正文符合配置时才退出 0。任一失败均非零并保留判定；鉴权或额度失败不能冒充预期的模型连接失败。
- **OB-27** Given 按 trace ID 查询 v2 Observations API，Then 仅有一个 `agent.run` 根，场景必需的模型和工具观测完整，子观测的 `parentObservationId` 等于根 `id`，所有 `sessionId` 等于本地预期会话 ID，预期失败节点的 `level` 为 `ERROR`。
- **OB-28** Given 验收报告与本机凭据，When 提交仓库，Then 凭据、登录信息、报告原文均不进入 Git（落在 Git 忽略目录），仓库只保留脱敏摘要。

## 开放问题

- **OPEN-01**：是否直接依赖 `@langfuse/otel` + `@opentelemetry/*`？→ **已关闭（2026-11-19 设计自审 + 可行性核验）**：本仓为 TUI 单端、依赖面受控（`src/tui/package.json` 单独打包），引入 OTel SDK 会显著增加 npm 制品体积与初始化成本；改用**自建导出器**直接向 Langfuse OTLP 端点投递 OTLP JSON，保持属性契约一致。**已核验对监控效果无实质影响**：参考仓 OTel 版并未使用自动插桩、全局 TracerProvider 或上下文传播；Langfuse 的属性映射在**服务端**完成，本轮所用属性逐条符合官方映射表。重新评估的触发条件见[设计 §9.2](./design/design.zh.md)。代价是不获得 OTel 生态的自动插桩，本仓当前无此需求。
- **OPEN-02**：正文采集默认值？→ **已关闭**：默认关闭（`CAPTURE_CONTENT` 不为 `1` 即关闭），与参考仓一致。
- **OPEN-03**：追踪状态如何在 TUI 呈现？→ **已关闭**：本轮只做**只读诊断输出**（现有诊断通道），不做新命令族（斜杠命令面归 SP006）。
- **OPEN-04**：部署资产放仓库哪个位置？→ **已关闭**：放 `ops/langfuse/`（部署资产）+ `scripts/langfuse/`（工具脚本），与参考仓目录语义一致；本机运行态放 `.runtime/langfuse/`（Git 忽略）。
- **OPEN-05**：Langfuse 镜像版本号？→ **已关闭**：设计文档记录实施时验证可用的稳定版本；不得凭记忆写死未验证版本号，实施时以实际拉取成功为准。
- **OPEN-06**：是否允许指向云端 Langfuse？→ **已关闭**：允许 `https:` 任意端点（用户显式配置）；`http:` 仍限本机地址，避免明文外发凭据。

## 身份

- 需求来源「SP004 中需要加一项优化需求，参照参考仓搭建 Langfuse 的监控体系，直接照搬这套监控」为 **USER_CONFIRMED**（2026-11-19）。
- 「直接照搬这套监控」的**行为等价目标**为 USER_CONFIRMED；AC 切分、模块划分、契约形状与自建导出器替代 OTel SDK 为 **MODEL_PROPOSED**，随设计文档自审。
- 未决问题已收敛为 OPEN-01…OPEN-06 并在本文档内关闭，无阻塞性 OPEN。

2026-11-19 · v0.2 将四项 P1 与上报、版本两处口径纳入原有 28 条 AC。方案沿用本机 Langfuse 与直接 OTLP/HTTP，实施保持暂停。

## 验收回填（T33，2026-11-19）

实施完成（T25–T33）。全量 `npm test` **775 项，773 通过，0 失败，2 既有 skip**；`test:checks` 模块边界通过；AST 独立来源复核**命中 0，PASS**（详见 [../ast-review.md](../ast-review.md)）。下表逐条回填。验证层：L0 纯逻辑 / L1 真实 Core 回合 / L1 脚本实测 / live 平台。

| AC | 状态 | 证据（用例 / 命令） |
| --- | --- | --- |
| OB-01 | PASS | `scripts/langfuse/init-local.test.mjs`：三文件生成、随机凭据、Windows 真实 NTFS DACL+SID 核对（`node --test scripts/langfuse/*.test.mjs`） |
| OB-02 | PASS | 同上：幂等不覆盖、缺关键键报错保留原文件 |
| OB-03 | PASS（结构） | `scripts/langfuse/compose.test.mjs`：六服务、仅 loopback 3000/9090、数据库不发布、健康检查、五具名卷。**真实运行时见 OB-04 UNVERIFIED** |
| OB-04 | **UNVERIFIED** | 本机隔离部署 ClickHouse fresh-migration 脏失败（version 40 循环），Web 未就绪；恢复条件见下 |
| OB-05 | PASS | `compose.test.mjs`：stop 无 `down`/`-v`，start 先初始化 |
| OB-06 | PASS | `src/observability/test/exporter.test.mjs`、`src/tui/test/observability-wiring.test.mjs`：未启用零请求、不注入 tracer |
| OB-07 | PASS | `exporter.test.mjs`：仅 5 白名单变量、继承环境优先 |
| OB-08 | PASS | 同上 + wiring：相对路径/不可读保留继承环境、脱敏诊断、不阻断 |
| OB-09 | PASS | `exporter.test.mjs`：`NODE_OPTIONS` 不被导入 |
| OB-10 | PASS | `exporter.test.mjs`：file/ftp/含凭据/非本机 http 拒绝，本机 http 与任意 https 允许 |
| OB-11 | PASS | `src/core/test/observability.test.mjs`：每回合唯一根，带 session/turn/runId/agent 类型 |
| OB-12 | PASS | 同上：每次 stream 一个 model.request 子观测，usage 不跨调用继承 |
| OB-13 | PASS | 同上：工具观测在权限判断前创建，带 call.id 与名字 |
| OB-14 | PASS | 同上 + `exporter.test.mjs`：同会话多回合 session.id 一致、turn.id 不同 |
| OB-15 | PASS | 同上：error→ERROR、cancelled/blocked→WARNING |
| OB-16 | PASS | `exporter.test.mjs`：正文关闭时无 input/output 属性 |
| OB-17 | PASS | `src/core/test/observability.test.mjs` + `exporter.test.mjs`：根 input/output 为 user/assistant 数组，模型未产生助手消息即失败时 output 为 `[]` |
| OB-18 | PASS | `src/observability/test/redact.test.mjs`：超长裁剪 ≤8000、合法 JSON、保留角色、不重新引入密钥 |
| OB-19 | PASS | 同上：敏感键/凭据样式/已知凭据脱敏，短串不误伤 |
| OB-20 | PASS | `exporter.test.mjs`：平台 5xx/拒连/挂起静默失败，3 秒超时，缓冲有界 |
| OB-21 | PASS | `src/core/test/observability.test.mjs`：假 tracer 抛异常回合仍正常完成 |
| OB-22 | PASS | `exporter.test.mjs`：shutdown 限时返回，平台挂起不阻塞 |
| OB-23 | PASS | `exporter.test.mjs`：即时禁用后无新观测、丢弃待发批次 |
| OB-24 | **UNVERIFIED**（live） | 脚本已实现并走生产路径；替身判定 20 项 PASS。真实三场景需模型凭据 + 部署成功，未执行 |
| OB-25 | PASS（判定逻辑） | `scripts/langfuse/verify-agent.test.mjs`：五项判定、正文关闭为 null、model-error 空数组。**live 报告生成 UNVERIFIED** |
| OB-26 | PASS（判定逻辑） | 同上：四项必通过 + 正文符合配置才退出 0，负向场景非零。**live 退出码 UNVERIFIED** |
| OB-27 | PASS（判定逻辑） | 同上：根唯一/子父/会话/级别，根重复/缺子/错父/错级别/错会话均非零。**live v2 回查 UNVERIFIED** |
| OB-28 | PASS | `.runtime/` 已 Git 忽略；报告/凭据落 `.runtime/langfuse/`；`git status` 无凭据/报告入库 |

**汇总**：28 条 AC，代码/结构/判定逻辑层面 **26 条 PASS**；**OB-04、OB-24 为 UNVERIFIED**（真实部署与 live 三场景），OB-03 真实运行时、OB-25/26/27 的 live 平台叠加亦 UNVERIFIED。

### UNVERIFIED 恢复条件

| 项 | 恢复条件 |
| --- | --- |
| OB-04 真实部署健康 | 在无竞争 Langfuse 实例、ClickHouse fresh-migration 可正常完成的环境重跑 `control.ps1 -Action start`（本次失败为 Langfuse 部署工具在 fresh-init 的迁移脏状态循环，非观测代码缺陷；本机另有参考仓实例运行） |
| OB-24 live 三场景 | 部署成功 + 用户提供 `BUDINGX_SMOKE_MODEL_KEY`/`_BASE_URL`/`_MODEL`，运行 `node scripts/langfuse/verify-agent.mjs` |
| OB-25/26/27 live 叠加 | 同上，真实平台回查并生成 `verification.json` |
| OB-03 真实运行时 | 同 OB-04 |

2026-11-19 · v0.3 实施完成并回填验收；代码验证全绿，真实部署/live 三场景 UNVERIFIED（恢复条件如上）。
