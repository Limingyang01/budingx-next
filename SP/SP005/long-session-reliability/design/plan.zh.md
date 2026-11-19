# SP005 实施计划：长会话与数据可靠性

- 需求目录：`SP/SP005/long-session-reliability/`
- 已确认 SP：SP005（长会话与数据可靠性）
- 依据：`SP/SP005/long-session-reliability/design/design.zh.md` v1.0
- 分支：`feature/SP005/long-session-reliability`
- 文档起点 SHA：`17afe34`（master）
- 核对 master SHA：`17afe34`
- 版本：v1.0
- 状态：draft

> **执行方式**：本计划由 Agent 自行执行。每个任务按「设计 → AC → 依赖 → 文件 → 产出 → RED → GREEN → 验证 → 完成事实」推进；**RED 用例必须先失败**，再写最小实现使其转绿。`完成事实` 一栏**不预填**，实现完成后由实际执行结果回填。

## Goal

在 TUI 单端范围内交付 SP005 的四个功能目录：

1. **context-budget**：上下文预算核算与压缩，压缩后**保留用户约束、已批准计划、未完成工具状态**，压缩结果可观察。
2. **session-recovery**：会话转录持久化到 `~/.budingx/sessions/<sessionId>/`，跨进程恢复历史与状态，**恢复不盲重放副作用**，并发写互斥，损坏/版本升级不覆盖用户数据。
3. **failure-recovery**：长任务失败有**明确原因**（稳定错误码 + 类别 + 位置），失败点可恢复，已确认副作用不重复。
4. **project-memory**：项目级/会话级记忆，路径隔离、原子持久化、跨进程可见、凭据拒写、损坏隔离。
5. **观测**：本机 Langfuse 协议兼容接收端，使端到端可回查「效果」与「工具调用是否合适」。

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ src/tui (UI 层)                                             │
│  runtime.ts ── 注入 sessionId / restore / transcript / mem  │
│  commands.ts ── /sessions /resume /context /memory          │
│  app.tsx ── 渲染 context_compacted / recovery 通知           │
└───────────────┬─────────────────────────────────────────────┘
                │ 端口注入（core 不做 IO）
┌───────────────▼─────────────────────────────────────────────┐
│ src/core (纯逻辑)                                           │
│  context-budget.ts (新)  预算/压缩/保留项                    │
│  session.ts (改)          压缩接线、落盘、失败码、恢复入口    │
│  events.ts (改) / constants.ts (改)                          │
└───────────────┬─────────────────────────────────────────────┘
                │ 端口实现（真实 IO）
┌───────────────▼─────────────────────────────────────────────┐
│ src/storage (真实 IO)                                       │
│  session-transcript.ts (新) JSONL 转录                      │
│  session-store.ts (新)      列表/恢复/写锁                   │
│  project-memory.ts (新)     项目/会话记忆                    │
│  private-file.ts (新)       私有权限                        │
│  atomic.ts (改)             writeTextAtomic                 │
└─────────────────────────────────────────────────────────────┘

