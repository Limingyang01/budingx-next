# agent-observability · Agent 可观测性监控（Langfuse）· 实施计划

版本：v1.2｜状态：**文档已修订，实施暂停**｜依据：[设计 v1.2](design.zh.md)｜[需求 v0.2](../requirements.md)｜命令默认从仓库根执行

> **执行方式**：按 `superpowers:executing-plans` 或 `superpowers:subagent-driven-development` 逐任务执行；步骤用 `- [ ]` 复选框跟踪。
>
> **当前状态（2026-11-19）**：用户确认沿用现有 Langfuse 方案，暂不接 LangChain。本轮仅修订与自审文档，T25–T33 均未执行，实施待用户明确放行。

---

## Goal

在 budingx-next 落地一套**本机自建 Langfuse 监控体系**，让开发者能在自己的机器上查看 Agent 回合、模型调用、工具执行与错误记录：

- 每次 Agent 回合产生 `agent.run` 根观测，其下挂 `model.request`（generation）与 `tool.<name>`（tool）子观测，父子层级与 `session.id` 关联可查；
- 默认**只采集结构化元数据**，正文显式 opt-in 才采集，且先脱敏，再从脱敏结构裁剪为合法 JSON；
- 追踪关闭/配置缺失/平台不可达/埋点异常**一律不影响** Agent 业务结果；
- 提供**无界面可重复**的验收脚本，用本仓真实生产 Agent 路径跑三场景并从 Langfuse 公开 API 回查观测，自证接入生效。

出口以本需求的 28 条 AC（OB-01…OB-28）为准；行为等价目标见[需求 v0.2 §参考对照点](../requirements.md) A-01…A-15。

## Architecture

- 新增 `src/core/observability.ts`：Core 侧追踪**纯类型端口**（`Tracer`、`TraceHandle`、`TraceOutcome`）。Core 不 import 任何 IO/网络模块，既有模块边界规则不变。
- 新增 `src/observability/`：`config.ts`（白名单变量加载）、`redact.ts`（独立脱敏，裁剪已脱敏的结构）、`context.ts`（回合缓冲与显式父句柄）、`exporter.ts`（**手写 OTLP JSON** 导出器）、`runtime.ts`（开关、URL 校验、生命周期、flush）。
- 扩展 `src/core/session.ts`：接收注入的 `tracer?: Tracer`，在回合/模型/工具三处接线，关闭时省略 tracer。
- `src/tui/runtime.ts`：读显式 env 文件绝对路径 → 加载配置 → 初始化追踪 → 构造实现并注入 Session → 输出脱敏诊断；失败时省略 tracer，启动照常。
- 新增 `ops/langfuse/`（Compose + 部署文档）与 `scripts/langfuse/`（`init-local.mjs`、`control.ps1`、`verify-agent.mjs` 及其自测）。
- 依赖方向 `tui → observability → core`；**`core` 不依赖 `observability`**（边界检查新增该条目）。
- **不新增任何运行时第三方依赖**：全部使用 Node.js 内置模块。

## Spec（权威来源）

- 设计：[design.zh.md](design.zh.md) v1.2
- 需求：[requirements.md](../requirements.md) v0.2
- 状态：[STATUS.md](../STATUS.md)
- 参考仓只读审计：`ops/langfuse/`、`scripts/langfuse/`、`vscode_plugin/src/host/observability/`、`src/server/services/langfuseRuntime.ts`、`SP/SP01/agent-observability/STATUS.md`（revision `b5c9be8`）
- SP004 主设计 [../design/design.zh.md](../design/design.zh.md) 与主计划 [../design/plan.zh.md](../design/plan.zh.md)（本需求作为其**追加优化需求**，共用同一功能分支与合并门禁）

## Global Constraints

