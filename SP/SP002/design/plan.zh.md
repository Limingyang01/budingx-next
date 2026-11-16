# SP002 实施计划 · 模型与会话闭环

版本：v0.1｜更新：2026-11-16｜依据：[设计稿 v0.3 approved](design.zh.md)（同版批准直接覆盖本计划，无需再次汇报）｜分支：`feature/SP002/model-session-loop`（已从 master `484c6a9` 创建）

**Goal**：交付「模型与会话闭环」——独立 provider 模块（OpenAI 兼容流式 + tool_calls 组装 + 错误分类 + 有界重试 + 取消）、显式会话状态机与类型化事件契约（双中断 + 排队 + 审批最小闭环）、`~/.budingx` 模型档案持久化（CRUD + 凭据隔离 + 快照）、Ink 8 对话式 TUI，32 条 AC 全部有证据。

**Architecture**：四模块单向依赖 `tui → core ← provider`、`tui → core ← storage`。core 持有会话/回合/事件/队列/快照，零 UI 零 IO 副作用；provider 只做协议适配与流解析，事件类型由 core 定义；storage 是唯一数据根 `~/.budingx` 的读写方；tui 只渲染与收键，不做业务判断。单一 tsc 程序 `rootDir=src`、`outDir=src/tui/dist`，产物 `dist/core`、`dist/provider`、`dist/storage`、`dist/tui`，bin=`dist/tui/cli.js`。

**Tech Stack**：Node.js >=22.18、TypeScript 5.9.3、node --test；运行时依赖仅 `ink@^8` / `react@^19` / `string-width@^9`（渲染层白名单）；无 Bun、无 workspace/file 依赖。

**Spec**：`SP/SP002/design/design.zh.md`（v0.3 approved）+ 四份需求 v0.1（`SP/SP002/*/requirements.md`，AC 共 32 条）。

---

## Global Constraints

- Node.js `>=22.18.0`；只用 Node，不引入 Bun；TS `strict` + `noEmitOnError`；JS/TS 用 2 空格、ESM、无分号。
- 单一 tsc 程序编译整个 `src/`：`rootDir=src`、`outDir=src/tui/dist`、`include` 显式排除任何 `dist/`；产物 `dist/core/*.js`、`dist/provider/*.js`、`dist/storage/*.js`、`dist/tui/*.js`；`src/tui/package.json` 的 `bin` 改为 `dist/tui/cli.js`（相对 0.1.1 的 `dist/cli.js` 为路径变更，未发布前允许）。
- 运行时 npm 依赖白名单**恰好** `{ink, react, string-width}`；不引入其他第三方 UI/终端依赖；`ink`/`react`/`string-width` 均为 MIT，登记进 `THIRD-PARTY-NOTICES.md`。
- core/provider/storage 禁止 import 任何 UI/终端库（含 `ink`、`react`、`node:readline` 之外的终端控制库）；core 额外禁止 `node:fs`/`node:http` 等 IO 副作用模块。
- 数据根仅 `~/.budingx`（`os.homedir()` 解析）；禁止读写 `~/.claude`；key 不进普通配置 JSON、不进日志、不进事件负载；UI 回显仅末 4 位。
- 事件契约：形状与 UI 类型无关、可 JSON 序列化；delta 先于对应 completed；**每 turn 至多一个 `turn_finalized`**；`TurnSnapshot` 冻结于 `turn_started`，每 turn 一次。
- 一个 turn = 一次用户提交的完整续跑链（工具结果回填→再次调模型共用同一 `turnId`）；`maxIterations` 默认 32，超限 → `turn_finalized{outcome:'max_turns'}` + notice，不静默截断。
- 错误码格式 `BUDINGX_<域>_<序号>`，冻结于 `src/core/constants.ts`；任何 message/log 不得含 key 明文。
- 测试统一 `node --test`；每条 AC 至少各有一个单元用例与一个功能（端到端）用例，先 RED 后 GREEN；零测试与全 skip 不算通过。
- 参考实现 `budingWorkerSpace` 仅作行为对照（TUI 命令、Agent 主循环、工具行为）；只读机制不抄代码，实现独立编写，核心逻辑不背离、使用体验不下降；实现提交信息引用 CAP/AC ID，不引用旧仓路径。

## Review Focus

以下五类输入/失效模式是设计隐含、但任务测试容易漏掉的真实使用场景；每条在所属任务的测试步骤中给出对应断言。

1. **回合中途用户改主意**（Esc 打断）：用户以为模型还在跑就改需求，期望**已输出的半截文本不被丢弃**（保留并回填合成 tool_result），会话回到 idle 可继续，而不是整段丢失重来。—— 归 T6。
2. **执行中想到补充**：连续输入两条补充，期望**两条都不丢、按序注入、不重复注入**，且注入点在工具结果回填之后而非打断当前回合。—— 归 T6。
3. **切换模型不该丢历史**：用户在会话中途 `/model` 换模型，期望历史保留、切换自**下一回合**生效、进行中的回合仍用启动快照（不误用新凭据/新模型）。—— 归 T7/T5 联测。
4. **编辑档案把主机换掉**：用户改 base URL 到另一台服务器，期望**旧 key 不被自动转发**、要求显式重输；否则等于把凭据泄给新主机。—— 归 T7。
5. **中文/emoji 输入与显示**：用户日常中文提问并粘贴带 emoji 的多行文本，期望**宽度计算正确不乱码、不切字、不误发**（粘贴多行不触发发送）。—— 归 T9/T8。

---

## 任务总览与 AC 覆盖