观测旁路（不进制品）：scripts/langfuse/local-receiver.mjs
```

依赖规则：

- `core` 不得 import `storage` / `provider` / `tui` / `exec`（`scripts/checks/module-boundaries.mjs` 既有规则继续生效，本轮**不新增顶层模块**）。
- `core` 只依赖 `SessionTranscript` 这类**接口**，实现放在 `storage`。
- `storage` 不依赖 `core` 的运行时实现（只复用 `Message` 类型 ⇒ 类型层 import 需检查边界脚本是否允许；若不允许，则在 `core` 侧定义最小可序列化形状，由 `storage` 用结构化类型承接）。

## Spec（权威来源）

- 设计文档：`SP/SP005/long-session-reliability/design/design.zh.md` v1.0（§4 上下文预算、§5 会话持久化与恢复、§6 失败恢复、§7 项目记忆、§8 本机观测）。
- 需求文档：`SP/SP005/long-session-reliability/requirements.md`（AC：CB-01…07 / SR-01…11 / FR-01…08 / PM-01…08 / OB-01…04 / EV-01…03）。

## Global Constraints

1. `core` 保持**零 IO**（不 import `node:fs`/`node:http` 等），持久化一律以端口注入。
2. 用户数据只在 `~/.budingx`（`os.homedir()` 解析），**永不读写 `~/.claude`**，**不写用户项目目录**。
3. 写入一律「临时文件 + fsync + rename」原子替换；失败时**原文件不变**并保留 `.bak`。
4. 恢复路径**不得**包含重新执行工具的代码路径；不确定结果的步骤标记 `needs_review`，交由用户核对后显式发起。
5. 恢复**不升权**：会话历史中的权限模式只作为上限，与当前更严格者取交集。
6. 任何 `outcome==='error'` 的回合必须带**非空稳定错误码**（`ERROR_CODES` 的 `BUDINGX_*`），不得为空串。
7. 追踪默认关闭；观测端不可达时**业务结果必须一致**；观测**不得**记录密钥（复用 `redactValue`）。
8. 压缩保留项来自**结构化状态**（用户约束消息 / 已批准计划 / 未完成工具调用），不得用文本摘要替代。
9. 不得用「零测试」冒充通过；每条 AC 至少各有一例单元 + 一例端到端。
10. 所有新增源码遵循仓库风格：ESM、无分号、2 空格、UTF-8；TypeScript 用 `strict` 现有配置。
11. **合入 master 的时机由用户决定**（USER_CONFIRMED，2026-11-19）：本轮只提交到 feature 分支。
12. 参考仓只读：仅理解行为事实，不复制源码/提示词/内部类型；本轮所有实现自写。

## Review Focus（评审重点）

1. `core` 是否仍然零 IO（门禁脚本须 GREEN）。
2. 恢复路径是否存在任何「隐式重放副作用」的路径。
3. 压缩是否可能丢失用户约束/已批准计划/未完成工具状态（必须有单测锁定）。
4. 写入失败时是否**丢失了回合结果**（结果必须仍然交付，并带 `persistenceError`）。
5. 并发写是否会交错损坏转录。
6. 记忆是否可能跨项目/跨会话泄漏或写入用户项目目录。
7. 观测是否在关闭/不可达时完全无副作用。
8. 是否出现 `as any`、空 catch、`// @ts-ignore` 之类降级手段。

## 任务清单

### T0 · 实施前重核

- **设计**：§12.4
- **AC**：全部（前置）
- **依赖**：无
- **Create**：无
- **Modify**：无
- **Consumes**：`git status --short`、分支、master SHA
- **Produces**：确认的实施基线（SHA + 基线测试计数）
- **RED**：不适用
- **GREEN**：不适用
- **验证**：`git status --short`（干净）；`git rev-parse HEAD`；`npm run test:unit` 基线计数；`npm run spec:check`；`npm run test:checks`
- **完成事实**：基线 master 17afe34；`npm run build` GREEN、`npm run test:checks` 通过、全量单元测试通过；从 master 建分支 feature/SP005/long-session-reliability。

### T1 · core 侧端口与事件/错误码扩展

- **设计**：§4.5、§5.6、§6.1、§10.2
- **AC**：CB-01（事件）、FR-01（错误码非空）、FR-07（`persistenceError`）
- **依赖**：T0
- **Create**：`src/core/context-budget.ts`（仅类型骨架，算法在 T2）
- **Modify**：`src/core/events.ts`（`context_compacted` 事件、`turn_finalized.persistenceError`、`NoticeCode` 新增 `context_overflow`/`storage_write_failed`/`recovery_needs_review`）、`src/core/constants.ts`（`BUDINGX_CORE_007 coreContextOverflow`、`BUDINGX_CORE_008 coreCompactionCircuitOpen`、`BUDINGX_PROVIDER_018 providerUnknown`、`BUDINGX_STORAGE_005 storageWriteFailed`）、`src/core/index.ts`（导出）
- **Consumes**：现有 `SessionEvent` 联合、`ERROR_CODES`、`NoticeCode`
- **Produces**：可被 session/transcript 使用的类型与码
- **RED**：`node --test src/core/test/events-contracts.test.mjs` 断言新事件可构造且联合类型包含新成员；断言新错误码存在且唯一
- **GREEN**：补齐类型与常量
- **验证**：`npm run build` 通过；`node --test src/core/test/*.test.mjs` 无回归
- **完成事实**：`src/core/transcript.ts`（SessionTranscript 端口 + 记录类型）、`src/core/events.ts` 新增 `context_compacted` 事件与 `TurnFinalizedEvent.persistenceError`、`src/core/constants.ts` 新增 `coreContextOverflow:/BUDINGX_CORE_007`、`coreCompactionCircuitOpen:/BUDINGX_CORE_008`、`coreRecoveryNeedsReview:/BUDINGX_CORE_009`、`coreToolLoopDetected:/BUDINGX_CORE_010`、`storageWriteFailed:/BUDINGX_STORAGE_005`、`storageSessionLocked:/BUDINGX_STORAGE_006`。GREEN：`npm run build` 通过；后续用例直接断言这些码。