1. **不新增运行时第三方依赖**；只用 Node.js 内置模块（`node:crypto`、`node:fs`、`node:path`、`node:url`、`node:util`）。Windows 文件权限使用宿主原生 ACL 能力。依赖范围排除 LangChain、LangGraph、`@opentelemetry/*` 和 `@langfuse/otel`（设计偏离 R-01）。
2. JS/TS：2 空格、ESM、无分号、UTF-8；中文注释与文案。
3. 行为变更先写有意义的失败回归（RED），再最小实现（GREEN）；零测试、全 skip、基础设施报错不算 RED。
4. **不迁入参考仓源码**、提示词、内部类型、生成产物或私有资产；Compose 结构、OTLP 请求体、Langfuse 属性名属公开规范，按规范实现。
5. 本机凭据、登录信息、验收报告**一律落 `.runtime/langfuse/`（Git 忽略）**，不进仓库。
6. **默认关闭**追踪；**不扫描**工作区、仓库 `.env` 或 `~/.claude`；只导入 5 个白名单变量。
7. 正文采集**显式 opt-in**，先脱敏，再从脱敏结构裁剪为合法 JSON。
8. **追踪不得改变业务结果**：所有埋点路径 try/catch；回合无需等待网络。单次后台请求及正常退出的总 flush 各 ≤3 秒。
9. `core` 不引入 `node:*` IO/网络；追踪实现只在 `src/observability/`。
10. 既有 SP002/SP003/SP004 行为不得回归；追踪关闭时无观测缓冲、无 Langfuse 网络请求。
11. 实施获放行后，每个实施阶段完成即本地提交（中文提交说明）；合入 master 与推送远端在 2026-11-17 委托内，但需交叉验证门禁 GREEN；npm 发布、打标签、远端设置、分支/worktree 删除不在授权内。
12. 证据分层记录：L0 纯逻辑 / L1 真实 Core 回合 / L1 真实 Docker / live 平台 + live Provider / 真终端人工（UNVERIFIED）；互不冒充。
13. 独立实现及 AST 复核按设计 §9.3；命中数为 0 才算通过。

## Review Focus（评审重点）