| 任务 | 名称 | 覆盖 AC | 里程碑 |
| --- | --- | --- | --- |
| T1 | 仓库骨架与边界检查 | PS-07、SL-09、TC-01(部分) | M0 |
| T2 | provider 流解析与 tool_calls 组装 | PS-01、PS-02 | M1 |
| T3 | provider 客户端（错误/重试/取消/限额/probe） | PS-03、PS-04、PS-05、PS-06、PS-08(机制) | M1 |
| T4 | core 事件契约与消息规范化 | SL-02(形状) | M1 |
| T5 | core 会话状态机与工具回合 | SL-01、SL-02、SL-03、SL-06、SL-07、SL-08 | M1/M2 |
| T6 | core 双中断与输入队列 | SL-04、SL-05 | M2 |
| T7 | storage 模型档案与凭据仓库 | MM-01…MM-07 | M3 |
| T8 | TUI 渲染 reducer | TC-02 | M3 |
| T9 | TUI 多行编辑器 | TC-03 | M3 |
| T10 | TUI 按键与审批交互 | TC-04、TC-05 | M3 |
| T11 | TUI 应用装配与非 TTY 路径 | TC-06、TC-07 | M4 |
| T12 | 构建、制品边界与全量回归 | TC-08、TC-01、PS-07、SL-09 | M4 |
| T13 | 交付记录与合入 master | 全部 32 条 | 收口 |

AC 覆盖自检：PS-01…08 → T2/T3/T12；MM-01…07 → T7；SL-01…09 → T4/T5/T6/T12；TC-01…08 → T1/T8/T9/T10/T11/T12。**每条 AC 在 T13 汇总表中有「单元用例 + 功能用例」两行且命令与数量为真实实测值。**

---

### Task T1：仓库骨架与边界检查

**Files**：
- Create: `src/core/index.ts`、`src/core/events.ts`、`src/core/provider.ts`、`src/core/tools.ts`、`src/core/constants.ts`、`src/core/normalize.ts`、`src/core/session.ts`
- Create: `src/provider/index.ts`、`src/provider/sse.ts`、`src/provider/openai.ts`、`src/provider/errors.ts`
- Create: `src/storage/index.ts`、`src/storage/paths.ts`、`src/storage/config-store.ts`、`src/storage/credentials.ts`、`src/storage/profiles.ts`
- Create: `scripts/checks/module-boundaries.mjs`
- Modify: `src/tui/tsconfig.json`（`rootDir: ".."`、`outDir: "dist"`、include 覆盖四模块、exclude `dist`、`jsx: "react-jsx"`、`jsxImportSource: "react"`）
- Modify: `package.json`（devDeps 增 `ink`/`react`/`string-width`/`@types/react`；`build` 指向新 tsconfig；`test` 纳入新模块测试）
- Modify: `src/tui/package.json`（`bin: dist/tui/cli.js`；`dependencies: {ink, react, string-width}`；`files` 保持）

**Interfaces**：
- Consumes: 无（起点）
- Produces: `src/core/events.ts` 导出 `SessionState`、`TurnOutcome`、`NoticeCode`、`ErrorInfo`、`Usage`、`TurnSnapshot`、`SessionEvent`、`Message`、`MessageBlock`、`TurnFinalizedEvent`；`src/core/provider.ts` 导出 `ModelProvider`、`ProviderEvent`、`ProviderError`、`ChatRequest`、`ApiMessage`、`ToolSpec`、`FinishReason`；`src/core/tools.ts` 导出 `ToolHandler`、`ApprovalGateway`、`ApprovalRequest`、`ApprovalDecision`；`src/core/constants.ts` 导出 `CANCEL_BUDGET_MS`、`QUEUE_AUTOSTART_MS`、`TOOL_OUTPUT_CAP`、`MAX_ITERATIONS`、`ERROR_CODES`。

- [ ] **Step 1**：写 `scripts/checks/module-boundaries.mjs`——扫描 `src/{core,provider,storage}/**/*.ts(x)` 的 import 语句，命中 UI/终端库（`ink`、`react`、`node:readline`、`node:tty`、`ansi-*`、`chalk`）或 core 命中 IO 模块（`node:fs`、`node:http`、`node:net`）即失败；再校验 `src/tui/package.json.dependencies` 键集合**恰好**等于 `{ink, react, string-width}`，且根 `package.json` devDependencies 中三项版本与之一致。退出码非 0 表示失败。
- [ ] **Step 2**：运行 `node scripts/checks/module-boundaries.mjs`——预期：当前仓库无 `src/core` 等目录，检查器对缺失目录视为空并**通过**（基础设施就绪，不是业务 RED）；此步只验证脚本自身可运行。
- [ ] **Step 3**：在 `src/core/` 建空壳 `index.ts` 等 7 个文件、`src/provider/` 4 个、`src/storage/` 5 个，仅导出类型骨架（无实现），并把 `src/tui/src/*` 保持不动（**先补回归再迁移**，迁移在 T11）。
- [ ] **Step 4**：改 `src/tui/tsconfig.json`：`rootDir: ".."`、`outDir: "dist"`、`include: ["../core/**/*.ts", "../provider/**/*.ts", "../storage/**/*.ts", "./**/*.ts", "./**/*.tsx"]`、`exclude: ["dist"]`、`jsx: "react-jsx"`、`jsxImportSource: "react"`。
- [ ] **Step 5**：运行 `npm run build`——预期：编译成功且产物出现 `src/tui/dist/core/index.js`、`dist/provider/index.js`、`dist/storage/index.js`（`src/tui/src/*` 仍编译到 `dist/tui/…` 之外——若旧文件仍被 include，须把它们移到 `src/tui/` 根或临时排除；**旧 `src/tui/src/cli.ts` 在 T11 才迁移**，故本步先排除 `src/tui/src/**` 并在 T11 恢复）。
- [ ] **Step 6**：改根 `package.json`：devDeps 增 `ink`、`react`、`string-width`、`@types/react`；`test` 改为串联 `test:tui`、`test:core`、`test:provider`、`test:storage`、`test:checks`（各脚本 = `node --test <dir>/test/*.test.mjs`）。
- [ ] **Step 7**：运行 `npm install`（根）并 `npm run build`——预期：编译通过，ink/react 类型可解析（`skipLibCheck` 不得掩盖自身类型错误）。
- [ ] **Step 8**：提交：`git commit -m "chore(SP002): 建立 core/provider/storage 模块骨架与依赖边界检查"`。