### T2 · 上下文预算与压缩器（纯逻辑）

- **设计**：§4.1–§4.6
- **AC**：CB-02…CB-07
- **依赖**：T1
- **Create**：`src/core/context-budget.ts`（完整实现）、`src/core/test/context-budget.test.mjs`
- **Modify**：无
- **Consumes**：`Message`/`MessageBlock`（core 内）、`PreservedItem` 定义
- **Produces**：`ContextBudgetManager{estimate,compact}`，阈值公式、保留项抽取、未完成工具占位、幂等、熔断计数支持
- **RED**：先写失败用例：①未超阈值不压缩；②超阈值压缩后 `estimatedTokens <= compactFloor`；③约束消息在压缩后仍存在；④计划文本在压缩后仍存在；⑤未完成 `tool_use` 变为 `isError:true` 且内容含 `[compacted]`；⑥重复 compact 结果一致（幂等）；⑦压缩后仍超限 → `withinBudget=false` + `overflowReason` 非空；⑧保留项上限（最多 8 条约束，取最近）
- **GREEN**：实现 `estimate`（字符启发式：CJK 按 1 char/1 token 近似，ASCII 按 4 chars/token）+ `compact`（从最旧起删非保留消息，落在回合边界，未完成 tool_use 合成为 `[compacted]` 占位）
- **验证**：`node --test src/core/test/context-budget.test.mjs`
- **完成事实**：`src/core/context-budget.ts` + `src/core/test/context-budget.test.mjs` 11/11；端到端 `src/core/test/context-budget.e2e.test.mjs` 3/3（CB-01…CB-04 在真实 HTTP 请求体里断言约束、计划、未完成工具占位）。实现期发现并修复：占位 `tool_result` 若与被丢弃的 `tool_use` 分离会被 `normalizeForApi` 跳过 ⇒ 改为成对搬运（设计 §4.8）。

### T3 · 会话转录存储（JSONL）

- **设计**：§5.1–§5.4
- **AC**：SR-01、SR-07、SR-08、SR-09
- **依赖**：T1
- **Create**：`src/storage/session-transcript.ts`、`src/storage/private-file.ts`、`src/storage/test/session-transcript.test.mjs`
- **Modify**：`src/storage/index.ts`（导出）
- **Consumes**：`src/storage/paths.ts`（`dataRoot`/`backupPath`）、`src/storage/atomic.ts`（原子写模式）
- **Produces**：`TRANSCRIPT_VERSION`、`TranscriptRecord` 联合、`createSessionTranscript({sessionId,home?})` → `SessionTranscript{append,read,directory}`
- **RED**：①新会话目录在 `~/.budingx/sessions/<id>/`；②append 后 read 顺序一致；③写入半行损坏 → `read()` 跳过该行、`corruptedLines===1`、原文件未被改写；④`v` 大于 `TRANSCRIPT_VERSION` → `unsupported:true` 且 `records:[]`、文件未被覆写；⑤POSIX 下文件权限 0600；⑥追加是行式且以 `\n` 结尾
- **GREEN**：实现 `append`（`appendFileSync` + `fsyncSync`）、`read`（逐行解析 + 跳过计数）、版本拒绝、`restrictToCurrentUser()`
- **验证**：`node --test src/storage/test/session-transcript.test.mjs`
- **完成事实**：`src/storage/session-transcript.ts` + `src/storage/test/session-transcript.test.mjs` 12/12（SR-01、SR-07 半截行、SR-08 版本过高、SR-09 强杀后无半截、SR-11 写锁）。

### T4 · 会话索引、恢复与写锁

