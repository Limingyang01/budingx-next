# long-session-reliability · 长会话与数据可靠性 · 设计文档

- 需求 slug：`long-session-reliability`
- 已确认 SP：SP005 优化需求（USER_CONFIRMED，2026-11-19 用户会话）
- 版本：v1.0
- 状态：**待实施**（Agent 自审对象，自审通过即进入计划与实施）
- 材料来源：
  - 路线图 `docs/iteration-plan.md` SP005 行（USER_CONFIRMED）
  - `docs/reference-tui-replication-audit.md` §SP005 增补要点（USER_CONFIRMED）
  - 用户会话「/buding-sdd 开始SP005，做完后跑端到端的测试，测试过程你可以使用langfuse去看看测试的效果以及工具的调用是否合适，你在本地搭好langfuse的监测」— **USER_CONFIRMED**
  - 用户会话「测试完成后待我决定后再合入master分支」— **USER_CONFIRMED**（覆盖 2026-11-17 委托中的自动合入）
  - 参考仓只读审计 `skills/buding-sdd/references/reference-repo-inventory.md`（只读参考，未取源码）
  - 本仓既有实现：`src/core/session.ts`、`src/core/events.ts`、`src/core/normalize.ts`、`src/core/observability.ts`、`src/storage/{paths,atomic,permissions,config-store}.ts`、`src/plan/{store,serialize,host}.ts`、`src/exec/persist.ts`、`src/tui/runtime.ts`、`src/tui/commands.ts`、`src/observability/*`
- 身份区分：需求立项、四个功能目录与出口验收为 **USER_CONFIRMED**；AC 切分、模块划分、文件布局、契约形状、阈值参数为 **MODEL_PROPOSED**；本轮合入 master 的时机由用户决定（USER_CONFIRMED）。
- 关联：[需求 v0.1](../requirements.md)｜[STATUS](../STATUS.md)｜[实施计划](./plan.zh.md)｜[SP005 汇总](../../requirements-summary.md)

---

## 1. 背景与目标

### 1.1 前后行为

| | 当前（master `17afe34`） | 本轮目标 |
| --- | --- | --- |
| 会话历史 | **只在内存**：`Session.messages` 是进程内数组，进程结束即丢失 | 转录落盘 `~/.budingx/sessions/<sessionId>/`，新进程可按 ID 恢复并继续对话 |
| 上下文增长 | **无预算、无压缩**：历史无限累积直到 Provider 拒绝 | 按确定性阈值压缩历史，且**保留用户约束、当前计划与工具状态** |
| 失败表达 | 回合终态有 `outcome`/`error.class`/`error.code`，但**失败点不落盘**、长任务失败无跨进程可定位证据 | 失败位置（轮次/步骤/错误码）随转录保留；重试从失败点继续，不重复已确认完成的副作用 |
| 项目记忆 | **不存在**：没有项目级长期记忆，也没有会话隔离 | 项目级记忆按项目标识分区、原子持久化、跨进程可见、跨项目不串 |
| 会话管理 | 只能 `/clear` 清空当前会话 | 可列出会话（ID/标题/更新时间/轮次）、按 ID 恢复；未知 ID 明确报错 |
| 本机观测 | SP004 已有追踪端口与 OTLP 导出，但**本机无容器运行时** → 无法起真实 Langfuse | 交付**协议兼容的本地接收端**（开发期脚本，不进制品），可回查 `agent.run` → `model.request`/`tool.<name>` 层级与错误 |

### 1.2 目标（USER_CONFIRMED 出口验收逐条展开）

1. **压缩保留约束/计划/工具状态**（→ CB-01…CB-07）。
2. **跨进程恢复不盲重放副作用**（→ SR-01…SR-11、FR-06）。
3. **项目记忆/会话隔离、原子持久化、升级/备份和共享写入约束有 fixture 与真实进程证据**（→ PM-01…PM-08、SR-07…SR-11）。
4. **明确长任务失败原因**（→ FR-01…FR-08）。

### 1.3 明确排除

| 排除项 | 归属 | 理由 |
| --- | --- | --- |
| 会话分支 / rewind 文件历史快照（CAP-L4-02） | 后续轮次 | r5 排查的**建议**级；本轮先保证「恢复不盲重放」 |
| `auto-memory` 蒸馏链（CAP-L3-20） | — | 路由明确标为提议；参考仓自身亦为提议 |
| `/context` 彩色网格 UI（CAP-L2-19/CAP-L3-04） | SP006 | 本轮只交付**可查询的预算构成数据**与命令输出 |
| 成本/token 看板（CAP-L3-05） | SP007 / SP016 | 能力矩阵「诊断与性能」行 |
| 跨设备/多端同步 | SP008 | r6 已移出当前 SP |
| 后台任务句柄跨进程接管 | — | 后台进程不跨进程存活；本轮只恢复其输出与终态记录，不假装恢复活进程 |
| 真实 Langfuse 栈（Docker/WSL + postgres/clickhouse/redis/minio） | UNVERIFIED | 本机无容器运行时；交付协议兼容接收端作为观测手段（恢复条件见 §8.4） |

### 1.4 保留行为（不得回归）

- SP002：回合契约、事件联合类型、取消/排队/审批语义、错误码体系（`BUDINGX_*`）。
- SP003：权限三档与底线规则、检查点/撤销、工作区边界；写入被拒时磁盘不变。
- SP004：编码任务闭环、命令执行边界、计划/待办/追问、追踪端口契约（`src/core/observability.ts`）。
- SP004 可观测：追踪默认关闭、父子句柄显式传递、失败静默降级、正文显式 opt-in。
- **既有 `npm run test:unit` 全绿**（基线见 §12.4）。

---

## 2. 当前状态（事实标注）

### 2.1 已存在（经源码核对）