---

### Task T2：provider 流解析与 tool_calls 组装（PS-01、PS-02）

**Files**：
- Create: `src/provider/sse.ts`、`src/provider/errors.ts`、`src/provider/test/sse.test.mjs`
- Modify: `src/core/provider.ts`（补 `ProviderEvent` 完整定义）

**Interfaces**：
- Consumes: T1 的 `src/core/provider.ts` 类型
- Produces:
  - `parseSseFrames(buffer: string): { frames: SseFrame[]; rest: string }`，`SseFrame = { data: string }`——按 `\n\n` 切帧，逐行取 `data:` 前缀拼接、忽略 `:` 注释行、容忍 CRLF。
  - `class SseParser { push(chunk: string): SseFrame[]; end(): SseFrame[] }`——跨事件增量缓冲，`end()` 冲刷残留帧。
  - `assembleToolCalls(fragments: ToolFragment[]): { calls: ToolCall[]; errors: ToolCallError[] }`，`ToolCall = { index: number; id: string; name: string; arguments: string }`，`ToolCallError = { index: number; code: string; message: string }`——按 `index` 归并跨事件碎片；缺 `index` 时按出现顺序补位；`arguments` 非法 JSON 归一为结构化错误项（不抛崩）。
  - `classifyHttpStatus(status: number): ErrorClass`——401/403→`auth`、404→`not_found`、429→`rate_limited`、5xx→`overloaded`（503/529）、其他→`bad_request`。

- [ ] **Step 1**：写 `src/provider/test/sse.test.mjs`：
  - 用例 `SSE 分帧容忍任意 TCP 分片、CRLF、多行 data、注释行与 [DONE]`：把一段含 `': keepalive\r\n'`、多行 `data:`、中文 UTF-8 拆成**逐字节**喂入 `SseParser`，断言重组出的 `data` 与原帧一致。
  - 用例 `tool_calls 跨事件碎片按 index 组装完整调用列表`：喂入 `[{index:0,id:'a',name:'x'},{index:0,argsDelta:'{"a":'},{index:0,argsDelta:'1}'},{index:1,id:'b',name:'y',argsDelta:'{}'}]`，断言 `calls` 长度为 2、`calls[0].arguments === '{"a":1}'`、`calls[0].id==='a'`。
  - 用例 `缺 index 的碎片按出现顺序补位且不丢调用`。
  - 用例 `非法 JSON 参数归一为结构化错误项且进程不崩`：断言 `errors[0].code` 形如 `BUDINGX_PROVIDER_*` 且 `calls` 不含该项。
- [ ] **Step 2**：运行 `node --test src/provider/test/sse.test.mjs`——预期：FAIL（`Cannot find module` 或断言失败），确认 RED。
- [ ] **Step 3**：实现 `src/provider/sse.ts`（`SseParser` + `parseSseFrames`）与 `src/provider/errors.ts`（`classifyHttpStatus` + 错误码表 `BUDINGX_PROVIDER_*`）。
- [ ] **Step 4**：在 `src/core/provider.ts` 补全 `ToolFragment`/`ToolCall`/`ToolCallError` 类型定义（provider 边界类型，core 不 import provider）。
- [ ] **Step 5**：实现 `assembleToolCalls`（在 `src/provider/sse.ts` 或独立 `src/provider/tool-calls.ts`，二选一，实现时定；**类型名与上表一致**）。
- [ ] **Step 6**：运行 `node --test src/provider/test/sse.test.mjs`——预期：全绿。
- [ ] **Step 7**：补**基线回归**：把 0.1.1 `src/tui/src/provider.ts` 的既有行为逐条写成 fixture 断言（分帧等价、`[DONE]` 前无文本报错、截断报错、非法事件报错、非 `text/event-stream` 报错、非 ok 状态不泄漏 body），断言新解析器行为与旧实现等价——**这一步是「先补行为回归再动刀」的前置证据**。
- [ ] **Step 8**：提交：`git commit -m "feat(SP002): 实现 provider 流分帧与 tool_calls 组装（PS-01/PS-02）"`。

---

### Task T3：provider 客户端（PS-03…PS-06）

**Files**：
- Create: `src/provider/openai.ts`、`src/provider/test/openai.test.mjs`

**Interfaces**：
- Consumes: T2 的 `SseParser`/`assembleToolCalls`/`classifyHttpStatus`；core 的 `ModelProvider`/`ProviderEvent`/`ChatRequest`
- Produces: `createOpenAiProvider(opts): ModelProvider`；`probe(profile, opts): Promise<ProbeResult>`，`ProbeResult = { ok: boolean; errorClass?: ErrorClass; message: string; supportsTools?: boolean }`；`ProviderLimits = { eventBufferBytes: number; maxResponseChars: number; connectTimeoutMs: number; idleStreamTimeoutMs: number; maxAttempts: number }`（默认 `eventBufferBytes=1048576`、`maxResponseChars=65536`、`connectTimeoutMs=30000`、`idleStreamTimeoutMs=120000`、`maxAttempts=5`）。