- **设计**：§5.5、§5.7
- **AC**：SR-05、SR-06、SR-10、SR-11
- **依赖**：T3
- **Create**：`src/storage/session-store.ts`、`src/storage/test/session-store.test.mjs`
- **Modify**：无
- **Consumes**：`createSessionTranscript`、`writeJsonAtomic`、转录记录类型
- **Produces**：`SessionSummary`、`SessionStore{list,summary,restore,acquire}`、`RestoreResult`（restored/not_found/unsupported_schema/corrupt）、`SessionLease`
- **RED**：①列表按 `updatedAt` 倒序、含 title/turns；②未知 ID → `not_found`；③版本不支持 → `unsupported_schema`；④损坏 → `corrupt` 且原文件保留；⑤同时 `acquire` 同一会话 → 第二次被拒（明确错误）；⑥陈旧锁（pid 不存在）不被静默删除，需显式 `forceUnlock`
- **GREEN**：实现 list/summary/restore/acquire（`wx` 独占创建锁文件、pid 存活检测）
- **验证**：`node --test src/storage/test/session-store.test.mjs`
- **完成事实**：`src/storage/session-store.ts`（索引、恢复、写锁、陈旧锁显式解锁）+ `src/storage/private-file.ts`（0600 权限）。SR-05/SR-06/SR-10/SR-11 由 session-transcript 与 sp005-commands 用例覆盖。

### T5 · 项目记忆（读写、原子、拒写、损坏隔离）

- **设计**：§7
- **AC**：PM-01…PM-08
- **依赖**：T3（原子写与私有权限）
- **Create**：`src/storage/project-memory.ts`、`src/storage/test/project-memory.test.mjs`
- **Modify**：`src/storage/atomic.ts`（新增 `writeTextAtomic`）、`src/storage/index.ts`（导出）
- **Consumes**：`src/observability/redact.ts` 的凭据模式常量、`backupPath()`、`dataRoot()`
- **Produces**：`projectKeyFor(root)`、`readProjectMemory`/`writeProjectMemory`/`readSessionMemory`/`writeSessionMemory`、条目解析与上限、凭据拒写
- **RED**：①项目级与会话级目录物理分离；②不同项目 key 不同；③跨进程（另起 node 进程读）可见；④写入中途失败 → 原文件不变；⑤含 `sk-`/`Bearer` 的正文 → 拒绝写入且无部分写入；⑥损坏文件 → 保留原文件 + `.bak` + 报告；⑦会话级不进入项目级读取结果；⑧超长条目/超条数 → 明确拒绝
- **GREEN**：实现条目读写、解析、上限、拒写、备份恢复
- **验证**：`node --test src/storage/test/project-memory.test.mjs`
- **完成事实**：`src/storage/project-memory.ts` + `src/storage/test/project-memory.test.mjs` 12/12（PM-01…PM-08：项目隔离、原子写、凭据拒写、`.bak` 保留、会话级隔离、上限）。

### T6 · Session 接线：压缩、落盘、失败码、恢复入口

- **设计**：§4.6、§5.6、§5.7、§6.1、§6.3
- **AC**：CB-01、CB-06、CB-07、SR-02、SR-03、SR-04、FR-01、FR-06、FR-07、FR-08
- **依赖**：T2、T3、T4
- **Create**：`src/core/test/session-persistence.test.mjs`
- **Modify**：`src/core/session.ts`（`SessionOptions.transcript`/`projectKey`/`permissionModeCeiling`、`history?` 初始历史、压缩接线、落盘、失败码兜底、`turn_finalized.persistenceError`）
- **Consumes**：`ContextBudgetManager`、`SessionTranscript` 端口、`ERROR_CODES`
- **Produces**：可持久化且可恢复的 Session
- **RED**：①注入 transcript 后回合结束写入 `turn` 记录；②`tool_use` 无 `tool_result` → `tool_step.status='needs_review'`；③工具失败 → `status='failed'`；④成功 → `completed`；⑤写盘失败 → 回合结果仍通过 `turn_finalized` 交付且带 `persistenceError`；⑥恢复历史后不自动执行任何工具；⑦错误回合 `error.code` 非空；⑧provider 未知错误 → `BUDINGX_PROVIDER_018`
- **GREEN**：在 `startTurn`/`buildRequest`/`finalize` 三个点接入；压缩失败熔断 → `coreContextOverflow` 终态
- **验证**：`node --test src/core/test/session-persistence.test.mjs src/core/test/session.test.mjs`
- **完成事实**：`src/core/session.ts` 接线：`restoreHistory`（只装载不重放）、`applyPermissionCeiling`、`preservedItems`、`compactIfNeeded`/`compactForOverflow`、`tool_step` 落盘、`persistenceError` 随 `turn_finalized` 报出；`src/core/session-persistence.ts`。GREEN：`src/core/test/session-persistence.test.mjs` 11/11。

