# agent-observability · Agent 可观测性监控（Langfuse）· 设计文档

- 需求 slug：`agent-observability`
- 已确认 SP：SP004 优化需求（USER_CONFIRMED，2026-11-19 用户会话）
- 版本：v1.2
- 状态：**文档已修订，实施暂停**｜参考仓 revision：`b5c9be8`（只读审计）｜核对本地 master：`868eae6`
- 材料来源：
  - 用户会话「SP004中需要加一项优化需求，参照D:\extra_project\buding-worker-space里搭建Langfuse的监控体系，直接照搬这套监控即可，你先不要实现，先产出文档，走SDD流程」— **USER_CONFIRMED**
  - 参考仓 `ops/langfuse/`（`compose.yaml`、`README.md`）— 只读参考
  - 参考仓 `scripts/langfuse/`（`init-local.mjs`、`control.ps1`、`configure-plugin.mjs`、`verify-agent.mjs`）— 只读参考
  - 参考仓 `vscode_plugin/src/host/observability/agentTracing.ts`、`tracingConfig.ts` — 只读参考
  - 参考仓 `src/server/services/langfuseRuntime.ts`、`vscode_plugin/docs/langfuse.md`、`SP/SP01/agent-observability/STATUS.md` — 只读参考
  - 本仓既有实现：`src/core/session.ts`（Session/回合/事件）、`src/core/provider.ts`（Provider 端口）、`src/core/tools.ts`（工具端口）、`src/core/permissions.ts`（权限端口）、`src/storage/credentials.ts`（凭据存取）
- 身份区分：需求立项、参考对象、「行为等价照搬」目标为 **USER_CONFIRMED**；AC 切分、模块划分、契约形状、自建导出器替代 OTel SDK 为 **MODEL_PROPOSED**；未决点已全部收敛（需求文档 OPEN-01…OPEN-06）。
- 关联：[需求 v0.2](../requirements.md)｜[STATUS](../STATUS.md)｜[实施计划 v1.2](./plan.zh.md)｜[SP004 汇总](../../requirements-summary.md)

---

## 1. 背景与目标

### 1.1 前后行为

| | 当前（master `868eae6`） | 本轮目标 |
| --- | --- | --- |
| 本机观测平台 | **不存在**。仓库无任何 Langfuse/OTel 资产 | 开发者可在本机用 Docker Compose 起一套 Langfuse，自带初始化、启停与文档 |
| Agent 埋点 | **不存在**。`src/core/session.ts` 只发 `SessionEvent` 给宿主，**没有跨进程/跨系统的可观测出口** | 每次 Agent 回合产生 `agent.run` 根观测 + `model.request` / `tool.<name>` 子观测，可按 `session.id` 聚合 |
| 配置来源 | 无 | 显式 env 文件绝对路径 + 5 个白名单变量；继承环境优先；不扫描工作区 |
| 正文采集 | 无 | 默认关闭；显式 opt-in 才采集，且经先脱敏，再裁剪脱敏后的结构 |
| 可验证性 | 无 | 无界面验收脚本用生产 Agent 路径跑三场景，并从 Langfuse 公开 API 回查观测 |
| 故障隔离 | — | 追踪关闭/不可达/异常**一律不影响** Agent 业务结果 |

### 1.2 目标（USER_CONFIRMED）

1. **照搬**参考仓这套 Langfuse 监控体系到 budingx-next，行为等价。
2. 只产出文档，走 SDD 流程，作为 SP004 的优化需求。

### 1.3 明确排除

| 排除项 | 归属 | 理由 |
| --- | --- | --- |
| 生产高可用、多租户、SSO | — | 本轮定位是**开发者本机自建**，不是生产观测平台 |
| 云端 Langfuse 默认接入 | — | 默认离线；显式配置 base URL 才指向任意兼容端点 |
| 性能看板（p50/p95、费用、内存） | SP007 / SP016 | 能力矩阵「诊断与性能」行 |
| 跨进程 trace 续接、多端共享观测 | SP005 / SP008 | 依赖 SP005 会话恢复、SP008 宿主契约 |
| 打包 Langfuse 进 npm 制品 | — | 部署资产是开发期工具 |
| 新增斜杠命令（如 `/tracing`） | SP006 | 完整命令面属 SP006；本轮只做只读诊断输出 |
| 把 Langfuse 作为唯一验收来源 | — | 平台可查询 ≠ 业务正确；两者分别取证 |

### 1.4 保留行为（不得回归）

- SP002 Session 契约：事件族、状态机、排队注入、双中断语义、工具回合装配。
- SP003 文件工具与三档权限；SP004 命令执行、计划模式闸门、完成证据门槛。
- **性能基线**：追踪关闭时无观测缓冲、无 Langfuse 网络请求（OB-06）。
- **模块边界**：`core` 不得依赖 IO/网络；追踪能力以**端口 + 注入**方式进入 Core（§4.2）。

---

## 2. 当前状态（事实标注）

### 2.1 已存在（经源码核对）

| 事实 | 位置 |
| --- | --- |
| `Session` 以 `onEvent?: (event: SessionEvent) => void` 订阅事件 | `src/core/session.ts`（`SessionOptions`） |
| `SessionEvent` 是可辨识联合类型，含 `tool_result`、`denial_recorded`、`status` 等 | `src/core/events.ts` |
| `TurnOutcome` 区分成功/取消/错误等终态 | `src/core/events.ts` |
| `Usage` 事件类型含 token 数 | `src/core/events.ts`（`Usage`） |
| Provider 端口 `ModelProvider`/`ChatRequest`/`ProviderEvent` 为纯类型 | `src/core/provider.ts` |
| 工具端口 `ToolHandler{name, parameters, summary, describe, requiresApproval?, capability?, target?, execute}` | `src/core/tools.ts` |
| 权限端口 `PermissionPolicy` + `PermissionRequest{tool, capability, path?}`；能力枚举含 `'read' \| 'write' \| 'execute'` | `src/core/permissions.ts` |
| `CredentialStore` 提供凭据存取与主机绑定。追踪脱敏为拟新增能力 | `src/storage/credentials.ts` |
| 模块边界脚本禁止 `core` 依赖 `node:http`/`node:net`/任何 UI 库 | `scripts/checks/module-boundaries.mjs` |
| 构建 `tsc -p src/tui/tsconfig.json`；`src/tui/package.json` 单独打包 | `src/tui/tsconfig.json`、`src/tui/package.json` |
| 测试 `node --test src/*/test/*.test.mjs`（构建后跑 `.mjs`） | `package.json` |

### 2.2 不存在（必须新建）