| 事实 | 位置 |
| --- | --- |
| `Session` 持有 `private readonly messages: Message[] = []`，**无任何持久化** | `src/core/session.ts` |
| `get history(): readonly Message[]` 只读暴露历史；`clearHistory()` 直接清空 | `src/core/session.ts:219`、`src/core/session.ts:603` |
| `buildRequest()` 直接 `normalizeForApi(this.messages, ...)` —— **无预算核算、无压缩** | `src/core/session.ts:778` |
| `finalize()` 在 `outcome==='error'` 时**移除本轮消息**（会话保持干净），`'cancelled'` 时按 `canRestore()` 决定移除或保留 `interrupt_mark` | `src/core/session.ts:1407` |
| `dispatchTools()` 工具失败以 `tool_result{isError:true}` 进入模型上下文，回合可继续 | `src/core/session.ts:1026` |
| 错误码体系 `ERROR_CODES`：provider 001–017 / core 001–006 / storage 001–004 / workspace 001–011 / permission 001–003 / exec 001–007 | `src/core/constants.ts` |
| `MAX_ITERATIONS = 32`、`TOOL_OUTPUT_CAP = 32768` | `src/core/constants.ts` |
| `normalizeForApi()` 会丢弃孤儿 tool_result、去重 tool_use id、为未完成调用补合成结果 | `src/core/normalize.ts` |
| `Tracer` 端口（`begin/end/setAttributes/setPayload`）无 IO，core 不依赖任何 `node:*` | `src/core/observability.ts` |
| 原子写 `writeJsonAtomic()`：临时文件 + fsync + rename，失败清理临时文件 | `src/storage/atomic.ts` |
| `PermissionsStore.load()` 的损坏隔离模式：解析失败 → 备份 + `corrupt=true` + 不启用规则 | `src/storage/permissions.ts` |
| `ConfigStore.load()` 的版本处理：版本更高 → 抛 `storageSchemaUnsupported`；版本更低 → 备份后迁移 | `src/storage/config-store.ts` |
| 数据根 `~/.budingx`（`os.homedir()`）、`backupPath(file)=file+'.bak'` | `src/storage/paths.ts` |
| 会话级产物目录 `~/.budingx/sessions/<sessionId>/tasks/<taskId>.out` | `src/exec/persist.ts` |
| 计划落盘 `~/.budingx/plans/<sessionId>/<planId>.md`，带 YAML frontmatter + 编号列表正文 | `src/plan/serialize.ts` |
| `PlanStore` 内存实现 + 可选 `filePath` 持久化；`Plan{approval, fingerprint?, approvedText?}` | `src/plan/store.ts` |
| `createAgentRuntime()` 组装 Session + 工具 + 权限 + 追踪；`setupTracing()` 读白名单 env | `src/tui/runtime.ts` |
| `runCommand()` 命令面：/help /config /models /model /permission /rules /diff /undo /denials /clear /exit | `src/tui/commands.ts` |
| OTLP 导出：POST `{base}/api/public/otel/v1/traces`，header `x-langfuse-ingestion-version: 4`，Basic 认证，3s 超时，失败静默 | `src/observability/exporter.ts` |
| `isValidBaseUrl()`：https 任意主机；http 仅 localhost/127.0.0.1/[::1] | `src/observability/runtime.ts` |

### 2.2 不存在（必须新建）

- 会话转录的写入/读取/恢复链路 — 拟新增 `src/storage/session-transcript.ts` + `src/storage/session-store.ts`
- 上下文预算核算与压缩器 — 拟新增 `src/core/context-budget.ts`
- 项目记忆存储 — 拟新增 `src/storage/project-memory.ts`
- 会话恢复在 TUI 的命令面（列表/恢复） — 拟新增 `src/tui/commands.ts` 扩展
- 本机协议兼容接收端 — 拟新增 `scripts/langfuse/local-receiver.mjs`（开发期脚本，不进制品）

### 2.3 假设（须在实施时验证）

- A-1：本机无 Docker、无 WSL 发行版（已实测：`docker` 不存在，`wsl -l -v` 只输出用法，3000/9090 无监听）→ **真实 Langfuse 栈本轮不可启动**，以协议兼容接收端替代，真实栈记 UNVERIFIED + 恢复条件。
- A-2：转录体积随会话增长，长会话需**行式追加**而非整文件重写，否则写放大严重（设计 §5.1）。
- A-3：`os.homedir()` 在本机解析为 `C:\Users\<user>\`（已由既有存储用例间接验证），本轮不硬编码盘符。

---

## 3. 方案总览：责任层与依赖

```text
┌──────────────────────────────────────────────────────────────┐
│ src/tui        Ink 宿主：/sessions 列表与恢复、/memory、/context │
│                （只消费事件与端口，不含业务判定）                 │
├──────────────────────────────────────────────────────────────┤
│ src/core       纯契约与状态机（无 IO）：                        │
│   context-budget.ts  预算核算、压缩计划、保留项、熔断（新）       │
│   session.ts         扩展：转录端口注入、压缩事件、失败落盘       │
│   events.ts          扩展：压缩/转录/记忆相关事件                │
├──────────────────────────────────────────────────────────────┤
│ src/storage    真实持久化：                                    │
│   session-transcript.ts  JSONL 行式转录：追加、读取、损坏跳过（新）│
│   session-store.ts       会话索引：列表、按 ID 恢复、并发写锁（新）│
│   project-memory.ts      项目级记忆：分区、原子写、损坏备份（新）  │
│   atomic.ts / paths.ts   复用：原子写与路径约定                    │
├──────────────────────────────────────────────────────────────┤
│ src/observability  既有追踪端口与 OTLP 导出（不改动业务语义）      │
└──────────────────────────────────────────────────────────────┘
```

**依赖规则（MODEL_PROPOSED）**

| 模块 | 允许依赖 | 禁止依赖 |
| --- | --- | --- |
| `src/core` | 纯类型 | 任何 `node:*` IO、UI 库、任何其他 `src/*` 模块（既有规则不变） |
| `src/storage` | `node:fs`、`node:os`、`node:path`、`node:crypto`、`../core/*` | `../tui/*`、UI 库 |
| `src/tui` | 全部 | — |

**关键判断：`core` 不做 IO**（既有模块边界脚本 `scripts/checks/module-boundaries.mjs` 的 `core` 条目禁止 `node:fs` 等）。因此转录与记忆**只能以端口注入** `core`：

- `Session` 接受可选 `transcript?: SessionTranscript` 端口（纯接口定义在 `src/core/`）。
- `src/storage/session-transcript.ts` 提供该端口的真实实现。
- 压缩发生在 `core`（纯计算，可单测），落盘发生在 `storage`。

这与 SP004 的 `Tracer` 端口、`CommandRunner` 端口、`PlanModeHost` 端口的处理方式一致。

---

## 4. 上下文预算与压缩（context-budget）

### 4.1 core 端口（拟新增 `src/core/context-budget.ts`）

```ts
/** 上下文预算的核算输入（纯数据）。 */
export type ContextBudgetInput = {
  /** 参与估算的消息（已归一化前的原始消息）。 */
  messages: Message[]
  /** 模型上下文窗口上限（token）。 */
  maxTokens: number
  /** 预留的输出 token。 */
  reservedOutputTokens?: number
  /** token 估算器：缺省用内置字符启发式。 */
  estimate?: (messages: Message[]) => number
}

/** 单条保留项：压缩后必须仍在上下文中的结构化事实。 */
export type PreservedItem = {
  kind: 'constraint' | 'plan' | 'tool_state'
  /** 稳定标识，便于断言与调试。 */
  id: string
  /** 注入回请求的文本。 */
  text: string
  /** 保留原因（可读）。 */
  reason: string
}