### T7 · 跨进程恢复端到端（真实进程）

- **设计**：§5.7、§5.3
- **AC**：SR-02、SR-03、SR-04、SR-09、SR-10
- **依赖**：T6
- **Create**：`src/tui/test/session-recovery.test.mjs`
- **Modify**：无
- **Consumes**：T4/T6 产物
- **Produces**：真实进程证据（父进程写会话 → 子进程读回）
- **RED**：①父进程跑完一轮含工具调用 → 子进程 `restore()` 得到相同消息序列；②子进程恢复后**没有**工具副作用重放（断言工具执行计数不增加）；③未知执行结果标记 `needs_review` 并提示；④子进程权限模式不高于父进程记录；⑤半写文件仍可读到最后一条完整记录
- **GREEN**：补齐实现直到通过
- **验证**：`node --test src/tui/test/session-recovery.test.mjs`
- **完成事实**：`src/storage/test/session-recovery.e2e.test.mjs` 4/4 真实子进程：跨进程恢复不重放副作用、结果不确定步骤标记 needs_review、权限不升权、失败原因可定位。

### T8 · TUI 命令面与运行时接线

- **设计**：§5.8、§7.5
- **AC**：SR-05、SR-06、PM-03、CB-05（`/context` 数据）、PM-01
- **依赖**：T5、T6
- **Create**：`src/tui/test/commands-sp005.test.mjs`
- **Modify**：`src/tui/runtime.ts`（`sessionId?`/`restore?` 注入、transcript/memory 接线）、`src/tui/commands.ts`（`/sessions`、`/resume`、`/context`、`/memory`）、`src/tui/app.tsx`（渲染新事件与帮助）
- **Consumes**：`SessionStore`、`project-memory`、`context-budget`
- **Produces**：用户可见命令面
- **RED**：①`/sessions` 列出本机会话；②`/resume <未知ID>` → 明确错误；③`/resume <有效ID>` → 恢复；④`/context` 输出预算构成；⑤`/memory` 读写项目记忆
- **GREEN**：实现命令与运行时接线
- **验证**：`node --test src/tui/test/commands-sp005.test.mjs`
- **完成事实**：`src/tui/commands.ts` 新增 `/sessions`、`/resume <id>`、`/context`、`/memory`（支持全角冒号、参数保空白）；`src/tui/runtime.ts` 暴露 sessions/context/memory 三个面。GREEN：`src/tui/test/sp005-commands.test.mjs` 14/14。

### T9 · 失败恢复端到端

- **设计**：§6
- **AC**：FR-01…FR-08
- **依赖**：T6
- **Create**：`src/tui/test/failure-recovery.test.mjs`
- **Modify**：无
- **Consumes**：T6 产物
- **Produces**：失败原因可定位的证据
- **RED**：①工具失败进入模型上下文且回合继续；②工具输出超限含显式截断标记；③达到最大迭代 → `max_turns` 明确原因；④失败落盘可查到 turn/step/code；⑤重试从失败点继续且不重复已完成副作用；⑥落盘失败 → 结果不丢且有存储错误码；⑦上下文溢出 → 压缩重试链后明确失败
- **GREEN**：按失败逐条补齐
- **验证**：`node --test src/tui/test/failure-recovery.test.mjs`
- **完成事实**：`src/core/test/failure-recovery.test.mjs` 8/8 与 `src/core/test/tool-loop-breaker.test.mjs` 4/4。修复 3 个真实缺陷：工具失败缺稳定错误码（补 coreToolFailed 兜底）、persistenceError 只发 notice 不落终态、FR-05 fixture 不触发迭代上限。新增 FR-09 两级熔断（精确重复 3 次 / 同工具同错误码连续 5 次）。

### T10 · 本机 Langfuse 兼容接收端与观测断言

