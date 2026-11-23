# SP009 追加 · loop-context-fidelity — 设计（v1，自审通过）

关联：[requirements.md](../requirements.md) · 分支 `feature/SP009/fix-0.9.1` · 随 0.9.1 交付。

## 1. B 组 · 回合上限（LF-01…LF-04）

### 1.1 契约

- `SessionOptions.maxIterations?: number`：**缺省 = 无上限**（`while (true)`，终止信号为
  「模型不再返回工具调用」/中断/失败熔断/溢出不可恢复）。显式传入正整数时才设上限。
- `MAX_ITERATIONS` 常量保留但语义改为「无头显式上限的校验上界参考」，不再作为会话默认值。
- 交互入口（cli.ts 交互分支、runtime 交互装配）**不传** maxIterations。
- 无头入口新增 `--max-turns <n>`：正整数校验（1…10000），传入 session.maxIterations；
  达到上限 → outcome `max_turns` → headless subtype `error_max_turns`（现有路径不变）。
- 子代理（2026-11-23 用户要求对齐）：`spawnOptions.maxTurns ?? definition.maxTurns`，**不再有硬编码默认上限**；`tokenLimit` 缺省为 Infinity（不再默认 100k 预算中断），仅显式传入时启用。`SUBAGENT_MAX_TURNS`/`SUBAGENT_TOKEN_LIMIT` 保留导出兼容历史引用。
- 达到上限的 notice 文案仅在显式上限路径出现；交互默认不再出现「达到回合上限」。

### 1.2 安全网（不变）

工具连续失败熔断（MAX_TOOL_FAILURE_STREAK / MAX_REPEATED_TOOL_FAILURES）、
上下文溢出先压缩再重试一次、Esc/双 Ctrl+C 中断、排队注入边界。

## 2. C 组 · 上下文窗口（LC-01…LC-06）

### 2.1 模型元数据发现（LC-01）

`src/provider/openai.ts`：
- `discoverModels` 保持返回 `string[]`（兼容既有消费者）。
- 新增 `discoverModelMetadata(endpoint, apiKey, options): Promise<ModelMetadata[]>`，
  `ModelMetadata = { id: string; contextLength?: number }`；解析每个模型对象的
  `context_length` / `context_window` / `max_input_tokens`（正整数、≤ 10_000_000 才采信）。
- `src/tui/model-management.ts` 拉取模型列表时同时取元数据，写入档案 `contextWindow`
  **仅当档案未显式设置且发现值有效**（不覆盖用户自定义）；并缓存到内存供解析。

### 2.2 档案字段与面板（LC-02）

- `ModelProfile` 增 `contextWindow?: number`（config-store 类型；未知字段保留规则不变）。
- `/models` 面板编辑流程增加「上下文窗口（tokens，可留空=自动）」输入；留空清除字段。
- 校验：正整数；非法输入提示并不保存。

### 2.3 窗口解析（LC-03）

新增 `src/core/context-window.ts`（纯函数）：
```
resolveContextWindow({ envWindow?, profileWindow?, discoveredWindow? }): number
  优先级：envWindow > profileWindow > discoveredWindow > DEFAULT(200000)
  各项须为正整数，否则跳过
```
runtime 用「当前 config + 当前档案 + 发现缓存」在每次需要时解析（模型切换即生效）：
- session.contextBudget：runtime 维护一个**活对象** `{ maxTokens }`，解析值变化时更新；
  session 在压缩判定时读取 `options.contextBudget.maxTokens`（现有读法），无需改 session 读取逻辑。
- 状态栏占比、`/context` 网格、ToolSearch 门控统一用同一解析值。
- `BUDINGX_CONTEXT_WINDOW` 语义不变（全局显式覆盖，最高优先级，对齐参考仓 env 覆盖）。

### 2.4 默认启用自动压缩（LC-04）

cli.ts / runtime：**无论是否设置环境变量**，交互会话都携带解析后的 contextBudget。
修复「未设 env → contextBudget undefined → compactIfNeeded 直接返回」的缺陷。

### 2.5 触发阈值对齐（LC-05）

`src/core/context-budget.ts`：
- 新常量 `AUTOCOMPACT_BUFFER_TOKENS = 13_000`（参考仓同名缓冲参数，机制事实）。
- `triggerTokens({ maxTokens, ... })` = `max(maxTokens − AUTOCOMPACT_BUFFER_TOKENS, compactFloor + 1)`。
  真实大窗口下精确等于「窗口 − 13k」（对齐参考仓）；**安全不变量**：触发点恒高于压缩目标，
  否则极小窗口下「已超触发点但仍高于压缩目标」会一回合都裁不掉（端到端测试暴露并修复）。
  保留 `COMPACT_TRIGGER_RATIO` 导出但标记废弃，内部不再使用。
- 压缩目标 `compactFloor`（0.6×可用预算）与保留项机制不变；`/context` 展示的 triggerTokens 同源更新。
- 溢出恢复链（先压缩再重试一次）不变。
- 回合边界约束：确定性裁剪只切「用户回合」边界；单提示词的多工具迭代属同一回合，无可裁剪边界
  （`no_compactable_range`），此时不压缩是正确行为。多回合场景才触发裁剪 + 模型摘要。

### 2.6 压缩手段对齐（LC-06）

参考仓自动压缩调用模型生成摘要；本仓 0.9.1 对齐：`context/compact-summary.ts` 用独立撰写的提示词把被裁剪回合浓缩为续作摘要，`context-budget.compact` 以 `<compacted_summary>` 消息保留在压缩边界（`summaryText` 输入），同时保留 SP005 的约束/计划/工具状态保留项。模型摘要失败或中断时回退确定性裁剪。手动 `/compact` 同样走模型摘要。

## 3. 失败与恢复

- 元数据发现失败/字段缺失 → 跳过该来源，回退下一优先级；不阻断模型列表。
- 档案 contextWindow 非法 → 面板拒绝保存；解析时跳过。
- 窗口解析任何来源非法 → 默认 200k，状态栏标注来源不变。

## 4. 变更集与 AST

改：`core/session.ts`、`core/constants.ts`、`core/context-budget.ts`、`provider/openai.ts`、
`tui/cli.ts`、`tui/headless.ts`、`tui/runtime.ts`、`tui/model-management.ts`、`tui/model-manager.tsx`、
`storage/config-store.ts`（类型）、相关测试。
新：`core/context-window.ts`、`sp009-loop-context.test.mjs`、AST 映射并入 `scripts/review/sp009-ast.mjs`。
AST 映射：session.ts ↔ query.ts/QueryEngine.ts；context-budget.ts/context-window.ts ↔ context.ts/analyzeContext.ts/autoCompact.ts；
openai.ts ↔ providers/model 发现；cli/headless ↔ entrypoints/cli、cli/print。

## 5. AC 映射

LF-01/02 → §1.1；LF-03/04 → §1.1/1.2；LC-01 → §2.1；LC-02 → §2.2；LC-03 → §2.3；
LC-04 → §2.4；LC-05 → §2.5；LC-06 → §2.6。每条 AC 单元 + 功能用例；端到端见 requirements §3。