/** 一次压缩的结果。 */
export type CompactionResult = {
  /** 是否真的执行了压缩。 */
  compacted: boolean
  /** 压缩后参与请求的消息。 */
  messages: Message[]
  /** 被替换掉的原始消息数量。 */
  replacedCount: number
  /** 被替换掉的原始消息索引区间（闭区间）。 */
  replacedRange?: { from: number; to: number }
  /** 保留项。 */
  preserved: PreservedItem[]
  /** 压缩后估算长度。 */
  estimatedTokens: number
  /** 预算内是否达标。 */
  withinBudget: boolean
  /** 未能达标时的原因（模型可辨识枚举）。 */
  overflowReason?: 'single_message_too_large' | 'preserved_exceeds_budget' | 'no_compactable_range'
}

/** 压缩器端口：core 内部只持有纯函数实现。 */
export interface ContextBudgetManager {
  /** 核算当前请求的估算长度。 */
  estimate(input: ContextBudgetInput): number
  /** 尝试把历史压缩到预算内；幂等。 */
  compact(input: ContextBudgetInput, preserved: PreservedItem[]): CompactionResult
}
```

### 4.2 阈值公式（CB-05）

参考仓的阈值公式为 MODEL_PROPOSED 复刻对象，本轮采用**自定确定性公式**（行为等价：同样的输入必然得到同样的压缩决策）：

```
targetTokens   = maxTokens - reservedOutputTokens
triggerTokens  = floor(targetTokens * COMPACT_TRIGGER_RATIO)   // 0.85
compactFloor   = floor(targetTokens * COMPACT_FLOOR_RATIO)    // 0.60
```

- 估算长度 `<= triggerTokens`：**不压缩**（正常回合零成本）。
- 估算长度 `> triggerTokens`：进入压缩，目标压到 `<= compactFloor`，且**至少删掉一条最旧的非保留消息**。
- 压缩后仍 `> targetTokens`：判定 `withinBudget=false`，由调用方按 CB-06 显式失败。

### 4.3 保留项（CB-02 / CB-03 / R-01）

保留项**不来自文本摘要**，而是来自结构化状态（这是 R-01 的主要缓解）：

| kind | 来源 | 注入位置 |
| --- | --- | --- |
| `constraint` | 用户消息中显式标记的约束（用户输入包含「不要/禁止/必须/不要修改」等硬约束句式，或宿主通过 `SubmitOptions.context` 注入的约束） | 压缩后作为**独立 user 消息**注入，位于压缩边界之后、当前轮之前 |
| `plan` | `PlanModeHost.store.current()` 的当前计划（目标 + 步骤 + 批准状态） | 同上 |
| `tool_state` | 未完成/被压缩掉的工具调用摘要（工具名 + 结果状态，不含完整输出） | 同上 |

约束抽取规则（确定性，可单测）：从用户消息文本中匹配硬约束句式（`不要`、`禁止`、`不得`、`必须`、`只能`、`不允许`），提取所在**消息**的全文（而非碎片），保证语义完整；最多保留 8 条，超出按时间倒序保留最近的。

### 4.4 未完成工具调用（CB-04）

压缩边界必须落在**完整回合边界**上。如果边界之前存在只有 `tool_use` 而没有对应 `tool_result` 的调用，压缩器**不得**丢弃它，而是把它合成为显式的失败占位结果：

```ts
{ type: 'tool_result', callId: '<id>', isError: true, content: '[compacted] 该工具调用在上下文压缩前未完成，结果未知，请重新确认其状态。' }
```

该占位结果与 `src/core/normalize.ts` 已有行为一致（未完成调用补合成结果），区别是本轮**必须显式标记 `[compacted]`** 以便与「真实执行失败」区分，且**不得**伪造成功结果。

### 4.5 压缩事件（CB-01）

新增事件（`src/core/events.ts`）：

```ts
export type ContextCompactedEvent = {
  type: 'context_compacted'
  turnId: string
  /** 被替换掉的原始消息区间（闭区间）。 */
  replacedRange: { from: number; to: number }
  /** 被替换的消息条数。 */
  replacedCount: number
  /** 保留项摘要（不含长文本正文，避免观测膨胀）。 */
  preserved: { kind: PreservedItem['kind']; id: string; reason: string }[]
  /** 压缩前后的估算 token。 */
  estimatedBefore: number
  estimatedAfter: number
  /** 是否达到预算内。 */
  withinBudget: boolean
}
```

事件加入 `SessionEvent` 联合类型；TUI 渲染层可消费但**本轮不新增卡片**（可视化归 SP006）。

### 4.6 幂等与熔断（CB-07）

- **幂等**：对同一 `messages` 数组重复调用 `compact()` 结果一致；已压缩过的边界用 `context` 块上的合成标记（如 `[compacted]`）识别，重复压缩不产生新的替换区间。
- **熔断**：同一会话内**连续 3 次**压缩后仍未落入预算（`withinBudget=false`），本轮不再尝试第 4 次，直接以 `context_overflow` 类错误终止回合，并发出 `notice{level:'error', code:'context_overflow'}`（新增 `NoticeCode`）。

### 4.7 与既有错误码的关系

`ERROR_CODES` 新增两条（保持 `BUDINGX_*` 稳定性，新号顺延，不复用旧号）：

| 码 | 常量 | 含义 |
| --- | --- | --- |
| `BUDINGX_CORE_007` | `coreContextOverflow` | 压缩后仍超出上下文预算，回合以明确失败终止 |
| `BUDINGX_CORE_008` | `coreCompactionCircuitOpen` | 压缩熔断打开（连续失败达阈值） |

`ErrorClass` 已有 `'context_overflow'` 取值，无需修改。

---

## 5. 会话持久化与跨进程恢复（session-recovery）

### 5.1 转录文件布局（SR-01 / A-01 / A-02）

```
~/.budingx/sessions/<sessionId>/
  transcript.jsonl        # 行式转录（追加写）
  meta.json               # 会话元数据（原子写）
  writer.lock             # 写锁（并发写互斥）
  tasks/<taskId>.out      # 既有：后台任务输出（src/exec/persist.ts）
```

- `transcript.jsonl`：**每行一条 JSON 记录**，追加写（`O_APPEND`），单行写完即 `fsync`。
- 权限：POSIX `0o600`；Windows 使用「仅当前用户」的 ACL（参照 `scripts/langfuse/init-local.mjs` 的 `icacls /inheritance:r +grant:r *SID:(OI)(CI)F` 做法，抽出为 `src/storage/private-file.ts` 的 `restrictToCurrentUser()`）。
- `meta.json`：`{ sessionId, title, createdAt, updatedAt, turns, schemaVersion, permissionMode?, projectKey? }`，用既有 `writeJsonAtomic()` 写。
- **字段命名自定**（A-01 只要求「行式 + 父引用链 + 元数据追加枚举」的行为等价）。

### 5.2 转录记录形状

```ts
/** 转录 schema 版本；高于此值拒绝读取（SR-08）。 */
export const TRANSCRIPT_VERSION = 1