- [ ] **Step 1**：写 `src/provider/test/openai.test.mjs`，用本地 `http.createServer` 提供 SSE fixture（`127.0.0.1` 走 loopback http）：
  - `错误分类覆盖 401/403/404/429/5xx/网络失败/超时/截断/非法事件/上下文超限`，断言每种产出**独立错误类别**与 `code` 形如 `BUDINGX_PROVIDER_<序号>`，且 `error.message` 不含 `test-only-key`、不含上游 body 原文。
  - `重试退避尊重 Retry-After 且达上限明确失败`：429 带 `Retry-After: 1` 与不带两种；连续 5xx；断言 `retry` 事件次数 = 上限、`delayMs` 呈指数级、无 `model` 字段变化（**无静默换模型**：请求体 `model` 始终一致）。
  - `中途 abort 归类为 aborted 且不重试、无未处理 rejection`：断言 `error.class === 'aborted'`、无 `retry` 事件。
  - `限额可配置且触发明确错误`：超大单事件、超长响应、慢流三种各触发一个明确错误码。
- [ ] **Step 2**：运行 `node --test src/provider/test/openai.test.mjs`——预期：FAIL，RED。
- [ ] **Step 3**：实现 `src/provider/openai.ts`：
  - `stream(req)` 产出 core `ProviderEvent`：`text_delta`/`thinking_delta`/`tool_call_delta`/`message_completed`/`retry`/`failed`。
  - 宽容解析：`delta.reasoning_content`/`delta.reasoning` → `thinking_delta`；`delta.tool_calls` → 碎片交给 `assembleToolCalls`。
  - 重试：`retryable = {rate_limited, overloaded, network, timeout}`；`delayMs = min(500 * 2^n, 8000) ± jitter`，`Retry-After` 优先（秒数解析）；每次重试先发 `retry` 事件。
  - 取消：`AbortSignal.any([用户信号, connectTimeout, idleTimeout])`；abort → `failed{class:'aborted'}`。
  - 脱敏：所有对外 message 过滤 key 与上游 body。
- [ ] **Step 4**：实现 `probe(profile, opts)`：默认非流式最小请求（`messages:[{role:'user',content:'ok'}]`、`max_tokens:1`、10s 硬超时）；`opts.tools === true` 时追加一次带静态 echo tool 的小请求，返回 `supportsTools`。
- [ ] **Step 5**：运行 `node --test src/provider/test/openai.test.mjs`——预期：全绿。
- [ ] **Step 6**：提交：`git commit -m "feat(SP002): 实现 provider 错误分类、有界重试、取消与限额（PS-03…PS-06）"`。

---

### Task T4：core 事件契约与消息规范化

**Files**：
- Create: `src/core/normalize.ts`、`src/core/test/normalize.test.mjs`、`src/core/test/events.test.mjs`

**Interfaces**：
- Consumes: T1 core 类型
- Produces: `normalizeForApi(messages: Message[]): ApiMessage[]`——剥离孤儿 tool_result、tool_use id 去重、缺失 tool_result 补占位错误结果；`ApiMessage = { role: 'user'|'assistant'|'tool'; content: string | ApiContentPart[] }`。

- [ ] **Step 1**：写 `src/core/test/normalize.test.mjs`：孤儿 tool_result 被剥离；重复 tool_use id 只保留首个；缺失 tool_result 的 tool_use 补 `{ is_error: true, content: '<cancelled>' }`；普通 user/assistant 文本原样保留。
- [ ] **Step 2**：写 `src/core/test/events.test.mjs`：`SessionEvent` 联合类型可 JSON 序列化（对每种事件构造一个样本 `JSON.parse(JSON.stringify(e))` 深比较相等）；`TurnSnapshot` 不含 key 字段（类型层面 + 值断言）。
- [ ] **Step 3**：运行 `node --test src/core/test/*.test.mjs`——预期：FAIL，RED。
- [ ] **Step 4**：实现 `src/core/normalize.ts`；补齐 `src/core/events.ts` 全部类型（含 `TurnFinalizedEvent` 的 `restoreText?: string` 扩展，见下）。
- [ ] **Step 5**：运行 `node --test src/core/test/*.test.mjs`——预期：全绿。

> **契约扩展说明（对已批准设计的最小增量）**：设计 §3.3 要求「auto-restore：纯取消且队空、无新输入、该回合用户消息后仅合成内容 ⇒ 移除该回合内容并把用户原文还原到输入框」。该「还原动作」需要一个可观察出口，故在 `turn_finalized` 事件上增加可选字段 `restoreText?: string`（仅 `outcome==='cancelled'` 且满足 auto-restore 条件时出现）。这是设计 §3.2「最小必要事件集 + 扩展规则」允许的增量，不改变既有事件语义。

- [ ] **Step 6**：提交：`git commit -m "feat(SP002): 定义 core 事件契约与消息规范化（SL-02 形状）"`。

---

### Task T5：core 会话状态机与工具回合（SL-01、SL-02、SL-03、SL-06、SL-07、SL-08）

**Files**：
- Create: `src/core/session.ts`、`src/core/test/session.test.mjs`

**Interfaces**：
- Consumes: T3 的 `ModelProvider`；T4 的 `normalizeForApi`；core `ToolHandler`/`ApprovalGateway`
- Produces: `class Session`：
  ```ts
  new Session(options: {
    provider: ModelProvider
    approval: ApprovalGateway
    resolveSnapshot: () => TurnSnapshot
    tools?: ToolHandler[]
    maxIterations?: number
    cancelBudgetMs?: number
    onEvent?: (event: SessionEvent) => void
  })
  get state(): SessionState
  get messages(): Message[]
  get queueSize(): number
  submit(text: string): void
  interrupt(reason: 'user'): void
  recycleQueued(): string[]   // 返回被回收的排队文本（供输入框还原）
  on(event: SessionEvent, handler: (e: SessionEvent) => void): () => void
  ```