- **追踪关闭时是否真的零影响**：未启用时是否无 Langfuse 网络请求和观测缓冲，Agent 结果是否与未装配追踪器的受控基线一致。
- **埋点异常是否被彻底隔离**：埋点内部抛错、平台 5xx、平台不可达、上报超时——四条路径下 Agent 回合是否照常完成（合理预期：照常完成）。
- **正文隐私**：正文采集关闭时平台上是否**完全没有** input/output 属性；开启时脱敏与裁剪是否生效，裁剪后是否仍是合法 JSON（合理预期：分别是「无属性」「脱敏且合法 JSON」）。
- **父子层级与 session 一致性**：模型/工具观测是否真的挂在 `agent.run` 下，`session.id` 是否全链一致（合理预期：是）。
- **凭据泄漏面**：核对 POSIX 目录/文件模式和 Windows 实际 ACL。正文先脱敏再裁剪，凭据文件位于 Git 忽略目录，重复执行保留既有内容。
- **验收脚本是否诚实**：正文未采集时 `contentVerified` 必须是 `null` 而非 `true`；鉴权/额度不足必须非零退出并保留失败事实（合理预期：是）。
- **是否引入了 OTel 依赖**：`package.json` 与 `src/tui/package.json` 的依赖不得出现 `@opentelemetry/*` 或 `@langfuse/otel`（合理预期：不出现）。
- **OTLP 字段是否被 Langfuse 正确映射**：按官方 [Attribute Mapping](https://langfuse.com/integrations/native/opentelemetry#property-mapping) 逐条核对 —— `langfuse.observation.type`→type、`langfuse.observation.level`→level、`langfuse.observation.status_message`→statusMessage、`langfuse.observation.metadata.outcome`→metadata、`langfuse.observation.input`/`.output`→input/output、`langfuse.observation.usage_details`（JSON string，字段名须为 `input`/`output`）→usage、`gen_ai.request.model`→model、`session.id`→sessionId。**`x-langfuse-ingestion-version: 4` 头不得缺失**（缺失可能走延迟入库路径）（合理预期：全部命中；OB-11、OB-27）。

---

## 任务清单

### T25 · 实施前重核（可观测性部分）

- **设计**：§2、§9.2
- **AC**：无（前置核对）
- **依赖**：无
- **Read**：`docs/current-status.md`、`src/core/session.ts`、`src/core/events.ts`、`src/core/provider.ts`、`src/core/tools.ts`、`src/core/permissions.ts`、`src/storage/credentials.ts`、`scripts/checks/module-boundaries.mjs`、`src/tui/runtime.ts`、`src/tui/tsconfig.json`、`src/tui/package.json`
- **核对清单**：
  1. 核对 `startTurn()` 分配 `turnId` 的位置、同回合注入与排队启动路径，以及宿主会话 ID 的传递。
  2. `SessionEvent` 中工具成功/失败/拒绝的确切事件名与字段（用于 outcome 判定）。
  3. 核对宿主已解析的模型配置与 Langfuse 配置怎样把当前已知凭据交给追踪脱敏。`CredentialStore` 仅提供存取。
  4. `scripts/checks/module-boundaries.mjs` 的规则写法（新增 `observability` 条目的位置与格式）。
  5. `src/tui/runtime.ts` 的装配顺序（Session 构造前后可注入 tracer 的位置）。
  6. `src/tui/tsconfig.json` 的 include 列表。
  7. 记录当前 `npm run test:unit` 基线数量（本轮新增用例须在其上全绿）。
- **产出**：将核对结论与基线数字回填本任务的完成事实。
- **验证**：`npm run test:unit`（记录实际数量/结果）
- **完成事实**：待填

---

### T26 · Core 追踪端口与 Session 接线

- **设计**：§4.2
- **AC**：OB-11、OB-12、OB-13、OB-14、OB-15、OB-16、OB-21
- **依赖**：T25
- **Create**：`src/core/observability.ts`、`src/core/test/observability.test.mjs`
- **Modify**：`src/core/session.ts`
- **Consumes**：`SessionEvent` 族、工具调用 ID、Provider 模型名与 usage、`TurnOutcome`
- **Produces**：
  - `src/core/observability.ts`：`Tracer` 接口、`TraceHandle`、`TraceOutcome = 'success'|'error'|'cancelled'|'blocked'`
  - `SessionOptions.tracer?: Tracer`（未注入时跳过埋点）
- **RED**（用假 tracer 记录调用序列）：
  1. 未注入 tracer 时，回合执行**零**埋点调用且不抛错（OB-21）
  2. `startTurn()` 分配 ID 后只创建一个根，带 `session.id`、`turn.id`、`langfuse.trace.metadata.runId` 与 Agent 类型（OB-11）。
  3. 每次 Provider stream 产生一个模型观测，传入本回合根句柄。下次调用未返回 usage 时不得继承前一次 usage（OB-12）。
  4. Provider 返回 usage 后调用 `setAttributes` 带 `langfuse.observation.usage_details`（OB-12）
  5. 工具在权限判断前创建观测，传入本回合根句柄，保持工具调用 ID 与名字（OB-13）。
  6. 工具成功 → `end(handle,'success')`；工具失败 → `end(handle,'error')`（OB-15）
  7. 工具被权限拒绝或计划模式阻断 → `end(handle,'blocked')`（OB-15）
  8. 用户取消时关闭当前子观测与根各一次，晚到事件不改变终态。回合失败时根为 `error`（OB-15）。
  9. 忙时只入队无新根。同回合注入仍用原根；队列触发实际新回合时生成新根，`session.id` 相同而 `turn.id` 不同（OB-11、OB-14）。
  10. 根和子观测的正文、usage 在相应 `end()` 前写入。根创建失败时没有游离子观测（OB-11、OB-16、OB-21）。
  11. **假 tracer 抛异常时回合仍正常完成**（OB-21）
- **GREEN**：实现端口与三处接线；所有埋点调用包 try/catch，异常吞掉
- **验证**：`npm run build && node --test src/core/test/observability.test.mjs`
- **完成事实**：待填

---

### T27 · 脱敏与合法 JSON 裁剪

- **设计**：§4.4
- **AC**：OB-17、OB-18、OB-19
- **依赖**：T25
- **Create**：`src/observability/redact.ts`、`src/observability/test/redact.test.mjs`
- **Consumes**：需上报的结构与宿主传入的当前已知凭据，使用合成值验证
- **Produces**：`redactValue(value, knownSecrets): string`（先脱敏再裁剪的合法 JSON）
- **RED**：
  1. 敏感键（`api_key`/`secret`/`password`/`token`/`authorization`/`cookie`/`private_key`）的值被替换为 `[redacted]`（OB-19）
  2. `Bearer <token>`、`sk-*`、`ghp_*`、`github_pat_*`、`AKIA*`、JWT、私钥块 → `[redacted]`（OB-19）
  3. 长度 ≥ 8 的已知密钥字面量被替换（OB-19）
  4. 短串（长度 < 8）**不**被误替换（OB-19 反向）
  5. 超长用户/助手消息内放入位于保留前缀的合成凭据，断言最终上报值可 `JSON.parse`、不超过 8000 字符、保留角色与 `[truncated]`，且原始凭据未出现（OB-17…OB-19）。
  6. 任意大对象超长 → `{truncated:true, preview:'...'}` 且**结果可 `JSON.parse`**（OB-18）
  7. 不可序列化的值（循环引用）→ 返回合法 JSON 错误对象而非抛错（OB-18）
  8. 短内容**原样**返回且不添加 `truncated`（OB-18 反向）
- **GREEN**：独立实现脱敏。消息分支和对象分支均只从脱敏结构裁剪，异常回退不含原文。
- **验证**：`npm run build && node --test src/observability/test/redact.test.mjs`
- **完成事实**：待填

---

### T28 · 追踪运行时：配置、URL 校验、上下文、导出器

- **设计**：§4.3、§4.5、§4.6、§4.10
- **AC**：OB-06、OB-07、OB-08、OB-09、OB-10、OB-16、OB-20、OB-22、OB-23
- **依赖**：T26、T27
- **Create**：`src/observability/config.ts`、`src/observability/context.ts`、`src/observability/exporter.ts`、`src/observability/runtime.ts`、`src/observability/index.ts`、`src/observability/test/config.test.mjs`、`src/observability/test/exporter.test.mjs`、`src/observability/test/runtime.test.mjs`
- **Consumes**：`src/core/observability.ts` 的 `Tracer`/`TraceHandle`、T27 的 `redactValue`
- **Produces**：
  - `loadTracingEnvironment(env, file, report?): NodeJS.ProcessEnv`
  - `initializeTracing(env, report?): boolean`
  - 即时 `disableTracing()` 与正常退出 `shutdownTracing(): Promise<void>`，后者最多等 3 秒
  - 宿主可选的只读回执回调，按回合提供 trace ID、会话 ID、发送结果
  - `tracing(): Tracer | undefined`
  - OTLP 请求体组装函数（可单测）
- **RED**：
  1. `BUDINGX_LANGFUSE_ENABLED !== '1'` → `initializeTracing` 返回 false，**不发任何请求**（OB-06）
  2. 缺 public/secret key → 返回 false（OB-06）
  3. env 文件为**相对路径** → 保留继承环境 + 脱敏诊断 + 不抛错（OB-08）
  4. env 文件不可读 → 同上（OB-08）
  5. 进程环境中的同名变量**优先于**文件值（OB-07）
  6. 只导入 5 个白名单变量；文件中的 `NODE_OPTIONS` **不被导入**（OB-09）
  7. `file:`/`ftp:` 协议 → 返回 false（OB-10）
  8. URL 含 `user:pass@` → 返回 false（OB-10）
  9. `http://example.com`（非本机）→ 返回 false；`http://localhost:3000` → 允许（OB-10）
  10. `https://cloud.example.com` → 允许（OB-10，OPEN-06）
  11. 请求 URL 为 `<base>/api/public/otel/v1/traces`，头含 `x-langfuse-ingestion-version: 4` 与 Basic 认证，`redirect:'error'`（对齐 A-14；缺该头可能走延迟入库路径）
  11b. 请求体 span 属性名与官方映射表一致：`langfuse.observation.type`/`level`/`status_message`/`metadata.outcome`/`input`/`output`/`usage_details`；`usage_details` 为 JSON string 且字段名为 `input`/`output`（对齐官方 Attribute Mapping）
  11c. 每个 span **同时**带 `startTimeUnixNano` 与 `endTimeUnixNano`（官方：缺失会按另一端补齐，观测时长失真）
  12. 请求体含 `resourceSpans[0].resource.attributes` 的 `service.name=budingx-tui`（A-14）
  13. content capture 关闭 → span 属性**不含** `langfuse.observation.input/output`（OB-16）
  14. 正文开启时根观测为用户/助手消息数组。模型连接失败且无助手消息时 output 为 `[]`；正文关闭时 status message 也不得泄漏合成凭据（OB-17、OB-19）。
  15. 平台返回 500 → 静默失败，不抛错（OB-20）
  16. 平台连接被拒 → 静默失败，不抛错（OB-20）
  17. 用未决 fetch 验证回合终态及下一次输入先于网络完成，后台请求在 3 秒截止时取消（OB-20）。
  18. 正常退出只 flush 完整批次，多个等待批次共用总计 3 秒的截止时间，到期取消在途请求并丢弃剩余批次（OB-22）。
  19. 即时禁用后无新观测，丢弃未完成回合与待发批次，取消在途发送，Agent 继续运行（OB-23）。
  20. OTLP 子节点的 `parentSpanId` 指向根 `spanId`，共享 `traceId`、`session.id`、`turn.id`。并行回合间无串写（OB-11…OB-14）。
  21. 验证 200 span、1 个在途批次与 8 个等待批次的上限，超限整批丢弃并计数（OB-20）。
- **GREEN**：按 §4.3–§4.6 实现；导出器用 `fetch`，可在测试中注入替身
- **验证**：`npm run build && node --test src/observability/test/*.test.mjs`
- **完成事实**：待填

---

### T29 · 宿主装配、注入与诊断输出

- **设计**：§4.9、§5
- **AC**：OB-06、OB-08、OB-21、OB-22
- **依赖**：T28
- **Modify**：`src/tui/runtime.ts`、`src/tui/cli.ts`、`src/tui/tsconfig.json`、`scripts/checks/module-boundaries.mjs`
- **Create**：`src/tui/test/observability-wiring.test.mjs`
- **Consumes**：`src/observability` 的 `loadTracingEnvironment`/`initializeTracing`/`tracing`
- **Produces**：`Session` 注入的 `Tracer` 实例；诊断输出（enabled/disabled、content capture on/off、base url host，**不含密钥**）
- **RED**：
  1. 未设置 `BUDINGX_LANGFUSE_ENABLED` → 诊断输出 `disabled`，Session 未注入 tracer（OB-06）
  2. `BUDINGX_LANGFUSE_ENABLED=1` 但缺 key → 诊断输出 `disabled`（enabled 配置不完整），不报错退出（OB-06）
  3. env 文件路径不可读 → 诊断输出**含**原因（脱敏）且**不阻断**启动（OB-08）
  4. 诊断输出**不含** public/secret key 的任何片段（OB-19 相关）
  5. `src/tui/package.json` 依赖中无 LangChain、LangGraph、`@opentelemetry/*` 和 `@langfuse/otel`（Review Focus）
  6. `core` 模块**不 import** `src/observability`（静态检查）
- **GREEN**：TUI 和验收脚本共用生产 runtime 装配入口，CLI 正常退出调用限时 flush，`tsconfig.json` 纳入 `../observability`。
- **验证**：`npm run build && node --test src/tui/test/observability-wiring.test.mjs && npm run test:checks`
- **完成事实**：待填

---

### T30 · 本机部署资产（Compose + 初始化 + 启停 + 文档）

- **设计**：§4.7
- **AC**：OB-01、OB-02、OB-03、OB-04、OB-05
- **依赖**：无（可与 T26–T29 并行）
- **Create**：`ops/langfuse/compose.yaml`、`ops/langfuse/README.md`、`scripts/langfuse/init-local.mjs`、`scripts/langfuse/init-local.test.mjs`、`scripts/langfuse/control.ps1`、`scripts/langfuse/compose.test.mjs`
- **Consumes**：`.runtime/langfuse/`（Git 忽略）
- **Produces**：本机可用的 Langfuse 实例与三份本机配置文件
- **RED**：
  1. `init-local.mjs` 首次运行生成 `local.env`/`agent.env`/`login.json` 三文件（OB-01）
  2. POSIX 实测目录 `0o700`、三个文件 `0o600` 及当前用户归属，Windows 实测目录和三个文件的 NTFS DACL 与当前用户 SID，验证宽权限或无法验证的路径在写入前失败（OB-01）。
  3. 三文件路径全部落在 `.runtime/langfuse/`（OB-01）
  4. `local.env` 含 DB 密码、SALT、ENCRYPTION_KEY、NEXTAUTH_SECRET、项目 public/secret key、初始用户邮箱/密码，且均为随机生成（OB-01）
  5. `agent.env` 含 `BUDINGX_LANGFUSE_ENABLED=1`、`LANGFUSE_BASE_URL`、`LANGFUSE_PUBLIC_KEY`、`LANGFUSE_SECRET_KEY`（OB-01）
  6. 重复执行**不覆盖**已有凭据且退出码 0（OB-02）
  7. 已有 `local.env` 缺关键键 → **报错**并保留原文件，不删除数据卷（OB-02）
  8. `compose.yaml` 解析后含 6 个服务，宿主只绑定 `127.0.0.1:3000` 与 `127.0.0.1:9090`，数据库/ClickHouse/Redis **不发布宿主端口**（OB-03）
  9. 每个服务有健康检查；web/worker 依赖四个基础服务 healthy（OB-03）
  10. 具名卷 5 个，与服务 `volumes` 引用一致（OB-03）
  11. `control.ps1` 的 stop 分支**不含** `-v` / `down`（OB-05）
  12. `control.ps1` 的 start 分支先调用 `init-local.mjs`（OB-05）
- **GREEN**：按 §4.7 实现；Compose 结构与初始化语义按公开规范与参考行为独立编写
- **验证**：`node --test scripts/langfuse/*.test.mjs`
- **完成事实**：待填

---

### T31 · 本机真实部署与健康检查（L1 Docker）

- **设计**：§4.7、§9.2
- **AC**：OB-03、OB-04
- **依赖**：T30
- **实测步骤**：
  1. `node scripts/langfuse/init-local.mjs`
  2. `powershell -NoProfile -File scripts/langfuse/control.ps1 -Action start`
  3. `powershell -NoProfile -File scripts/langfuse/control.ps1 -Action status`
  4. `Invoke-RestMethod http://localhost:3000/api/public/health` → 期望 `status: OK` + 版本
- **记录**：实际镜像 tag（以 `docker compose pull` 成功为准，**不得凭记忆写死**）、启动耗时、健康检查原始响应
- **未执行时的处理**：本机无 Docker/WSL → 记 **UNVERIFIED**，写明恢复条件（安装 Docker Engine 后重跑），**不冒充通过**
- **完成事实**：待填

---

### T32 · 无界面验收脚本与报告

- **设计**：§4.8
- **AC**：OB-24、OB-25、OB-26、OB-27、OB-28
- **依赖**：T26、T28、T29。真实验收依赖 T31，替身用例可先执行。
- **Create**：`scripts/langfuse/verify-agent.mjs`、`scripts/langfuse/verify-agent.test.mjs`
- **Consumes**：T29 生产 runtime、真实 Provider、工作区只读工具、按 `turnId` 提供真实 `traceId` 与预期会话 ID 的宿主回执、本机配置和模型凭据
- **Produces**：`.runtime/langfuse/verification.json`（含每场景五项独立判定与实际 trace ID）
- **RED**（用替身平台与替身模型）：
  1. 平台鉴权失败 → **在发起任何模型调用前**退出，不消耗额度（OB-24）
  2. 缺模型凭据 → 明确报错退出（OB-24）
  3. 三场景各自产生 `localExpectationMet`（成功/工具失败/模型失败）（OB-24）
  4. 三个场景各报告 trace ID（未生成时为 null）与 `localExpectationMet`、`platformIndexed`、`hierarchyOk`、`sessionConsistent`、`contentVerified` 五项（OB-25）。
  5. 正文关闭时 `contentVerified === null`，任一观测仍有正文则非零。正文开启时结构或脱敏失败均非零。模型连接失败且无助手消息时只接受合法空数组 `[]`（OB-25、OB-26）。
  6. 平台不可查时 `platformIndexed === false` 且脚本**非零退出**（OB-26）
  7. 本地预期不满足时脚本**非零退出**并保留失败事实（OB-26）
  8. 鉴权/额度不足不得冒充成功（OB-26）
  9. 使用 v2 字段 `parentObservationId`、`id`、`sessionId`，分别测试根重复、缺子观测、错父节点、错误级别不符和所有节点共用错误会话 ID。这些场景即使已索引也均非零退出（OB-26、OB-27）。
  10. 报告文件写入 `.runtime/langfuse/`，**不在** Git 跟踪路径（OB-28）
  11. 只读工具限定在 `.runtime/langfuse/agent-workspace/`，不读真实项目（OB-24）
- **GREEN**：按 §4.8 实现。按 v2 的 trace ID、时间窗口、字段组与分页查询，在截止时间内等齐场景节点。合并四项必通过判定及适用正文校验生成退出码。
- **验证**：`node --test scripts/langfuse/verify-agent.test.mjs`；有环境时再跑真实三场景（记录真实 trace ID 与五项判定）
- **完成事实**：待填

---

### T33 · 全量回归、交付记录与独立来源复核

- **设计**：§7、§9.3
- **AC**：全部 28 条回填
- **依赖**：T26–T32
- **Modify**：`SP/SP004/agent-observability/requirements.md`（AC 回填）、`SP/SP004/agent-observability/STATUS.md`、`SP/SP004/test-report.md`、`SP/SP004/requirements-summary.md`、`docs/current-status.md`、`PRODUCT.md`（如涉及用户可见行为）
- **Create/Modify**：`scripts/review/` 下的 AST 复核脚本与报告（沿用 SP004 T24 同口径）
- **步骤**：
  1. `npm test` 全量（对照 T25 基线 + 本轮新增用例数）
  2. `npm run test:checks`（含新增 `observability` 边界规则）
  3. AST 独立来源复核：固定参考 revision `b5c9be8`，只开放参考仓 Langfuse 相关路径；判定阈值为「至少 30 节点连续相同归一化子树」或「双方均 ≥60 节点且归一化序列相似度 ≥ 0.80」；**命中数须为 0**
  4. AC → 任务 → 文件 → 用例 → 命令/cwd → 实际数量/结果 逐条回填
  5. 未执项标 **UNVERIFIED** 并写恢复条件；失败标 **FAIL**
  6. 实施交付时在 `PRODUCT.md` 同步可选追踪配置、默认值与使用限制。当前纯文档修订尚未改变产品行为。
  7. 更新 SP004 汇总需求索引与变更记录
- **完成事实**：待填

---

## 测试收口映射（AC → 任务 → 用例）

| AC | 任务 | 用例文件 | 层 | 预期 RED 表现 |
| --- | --- | --- | --- | --- |
| OB-01 | T30 | `scripts/langfuse/init-local.test.mjs` | L0 | 文件不存在 |
| OB-02 | T30 | 同上 | L0 | 重复执行覆盖了凭据 / 不完整文件未报错 |
| OB-03 | T30 | `scripts/langfuse/compose.test.mjs` | L0 | 端口绑定不符 / 缺健康检查 |
| OB-04 | T30、T31 | `scripts/langfuse/compose.test.mjs` + 实际健康检查 | L0 + L1 Docker | 缺健康检查配置或真实 health 非 OK |
| OB-05 | T30 | `scripts/langfuse/compose.test.mjs` | L0 | stop 含 `-v` |
| OB-06 | T28、T29 | `src/observability/test/runtime.test.mjs`、`src/tui/test/observability-wiring.test.mjs` | L0 | 发出了请求 / 未降级 |
| OB-07 | T28 | `src/observability/test/config.test.mjs` | L0 | 文件值覆盖了环境值 |
| OB-08 | T28 | 同上 | L0 | 相对路径抛错 / 阻断启动 |
| OB-09 | T28 | 同上 | L0 | 导入了 `NODE_OPTIONS` |
| OB-10 | T28 | 同上 | L0 | 非法 URL 未被拒 |
| OB-11 | T26、T28 | `src/core/test/observability.test.mjs`、`src/observability/test/exporter.test.mjs` | L0 | 缺根观测 / 属性缺失 |
| OB-12 | T26 | `src/core/test/observability.test.mjs` | L0 | 缺模型子观测 / 缺 usage |
| OB-13 | T26 | 同上 | L0 | 缺工具子观测 |
| OB-14 | T26 | 同上 | L0 | 两回合 session/turn 不一致 |
| OB-15 | T26 | 同上 | L0 | outcome/level 判定错 |
| OB-16 | T28 | `src/observability/test/exporter.test.mjs` | L0 | 关闭时仍写了 input/output |
| OB-17 | T28 | 同上 | L0 | 角色结构错 |
| OB-18 | T27 | `src/observability/test/redact.test.mjs` | L0 | 裁剪后 JSON 非法 |
| OB-19 | T27 | 同上 | L0 | 凭据未脱敏 |
| OB-20 | T28 | `src/observability/test/runtime.test.mjs` | L0 | 上报失败冒泡到业务层 |
| OB-21 | T26、T29 | `src/core/test/observability.test.mjs` | L0 | 埋点异常影响回合 |
| OB-22 | T28 | `src/observability/test/runtime.test.mjs` | L0 | shutdown 挂起 |
| OB-23 | T28 | 同上 | L0 | 关闭后仍发新 span |
| OB-24 | T32 | `scripts/langfuse/verify-agent.test.mjs` | L0（替身）+ live | 鉴权失败仍调模型 |
| OB-25 | T32 | 同上 | L0 | 缺五项判定 / `contentVerified` 误报 true |
| OB-26 | T32 | 同上 | L0 | 失败仍退出 0 |
| OB-27 | T32 | 同上 + live 平台 | L0 + live | 未校验父子层级 |
| OB-28 | T32 | 同上 | L0 | 报告落进 Git 跟踪路径 |

**覆盖检查**：每条 AC 至少各有一例单元（L0）与一例功能（L1/live）用例。

- OB-01…OB-05：L0 由 `scripts/langfuse/*.test.mjs`；L1 由 T31 真实部署 + T32 真实脚本。
- OB-06…OB-23：L0 覆盖端口和协议，L1 用脱离 UI 的生产 runtime 与受控端点验证禁用、超时、缓冲、取消和退出；T32 只补其实际观测到的 live 行为。
- OB-24…OB-28：L0 由 `scripts/langfuse/verify-agent.test.mjs`（替身平台）；live 由 T32 真实运行。

---

## 执行前置与风险

### 前置

1. 用户放行实施（本轮**未获放行**）。
2. 放行后核对 `feature/SP004/real-coding-task` 的实际状态、基线和已有改动，沿用 SP004 功能分支。
3. `npm ci` 完成；基线测试全绿。

### 风险与处置

| ID | 风险 | 处置 | 恢复条件 |
| --- | --- | --- | --- |
| R-01 | 引入 OTel 依赖改变 npm 制品构成 | 已改为自建导出器 | 不适用（已消除） |
| R-02 | 埋点影响主循环性能/正确性 | 有界后台队列 + 请求与退出独立预算 | 上报挂起时验证回合和下一输入无需等待 |
| R-03 | 正文泄漏业务机密 | 默认关闭 + opt-in + 脱敏 + 裁剪 | AC OB-17…19 |
| R-04 | 凭据误入 Git | 全落 `.runtime/langfuse/` | AC OB-28 |
| R-05 | 照搬 vs 独立实现 | 行为等价 + 偏离登记 + AST 复核 | AC/T33 |
| R-06 | 平台索引延迟导致误判 | 轮询 + 「有 trace」不单独作为通过依据 | AC OB-27 |
| R-07 | 本机无 Docker | 部署项记 UNVERIFIED，其余项照常验证 | 装 Docker 后重跑 T31 |
| R-08 | 无模型凭据 | 真实三场景记 UNVERIFIED | 补凭据后重跑 T32 |

### 与 SP004 主线的关系

本需求作为 SP004 的**追加优化需求**，共享同一功能分支、同一合并门禁与同一交付记录。T25–T33 在 T24 之后执行；T33 的全量回归与 AST 复核**包含**本轮新增代码与文档。

2026-11-19 · v1.2 对齐需求 v0.2 与设计 v1.2，四项 P1 及上报、版本口径已进入对应任务与回归用例。实施暂停。