/** 一条转录记录（JSONL 一行）。 */
export type TranscriptRecord =
  | { v: number; type: 'session_started'; ts: number; sessionId: string; model?: string; baseUrlHost?: string }
  | { v: number; type: 'message'; ts: number; parentId?: string; id: string; role: 'user' | 'assistant' | 'tool'; blocks: unknown[] }
  | { v: number; type: 'turn'; ts: number; turnId: string; outcome: string; error?: { class: string; code: string; message: string; retryable: boolean }; usage?: { inputTokens?: number; outputTokens?: number } }
  | { v: number; type: 'tool_step'; ts: number; turnId: string; callId: string; name: string; status: 'completed' | 'failed' | 'needs_review'; detail?: string }
  | { v: number; type: 'note'; ts: number; turnId?: string; text: string }
```

- `parentId` 串成会话链（对应 A-01 的 `parentUuid`），本轮字段名自定。
- `tool_step.status` 三态是「恢复不盲重放」的核心（SR-03/SR-04）。

### 5.3 副作用步骤的状态机（SR-03 / SR-04 / FR-06）

工具调用一旦可能产生副作用（`capability !== 'read'`，或工具名在 `SIDE_EFFECT_TOOLS` 名单内），转录记录其终态：

| 情形 | `tool_step.status` | 恢复时的行为 |
| --- | --- | --- |
| 工具成功返回（exit code 0 / 写成功） | `completed` | **不重放**；恢复时标记为已完成 |
| 工具明确失败（exit code ≠ 0 / 被拒 / 返回错误） | `failed` | **不重放**（结果已知）；恢复时提示结果为失败 |
| 工具被中断 / 进程被杀 / 结果未知 | `needs_review` | **绝不自动重放**；恢复时以「需核对」提示用户，说明代价后由用户显式发起 |

判定「结果未知」的规则（确定性）：

1. 回合终态为 `cancelled` 且该 `tool_use` 没有对应 `tool_result` → `needs_review`。
2. 回合终态为 `error` 且该 `tool_use` 没有对应 `tool_result` → `needs_review`。
3. 进程在写转录期间被强杀（记录缺失）→ 读取时按「有 `tool_use` 无 `tool_result`」推断为 `needs_review`。

> 这是「不盲重放」的**机制性保证**：恢复路径**根本没有**「重新执行工具」的代码路径——恢复只重建消息历史与状态，工具执行永远发生在新一轮的用户请求中。

### 5.4 存储层（`src/storage/session-transcript.ts`，拟新增）

```ts
export type TranscriptWriteResult = { ok: true; bytesWritten: number } | { ok: false; code: string; message: string }

/** 转录端口（core 侧依赖此接口，storage 提供实现）。 */
export interface SessionTranscript {
  /** 追加一条记录（原子行写 + fsync）。 */
  append(record: TranscriptRecord): TranscriptWriteResult
  /** 读取全部记录；损坏行跳过并报告。 */
  read(): { records: TranscriptRecord[]; corruptedLines: number; schemaVersion?: number; unsupported: boolean }
  /** 会话目录绝对路径。 */
  directory(): string
}

/** 创建转录（真实实现，JSONL）。 */
export function createSessionTranscript(options: { sessionId: string; home?: string }): SessionTranscript
```

实现要点：

- **追加写**：`fs.appendFileSync(fd, line, 'utf8')` 后 `fsyncSync`；每条记录一行、以 `\n` 结尾。
- **损坏跳过（SR-07）**：读取时逐行 `JSON.parse`，解析失败的行**跳过并计数**，**原始文件不删不改**；返回 `corruptedLines`。
- **版本拒绝（SR-08）**：首条记录的 `v` 大于 `TRANSCRIPT_VERSION` → `read()` 返回 `unsupported: true` 且 `records: []`，**不覆写**。
- **权限（A-02）**：创建时 `chmod 0o600`（POSIX）；Windows 调用 `restrictToCurrentUser()`。
- **强杀可读（SR-09）**：行式 + 原子追加保证「最后一条完整记录」始终可解析；末尾半行被当作损坏行跳过。

### 5.5 会话索引与并发（SR-05 / SR-06 / SR-11）

`src/storage/session-store.ts`（拟新增）：

```ts
export type SessionSummary = {
  sessionId: string
  /** 标题：首条用户消息的前 60 字符。 */
  title: string
  createdAt: number
  updatedAt: number
  /** 完成的轮次数。 */
  turns: number
  /** 权限模式（恢复后沿用，不升权）。 */
  permissionMode?: string
}

export interface SessionStore {
  /** 列出会话（按 updatedAt 倒序）。 */
  list(): SessionSummary[]
  /** 按 ID 读取摘要；不存在返回 undefined（不静默新建）。 */
  summary(sessionId: string): SessionSummary | undefined
  /** 读取转录并重建消息历史。 */
  restore(sessionId: string): RestoreResult
  /** 取得某会话的写锁（并发写互斥）。 */
  acquire(sessionId: string): SessionLease
}

export type RestoreResult =
  | { status: 'restored'; messages: Message[]; summary: SessionSummary; pendingReview: { callId: string; name: string }[] }
  | { status: 'not_found' }
  | { status: 'unsupported_schema'; version: number }
  | { status: 'corrupt'; corruptedLines: number }