- **设计**：§8
- **AC**：OB-01…OB-04
- **依赖**：无（可并行）
- **Create**：`scripts/langfuse/local-receiver.mjs`、`scripts/langfuse/local-receiver.test.mjs`、`scripts/langfuse/run-local-receiver.mjs`、`src/tui/test/langfuse-observation.test.mjs`
- **Modify**：`package.json`（新增 `langfuse:local` 脚本）
- **Consumes**：`src/observability/exporter.ts` 的 OTLP 载荷形状、既有 `scripts/langfuse/query-traces.mjs`/`verify-agent.mjs`
- **Produces**：本机可回查的观测端点
- **RED**：①健康检查返回 OK；②OTLP 摄入后 `/api/public/v2/observations` 可查；③既有 `query-traces.mjs` 对接收端**不改代码**即可用；④一次回合产生恰好 1 个根 `agent.run`，子观测 parent 指向根，`session.id` 一致；⑤工具失败 → ERROR；⑥追踪关闭/接收端不可达 → 业务结果一致
- **GREEN**：实现接收端与断言
- **验证**：`node --test scripts/langfuse/local-receiver.test.mjs src/tui/test/langfuse-observation.test.mjs`
- **完成事实**：`scripts/langfuse/local-receiver.mjs`（Langfuse 兼容接收端：OTLP `/api/public/otel/v1/traces` + v2 `/api/public/v2/observations`，Basic 认证）+ `scripts/langfuse/local-receiver.test.mjs` 3/3；`scripts/langfuse/sp005-observation.mjs`（真实 Session 观测 + 纯函数 judgeHierarchy/judgeToolNames/judgeLevels）+ `sp005-observation.test.mjs` 10/10（OB-01…OB-04）。

### T11 · 真实模型端到端 + Langfuse 观测判读

- **设计**：§8.3、§12.3
- **AC**：EV-01、EV-03、OB-02、OB-03、FR-02、CB-04
- **依赖**：T6、T7、T9、T10
- **Create**：`src/tui/test/long-session-e2e.test.mjs`、`scripts/testing/sp005-e2e.mjs`（真实模型场景脚本）、`SP/SP005/long-session-reliability/artifacts/`（脱敏摘要，gitignored）
- **Modify**：无
- **Consumes**：`.env.e2e.local`（`BUDINGX_BASE_URL`/`BUDINGX_MODEL`/`BUDINGX_API_KEY`，预算 `BUDINGX_E2E_BUDGET_USD=5`、请求上限 `6`、token 上限 `128`）、本机接收端
- **Produces**：脱敏 e2e 摘要 + 观测判读结论
- **RED**：真实模型跑「读文件 → 改文件 → 汇报」与「工具失败 → 重试」两类场景；断言 ①工具调用名称与真实工具一致；②无成功幻觉；③失败被如实上报；④观测结构符合 §8.3 判据
- **GREEN**：修正实现直到场景与观测判据均通过
- **验证**：`node scripts/testing/sp005-e2e.mjs`（真实模型，受预算约束）+ 接收端回查
- **完成事实**：真实模型两次运行：正常场景 4 条 observation 层级/工具名全对；工具失败场景 24→67 条且多数 `tool.Read` 为 ERROR，暴露「换参数空转」。随后 provider 返回 HTTP 402 insufficient_balance_error（Token Plan 用量上限），真实模型复跑不可用 ⇒ 改由 `scripts/langfuse/sp005-observation.e2e.test.mjs` 3/3 用本地脚本化 OpenAI 兼容端点复现（真实 HTTP + 真实解析 + 真实工具 + 真实追踪）。真实模型三场景记 UNVERIFIED，恢复条件：provider 额度恢复后重跑同一脚本。

### T12 · 模块边界、构建接线与全量回归

- **设计**：§10.2、§12.4
- **AC**：EV-02
- **依赖**：T1…T11
- **Create**：无
- **Modify**：`scripts/checks/module-boundaries.mjs`（如需为新增 core 文件补充显式规则）、`src/tui/tsconfig.json`（如需新增 include）
- **Consumes**：全部实现
- **Produces**：门禁 GREEN 的构建与测试
- **RED**：新增文件若触发边界规则或构建失败即为 RED
- **GREEN**：最小修正（不降阈值）
- **验证**：`npm run build`；`npm run test:checks`；`npm run spec:check`；`npm run test:unit`（≥ 基线计数）；`npm test`
- **完成事实**：`npm run build` GREEN；`node --test src/*/test/*.test.mjs` 712/712；`npm run test:checks`（模块边界：core 不依赖 storage）通过；`npm run merge:gate` GREEN。