- `src/observability/` 模块（追踪契约、脱敏、导出器）— 拟新增
- `src/core/observability.ts`（Core 侧追踪端口，纯类型）— 拟新增
- `ops/langfuse/compose.yaml`、`ops/langfuse/README.md` — 拟新增
- `scripts/langfuse/init-local.mjs`、`scripts/langfuse/control.ps1`、`scripts/langfuse/verify-agent.mjs` — 拟新增
- `src/tui` 侧追踪状态装配与只读诊断输出 — 拟新增/修改

### 2.3 参考仓只读审计结论（要点）

参考仓有**两套**并存的追踪实现，行为不同，需明确取舍：

| 参考实现 | 技术 | 特点 | 本轮取舍 |
| --- | --- | --- | --- |
| `vscode_plugin/.../agentTracing.ts` | `@opentelemetry/*` + `@langfuse/otel` `LangfuseSpanProcessor` | 标准 OTel，回合缓冲与显式父句柄，span 处理器自动批量导出 | **不采用**（见 §4.3 R-01） |
| `src/server/services/langfuseRuntime.ts` | 手写 OTLP JSON → `POST /api/public/otel/v1/traces` | 端到端回合聚合，工具/模型节点由事件回放生成，无 OTel 依赖 | **采用其协议**（§4.3） |

**关键取舍**：参考仓最终生产路径走的是**手写 OTLP 端点**那套（`x-langfuse-ingestion-version: 4`），而 OTel 那套绑在 VS Code 插件宿主。本仓是 TUI 单端，无插件宿主，故采用**手写端点 + 显式父句柄**。沿用自研 Agent Core，本轮依赖范围排除 LangChain、LangGraph 和 OTel SDK。

---

## 3. 方案总览

```
┌─────────────────────────────────────────────────────────────┐
│  src/tui（宿主）                                             │
│   ├─ 读取 BUDINGX_LANGFUSE_ENV_FILE（绝对路径）             │
│   ├─ loadTracingEnvironment() → 5 个白名单变量               │
│   ├─ 初始化 TracingRuntime（失败则静默降级为 disabled）      │
│   └─ 装配 src/core/observability.ts 的端口实现注入 Session   │
└──────────────────────────┬──────────────────────────────────┘
                           │ 注入（Core 不反向依赖）
┌──────────────────────────▼──────────────────────────────────┐
│  src/core/session.ts                                         │
│   ├─ 回合开始 → tracer.begin('agent.run', {...})             │
│   ├─ 模型请求 → tracer.begin('model.request', {...})          │
│   ├─ 工具调用 → tracer.begin('tool.<name>', {...})            │
│   └─ 回合结束 → tracer.end(outcome)                          │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│  src/observability（拟新增）                                 │
│   ├─ context.ts   回合缓冲与显式父句柄               │
│   ├─ redact.ts    先脱敏再裁剪           │
│   ├─ exporter.ts  手写 OTLP JSON → Langfuse /api/public/otel │
│   └─ runtime.ts   开关、生命周期、flush、故障隔离             │
└─────────────────────────────────────────────────────────────┘
```

**关键设计约束**：

1. Core 只依赖 `src/core/observability.ts` 的**纯类型端口**，不 import 任何网络/IO 模块（保持既有模块边界规则）。
2. 追踪实现放在 `src/observability/`，由宿主（`src/tui/runtime.ts`）装配并注入。
3. 埋点调用全部包在 try/catch 中，异常一律吞掉并回落到「无追踪」路径。

---

## 4. 详细设计

### 4.1 责任划分

| 关注点 | 归属 | 理由 |
| --- | --- | --- |
| 观测的**语义**（什么是回合、什么是工具节点、outcome 怎么判） | `src/core` | 与业务状态机同源，避免语义漂移 |
| 观测的**传输**（怎么脱敏、怎么组装 OTLP、怎么上报） | `src/observability` | 与业务解耦，可替换导出目标 |
| 观测的**开关与配置来源** | `src/tui/runtime.ts`（宿主） | 配置是宿主责任；`core` 不读环境变量 |
| 本机部署资产 | `ops/langfuse/` + `scripts/langfuse/` | 开发期工具，不进产品制品 |

### 4.2 Core 侧追踪端口（拟新增 `src/core/observability.ts`）

纯类型，无 IO，与 `src/core/exec.ts`、`src/core/plan.ts` 同构。

```ts
// 拟新增 src/core/observability.ts
export type TraceOutcome = 'success' | 'error' | 'cancelled' | 'blocked'

export type TraceAttributes = Record<string, string | number | boolean>

/** Core 只依赖此端口；实现由宿主注入。 */
export interface Tracer {
  /** 开始一个观测；返回句柄，失败返回 undefined（不抛错）。 */
  begin(name: string, attributes?: TraceAttributes, parent?: TraceHandle): TraceHandle | undefined
  /** 结束一个观测。 */
  end(handle: TraceHandle | undefined, outcome: TraceOutcome, error?: unknown): void
  /** 在当前观测上下文中设置属性。 */
  setAttributes(handle: TraceHandle | undefined, attributes: TraceAttributes): void
  /** 写入 input/output 正文（仅在 content capture 开启时实际生效）。 */
  setPayload(handle: TraceHandle | undefined, key: 'input' | 'output', value: unknown): void
}

export type TraceHandle = { readonly id: string }
```

**Session 接线点（拟修改 `src/core/session.ts`）**：

| 位置 | 动作 | 属性 |
| --- | --- | --- |
| `startTurn()` 分配实际 `turnId`，进入统一回合执行与收尾路径 | `begin('agent.run')`，句柄归属 `ActiveTurn` | `session.id`、`turn.id`、`langfuse.trace.metadata.runId`、`langfuse.observation.type=agent` |
| 每次 `ModelProvider.stream()` 前 | 有根句柄才 `begin('model.request', attrs, root)` | `langfuse.observation.type=generation`、`gen_ai.request.model`。Provider 内部重试归属此观测 |
| Provider 流完成、失败或取消 | 写入本次调用的 usage 与适用正文，再 `end` 一次 | 无 usage 时省略，下一次调用重新收集 |
| 工具调度开始，权限判断之前 | 有根句柄才 `begin('tool.<name>', attrs, root)`；成功、失败、阻断或取消均收尾一次 | `langfuse.observation.type=tool`、`gen_ai.tool.call.id` |
| 工具被权限拒绝 / 计划模式阻断 | `end(handle, 'blocked')` | level=WARNING |
| 回合统一收尾 | 写入根观测正文后 `end(root, outcome)` 一次，封存整批 | `langfuse.observation.metadata.outcome`、level |