```

- **并发写（SR-11）**：每个会话目录下放 `writer.lock`（内容含 pid + 时间戳）。写入前尝试 `wx` 独占创建；已存在则检查 pid 是否存活（存活 → 明确拒绝并给出「另一个进程正在写该会话」错误；不存活 → 视为陈旧锁，**不静默删除**，需显式 `--force-unlock` 才清理）。避免交错损坏。
- **元数据与转录的一致性**：`meta.json` 用既有 `writeJsonAtomic()`；`updatedAt` 每次成功追加后更新（更新失败不视为致命，读取时以转录末条 ts 为准）。

### 5.6 core 侧接线（`src/core/session.ts`）

`SessionOptions` 新增：

```ts
/** 转录端口（可选；不注入则完全不做持久化，既有行为不变）。 */
transcript?: SessionTranscript
/** 项目标识（用于项目记忆分区；缺省表示无项目上下文）。 */
projectKey?: string
```

`Session` 内部新增：

- `private readonly transcript?: SessionTranscript`
- `private readonly preservedItems: PreservedItem[] = []`（保留项收集）
- `private compactionFailures = 0`（熔断计数）

行为变更（**均为增量，不改变既有回合语义**）：

1. `startTurn()`：开始时追加 `session_started`（仅会话首轮）或 `turn` 前置记录。
2. `buildRequest()`：在 `normalizeForApi()` **之前**调用压缩器（§4），若压缩发生则发出 `context_compacted` 事件。
3. `finalize()`：追加 `turn` 记录（终态 + 错误类 + 错误码 + usage），并为每个 `tool_use` 追加 `tool_step` 记录（三态）。
4. `clearHistory()`：追加 `note{text:'conversation_cleared'}`（不删除转录文件）。
5. 追加失败（FR-07）：**不得丢失回合结果**。策略：
   - 失败被**捕获**（不抛出到用户）→ 发出 `notice{level:'error', code:'storage_write_failed', text}`，回合结果仍然通过 `turn_finalized` 事件交付；
   - `turn_finalized` 事件仍携带 `error`（若原回合有错），另加 `persistenceError` 字段（新增，类型 `{ code: string; message: string }`），让宿主能区分「模型失败」与「落盘失败」。

### 5.7 跨进程恢复流程（SR-02 / SR-10）

新增 `src/storage/session-store.ts` 的 `restore()` 产出的 `messages` 直接作为 `Session` 的初始历史。`Session` 增加构造期入口：

```ts
/** 用恢复出的历史构造会话（不触发模型调用）。 */
export function createSession(options: SessionOptions & { history?: Message[] }): Session
```

- 恢复时**不重放任何工具**（§5.3 的机制性保证）。
- 恢复时若存在 `needs_review` 的 `tool_step`，会话发出 `notice{level:'warning', code:'recovery_needs_review', text}`，提示用户核对哪些步骤结果未知。
- **权限不升权（SR-10）**：恢复时把 `meta.json.permissionMode` 作为**上限**写入；当前进程已配置的权限模式更严格时保持更严格者。实现：`SessionOptions.permissionModeCeiling?`，由宿主从 `meta.json` 提供。

### 5.8 TUI 命令面（SR-05 / SR-06）

新增命令（`src/tui/commands.ts`）：

| 命令 | 行为 | AC |
| --- | --- | --- |
| `/sessions` | 列出本机会话（ID、标题、更新时间、轮次），纯文本输出 | SR-05 |
| `/resume <sessionId>` | 按 ID 恢复会话；**未知 ID 明确报错**（`<nonexistent>`），不静默新建 | SR-06 |
| `/context` | 输出当前上下文预算构成（消息数、估算 token、预算、保留项）——数据输出，网格 UI 归 SP006 | CB-05 / A-07 |
| `/memory` | 列出/写入当前项目记忆 | PM-01 / PM-03 |

`/resume` 需要宿主（`src/tui/runtime.ts` / `app.tsx`）重建 Session 实例：`createAgentRuntime()` 增加 `sessionId?` 与 `restoreHistory?` 参数，读写同一 `~/.budingx/sessions/<sessionId>/`。

---

## 6. 失败恢复与明确失败原因（failure-recovery）

### 6.1 失败分类（FR-01）

既有 `ErrorClass` 与 `ERROR_CODES` 已覆盖 provider 401/429/5xx/超时（`BUDINGX_PROVIDER_*`）。本轮的增量是**让失败事实可定位、可恢复**：

| 层 | 新增/复用 | 内容 |
| --- | --- | --- |
| 回合级 | 复用 `turn_finalized{outcome, error{class, code, message, retryable}}` | 已有；本轮保证 `error.code` **必填**（不得为空） |
| 步骤级 | 新增转录 `tool_step{status, detail}` | 哪个工具、什么状态 |
| 位置级 | 新增转录 `turn{turnId, outcome, error}` | 哪一轮、什么终态 |
| 跨轮级 | 转录 `note{text}` | 人工标记的检查点 |

**规则**：任何 `outcome === 'error'` 的回合，其 `error.code` 必须来自 `ERROR_CODES`（稳定 `BUDINGX_*`），不允许空串。既有 `src/core/session.ts` 的 provider 失败路径已经填 `ERROR_CODES.providerAborted` 等；本轮新增一条**兜底**：若 provider 抛出的错误没有可映射的码，统一落到新增的 `BUDINGX_PROVIDER_018` = `providerUnknown`。

### 6.2 失败点恢复（FR-06）

「重试从失败点继续，不重复已确认完成的副作用」的实现：

1. 转录里每个副作用工具都有终态（§5.3）。
2. 恢复会话时，`completed` 的副作用步骤在历史中以 `tool_result`（成功）存在；`failed` 的以 `tool_result{isError:true}` 存在；`needs_review` 的以**占位失败结果**存在（明确「结果未知」）。
3. 用户再次提交指令时，模型看到的历史里，**已完成的副作用已经是完成态**，不会重新发起同样的副作用；若用户主动要求重做，模型会发起新的工具调用（这是用户显式发起，符合「恢复不盲重放」）。
4. 因此「不重复」由**历史保真**保证，而非额外的去重逻辑。

### 6.3 上下文溢出恢复链（FR-08 / A-11 / CB-06）

参考仓的恢复链为：withhold error → drain/fold → 完整摘要 → 最后才释放。本轮采用**行为等价但更小**的链（MODEL_PROPOSED）：

```
provider 返回 context_overflow
  → ① 先 withhold（不把错误文本直接塞回上下文）
  → ② 触发一次压缩（§4）
  → ③ 压缩后在预算内 → 重试本次请求（最多 1 次）
  → ④ 压缩后仍超限 / 重试仍溢出 → 以 coreContextOverflow 明确失败终止回合
```

- 压缩熔断（连续 3 次失败）打开后，直接走 ④，不再重试。
- `prompt_too_long`（既有 `TurnOutcome`）与 `context_overflow` 区分：前者是**单条输入**过长（无法通过压缩解决），后者是**累积**过长（可压缩）。

### 6.4 工具失败进入上下文（FR-02 / FR-03）

既有行为已满足：`dispatchTools()` 对失败工具推 `tool_result{isError:true}`，回合继续（§2.1 已核对）。本轮只补两点：

1. **失败不被伪装为成功**：既有 `keepCancelArtifacts()` 对未完成调用推 `isError:true` 结果（已核对）。本轮新增断言用例锁定。
2. **超长输出截断标记（FR-03）**：既有 `TOOL_OUTPUT_CAP = 32768`。本轮要求截断时输出**必须含显式标记**（如 `… [truncated: N bytes omitted]`），并新增单测锁定标记存在（若既有实现已带标记，则只补测试）。

---

## 7. 项目记忆与会话隔离（project-memory）

### 7.1 位置与分区（PM-01 / PM-02 / PM-07）

```
~/.budingx/memory/
  projects/<projectKey>/
    MEMORY.md              # 项目级记忆（人类可读 Markdown）
  sessions/<sessionId>/
    MEMORY.md              # 会话级记忆