- [ ] **Step 1**：写 `src/core/test/session.test.mjs`（用假 provider：可编排 `text_delta`/`tool_call_delta`/`message_completed` 序列）：
  - `状态集合覆盖 idle/requesting/streaming/tool_running/awaiting_approval/cancelling`，且**每回合恰好一个终态**；重复/矛盾终态被守卫丢弃并发 `late_event_dropped` notice。
  - `事件顺序符合契约`：turn_started → text_delta → message_completed → turn_finalized；delta 先于 completed；事件不含任何 UI 类型。
  - `每个 tool_use 恰好一个 tool_result 回填并按调用顺序入历史`（含 n=2 并行）；未知工具名/非法参数 → 错误结果给模型且不崩；round-trip 可续跑至收敛。
  - `回合内切换模型不影响本回合`：回合进行中改 resolveSnapshot 返回值，本回合事件里的 snapshot 仍是旧值，下一回合为新值。
  - `active 时再次提交入队且不产生交错写历史`（唯一行为：入队）。
  - `审批 approve/deny`：deny → 合成拒绝结果回填、**会话继续**（下一轮仍发生）、无 pending 泄漏；请求带工具名/输入摘要/请求 id，应答按 id 匹配。
- [ ] **Step 2**：运行 `node --test src/core/test/session.test.mjs`——预期：FAIL，RED。
- [ ] **Step 3**：实现 `src/core/session.ts`：
  - 状态机：显式迁移表（`idle→requesting→streaming→tool_running→requesting…`，`awaiting_approval` 支路，`cancelling` 收口）；非法迁移抛错并被守卫吸收。
  - 回合循环：`maxIterations` 默认 32；每迭代调 `provider.stream`，把 provider 事件翻译为 `SessionEvent`；`finishReason==='tool_calls'` 时按序分派工具，工具结果回填后进入下一次迭代。
  - 快照：`turn_started` 时调用 `resolveSnapshot()` 一次并冻结。
  - 终态守卫：每 turn 一个 `turnId`，`finalize()` 幂等；迟到事件丢弃并发 `late_event_dropped`。
- [ ] **Step 4**：实现审批最小闭环：`awaiting_approval` 时发 `approval_requested`，`await gateway.request(req)` 得 decision，发 `approval_resolved`；deny → 合成 `tool_result{isError:true}` 并继续回合；取消时整体 reject + 清空 pending（无泄漏）。
- [ ] **Step 5**：运行 `node --test src/core/test/session.test.mjs`——预期：全绿。
- [ ] **Step 6**：提交：`git commit -m "feat(SP002): 实现会话状态机与工具回合闭环（SL-01/02/03/06/07/08）"`。

---

### Task T6：core 双中断与输入队列（SL-04、SL-05）

**Files**：
- Modify: `src/core/session.ts`、`src/core/test/session.test.mjs`

**Interfaces**：
- Consumes: T5 的 `Session`
- Produces: `Session.interrupt(reason)`、`Session.recycleQueued()`、事件 `input_queued`/`input_injected`/`queue_recycled`

- [ ] **Step 1**：写测试（先 RED）：
  - `打断在有界时间内取消模型请求与工具句柄`：假 provider 与假工具均暴露 `cancel()` 记录；断言 `interrupt('user')` 后二者都被取消，且从调用到 `turn_finalized{outcome:'cancelled'}` 的耗时 **< CANCEL_BUDGET_MS + 1000ms**（真实时间断言，不用假时钟）。
  - `打断后保留部分文本并为孤儿 tool_use 补合成 error 结果`，且会话回到 idle 可继续提交。
  - `纯取消且无新输入时还原用户原文`：断言 `turn_finalized.restoreText === 原文`，且 `session.messages` 中不含该回合内容。
  - `执行中输入两条按序注入且不重复`：断言 `input_injected` 事件两次、queueId 顺序与输入顺序一致、边界为 `intra_turn`、注入发生在 tool_result 回填之后。
  - `回合结束后剩余排队项在驻留窗口后自动起新回合`；窗口内 `recycleQueued()` 返回文本并发 `queue_recycled` notice。
- [ ] **Step 2**：运行 `node --test src/core/test/session.test.mjs`——预期：FAIL，RED。
- [ ] **Step 3**：实现 `interrupt`：置 `cancelling`、abort provider signal、调用工具 `cancel()`（工具通过 `ctx.signal` 收信号，`execute` 需自行遵守）；超 `CANCEL_BUDGET_MS` 强制标记并继续收口；发 `turn_finalized{outcome:'cancelled'}`。
- [ ] **Step 4**：实现队列：`submit` 在 `state!=='idle'` 时入队并发 `input_queued{queueId, preview}`；每次迭代（**第 2 次起**）在调模型前注入队首为 user 消息并发 `input_injected{boundary:'intra_turn'}`；回合结束后剩余项进入 `QUEUE_AUTOSTART_MS=400` 驻留窗口，超时逐条起新回合（边界 `inter_turn`）。
- [ ] **Step 5**：实现 auto-restore：取消终态时判定「纯取消 + 队空 + 无新输入 + 该回合用户消息后仅合成内容」→ 移除该回合消息、终态带 `restoreText`。
- [ ] **Step 6**：运行 `node --test src/core/test/session.test.mjs`——预期：全绿。
- [ ] **Step 7**：提交：`git commit -m "feat(SP002): 实现打断语义与输入队列（SL-04/SL-05）"`。

---