**父子关系**：`startTurn()` 使用宿主注入的稳定会话 ID。模型和工具从 `ActiveTurn` 取根句柄并显式传给 `begin()`。运行时验证父句柄仍属于当前启用的回合，从根继承 `traceId`、`session.id`、`turn.id` 和 trace 级属性，并将根 `spanId` 写入子 `parentSpanId`。无有效根时跳过子观测。`submit()` 只排队时无埋点，队列输入另起回合时创建新根，同回合注入沿用原根。终态和取消路径复用同一收尾保护，晚到的回调不得再写入或发送。

> **实现要点**：Session 通过 `SessionOptions.tracer?: Tracer` 接收注入。无 tracer 时直接跳过，Core 保持纯类型端口和现有公开事件形状。

### 4.3 传输层：手写 OTLP 导出器（拟新增 `src/observability/exporter.ts`）

**协议**（对齐参考仓 `langfuseRuntime.ts`，A-14）：

```
POST {LANGFUSE_BASE_URL}/api/public/otel/v1/traces
Authorization: Basic base64(publicKey:secretKey)
x-langfuse-ingestion-version: 4
content-type: application/json
```

**请求体**（OTLP JSON 结构）：

```jsonc
{
  "resourceSpans": [{
    "resource": { "attributes": [{ "key": "service.name", "value": { "stringValue": "budingx-tui" } }] },
    "scopeSpans": [{
      "scope": { "name": "budingx-agent" },
      "spans": [ /* 见下 */ ]
    }]
  }]
}
```

**Span 结构**：

```jsonc
{
  "traceId": "<32 hex>",      // 同一回合内所有观测共享
  "spanId": "<16 hex>",        // 每个观测唯一
  "parentSpanId": "<16 hex>",  // 子观测指向 agent.run
  "name": "agent.run | model.request | tool.<name>",
  "kind": 1,
  "startTimeUnixNano": "<nanos>",
  "endTimeUnixNano": "<nanos>",
  "attributes": [ { "key": "...", "value": { "stringValue": "..." } } ],
  "status": { "code": 2 }      // 仅错误时
}
```

**属性命名契约**（对齐参考仓 A-06/A-10/A-11，保证 Langfuse UI 正确归类）：

| 属性 | 值 | 说明 |
| --- | --- | --- |
| `session.id` | 会话 ID | 根与子观测一致 |
| `turn.id` | 回合 ID | 本仓新增，区分同会话多回合 |
| `langfuse.trace.name` | `agent.run` | 根观测 |
| `langfuse.observation.type` | `agent` / `generation` / `tool` | 决定 Langfuse 归类 |
| `langfuse.observation.metadata.outcome` | `success`/`error`/`cancelled`/`blocked` | |
| `langfuse.observation.level` | `ERROR` / `WARNING` | 仅非 success 时写 |
| `langfuse.observation.status_message` | 错误码或脱敏消息 | |
| `langfuse.observation.input` / `.output` | JSON 字符串 | **仅 content capture 开启时写** |
| `langfuse.observation.usage_details` | JSON `{input, output}` | 有 token 时 |
| `gen_ai.request.model` | 模型名 | model.request |
| `gen_ai.tool.call.id` | 工具调用 ID | tool.* |
| `langfuse.trace.metadata.runId` | UUID | 根观测 |
| `service.name` | `budingx-tui` | resource 级 |

**上报策略**：

| 项 | 决定 | 理由 |
| --- | --- | --- |
| 批量 | 回合收尾封存整批并交给后台发送。Agent 终态和下一次输入无需等待网络 | 父子同批提交 |
| 超时 | 单次请求最多 3 秒。正常退出 flush 的总预算独立为 3 秒 | 请求只在后台运行，退出超时取消在途请求 |
| 失败处理 | `catch` 后静默丢弃 + 计数 | 可观测性不得改变业务结果（OB-20） |
| 重试 | **不做** | 避免拖慢回合与重复数据；下一回合仅记录自身数据 |
| 缓冲上限 | 单回合最多 200 个 span（含根），后台最多 1 批在途和 8 批等待。超过回合上限丢弃该回合整批，队列满时丢弃新批，均计数 | 避免残缺观测及无界积压 |
| `redirect` | `'error'` | 防止凭据被 302 带到第三方 |

**偏离登记 R-01（重要）**：参考仓插件路径用 `@opentelemetry/*` + `@langfuse/otel`。本轮**不引入**这三个依赖，改用手写 OTLP JSON。理由：

1. 本仓 `src/tui/package.json` 单独打包进 npm，OTel SDK 会显著增加制品体积与冷启动成本；
2. 本仓无自动插桩需求（无第三方库生态接入），OTel 的主要价值用不上；
3. 参考仓**生产路径**（`langfuseRuntime.ts`）本身就是手写端点，本轮对齐那套；
4. 代价：不获得 OTel 生态的自动插桩与 exporter 生态，本轮无此需求。

> 该偏离须在 §9.5 独立来源复核中说明，并计入合并门禁。

#### R-01 可行性核验（2026-11-19 查官方文档与参考仓源码，结论：不影响监控效果）

用户提出「不引入会不会影响监控」。经三方核对：