```

- `projectKey`：由工作区根绝对路径**规范化**后取哈希前 16 位 + 人类可读目录名（形如 `my-project-<hash>`），保证：①同一项目稳定；②不同项目不同分区（PM-02）；③路径合法（无盘符/冒号）。
- **会话级记忆与项目级记忆物理分离**（PM-07）：会话级只落在 `sessions/<sessionId>/`，项目级只落在 `projects/<projectKey>/`；读取项目级记忆**不包含**会话级，反之亦然。
- **主机约束**：用户数据只在 `~/.budingx`；**不写用户项目目录**（与 SP004 的「后台输出/计划/worktree 都不写用户项目目录」一致）。

### 7.2 记忆条目格式与上限（PM-08）

`MEMORY.md` 为 Markdown，按条目分节：

```markdown
## <entryId> · <title>
- created: <ISO 时间>
- scope: project | session

<正文>
```

- 条目上限：单条正文 `<= 20000` 字符；总条数 `<= 200`；超出时**明确拒绝并提示**（PM-08，不静默丢弃）。
- 条目 ID 用 `randomUUID()`。

### 7.3 凭据拒写与脱敏（PM-05）

写入前扫描正文：命中既有 `src/observability/redact.ts` 的 `CREDENTIAL_PATTERNS`（Bearer、`sk-`、`ghp_`、`AKIA`、`xox`、`AIza`、JWT、cookie、`key=value`）或 `SENSITIVE_KEY` 时，**拒绝写入**并返回明确错误（`memorySecretRejected`），**不做部分写入**。

> 说明：SP004 的 `redactValue()` 面向观测输出（脱敏后裁剪）；本轮对用户记忆采取**更强**策略（拒写），因为记忆会被后续回合当作上下文注入。

### 7.4 原子写与损坏隔离（PM-04 / PM-06）

- 写入：复用 `src/storage/atomic.ts` 的原子写模式 —— 但记忆是 Markdown，需要 `writeTextAtomic()`（**拟新增** `src/storage/atomic.ts` 的文本版本：临时文件 + fsync + rename）。
- 写入中途失败（注入失败）：原文件保持不变，**无半截文件**（PM-04）。
- 文件损坏（解析失败）：保留原文件 + 旁存 `.bak`（`backupPath()`）→ 报告损坏 → **不静默丢弃**（PM-06）。行为对齐 `src/storage/permissions.ts` 的 `load()` 模式。

### 7.5 读取与注入（PM-03 / CB-03）

- `readProjectMemory({ projectKey })` → 条目数组（跨进程可见，PM-03）。
- 注入：会话首轮构造请求时，把项目级记忆作为**独立 user 上下文块**注入（形如 `<project_memory source="...">`），**不占用**系统提示词位置，不影响压缩保留项语义。
- 记忆内容**不进入** `context_budget` 的「保留项」判定（它是每轮注入的上下文，不是历史）。

---

## 8. 本机观测（Langfuse 兼容接收端）

### 8.1 定位

本机**无 Docker、无 WSL 发行版**（A-1 已实测）→ SP004 的 `ops/langfuse/compose.yaml` 栈无法启动。本轮交付一个**协议兼容的本地接收端**（`scripts/langfuse/local-receiver.mjs`，**开发期脚本，不进 npm 制品、不被 TUI 依赖**），实现 SP004 已用到的三个接口：

| 接口 | 用途 | 对应真实 Langfuse |
| --- | --- | --- |
| `GET /api/public/health` | 健康检查 | 同名 |
| `POST /api/public/otel/v1/traces` | OTLP 摄入（Basic 认证） | 同名，header `x-langfuse-ingestion-version: 4` |
| `GET /api/public/v2/observations` | 观测查询（`traceId`/`sessionId`/`name`/`limit`/`page`/`fields`） | 同名 |
| `GET /api/public/projects` | 项目鉴权检查（供 `verify-agent.mjs` 用） | 同名 |

- 观测形状对齐 Langfuse v2：`{id, traceId, parentObservationId, name, type, startTime, endTime, level, statusMessage, sessionId, metadata:{outcome}, input, output}`。
- 数据落 `.runtime/langfuse/local-receiver/observations.json`（gitignored），1 秒间隔落盘 + 退出时落盘。
- **只读状态**：接收端只监听 `127.0.0.1`。

### 8.2 与既有工具链的兼容（OB-01）

既有 `scripts/langfuse/query-traces.mjs` 与 `scripts/langfuse/verify-agent.mjs` **不改一行代码**即可对接收端工作（已实测 `query-traces.mjs` 返回 `观测总数: 0 | trace 数: 0`）。这是本设计的**兼容判据**：接收端必须满足 SP004 工具链的隐含契约，而不是自造一套查询方式。

### 8.3 观测判据（OB-02 / OB-03 / OB-04）

| 判据 | 期望 |
| --- | --- |
| 根观测 | 每次回合**恰好 1 个** `agent.run`，`parentObservationId` 为空 |
| 子观测 | `model.request`、`tool.<name>` 的 `parentObservationId` 指向该根 |
| 会话一致 | 全部观测的 `session.id` 一致 |
| 工具名 | `tool.<name>` 的 `<name>` 与实际工具名一致（如 `tool.Read`） |
| 级别 | 工具失败 → ERROR；权限阻断 → WARNING；取消 → WARNING |
| 业务无关性 | 追踪关闭/接收端不可达时，回合业务结果完全一致（OB-04） |

### 8.4 真实 Langfuse 栈的 UNVERIFIED 与恢复条件

本轮**不**验证真实 Langfuse（Docker/WSL 栈）。恢复条件（写进 test-report）：

1. 安装 Docker Desktop 或 WSL2 + 一个 Linux 发行版；
2. `node scripts/langfuse/init-local.mjs` 生成 `.runtime/langfuse/`；
3. `scripts/langfuse/control.ps1 -Action start`（或 `docker compose -f ops/langfuse/compose.yaml up -d`）；
4. `node scripts/langfuse/verify-agent.mjs` 通过。

---

## 9. 对参考实现的对照与有意偏离

| 锚点 | 参考行为 | 本轮 | 偏离理由 |
| --- | --- | --- | --- |
| A-01 | JSONL + `parentUuid` 链 + 元数据追加枚举 | **等价**：自有 JSONL 行式转录 + `parentId` 链 + 元数据追加 | 字段名自定，不抄结构 |
| A-02 | 权限 0o600 | **等价**：POSIX 0600 + Windows 当前用户 ACL | 平台差异 |
| A-03 | 原子写 + 备份 + 坏文件隔离 + 升级锁 + 11 项迁移 | **等价**：复用本仓 `writeJsonAtomic` + `.bak` 模式 + 版本拒绝；迁移链本轮为 v1（无迁移） | 迁移在有 v2 时再补 |
| A-04 | resume 选择器 + CLI 旗标族 | **部分等价**：本轮只做 `/sessions` + `/resume <id>`；选择器 UI 与旗标族归 SP006/SP008 | r5 列为增补项，本轮不铺 UI |
| A-05 | rewind 快照 + diff 预览 | **排除** | 路线图列为建议级 |
| A-06 | compact 阈值 + 三型微压缩 + 熔断 + preserved + 边界 ack | **等价（简化）**：自定阈值公式 + 结构化保留项 + 熔断（≥3）+ 边界事件 `context_compacted` | 「三型微压缩」依赖参考仓的投影/摘要机制，本轮以结构化保留项替代，保证约束/计划/工具状态不丢 |
| A-07 | `/context` 网格 | **部分等价**：本轮交付 `/context` 数据输出，网格 UI 归 SP006 | UI 属 SP006 P0 |
| A-08 | 记忆三级 + `@import` | **等价（简化）**：项目级 + 会话级两级 + 原子持久化 + 隔离；`@import` 展开列为可选增强 | 三级层次非本轮门槛 |
| A-09 | auto-memory 蒸馏链 | **排除** | 提议级 |
| A-10 | 恢复时先核对不确定结果 | **等价**：`needs_review` 三态 + 恢复提示 | — |
| A-11 | 溢出恢复链 withhold→drain/fold→summary→release | **等价（简化）**：withhold→压缩→重试≤1→明确失败 | 摘要/折叠依赖参考仓摘要链，本轮以压缩替代 |

---

## 10. 变更集

### 10.1 拟新增文件

| 路径 | 职责 |
| --- | --- |
| `src/core/context-budget.ts` | 预算核算、压缩器、保留项类型（纯逻辑） |
| `src/storage/session-transcript.ts` | JSONL 转录：追加、读取、损坏跳过、版本拒绝、私有权限 |
| `src/storage/session-store.ts` | 会话索引、列表、恢复、写锁 |
| `src/storage/project-memory.ts` | 项目/会话级记忆：读写、原子写、损坏备份、凭据拒写 |
| `src/storage/private-file.ts` | 私有权限设置（POSIX 0600 / Windows 当前用户 ACL） |
| `src/core/test/context-budget.test.mjs` | CB-01…CB-07 单测 |
| `src/storage/test/session-transcript.test.mjs` | SR-01/07/08/09 单测 + fixture |
| `src/storage/test/session-store.test.mjs` | SR-05/06/11 单测 |
| `src/storage/test/project-memory.test.mjs` | PM-01…PM-08 单测 |
| `src/tui/test/session-recovery.test.mjs` | SR-02/03/04/10 端到端（真实进程） |
| `src/tui/test/long-session-e2e.test.mjs` | 端到端主场景 + Langfuse 观测断言（OB-02/03/04） |
| `scripts/langfuse/local-receiver.mjs` | 本机协议兼容接收端 |
| `scripts/langfuse/local-receiver.test.mjs` | 接收端单测 |
| `scripts/langfuse/run-local-receiver.mjs` | 启动脚本（读取 `.runtime/langfuse/agent.env`） |

### 10.2 拟修改文件

| 路径 | 改动 |
| --- | --- |
| `src/core/events.ts` | 新增 `context_compacted` 事件；`turn_finalized` 增 `persistenceError?`；`NoticeCode` 增 `context_overflow`/`storage_write_failed`/`recovery_needs_review` |
| `src/core/constants.ts` | 新增 `BUDINGX_CORE_007`/`BUDINGX_CORE_008`/`BUDINGX_PROVIDER_018`/`BUDINGX_STORAGE_005` |
| `src/core/session.ts` | 注入 `transcript` 端口；压缩接入 `buildRequest()`；`finalize()` 落盘；恢复入口；失败码兜底 |
| `src/core/index.ts` | 导出 `context-budget.js` |
| `src/storage/atomic.ts` | 新增 `writeTextAtomic()` |
| `src/storage/index.ts` | 导出新模块 |
| `src/tui/runtime.ts` | `createAgentRuntime()` 增 `sessionId?`/`restore?`；接线 transcript/memory |
| `src/tui/commands.ts` | 新增 `/sessions`、`/resume`、`/context`、`/memory` |
| `src/tui/app.tsx` | 渲染 `context_compacted` 通知与新命令帮助 |
| `scripts/checks/module-boundaries.mjs` | 确认 `core` 规则仍覆盖新增文件（本轮不新增顶层模块，无需新规则） |
| `package.json` | 新增脚本 `langfuse:local`（启动接收端）；测试脚本纳入新测试目录 |
| `PRODUCT.md` | 用户可见行为变化（新命令、新数据路径、限制）必须同步 |
| `docs/iteration-plan.md` / `docs/agent-capability-matrix.md` | SP005 状态回写 |

### 10.3 不改动

- `src/workspace/*`、`src/exec/*`、`src/git/*`、`src/plan/*`、`src/provider/*`、`src/observability/*`（除新增事件类型的使用方）。
- `ops/langfuse/compose.yaml`（真实栈资产保留，作为 UNVERIFIED 的恢复路径）。

### 10.4 依赖与材料来源

| 材料 | 来源 | 许可 | 处理决定 |
| --- | --- | --- | --- |
| 参考仓 Langfuse/compose/脚本 | 本地 `budingWorkerSpace`（只读） | 未开源（无 LICENSE） | **只读机制理解**，不复制代码；本轮接收端为自写实现 |
| 参考仓压缩/记忆/恢复机制 | 同上 | 同上 | 同上；行为等价不逐字照抄 |
| `writeJsonAtomic` 原子写模式 | 本仓 `src/storage/atomic.ts` | 自有 | 直接复用 |
| `PermissionsStore.load()` 损坏隔离模式 | 本仓 `src/storage/permissions.ts` | 自有 | 模式复用（借鉴结构，不搬代码） |
| `redactValue` 凭据模式 | 本仓 `src/observability/redact.ts` | 自有 | 复用模式常量用于记忆拒写 |

---

## 11. 验收条件（AC → 责任层映射）

| AC | 承载章节 | 主要责任层 | 验证层 |
| --- | --- | --- | --- |
| CB-01…CB-07 | §4 | `src/core/context-budget.ts` + `src/core/session.ts` | 单元 + 端到端 |
| SR-01…SR-11 | §5 | `src/storage/session-transcript.ts` + `session-store.ts` + `core/session.ts` | 单元 + 真实进程 |
| FR-01…FR-08 | §6 | `core/session.ts`（既有）+ 转录落盘 | 单元 + 端到端 |
| PM-01…PM-08 | §7 | `src/storage/project-memory.ts` | 单元 + 真实进程 |
| OB-01…OB-04 | §8 | `scripts/langfuse/local-receiver.mjs` + 既有 `src/observability` | 单元 + 真实进程 |
| EV-01…EV-03 | §12 | 交付记录 | 端到端 + 门禁 |

---

## 12. 风险与开放项

### 12.1 风险

| ID | 风险 | 缓解 |
| --- | --- | --- |
| R-01 | 压缩丢关键约束 | 保留项来自**结构化状态**而非文本摘要（§4.3），单测锁定 |
| R-02 | 恢复误重放副作用 | `tool_step` 三态 + 恢复路径**无重放代码路径**（§5.3） |
| R-03 | 并发写交错损坏 | 写锁 + 原子行追加（§5.5） |
| R-04 | schema 升级覆盖用户数据 | 版本更高 → 只读拒绝；未知字段保留（§5.4） |
| R-05 | 观测端成为新依赖 | 默认关闭、失败静默、接收端不进制品（§8） |
| R-06 | 端到端消耗真实模型额度 | 受 `BUDINGX_E2E_MAX_REQUESTS=6`/预算约束，场景数固定 |
| R-07 | 跨项目记忆污染 | `projectKey` 分区 + 专门 AC（PM-02/PM-07） |
| R-08 | 转录无限增长 | 本轮不实现归档/轮转（明确记为已知限制） |

### 12.2 开放项

| ID | 问题 | 处理 |
| --- | --- | --- |
| O-01 | 转录的 `turn` 记录是否需要包含 usage 会话级累计 | 本轮按回合记录 usage（§5.2），不做会话级累计 |
| O-02 | `/context` 输出格式 | 本轮输出确定性文本行；网格 UI 归 SP006 |
| O-03 | 记忆条目上限的具体数值（20000 字符 / 200 条） | MODEL_PROPOSED，可后续调整，测试只断言「超限被明确拒绝」 |

### 12.3 已知限制（本轮明确不做）

- 转录不归档、不轮转；长时间运行会持续增长。
- 不支持从转录**回滚**工作区文件（rewind 排除）。
- 记忆无版本历史、无导入导出。
- 真实 Langfuse 栈未在本机验证（§8.4）。

### 12.4 实施前重核（进入实施前必须确认）

- master 与分支基线 SHA、`git status --short` 干净。
- `npm run test:unit` 基线计数（作为回归下限）。
- `npm run spec:check`、`npm run test:checks` 通过。
- 本机 Node 版本 ≥ 22.18、真实模型可用（`.env.e2e.local`）、接收端可启动。
- **合入 master 的时机由用户决定**（USER_CONFIRMED，2026-11-19）。

---

## 13. 自审记录

| 检查项 | 结论 |
| --- | --- |
| 是否覆盖全部 AC | 是。CB/SR/FR/PM/OB/EV 六组 AC 均在 §11 有承载章节与验证层 |
| 是否突破模块边界 | 否。core 保持无 IO，转录/记忆以端口注入；不新增顶层模块 |
| 是否复用既有模式 | 是。原子写、损坏隔离、`ERROR_CODES`、事件联合、追踪端口全部复用 |
| 是否与用户指令一致 | 是。「本地搭好 langfuse 的监测」→ §8 本地接收端；「合入 master 待我决定」→ §12.4/交付记录约束 |
| 是否独立实现 | 是。仅只读参考仓行为事实，未取源码、提示词、内部类型或 bundle |
| 是否有未验证项 | 有：真实 Langfuse 栈、真实终端像素对照、npm 安装包核验 —— 在 test-report §5 列恢复条件 |
| 自审结论 | **通过**，进入实施计划（plan.zh.md） |

---

## 14. 版本记录

| 版本 | 日期 | 变化 |
| --- | --- | --- |
| v1.0 | 2026-11-19 | 首版：四个功能目录的方案、契约、AC 映射、风险与自审 |

### 4.8 未完成占位的配对要求（CB-04 实现补充，2026-11-19）

实现中发现：把未完成工具调用合成为占位结果后，如果**对应的 tool_use 随压缩区间一起被丢弃**，normalizeForApi 会把失去配对的 tool_result 一并跳过，模型实际**看不到**任何占位——等于静默丢失「结果未知」这一事实。

因此压缩器必须**成对搬运**：被丢弃区间内存在未完成调用的 tool_use 时，连同其合成占位 tool_result 一起保留到压缩边界之后，且 tool_result 紧跟在 tool_use 之后。验证用例见 src/core/test/context-budget.e2e.test.mjs（CB-01/02/03/04，真实 HTTP 请求体断言）。

---

## 8. 工具空转熔断（FR-09，实现期增补）

### 8.1 问题（真实模型观测证据）

本地 Langfuse 兼容接收端记录的两次真实模型回合：

| 观测 | 结果 |
| --- | --- |
| 正常回合 | 4 条 observation（agent.run + model.request + tool.Read + model.request），层级与工具名正确 |
| 工具失败回合（仅精确签名熔断） | 67 条 observation，其中 **55 条 tool.Read 均为 ERROR**，直到 max_iterations 才终止 |

模型并没有「重复同一个调用」，而是不断**换参数**（missing-sp005.txt、./missing-sp005.txt、data/...、src/...、docs/...、missing-sp005.md、.、/）去撞同一个失败工具。只按「工具名 + 参数」精确签名计数的熔断因此永远抓不到，回合被浪费在无进展的重试上。

### 8.2 两级熔断（src/core/session.ts dispatchTools）

| 层级 | 计数器 | 阈值常量 | 抓什么 |
| --- | --- | --- | --- |
| 精确重复 | repeatedToolFailures（键 = 工具名 + 参数序列化） | MAX_REPEATED_TOOL_FAILURES = 3 | 原样重试同一个调用 |
| 连续失败 | toolFailureStreaks（键 = 工具名 + 错误码） | MAX_TOOL_FAILURE_STREAK = 5 | 换参数瞎试同一个失败工具 |

任一层到阈值即：结束该工具 observation（error）、写入 tool_step 记录、向模型推入带 BUDINGX_CORE_010（coreToolLoopDetected）的结果，并让回合以 error 终态结束（retryable: false）。任一成功调用会清空两个计数器。

**语义说明**：熔断导致回合以错误结束，finalize 按既有设计回滚本轮消息，所以熔断原因只落在**转录**与 turn_finalized.error 中，不会进入模型上下文。这是有意的：熔断的本意就是终止这次无进展的回合，而不是继续对话。

### 8.3 新增错误码

| 码 | 常量 | 含义 |
| --- | --- | --- |
| BUDINGX_CORE_010 | coreToolLoopDetected | 同一工具连续失败达阈值，判定为空转并终止回合 |

### 8.4 验证

- src/core/test/tool-loop-breaker.test.mjs（4 例）：精确重复熔断、熔断原因落转录且出现在 turn_finalized.error、成功过的调用不计入、换参数同错误码熔断。
- scripts/langfuse/sp005-observation.e2e.test.mjs（3 例）：真实 HTTP + 真实追踪 + 真实接收端，验证失败工具为 ERROR 且熔断发生在 maxIterations 之前。