### Task T7：storage 模型档案与凭据仓库（MM-01…MM-07）

**Files**：
- Create: `src/storage/paths.ts`、`src/storage/config-store.ts`、`src/storage/credentials.ts`、`src/storage/profiles.ts`、`src/storage/test/*.test.mjs`

**Interfaces**：
- Consumes: core `TurnSnapshot`
- Produces:
  - `dataRoot(): string`——`path.join(os.homedir(), '.budingx')`（不硬编码用户名/盘符）。
  - `type ModelProfile = { id: string; label: string; baseUrl: string; model: string; apiKeyRef: string; capabilities: { tools: boolean }; createdAt: string; updatedAt: string }`
  - `type ConfigFile = { version: number; defaultModelId?: string; models: ModelProfile[] }`
  - `class ConfigStore { load(): ConfigFile; save(cfg: ConfigFile): void; }`——原子写（`tmp → fsync → rename`）、迁移前留 `.bak`、未知字段保留、损坏时备份并抛明确错误（不静默清空）。
  - `class CredentialStore { get(id: string, host: string): string | undefined; set(id: string, host: string, key: string): void; remove(id: string): void; list(): { id: string; host: string }[]; }`——`(id, host)` 双键绑定，host 不符即视为无 key。
  - `createProfile(input): ModelProfile`、`validateProfileInput(input): void`、`mergeSources({args, env, file}): ResolvedConfig`（优先级 CLI > env > file，保留 0.1.1 用法）。

- [ ] **Step 1**：写 `src/storage/test/config-store.test.mjs`（用临时 HOME，**通过注入 home 解析函数**而非改真实 home）：
  - `CRUD 持久化并跨进程加载`（写入→新 store 读回）、`写入为原子且中断不留半写文件`（断言无残留 tmp）、`配置文件带 schema 版本字段`。
  - `未知字段保留`：写入含 `futureField` 的 fixture，读回后仍在。
  - `损坏配置备份并明确报错`：断言抛错、`.bak` 存在、原文件未被静默清空。
  - `版本迁移钩子`：旧版本 fixture 迁移到当前版本并留 `.bak`。
- [ ] **Step 2**：写 `src/storage/test/credentials.test.mjs`：
  - `key 仅存于专用凭据文件`（断言 config.json 不含 key 字面量）、`host 不符时视为无 key`、`rm 档案连带删 key`、`孤儿 key 诊断（不静默删除）`、`UI 回显仅末 4 位`（工具函数 `maskKey(key)`）。
- [ ] **Step 3**：写 `src/storage/test/profiles.test.mjs`：
  - `非法输入显式校验错误且不落盘半合法档案`（超长名、控制字符、带凭据的 URL、重复 label）。
  - `三源合并优先级 CLI>env>file`，且 0.1.1 的 env/参数用法完整保留。
  - `切换模型不清历史且自下一回合生效`——与 T5 联测（**Review Focus 第 3 条**）。
  - `改 base URL 到另一主机后旧 key 不被转发`（**Review Focus 第 4 条**）：断言 `credentials.get(id, newHost) === undefined`，且 `mergeSources`/provider 组装时不会把旧 key 拼到新 host。
- [ ] **Step 4**：运行 `node --test src/storage/test/*.test.mjs`——预期：FAIL，RED。
- [ ] **Step 5**：实现 `paths.ts`/`config-store.ts`/`credentials.ts`/`profiles.ts`。
- [ ] **Step 6**：运行 `node --test src/storage/test/*.test.mjs`——预期：全绿。
- [ ] **Step 7**：提交：`git commit -m "feat(SP002): 实现模型档案持久化与凭据隔离（MM-01…MM-07）"`。

---

### Task T8：TUI 渲染 reducer（TC-02）

**Files**：
- Create: `src/tui/render/reducer.ts`、`src/tui/render/types.ts`、`src/tui/test/reducer.test.mjs`

**Interfaces**：
- Consumes: core `SessionEvent`
- Produces: `type Frame = { staticLines: string[]; liveLines: string[]; status: { state: SessionState; note?: string }; queue: { id: string; preview: string }[]; approval?: { requestId: string; name: string; summary: string } }`；`reduceFrame(frame: Frame, event: SessionEvent): Frame`——纯函数；`renderTextLines(text, width): string[]`——按显示宽度折行，**CJK/emoji 宽度正确、不切字**（**Review Focus 第 5 条**）。

- [ ] **Step 1**：写 `src/tui/test/reducer.test.mjs`：fixture 事件流回放，断言 delta 文本**按帧合并**（不逐字符重排）、终态切换原子（live→Static 无重复段无丢段）、宽度计算对 `你好`/`👍`/emoji 组合正确。
- [ ] **Step 2**：运行 `node --test src/tui/test/reducer.test.mjs`——预期：FAIL，RED。
- [ ] **Step 3**：实现 `reduceFrame` 与 `renderTextLines`（宽度用 `string-width`）。
- [ ] **Step 4**：运行 `node --test src/tui/test/reducer.test.mjs`——预期：全绿。
- [ ] **Step 5**：提交：`git commit -m "feat(SP002): 实现 TUI 事件到帧模型的渲染 reducer（TC-02）"`。

---

### Task T9：TUI 多行编辑器（TC-03）

**Files**：
- Create: `src/tui/editor/buffer.ts`、`src/tui/editor/keys.ts`、`src/tui/test/editor.test.mjs`

**Interfaces**：
- Consumes: `string-width`
- Produces: `class EditorBuffer { lines: string[]; cursor: { line: number; col: number }; history: string[]; setText(t): void; getText(): string; insert(text): void; newline(): void; backspace(): void; delete(): void; moveLeft/Right/Up/Down(): void; moveHome/End(): void; undo(): void; recallPrevious()/recallNext(): void; }`；`applyKey(buf, key): { handled: boolean; submit?: boolean; escape?: boolean; interrupt?: boolean }`。