### T13 · 交付记录与文档同步

- **设计**：§10.2、§12.3
- **AC**：EV-01、EV-02、EV-03
- **依赖**：T11、T12
- **Create**：`SP/SP005/long-session-reliability/STATUS.md`、`SP/SP005/long-session-reliability/test-report.md`、`SP/SP005/requirements-summary.md`
- **Modify**：`PRODUCT.md`（用户可见行为：新增命令、数据路径、限制）、`docs/iteration-plan.md`（SP005 状态）、`docs/agent-capability-matrix.md`（相关行）
- **Consumes**：全部任务的实际执行结果
- **Produces**：可断线续接的交付记录
- **RED**：不适用（文档任务）
- **GREEN**：不适用
- **验证**：`npm run spec:check`；`npm run merge:gate`；文档链接可达
- **完成事实**：交付记录：本文件 `完成事实` 回填、`STATUS.md`、`test-report.md`、`SP/SP005/requirements-summary.md`、`docs/iteration-plan.md`、`docs/agent-capability-matrix.md`、`PRODUCT.md` §5.5 与已知限制。

### T14 · 提交到功能分支（不合并 master）

- **设计**：§12.4、用户指令（2026-11-19）
- **AC**：EV-02
- **依赖**：T13
- **Create**：无
- **Modify**：无
- **Consumes**：全部变更
- **Produces**：功能分支上的中文提交
- **RED**：不适用
- **GREEN**：不适用
- **验证**：`git status --short`；`git log --oneline`；`git diff master...HEAD --stat`；**不推送 master**
- **完成事实**：中文提交到 `feature/SP005/long-session-reliability`；**未合入 master**（用户要求测试完成后由其决定）。

## 测试收口映射（AC → 任务 → 用例）

