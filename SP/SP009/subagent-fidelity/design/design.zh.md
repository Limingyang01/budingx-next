# SP009 追加 · subagent-fidelity — 设计（v1，自审通过）

关联：[requirements.md](../requirements.md) · 基线 master `0af9249` · 随 0.9.1 交付。

## 1. 契约变更

### 1.1 事件（`src/core/events.ts`）
- `turn_started` 增加可选 `notification?: boolean` 与 `display?: string`（简洁展示文本）。
- `input_injected` 增加可选 `display?: string`。

### 1.2 会话（`src/core/session.ts`）
- `QueuedInput` 增加 `notice?: string`。
- `enqueueNotification(text, notice)`：把 `notice` 存到队列项；`input_queued.preview` 使用 `notice`（无则退回首行）。
- `startTurn`/`injectQueued`：向 `turn_started`/`input_injected` 透传 `notification` 与 `display=notice`。

### 1.3 渲染（`src/tui/render/reducer.ts`）
- `turn_started`：`notification` 为真时渲染 `{kind:'meta', text: display}`，绝不把 XML 当 `kind:'user'`。
- `input_injected`：`notification` 为真时同样渲染 `meta`（且不更新 `lastQuestion`），否则维持用户输入行为。

### 1.4 子代理预算（`src/core/agent-runtime.ts`，与 LF-03 同处）
- `tokenLimit` 缺省 `Infinity`；仅显式 `tokenLimit` 启用。`maxIterations: spawnOptions.maxTurns ?? definition.maxTurns`（无默认值）。

## 2. 失败与恢复
- 通知 XML 为空 → 不排队（既有行为）。
- 无 `display`（旧调用）→ 转录不新增 meta 行，但仍保留 `agent_notification` 提示；绝不回退成展示原始 XML。
- reducer 对未知 kind 维持既有默认分支。

## 3. 变更集与 AST
改：`events.ts`、`session.ts`、`agent-runtime.ts`、`render/reducer.ts`、`agent-runtime.test.mjs`。
新：`sp009-agent-notify.test.mjs`。
AST 映射：session.ts ↔ QueryEngine.ts（已映射）；agent-runtime.ts ↔ tools/AgentTool（需补映射）。

## 4. AC 映射
SF-01/03/04/05 → §1.1–1.3（测试 N-01/N-02 断言 meta 行、无 XML、模型上下文仍含 XML）；SF-02 → §1.2；LF 预算 → §1.4（测试「未显式设置 tokenLimit 不再中断」）。