- [ ] **Step 1**：写 `src/tui/test/editor.test.mjs`：
  - 多行输入与光标行列移动；`↑/↓` 召回历史输入；多行粘贴不误发（`applyKey` 对 paste 内容插入为文本，不产生 submit）；中文/emoji 宽度定位不错位（**Review Focus 第 5 条**）。
  - undo 栈：连续插入后 undo 回到上一步。
- [ ] **Step 2**：运行 `node --test src/tui/test/editor.test.mjs`——预期：FAIL，RED。
- [ ] **Step 3**：实现 `EditorBuffer` 与 `applyKey`（键位表：Enter=提交（多行模式下 Shift/Ctrl+Enter 换行）、Esc=打断/回收、Ctrl+C=打断或退出、↑↓=历史）。
- [ ] **Step 4**：运行 `node --test src/tui/test/editor.test.mjs`——预期：全绿。
- [ ] **Step 5**：提交：`git commit -m "feat(SP002): 实现多行输入编辑器与键位映射（TC-03）"`。

---

### Task T10：TUI 按键与审批交互（TC-04、TC-05）

**Files**：
- Create: `src/tui/approval.ts`、`src/tui/test/keys.test.mjs`

**Interfaces**：
- Consumes: T5 `Session`、T9 `applyKey`
- Produces: `createInkApprovalGateway(): ApprovalGateway`；`resolveApproval(frame, decision): Frame`

- [ ] **Step 1**：写 `src/tui/test/keys.test.mjs`：
  - 执行中 Esc → `session.interrupt('user')` 被调用（打桩断言）；执行中输入 → 入队且有可见指示；空闲 Esc → 回收可编辑排队项；空闲 Ctrl+C 双按退出、执行中单次 Ctrl+C = 打断。
  - 审批卡仅渲染队首；用户正在输入时抑制、停打重现；决策 resolve 恰一次；取消时清空；UI 无「已选仍显示」残留（**竞态注入**：审批 pending 时连续按两次决定键，断言只生效一次且卡消失）。
- [ ] **Step 2**：运行 `node --test src/tui/test/keys.test.mjs`——预期：FAIL，RED。
- [ ] **Step 3**：实现审批网关与卡状态机（claim-once 语义、输入抑制、取消清空）。
- [ ] **Step 4**：运行 `node --test src/tui/test/keys.test.mjs`——预期：全绿。
- [ ] **Step 5**：提交：`git commit -m "feat(SP002): 实现按键语义与审批交互（TC-04/TC-05）"`。

---

### Task T11：TUI 应用装配、非 TTY 与构建迁移（TC-06、TC-07）

**Files**：
- Create: `src/tui/app.tsx`、`src/tui/commands.ts`、`src/tui/cli.ts`（新）
- Modify: `src/tui/src/cli.ts`、`src/tui/src/provider.ts`、`src/tui/src/config.ts`（**删除**，内容已迁入 provider/storage/tui）
- Modify: `src/tui/test/cli.test.mjs`、`src/tui/test/runtime.test.mjs`（引用路径随 bin 变更更新）

**Interfaces**：
- Consumes: T3 provider、T5/T6 session、T7 storage、T8/T9/T10 tui
- Produces: `src/tui/cli.ts` 入口——`--help`/`--version`/`--prompt`/交互模式；`src/tui/commands.ts` 导出 `runCommand(text, ctx): Promise<CommandResult>`，命令族 `/help` `/config` `/model` `/models` `/provider` `/clear` `/exit`

- [ ] **Step 1**：写 `src/tui/test/cli.test.mjs` 新版断言：
  - `--help`/`--version` 不依赖配置；非法选项与缺模型确定性报错（**缺凭据确定性报错**）。
  - `--prompt` 单次路径：stdout 非 TTY 时**无 ANSI 污染**、只输出纯文本；本地 fixture server 返回 SSE → 输出包含内容、退出码 0。
  - `/model` 切换**不清历史**（Review Focus 第 3 条的功能用例：切换后下一回合的请求体含历史）。
  - 管道 EOF（stdin 提前关闭）时回合仍完成且正常退出（保留 0.1.1 行为）。
- [ ] **Step 2**：运行 `node --test src/tui/test/cli.test.mjs`——预期：FAIL，RED。
- [ ] **Step 3**：迁移旧 `src/tui/src/*`：删除 `src/tui/src/`，把 `cli.ts` 放到 `src/tui/cli.ts`，`provider.ts` 的 SSE 逻辑已在 T2/T3 迁入 `src/provider/`，`config.ts` 的 `normalizeBaseUrl`/`loadConfig` 迁入 `src/storage/profiles.ts`（**保留 0.1.1 的全部校验语义**：HTTPS/loopback 规则、模型名长度、key 无换行、timeout 范围、未知选项报错）。
- [ ] **Step 4**：实现 `src/tui/app.tsx`（Ink 8）：`<Static>` 落 scrollback + live 区、`<PromptEditor>`、`<QueueStrip>`、`<ApprovalDialog>`、`<StatusBar>`；delta 合帧 `maxFps=30`；**不启用 alt-screen**。
- [ ] **Step 5**：实现 `src/tui/commands.ts` 与 `cli.ts` 装配（env/args/file 三源合并 → profile → provider → session → Ink 渲染）。
- [ ] **Step 6**：实现 resize 基本处理（宽度变化重排不崩、不错位）。
- [ ] **Step 7**：运行 `node --test src/tui/test/*.test.mjs` 与 `npm run build`——预期：全绿、编译通过。
- [ ] **Step 8**：提交：`git commit -m "feat(SP002): 迁移并重建 TUI 应用层，接入 Ink 对话界面（TC-06/TC-07）"`。