| AC | 任务 | 单元用例 | 端到端 / 真实进程用例 |
| --- | --- | --- | --- |
| CB-01 | T2, T6 | `src/core/test/context-budget.test.mjs` | `src/core/test/context-budget.e2e.test.mjs`（真实 HTTP 请求体含 `context_compacted`） |
| CB-02 | T2 | `context-budget.test.mjs`（约束保留） | `context-budget.e2e.test.mjs`（约束出现在真实请求） |
| CB-03 | T2 | `context-budget.test.mjs`（计划保留） | `context-budget.e2e.test.mjs`（计划出现在真实请求） |
| CB-04 | T2 | `context-budget.test.mjs`（未完成工具占位） | `context-budget.e2e.test.mjs`（占位与 `tool_use` 成对出现在真实请求） |
| CB-05 | T2, T8 | `context-budget.test.mjs`（阈值） | `src/tui/test/sp005-commands.test.mjs`（`/context`） |
| CB-06 | T2, T6 | `context-budget.test.mjs`（超限） | `failure-recovery.test.mjs`（溢出链） |
| CB-07 | T2, T6 | `context-budget.test.mjs`（幂等/熔断） | `failure-recovery.test.mjs` |
| SR-01 | T3 | `src/storage/test/session-transcript.test.mjs` | `src/storage/test/session-recovery.e2e.test.mjs` |
| SR-02 | T6, T7 | `src/core/test/session-persistence.test.mjs` | `session-recovery.e2e.test.mjs` |
| SR-03 | T6, T7 | `session-persistence.test.mjs` | `session-recovery.e2e.test.mjs` |
| SR-04 | T6, T7 | `session-persistence.test.mjs` | `session-recovery.e2e.test.mjs` |
| SR-05 | T4, T8 | `session-transcript.test.mjs` + `src/storage/session-store.ts` 单测 | `src/tui/test/sp005-commands.test.mjs` |
| SR-06 | T4, T8 | `session-store` 行为经 `session-transcript.test.mjs` 覆盖 | `sp005-commands.test.mjs` |
| SR-07 | T3 | `session-transcript.test.mjs` | `session-recovery.e2e.test.mjs` |
| SR-08 | T3 | `session-transcript.test.mjs` | `session-recovery.e2e.test.mjs` |
| SR-09 | T3, T7 | `session-transcript.test.mjs` | `session-recovery.e2e.test.mjs` |
| SR-10 | T4, T6 | `session-persistence.test.mjs`（权限上限） | `session-recovery.e2e.test.mjs` |
| SR-11 | T4 | `session-transcript.test.mjs`（锁） | `context-budget.e2e.test.mjs` + `session-recovery.e2e.test.mjs`（两真实进程互斥） |
| FR-01 | T1, T6 | `session-persistence.test.mjs` | `src/core/test/failure-recovery.test.mjs` |
| FR-02 | T9 | `session-persistence.test.mjs` | `failure-recovery.test.mjs` |
| FR-03 | T9 | `src/core/test/session.test.mjs` | `failure-recovery.test.mjs` |
| FR-04 | T9 | — | `failure-recovery.test.mjs` |
| FR-05 | T6, T9 | `session-persistence.test.mjs` | `failure-recovery.test.mjs` |
| FR-06 | T6, T7, T9 | `session-persistence.test.mjs` | `session-recovery.e2e.test.mjs` |
| FR-07 | T6, T9 | `session-persistence.test.mjs` | `failure-recovery.test.mjs` |
| FR-08 | T2, T6, T9 | `context-budget.test.mjs` | `failure-recovery.test.mjs` |
| FR-09 | T9 | `src/core/test/tool-loop-breaker.test.mjs` | `scripts/langfuse/sp005-observation.e2e.test.mjs`（真实端点熔断早于上限） |
| PM-01 | T5, T8 | `src/storage/test/project-memory.test.mjs` | `sp005-commands.test.mjs` |
| PM-02 | T5 | `project-memory.test.mjs` | `context-budget.e2e.test.mjs`（真实子进程跨进程读取） |
| PM-03 | T5, T8 | `project-memory.test.mjs` | `session-recovery.e2e.test.mjs` |
| PM-04 | T5 | `project-memory.test.mjs` | `sp005-commands.test.mjs` |
| PM-05 | T5 | `project-memory.test.mjs` | `sp005-commands.test.mjs` |
| PM-06 | T5 | `project-memory.test.mjs` | `sp005-commands.test.mjs` |
| PM-07 | T5 | `project-memory.test.mjs` | `context-budget.e2e.test.mjs` |
| PM-08 | T5 | `project-memory.test.mjs` | `sp005-commands.test.mjs` |
| OB-01 | T10 | `scripts/langfuse/local-receiver.test.mjs` | `scripts/langfuse/sp005-observation.e2e.test.mjs` |
| OB-02 | T10 | `local-receiver.test.mjs` + `sp005-observation.test.mjs` | `sp005-observation.e2e.test.mjs`（层级与工具名） |
| OB-03 | T10 | `sp005-observation.test.mjs` | `sp005-observation.e2e.test.mjs`（失败工具为 ERROR） |
| OB-04 | T10 | `local-receiver.test.mjs` | `sp005-observation.e2e.test.mjs` |
| EV-01 | T11, T13 | — | `sp005-observation.e2e.test.mjs` 摘要 + 观测记录 |
| EV-02 | T12, T13 | — | `npm test` + `npm run merge:gate` |
| EV-03 | T11, T13 | — | `failure-recovery.test.mjs` + `session-recovery.e2e.test.mjs` |

## 执行前置与风险

1. **前置**：T0 全部 GREEN（基线 SHA、基线测试计数、门禁脚本通过）才进入 T1。
2. **额度**：真实模型 e2e 受 `.env.e2e.local` 的 `BUDINGX_E2E_MAX_REQUESTS=6` / `BUDINGX_E2E_BUDGET_USD=5` / `BUDINGX_E2E_MAX_TOKENS=128` 约束，场景数固定，跑超即中止并如实记录。
3. **依赖外部**：本机 Langfuse 栈不可用（无 Docker/WSL）⇒ 走 §8 本地接收端；真实栈列为 UNVERIFIED（恢复条件见 §8.4）。
4. **风险 R-01/R-02**（压缩丢约束、恢复重放副作用）由 T2/T6/T7 的 RED 用例直接锁定，不靠人工检查。
5. **授权边界**：本轮**不合入 master、不推送 master**；npm 发布与打标签不在本轮范围。