| 核对项 | 结论 | 依据 |
| --- | --- | --- |
| 参考仓是否用了 OTel 的自动插桩/全局 provider/上下文传播 | **没有**。全仓搜 `registerInstrumentations`/`NodeSDK`/`setGlobalTracerProvider`/`W3CTraceContextPropagator`/`trace.getSpan` **零命中**；只用 `BasicTracerProvider` + `LangfuseSpanProcessor` 两个具体类 | 参考仓 `vscode_plugin/src/` 实测 |
| 参考仓 OTel 版比手写版多了什么 | 只多两件事：**①** span 后台批量导出；**②** `shouldExportSpan` 按 instrumentation scope 过滤 | `agentTracing.ts` `initializeTracing` 实测 |
| 过滤能力本轮是否需要 | **不需要**。本仓只有自己发的 span（scope 名固定），不过滤等价于全放行；参考仓的过滤本身也只是 `name === 'budingx-agent'` | 同上 |
| 父子关系是否依赖 OTel | **不依赖**。OTel 的父子关系由 `trace.setSpan(ROOT_CONTEXT, parent)` 建立；本仓由 `ActiveTurn` 显式传递父句柄、`parentSpanId` 直接写进 span JSON，**语义等价** | 官方 [OTel 文档](https://langfuse.com/integrations/native/opentelemetry) 与参考仓 `agentTracing.ts` `begin()` 对照 |
| Langfuse 侧如何把 span 映射成观测 | **映射在 Langfuse 服务端做**，不在客户端 SDK。官方 [Attribute Mapping](https://langfuse.com/integrations/native/opentelemetry#property-mapping) 明确 `langfuse.*` 命名空间属性直接映射数据模型，且**优先于**通用 OTel 约定 | 官方文档 |
| 本轮用到的属性是否都能被正确映射 | **全部可以**。逐条核对官方映射表：`langfuse.observation.type`→type；`langfuse.observation.level`→level；`langfuse.observation.status_message`→statusMessage；`langfuse.observation.metadata.outcome`→metadata.outcome；`langfuse.observation.input`/`.output`→input/output；`langfuse.observation.usage_details`→usage；`gen_ai.request.model`→model；`session.id`→sessionId | 官方映射表逐行核对 |
| `usage_details` 的字段名是否要对齐 | **要**。官方映射表规定 `langfuse.observation.usage_details` 是 JSON string，字段为 `input`/`output`（对应 `gen_ai.usage.input_tokens`/`output_tokens`）。本轮设计 §4.3 已用 `{input, output}`，**与官方一致** | 官方映射表 |
| `x-langfuse-ingestion-version: 4` 是否必须 | **必须**。官方明确：不带此头，OTel 直传数据在 v4 数据模型与 v2 Observations API 上可能走延迟入库路径。本轮设计已包含该头 | 官方文档 |
| `gen_ai.tool.call.id` 是否被映射 | 不在官方 observation 字段表内，**会被保留进 `metadata`**（官方说明：所有未映射属性进 `metadata.attributes`）。本轮把它当**辅助标识**而非核心字段，核心归类靠 `langfuse.observation.type=tool` 与 span 名 `tool.<name>` | 官方文档 |
| 是否有本轮用得上但 OTel 独有的能力 | 有三项，但**当前不需要**：① 跨进程上下文传播（W3C baggage）——本轮单进程，SP005 才谈跨会话；② 自动插桩（OpenAI/Anthropic 等库）——本仓 Provider 是自研 `src/provider`，无第三方库可插；③ OTel Collector 转发——本机直连即可 | 官方文档 + 本仓实际 |
| 批量导出对本轮的影响 | 影响**很小**。本轮设计「回合结束一次性投递」本身就是批量（一次请求带该回合全部 span），只是不后台定时。差别是崩溃时可能丢当前回合的 span —— 本轮已接受（设计 §5「崩溃丢失」） | — |

**结论**：**不引入 OTel SDK 对监控效果无实质影响**。原因是——(a) 参考仓 OTel 版**没用**自动插桩、上下文传播或全局 provider，这些才是 OTel 的真正价值；(b) Langfuse 的属性映射在**服务端**完成，客户端只要按 OTLP JSON 协议发对字段，平台侧渲染完全一致；(c) 本轮唯一损失的「后台定时批量」已由「回合结束批量投递」覆盖。

**保留的代价（诚实登记）**：若将来需要 **①** 跨进程/跨服务 trace 续接、**②** 接入第三方 OTel 库并自动插桩、**③** 用 OTel Collector 统一汇聚，则需要重新评估引入 OTel SDK。该条件写入 §9.2 的后续触发条件。

### 4.4 脱敏与长度裁剪（拟新增 `src/observability/redact.ts`）

在 `src/observability/redact.ts` 独立实现脱敏与序列化。宿主只传入当前模型和 Langfuse 的已知凭据作为内存中的匹配值。`CredentialStore` 继续负责存取，脱敏器无需读取凭据文件。

| 规则 | 行为 |
| --- | --- |
| 敏感键与内容 | 递归替换敏感键值及字符串中的 API Key、Bearer、私钥块、Cookie、JWT 等模式。键名也要处理意外携带的凭据字面量 |
| 已知凭据 | 替换宿主提供的已知凭据字面量，沿用长度至少 8 的匹配策略。敏感字段和已知样式仍独立脱敏 |
| 错误与诊断 | 错误码优先。任何需输出的消息都走同一脱敏器与长度限制，包括关闭正文采集时的错误状态和诊断 |
| 序列化上限 | 正文最多 8000 字符。超限带 `truncated` 标记，最终输出为合法 JSON |

先递归生成脱敏结构，再对该结构执行 JSON 序列化。超长消息数组取最近最多 8 条，只从脱敏后的消息裁剪正文并添加 `[truncated]`，保留角色和数组形状，每次按最终序列化长度检查上限。其他超长对象采用 `{truncated: true, preview: ...}`，preview 只取自已脱敏的序列化结果。遇到循环引用或序列化异常时返回固定的无原文 JSON 错误标记。裁剪、错误回退和上报阶段均只消费脱敏结果。

### 4.5 配置加载（拟新增 `src/observability/config.ts`）

对齐参考仓 A-09，**只导入 5 个白名单变量**：

| 变量 | 语义 |
| --- | --- |
| `BUDINGX_LANGFUSE_ENABLED` | `1` 才启用；其他值一律视为关闭 |
| `BUDINGX_LANGFUSE_CAPTURE_CONTENT` | `1` 才采集正文 |
| `LANGFUSE_BASE_URL` | 平台地址；缺省 `http://localhost:3000` |
| `LANGFUSE_PUBLIC_KEY` | 项目 public key |
| `LANGFUSE_SECRET_KEY` | 项目 secret key |

**来源优先级**：进程环境 > 用户指定的 env 文件。env 文件必须为**绝对路径**（相对路径视为配置错误）。

**明确禁止**：

- 不读取工作区设置、不扫描仓库 `.env`、不读 `~/.claude`；
- 不导入 `NODE_OPTIONS` 等运行参数（防止文件注入运行期行为）；
- 读取失败 → 保留继承环境 + 输出脱敏诊断 + **不阻断 Agent**。

### 4.6 开关与 URL 校验（拟新增 `src/observability/runtime.ts`）

`initializeTracing(env)` 返回 `boolean`（是否成功启用）：

```
1. env.BUDINGX_LANGFUSE_ENABLED !== '1'            → return false
2. !publicKey || !secretKey                        → return false
3. url = new URL(baseUrl || 'http://localhost:3000')
4. url.protocol 必须是 'https:'，或 'http:' 且 hostname ∈ {localhost, 127.0.0.1, [::1]}
5. url.username / url.password 必须为空
6. 任一步异常 → return false（不抛错、不发请求）
```

> 对齐参考仓 A-15；**放宽到任意 `https:` 端点**（用户显式配置云端时可用），`http:` 仍限本机，避免明文外发凭据。

### 4.7 本机部署资产（拟新增 `ops/langfuse/`）

### 4.7.1 Compose 结构

对齐参考仓 A-01，六个服务：

| 服务 | 镜像 | 宿主端口 | 说明 |
| --- | --- | --- | --- |
| `langfuse-web` | `langfuse/langfuse:<tag>` | `127.0.0.1:3000` | Web + 媒体端点 |
| `langfuse-worker` | `langfuse/langfuse-worker:<tag>` | — | 后台摄入 |
| `postgres` | `postgres:16` | **不发布** | 主库 |
| `clickhouse` | `clickhouse/clickhouse-server:<tag>` | **不发布** | 观测存储 |
| `redis` | `redis:7-alpine` | **不发布** | 队列 |
| `minio` | `minio` | `127.0.0.1:9090` | 对象存储（媒体） |

- 所有服务 `depends_on` 健康检查（`condition: service_healthy`）。
- 日志 `json-file`，`max-size: 10m`、`max-file: 3`（对齐参考仓）。
- 具名卷：`langfuse_postgres_data`、`langfuse_clickhouse_data`、`langfuse_clickhouse_logs`、`langfuse_minio_data`、`langfuse_redis_data`。
- **镜像版本号**：本轮实施时以 `docker compose pull` 实际拉取成功的稳定版为准，写入 `local.env` 的 `LANGFUSE_IMAGE_TAG` 并记录到交付记录；**不得凭记忆写死未验证版本号**。

### 4.7.2 初始化脚本（拟新增 `scripts/langfuse/init-local.mjs`）

对齐参考仓 A-02，但**去掉插件语境**（本仓无 VS Code 插件）：

| 文件 | 内容 | 位置 |
| --- | --- | --- |
| `local.env` | DB/对象存储密码、SALT、ENCRYPTION_KEY、NEXTAUTH_SECRET、项目 public/secret key、初始用户邮箱/密码 | `.runtime/langfuse/` |
| `agent.env` | `BUDINGX_LANGFUSE_ENABLED=1`、`LANGFUSE_BASE_URL`、`LANGFUSE_PUBLIC_KEY`、`LANGFUSE_SECRET_KEY` | `.runtime/langfuse/` |
| `login.json` | 登录地址、邮箱、随机初始密码 | `.runtime/langfuse/` |

规则：

- 全部落在 `.runtime/langfuse/`（Git 忽略）；
- 权限在写入任何凭据前建立并验证。POSIX 创建当前用户所有的 `0o700` 目录和 `0o600` 文件。Windows 在宿主端对 NTFS 目录取消继承、按当前用户 SID 限制访问，再验证目录和三个文件的实际 DACL 与归属。Windows 通过 WSL 启动 Docker 时，凭据仍在 Windows 宿主初始化，以 NTFS ACL 为准。
- **幂等**：复用前验证既有目录和文件权限。权限检查失败、无法限制访问或遇到无法验证的链接路径时停止初始化并保留原文件。既有凭据内容保持原样。
- **不完整则报错**：缺 `NEXTAUTH_URL`/用户凭据/项目 key 任一 → 抛错并保留原文件，**不删卷重来**；
- 随机值用 `node:crypto` 的 `randomBytes`/`randomUUID`；
- `DATABASE_URL` 由组件拼装（`postgresql://postgres:<pw>@postgres:5432/postgres`）。

### 4.7.3 启停控制（拟新增 `scripts/langfuse/control.ps1`）

对齐参考仓 A-03：

| Action | 行为 |
| --- | --- |
| `start` | 先跑 `init-local.mjs`，再 `docker compose -p budingx-langfuse --env-file .runtime/langfuse/local.env -f ops/langfuse/compose.yaml up -d` |
| `stop` | `docker compose ... stop`（**不删卷、不删凭据**） |
| `status` | `docker compose ... ps` |
| `logs` | `docker compose ... logs --tail 100 langfuse-web langfuse-worker` |

- Windows 无 Docker CLI 时走 WSL（`wsl.exe -d <Distro> --cd <linuxRoot> -- docker ...`）；
- WSL 模式启动隐藏保活进程（`wsl.exe ... sleep infinity`），pid + started 写入 `.runtime/langfuse/wsl-keeper.json`，下次 start 校验后复用；
- **禁止** `down -v`（会删数据卷）。

### 4.7.4 部署文档（拟新增 `ops/langfuse/README.md`）

对齐参考仓部署 README 的信息架构（环境要求 / 初始化与启动 / 登录与配置 / 无界面验证 / 日常管理 / 常见问题 / 共享与验证记录），内容按本仓实际重写：单机单实例约定、端口占用处理、镜像源可选路径（`DOCKER_REGISTRY=mirror.gcr.io`）、「健康通过 ≠ Agent 验证通过」的分开取证声明。

### 4.8 无界面验收脚本（拟新增 `scripts/langfuse/verify-agent.mjs`）

对齐参考仓 A-12/A-13，但**用本仓真实生产路径**。

**路径**：通过 TUI 与验收脚本共享的生产运行时装配，使用 Core Session、真实 Provider、真实追踪器与工作区只读工具。宿主侧只读回执按 `turnId` 提供实际 `traceId`、预期会话 ID 和本轮发送结果，供脚本关联查询。

**三场景**：

| # | 场景 | 构造 | 本地预期 |
| --- | --- | --- | --- |
| 1 | 成功 | 读存在的文件 | 工具 ok=true，无 error 事件 |
| 2 | 工具失败 | 读不存在的文件 | 工具 ok=false，模型如实报告 |
| 3 | 模型失败 | Provider 指向不可连接端点 | 连接错误、回合终态为 error、无工具调用。正文开启时根 output 为合法 JSON `[]` |

**执行前置**：

1. 校验 Langfuse 项目鉴权（`GET /api/public/projects`，Basic 认证）→ 失败则**在发起任何模型调用前**退出，不消耗额度；
2. 校验模型凭据可用（`BUDINGX_SMOKE_MODEL_KEY`/`_BASE_URL`/`_MODEL` 或本仓配置）→ 缺失则明确报错退出；
3. 只读工具限定在专用 fixture 目录（`.runtime/langfuse/agent-workspace/`），避免读到真实项目。

**报告**（`.runtime/langfuse/verification.json`）每场景独立五项判定：

| 字段 | 含义 |
| --- | --- |
| `localExpectationMet` | 本地行为符合场景预期 |
| `platformIndexed` | v2 API 按实际 `traceId` 查询到对应记录 |
| `hierarchyOk` | 恰有一个无物理父节点的 `agent.run`。模型和工具子观测的 `parentObservationId` 指向根 `id`，场景所需节点、类型和失败级别均符合本地预期 |
| `sessionConsistent` | 根与每个子观测的 `sessionId` 都等于运行时提供的本地预期 ID |
| `contentVerified` | 正文开启时验证根 input/output 合法、角色符合场景且已知合成凭据未出现。模型连接失败且未产生助手消息时验证 output 为 `[]`。正文关闭时为 `null`，另行断言本 trace 的所有观测均无正文 |

成功场景至少有一次成功模型调用和一次成功 `tool.Read`。工具失败场景要求预期的 `tool.Read` 为 `ERROR`，并核对本地工具错误和模型报告。模型连接失败场景要求根和模型节点均为 `ERROR`，且无工具节点。平台判定结合本地实际调用，避免仅凭任意一个 `ERROR` 通过。

**退出码**：三个场景的本地预期、索引、层级和会话一致性均为 `true`，且正文开启时 `contentVerified === true`、关闭时所有观测均无正文，才退出 0。查询失败、超时、鉴权或额度失败都记录实际判定并以非零退出。回执未生成时 trace ID 记 `null`。

**平台查询**：在有限截止时间内按 trace ID 和场景时间窗口查询 `/api/public/v2/observations`，请求 `fields=core,basic,io` 并处理分页。轮询等待场景必需观测齐全，截止仍缺则失败。OTLP 上报使用 `parentSpanId` 与 `session.id`，API 回查使用 `parentObservationId` 与 `sessionId`。I/O 按返回的原始字符串解析，省略 `parseIoAsJson`。

### 4.9 TUI 侧装配与诊断

| 动作 | 说明 |
| --- | --- |
| `src/tui/runtime.ts` | 读 `BUDINGX_LANGFUSE_ENV_FILE`（用户显式指定的绝对路径）→ `loadTracingEnvironment` → `initializeTracing` → 构造 `Tracer` 实现并注入 `Session` |
| 失败降级 | 初始化失败 → 省略 tracer，**不阻断启动** |
| 诊断输出 | 在现有诊断通道输出 `Langfuse tracing: enabled/disabled`、`content capture: on/off`、`base url: <host>`；**不输出密钥** |
| 关闭 | 宿主停止创建观测，丢弃未完成回合，再等待已封存批次最多 3 秒。到期取消在途请求并丢弃剩余批次 |
| 新命令 | **不新增**斜杠命令（属 SP006） |

### 4.10 故障隔离矩阵

| 故障 | 检测点 | 行为 | 对 Agent 结果的影响 |
| --- | --- | --- | --- |
| 未启用 | `initializeTracing` 返回 false | 省略 tracer | 无 Langfuse 网络请求 |
| 配置缺失/文件不可读 | `loadTracingEnvironment` catch | 保留继承环境 + 诊断 | 无 |
| URL 非法 | 校验步骤 3–5 | 返回 false | 无 |
| 平台不可达 | fetch 抛错 | 静默丢弃 + 计数 | 无 |
| 平台 5xx | `response.ok` 假 | 静默丢弃 + 计数 | 无 |
| 上报超时 | `AbortSignal.timeout(3000)` | 静默丢弃 | 回合终态无需等待请求 |
| 埋点内部异常 | try/catch | 吞掉，回落无追踪 | 无 |
| 进程退出时未 flush | shutdown 超时 | 丢弃未发数据 | 无（不挂起） |

> **生命周期**：即时禁用丢弃未完成回合和待发批次，并取消在途请求。正常退出只 flush 已封存批次，使用整个退出阶段的 3 秒截止时间。两个路径都立即停收观测。

---

## 5. 状态归属与生命周期

| 状态 | 归属 | 生命周期 | 恢复 |
| --- | --- | --- | --- |
| 追踪配置 | 宿主进程内存 | 进程启动时读取一次 | 重启进程 |
| 启用标志 | `src/observability/runtime.ts` 单例 | 进程级 | 改 env 后重启 |
| 根与子观测句柄 | `ActiveTurn` 与追踪运行时 | 回合级 | 收尾后失效 |
| 待发批次 | 后台发送器 | 进程内有界缓冲 | 崩溃时丢失 |
| 本机凭据 | `.runtime/langfuse/*.env` | 文件 | 重新执行 init（幂等） |
| Langfuse 数据 | Docker 具名卷 | 持久 | `stop` 保留；`down -v` 会删（禁止） |

**并发**：多会话并行时，每会话独立 `session.id`；span 缓冲按回合隔离，无跨回合串写。

**跨进程**：本轮**不支持** trace 续接（SP005 范围）。

---

## 6. 变更集

| 路径 | 动作 | 说明 |
| --- | --- | --- |
| `src/core/observability.ts` | 拟新增 | Core 侧追踪端口（纯类型） |
| `src/core/session.ts` | 修改 | 注入 `tracer?`；回合/模型/工具埋点接线 |
| `src/tui/cli.ts` | 修改 | 正常退出接入有截止时间的追踪 flush |
| `src/observability/index.ts` | 拟新增 | 模块出口 |
| `src/observability/config.ts` | 拟新增 | 白名单变量加载与 env 文件解析 |
| `src/observability/redact.ts` | 拟新增 | 独立脱敏与安全裁剪 |
| `src/observability/context.ts` | 拟新增 | 回合缓冲与显式父句柄 |
| `src/observability/exporter.ts` | 拟新增 | 手写 OTLP JSON 导出器 |
| `src/observability/runtime.ts` | 拟新增 | 开关、URL 校验、生命周期、flush |
| `src/observability/test/` | 拟新增 | L0/L1 单元与功能测试 |
| `src/tui/runtime.ts` | 修改 | 配置读取、追踪初始化、注入 Session、诊断输出 |
| `src/tui/tsconfig.json` | 修改 | include 新增 `../observability` |
| `src/tui/package.json` | **不修改** | 无新增运行时第三方依赖 |
| `ops/langfuse/compose.yaml` | 拟新增 | 本机 Langfuse 部署 |
| `ops/langfuse/README.md` | 拟新增 | 部署与使用文档 |
| `scripts/langfuse/init-local.mjs` | 拟新增 | 初始化本机凭据与配置 |
| `scripts/langfuse/control.ps1` | 拟新增 | 启停控制 |
| `scripts/langfuse/verify-agent.mjs` | 拟新增 | 无界面三场景验收 |
| `scripts/langfuse/*.test.mjs` | 拟新增 | 脚本自测 |
| `scripts/checks/module-boundaries.mjs` | 修改 | 新增 `observability` 边界规则（core 不得依赖它） |
| `package.json` | **不修改** | 无新增运行时第三方依赖（只用 Node 内置） |

**依赖与许可**：本轮**不新增任何运行时第三方依赖**。全部使用 Node.js 内置模块（`node:crypto`、`node:fs`、`node:path`、`node:url`、`node:util`）以及 Windows 宿主原生 ACL 能力。

**材料来源与处理决定**：

| 材料 | 来源 | 许可 | 处理决定 |
| --- | --- | --- | --- |
| 参考仓 Langfuse 资产 | `buding-worker-space` | 未开源（无 LICENSE） | **只读审计行为事实**；部署结构与协议为公开规范；实现独立编写，不复制文件 |
| Langfuse OTLP 协议 | 公开 API 规范 | 公开协议 | 按公开规范实现，不涉许可问题 |
| 本仓 Agent 契约 | `src/core`、`src/provider`、`src/workspace` | 自有 MIT | 复用生产运行路径，追踪脱敏独立实现 |

---

## 7. 验收条件映射

完整 AC 见[需求 v0.2](../requirements.md) OB-01…OB-28。

| AC 组 | 条数 | 责任层 | 测试层 |
| --- | --- | --- | --- |
| OB-01…OB-05 部署与配置 | 5 | `ops/langfuse/` + `scripts/langfuse/` | L1 真实 Docker（无 Docker 时 UNVERIFIED） |
| OB-06…OB-10 配置加载与安全 | 5 | `src/observability/config.ts`、`runtime.ts` | L0 纯逻辑 |
| OB-11…OB-19 观测内容与结构 | 9 | `src/core/observability.ts`、`src/core/session.ts`、`src/observability/*` | L0 + L1（Core 真实回合） |
| OB-20…OB-23 故障隔离与生命周期 | 4 | `src/observability/runtime.ts`、`exporter.ts` | L0 + L1（故障注入） |
| OB-24…OB-28 验收脚本与证据 | 5 | `scripts/langfuse/verify-agent.mjs` | L1 live 平台 + live Provider |
| **合计** | **28** | — | — |

**测试层定义**：

| 层 | 手段 |
| --- | --- |
| L0 纯逻辑 | 配置解析、URL 校验、脱敏、裁剪、span 组装、上下文父子关系（用假导出器） |
| L1 真实 Core 回合 | 本仓 `Session` + 假 Provider + 假工具 → 断言 span 结构、属性、outcome、session 一致性 |
| L1 真实 Docker | `docker compose up -d` → health check → 真实平台 API 查询 |
| live 平台 + live Provider | `verify-agent.mjs` 三场景 |
| 真终端人工 | 诊断输出观感 — **UNVERIFIED** |

---

## 8. 与参考仓对照与有意偏离

### 8.1 行为等价对照

见[需求 v0.2 §参考对照点](../requirements.md) A-01…A-15，本轮全部对齐。

### 8.2 有意偏离

| ID | 参考仓 | 本仓决定 | 理由 |
| --- | --- | --- | --- |
| **R-01** | `@opentelemetry/*` + `@langfuse/otel` | **自建 OTLP 导出器**，不引入这两个依赖 | §4.3；制品体积 + 冷启动 + 参考仓生产路径本就是手写端点 |
| **R-02** | `plugin.env` / `BUDINGX_LANGFUSE_*`（含插件语境） | `agent.env`；变量名去掉插件语境但保留 `BUDINGX_LANGFUSE_*` 前缀 | 本仓无插件 |
| **R-03** | `configure-plugin.mjs` 写 VS Code 用户设置 | **不实现** | 本仓无 VS Code 宿主；配置入口改为 TUI 侧显式 env 文件路径 |
| **R-04** | `verify-agent.mjs` 加载 `vscode_plugin/out/host/agentLoop.js` + Node 文件系统适配器 | 用本仓 `src/core` Session + `src/provider` + `src/workspace` 工具 | 本仓无 VS Code 模块；验证路径必须走本仓生产代码 |
| **R-05** | 服务端 `langfuseRuntime` 按 `sessionId:turnId` 聚合回合，回合结束整体投递 | 本仓同样按回合批量投递 | 行为一致 |
| **R-06** | 插件侧 `LangfuseSpanProcessor` 自动批量导出（后台定时） | 本仓回合收尾入有界后台队列，单次请求 ≤3 秒 | 保留回合整批语义，回合无需等待网络 |
| **R-07** | 参考仓 `http:` 只允许本机 | 本仓 `https:` 允许任意端点，`http:` 仍限本机 | 用户显式配置云端时需要；明文外发凭据仍禁止 |
| **R-08** | 参考仓有 `tracing.configuration.check` 这类诊断 span | 本轮**不写**诊断 span | 避免污染真实 trace；诊断走终端输出 |

### 8.3 与 SP004 其它需求的关系

| 关系 | 说明 |
| --- | --- |
| 依赖 | 依赖 SP004 的 `Session` 回合结构、`tool.<name>` 工具契约、权限拒绝事件 |
| 增强 | 观测到 `blocked` outcome，使权限拒绝与计划模式阻断在平台上可见（SP003/SP004 的可观测副产品） |
| 不冲突 | 不改动 SP002/SP003/SP004 的既有行为；追踪关闭时**零影响** |
| 不覆盖 | 不替代 SP004 自身的验收；平台可查 ≠ AC 通过 |

---

## 9. 风险与开放项

### 9.1 风险

| ID | 内容 | 处置 |
| --- | --- | --- |
| R-01 | 引入 OTel 依赖改变 npm 制品构成 | 已改为自建导出器，**不新增运行时依赖**；**2026-11-19 已核验对监控效果无实质影响**（§4.3 R-01 可行性核验：参考仓 OTel 版未用自动插桩/上下文传播/全局 provider，Langfuse 属性映射在服务端完成，本轮属性逐条符合官方映射表）；重新评估的触发条件见 §9.2 |
| R-02 | 埋点影响 Agent 主循环性能或正确性 | 全 try/catch + 3s 超时 + 回合批量投递；AC OB-20…OB-23 专测 |
| R-03 | 正文采集泄漏业务机密 | 默认关闭 + 显式 opt-in + 先脱敏后裁剪；AC OB-17…OB-19 专测 |
| R-04 | 本机凭据误入 Git | 全部落 `.runtime/langfuse/`（Git 忽略）；AC OB-28 专测 |
| R-05 | 「照搬」与「独立实现」约束冲突 | 以**行为等价**为目标，机制读、代码独立写；偏离逐条登记（§8.2） |
| R-06 | 上报超时或积压 | 使用独立的请求和退出截止时间，用未决请求证明业务终态与下一输入无需等待网络 |
| R-07 | Langfuse 平台侧索引延迟导致误判 | 验收脚本轮询窗口 + 「有 trace」不单独作为通过依据（OB-27） |
| R-08 | 单回合 span 数失控 | 单回合 span 上限 200，超出整批丢弃 |

### 9.2 开放项

本需求的 OPEN-01…OPEN-06 **已在需求文档内全部关闭**（见[需求 v0.2 §开放问题](../requirements.md)）。本设计无新增阻塞性 OPEN。

实施阶段需实测确认的事项（非 OPEN，属 UNVERIFIED）：

| 项 | 恢复条件 |
| --- | --- |
| Langfuse 镜像实际可拉取版本 | `docker compose pull` 实际成功；不得凭记忆写死版本号 |
| 本机 Docker / WSL 可用性 | 目标机器实测；无 Docker 时按 §4.7.3 降级并记 UNVERIFIED |
| 真实模型三场景 | 依赖用户凭据；无凭据记 UNVERIFIED |
| 平台侧观测可查询 | 依赖部署成功 + API 可达 |
| 后台发送与退出时限 | 验证挂起的网络无需阻塞回合终态，实测退出总耗时及丢弃语义 |

**后续触发条件（何时必须重新评估引入 OTel SDK）**：

| 触发条件 | 归属 | 需要的能力 |
| --- | --- | --- |
| 跨进程/跨会话 trace 续接 | SP005 | W3C 上下文传播（baggage / propagator） |
| 宿主拆分为多进程或多服务 | SP008 | 全局 TracerProvider + ContextManager |
| 要接入第三方 OTel 生态库并自动插桩 | 后续视需要 | `registerInstrumentations` |
| 要用 OTel Collector 统一汇聚多来源 | 后续视需要 | OTLP exporter + Collector 配置 |
| 平台侧出现本轮属性**映射不到**的观测字段 | 实施期发现 | 需核对官方属性映射表并补齐属性 |

> 这些条件**当前均不成立**。本仓是 TUI 单端单进程，Provider 自研，无第三方可插桩库。

### 9.3 独立实现与来源复核

参考输入限**可观察行为、公开协议字段与合成样例**。本仓从既有 Session/Provider/工具契约独立实现追踪与脱敏。

- 参考仓源码、配置、生成产物、私有资产**不得复制、逐文件改写或混入制品**；
- **不复制**参考仓的 `agentTracing.ts`（OTel 版本）、`langfuseRuntime.ts`、`init-local.mjs`、`control.ps1`、`compose.yaml`、`verify-agent.mjs`；
- Compose 结构、OTLP 请求体、Langfuse 属性名属**公开协议/规范**，按规范实现；
- 实施阶段须按 SP004 §9.8 同口径执行 AST 独立来源复核（至少 30 节点连续相同归一化子树，或双方均 ≥60 节点且相似度 ≥ 0.80 的函数对判定为命中），无未解决命中才通过；**命中数为 0 才算通过**；
- 报告仅保留路径、范围、指标与处置，不保留参考源码片段。

---

## 10. 自审记录

| 版本 | 日期 | 自审结论 | 身份 |
| --- | --- | --- | --- |
| v1.0 | 2026-11-19 | **Agent 自审通过**。核对：① 需求来源与「行为等价」目标为 USER_CONFIRMED，AC 切分为 MODEL_PROPOSED；② 参考对照 A-01…A-15 逐条有只读审计出处；③ Core 只依赖纯类型端口，不违反 `scripts/checks/module-boundaries.mjs` 既有规则（core 不依赖 IO/网络）；④ **不新增运行时第三方依赖**，不改变 npm 制品构成；⑤ 所有埋点故障隔离路径有对应 AC（OB-20…OB-23）；⑥ 凭据与正文采集的隐私边界有对应 AC（OB-16…OB-19、OB-28）；⑦ 偏离参考仓之处逐条登记（§8.2 R-01…R-08）；⑧ 无阻塞性 OPEN；⑨ 与 SP002/SP003/SP004 既有行为无冲突，追踪关闭时零影响 | MODEL_PROPOSED（技术方案），经 Agent 自审通过 |
| v1.1 | 2026-11-19 | **R-01 可行性核验补充**（用户问「不引入会不会影响监控」）：新增 §4.3「R-01 可行性核验」小节——查参考仓源码确认其 OTel 版**未用**自动插桩/全局 provider/上下文传播；查官方 Langfuse 文档确认**属性映射在服务端完成**且本轮全部属性符合官方映射表；核对 `x-langfuse-ingestion-version: 4` 为实时入库必需；逐条列出 OTel 独有能力与本轮不需要的理由；新增 §9.2「后续触发条件」明确何时必须重新评估。**结论：不引入 OTel SDK 对监控效果无实质影响。** 同时修正 §4.3 属性表的一处遗漏说明（`gen_ai.tool.call.id` 不在官方 observation 字段表内，保留进 `metadata`，仅作辅助标识） | MODEL_PROPOSED，经 Agent 自审通过 |
| v1.2 | 2026-11-19 | **文档自审通过**。四项 P1 与上报和版本口径已跨需求 v0.2、计划 v1.2 核对，逐项结论见 [STATUS](../STATUS.md)。运行验证仍为 UNVERIFIED。 | MODEL_PROPOSED，实施暂停 |

**本版授权范围**：仅文档产出。**不创建分支、不写产品代码、不提交、不合入**。用户会话「你先不要实现，先产出文档」为明确暂停指令。

---

## 11. 版本记录

| 版本 | 日期 | 变化 | 身份 |
| --- | --- | --- | --- |
| v1.0 | 2026-11-19 | 首版：责任划分、Core 追踪端口、手写 OTLP 导出器（替代 OTel，偏离 R-01）、脱敏与裁剪、配置白名单、URL 校验、本机部署资产、无界面验收脚本、故障隔离矩阵、变更集、AC 映射、偏离登记、风险 | MODEL_PROPOSED，经 Agent 自审通过 |
| v1.1 | 2026-11-19 | 新增 §4.3「R-01 可行性核验」（参考仓源码核对 + 官方 Langfuse 属性映射逐条核对，结论：不引入 OTel SDK 对监控效果无实质影响）；新增 §9.2「后续触发条件」；修正 `gen_ai.tool.call.id` 的映射说明；补充 `usage_details` 字段名与官方一致的核对结论 | MODEL_PROPOSED，经 Agent 自审通过 |
| v1.2 | 2026-11-19 | 先脱敏后裁剪，实际回合显式传递根句柄，区分 OTLP 与平台回查字段并收紧验收，补齐 Windows ACL 与有界后台发送。 | MODEL_PROPOSED，实施暂停 |