---

### Task T12：构建、制品边界与全量回归（TC-08、TC-01、PS-07、SL-09）

**Files**：
- Create: `scripts/checks/`（T1 的检查器完善）、`src/tui/test/pack.test.mjs`（或纳入 `scripts/release` 既有 tarball smoke）
- Modify: `package.json`（`test` 串联全部）、`THIRD-PARTY-NOTICES.md`、`src/tui/package.json`、`src/tui/README.md`、`docs/development.md`、`docs/architecture.md`、`docs/current-status.md`

- [ ] **Step 1**：写制品边界测试：断言 `src/tui/package.json` 的 `files` 只含 `dist/`、`README.md`、`LICENSE`；`dependencies` 键集合恰为 `{ink, react, string-width}`；`bin.budingx === 'dist/tui/cli.js'`；`engines.node` 沿用 `>=22.18.0`。
- [ ] **Step 2**：运行 `npm run build`——预期：产物 `dist/{core,provider,storage,tui}` 齐全、`dist/tui/cli.js` 存在。
- [ ] **Step 3**：运行 `npm pack --dry-run`（在 `src/tui`）并核对清单——预期：无源码 `.ts`、无 `node_modules`、无开发依赖。
- [ ] **Step 4**：运行**隔离安装 smoke**（仓库外临时目录 `npm install <tarball>` 后运行 `budingx --version` 与本地 fixture `--prompt` 请求）——预期：安装成功、bin shim 可用、真实进程请求成功；记录实际命令与输出。
- [ ] **Step 5**：运行全量 `npm test`——预期：全部通过；**记录实际用例数量**（不得以「0 tests」或全 skip 充数）。
- [ ] **Step 6**：更新 `THIRD-PARTY-NOTICES.md`（ink 8.0.0 MIT、react 19.x MIT、string-width 9.x MIT，注明仅用于渲染层）。
- [ ] **Step 7**：更新 `docs/development.md`、`docs/architecture.md`（DRAFT→SP002 实况）、`docs/current-status.md`、`src/tui/README.md`（新命令族、配置来源、破坏性变更说明）。
- [ ] **Step 8**：提交：`git commit -m "test(SP002): 完成制品边界验证与全量回归，更新文档与许可登记"`。

---

### Task T13：交付记录与合入 master

**Files**：
- Create: `SP/SP002/test-report.md`
- Modify: `SP/SP002/requirements-summary.md`、`SP/SP002/*/STATUS.md`

- [ ] **Step 1**：写 `SP/SP002/test-report.md`：AC → 任务 → 文件 → 测试用例 → 命令/cwd → **实际数量/结果** → 证据。逐条 32 条 AC，未执行为 `UNVERIFIED`（live 凭据缺失的 PS-08 记 UNVERIFIED 并写恢复条件），失败为 `FAIL`。
- [ ] **Step 2**：更新 `SP/SP002/requirements-summary.md` 阶段勾选与需求索引（下一步列更新）。
- [ ] **Step 3**：更新四个 `SP/SP002/*/STATUS.md`：阶段清单、批准原话、实际提交号、验证结果、遗留项。
- [ ] **Step 4**：执行 `git diff master...HEAD --stat` 自查范围，确认无依赖/日志/凭据/产物入库。
- [ ] **Step 5**：按 [buding-merge](../buding-merge/SKILL.md) 规程合入 master（本地合并，**不推送、不打标签、不发布**），并在 STATUS 记录 merge 结果。
- [ ] **Step 6**：进入 SP003 SDD 前置工作（需求 intake 与设计准备；实现仍需单独启动授权）。

---

## 计划自检（writing-plans 自检清单）

1. **Spec 覆盖**：设计 §3.1–§3.7、§5 失败路径、§6 AC 映射的每一条均在 T1–T13 有归属任务；32 条 AC 覆盖表见「任务总览与 AC 覆盖」，无遗漏。
2. **Step 粒度**：每个 Step 给出一个可写出的确定动作（测试名+断言、签名+取值、命令+预期输出）；无「TBD」「适当处理」类空行。
3. **类型一致**：`SessionEvent`/`SessionState`/`TurnOutcome`/`NoticeCode`/`ErrorInfo`/`Usage`/`TurnSnapshot`/`ModelProvider`/`ProviderEvent`/`ToolHandler`/`ApprovalGateway`/`ModelProfile`/`Frame`/`EditorBuffer` 在本计划各任务间命名一致（与设计 §3.2/§3.4/§3.5 一致）。
4. **Review Focus**：5 条各有归属任务与具体断言（RF1→T6、RF2→T6、RF3→T7+T5+T11、RF4→T7、RF5→T8/T9/T10）。
5. **比例**：计划约 340 行，设计 257 行——计划长度与设计相当，未把实现代码抄进计划。

## 未决与延期（不阻塞本轮）

- **PS-08 live 证据**：缺真实 Provider 凭据与预算 → 验收时若无凭据记 `UNVERIFIED`，恢复条件=用户提供任一 OpenAI 兼容服务凭据与费用上限。不用 mock 冒充通过。
- **人工 smoke 项**（TC-02/03/04/07 的 Windows Terminal + ConHost 真终端部分、CJK/IME 打字体验 R1 门槛）：无真 TTY 自动化弱 → 记 `UNVERIFIED` 并附人工清单，供用户验收时补证据。
- **输入历史跨会话持久化**：归 SP005。
- **工具级联取消策略**：归 SP003（SP002 默认不继承旧仓的兄弟级联假设）。
