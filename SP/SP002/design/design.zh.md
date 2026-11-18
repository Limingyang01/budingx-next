# SP002 设计 · 模型与会话闭环

> 本历史记录沿用当时的 SP 编号，现行排期及新旧编号见[路线图 r8](../../../docs/iteration-plan.md)。

版本：**v0.3 approved**——v0.2 draft 经独立 builder 复核（9 问 + 勘误），处理见 §10；**用户 2026-11-16 会话批准「继续SP002,我批准了设计」**，正文自 v0.2 起无实质变更，本版仅登记批准身份｜更新：2026-11-16｜覆盖需求：provider-streaming / model-management / session-lifecycle / tui-conversation（四份 v0.1 需求均已获用户批准 2026-11-16）
基线：master `3c166cb` + 未提交的 SP002 记录文件；本轮设计/计划为**中文单份**（按新版 SP 规范）。
原始材料：[迭代汇总](../requirements-summary.md)、[旧仓机制盘点](../attachments/old-repo-mechanism-inventory.md)（内部参考，禁入制品）、[O8 调研·Ink](../attachments/o8-research-ink.md)、[O8 调研·替代路线](../attachments/o8-research-alternatives.md)、[能力清单](../../SP001/capability-baseline/capability-manifest.md)、[仓库布局](../../../docs/repository-layout.md)、[npm 发布方案](../../../docs/npm-release-plan.md)。

> **批准语义（新版约定）**：本设计是本轮唯一常规人工审阅点。批准后覆盖：计划编写、实现、测试、交付与各阶段**本地提交**（提交说明中文）。用户验收、合并、推送、npm 发布仍各自独立授权。文中未标 USER_CONFIRMED 的技术决定均为 MODEL_PROPOSED，可在审阅时逐条否决；标「我的判断」的是 Agent 代决项。

---

## 1. 背景与目标

| 面 | 现在（0.1.1 预览） | 本轮后 |
| --- | --- | --- |
| 配置 | 仅环境变量/参数；`/model` 清空会话 | 模型档案持久化 `~/.budingx`，CRUD+验证，切换不清史、回合快照隔离 |
| Provider | SSE 分帧写在 CLI 内，遇 tool_calls 直接报错 | 独立 provider 模块：tool_calls 组装、错误分类、有界重试、取消 |
| 会话 | 无状态机、执行中吞输入 | 显式状态机 + 类型化事件契约 + 双中断（Esc 打断 / 排队补充）+ 审批最小闭环 |
| TUI | readline 行模式 + 裸 stdout | Ink 8.x 对话式 TUI（**用户已拍板沿用老仓库同款框架**），多行输入自研 |
| 构建 | `tsc -p src/tui` | Core/Provider/Storage/TUI 四模块编译内联进单一可发包 `budingx`，边界检查落地 |

不包含（路线图归属）：真实工作区工具（SP003/004）、转录持久化与恢复（SP005）、headless/滚动深优化（SP006）、协议扩展（SP007）、跨端共享（SP010）、发布链路扩展（SP011）。

## 2. 用户决定登记（USER_CONFIRMED，全部 2026-11-16）

| # | 原话/来源 | 含义 |
| --- | --- | --- |
| U1 | 「继续SP002迭代的开发工作」 | 开轮授权 |
| U2 | 「没有指定哪家服务」 | provider 按 OpenAI 兼容通用设计，不绑定厂商 |
| U3 | 「有时候想到问题会补充打断执行」+「这两种情况都有吧」 | 双中断模式都是一等场景 |
| U4 | 「批准」（对应「批准，进设计」） | 需求 v0.1 批准、设计轮启动 |
| U5 | 「没有版权问题你直接使用一样的即可，无需再调研」 | **O8=Ink**（与老仓库同框架）；SP001 设定的逐项实测门槛由用户豁免，风险改为实现期早期 smoke 兜底（§7-R1） |
| U6 | 既有：Core 零框架、TUI 层允许 MIT 框架、Node-only、`~/.budingx`、O1=A/O2=A/O5=B | 直接约束本设计 |

已关闭遗留：**O8**=U5；**O6 Core 独立成包**=维持默认「同仓目录不成包」（本设计 §3.1 落实，随批准生效）；**live 凭据**仍 OPEN（只影响 PS-08/TC 验收时点，不阻塞）。

## 3. 架构

七问总表（细节见各小节）：

| 架构问题 | 本设计的回答 |
| --- | --- |
| 谁拥有行为 | Core=会话/回合/事件契约/队列/快照；Provider=协议适配与流解析；Storage=配置/凭据仓库；TUI=渲染与按键，**不含业务判断** |
| 复用什么 | `src/tui` 现有 SSE 分帧/URL 校验/安全输出迁入 provider/tui（SP001 AC-12 指定的一次迁移）；Ink 8 作渲染底座（U5） |
| 跨越什么 | 本轮仅**进程内**接口（core ⇄ tui 以事件订阅耦合）；无 HTTP/WS/子进程新增（宿主契约留 SP006+，事件形状自本轮即可序列化） |
| 状态放哪里 | 会话=内存（Core）；配置/凭据=Storage 落 `~/.budingx`；临时 UI 态（输入缓冲/滚动）=TUI 本地 |
| 谁受影响 | 仅 `budingx` npm 包与 `~/.budingx` 新文件；旧仓/旧数据零接触；桌面/插件消费者未出现 |
| 如何失败 | 断流→错误分类不崩；重复/迟到事件→终态至多一次守卫；取消→有界终止链；崩溃→光标/raw-mode 恢复 |
| 如何证明 | §6 映射表：fixture/单测/真实进程/人工清单/live 四层 |

### 3.1 模块拓扑（落实 O6=同仓）

```text
src/
  core/        # 类型+状态机+事件契约+输入队列（零 UI、零 IO 副作用）
  provider/    # OpenAI 兼容实现（迁入现 streamChat），implements core.ModelProvider
  storage/     # config/credentials JSON 仓库，implements core 定义的接口；唯一数据根 ~/.budingx
  tui/         # Ink 应用（本目录仍是唯一发布单元 budingx）
```

- 依赖箭头：`tui → core ← provider`、`tui → core ← storage`；core 不 import 其余三者。
- 打包（v0.2 修正布局，Q5）：各模块源码**拍平到 `src/<mod>/` 直下**（`src/tui/cli.ts`、`src/core/session.ts`…；`src/tui/src/*` 连带迁移其 test 引用——**先补行为回归再动刀**，PS-01 基线语义不变）；单一 tsc 程序 `rootDir=src`、`outDir=src/tui/dist`（include 显式排除任何 `dist/`），产物即 `dist/core/*.js`、`dist/tui/cli.js`，**bin=`dist/tui/cli.js`**（相对 0.1.1 的 `dist/cli.js` 为路径变更，未发布前允许）；tarball 自包含、**无 workspace/file 依赖**（对齐 npm 发布方案）。
- 运行时 npm 依赖白名单（v0.2，Q4）：`ink`、`react`、**`string-width`**（编辑器宽度计算显式依赖，不蹭 ink 传递树；MIT，随 NOTICES 登记）。devDeps 增 `@types/react`（react 19 不内置类型），typescript 沿用 5.9.3；测试统一 **node --test**（需求文中「Vitest」为笔误级措辞，已勘误）。
- 边界检查（PS-07/SL-09 落地，SP001 AC-02 指派项）：`scripts/checks/module-boundaries.mjs` 扫描 import——core/provider/storage 禁止 UI/终端库；`src/tui/package.json.dependencies` 白名单 `{ink, react, string-width}`；并入 `npm test`，违反即失败。

### 3.2 事件契约（core/src/events.ts，宿主无关）

```ts
export type SessionState =
  | 'idle' | 'requesting' | 'streaming' | 'awaiting_approval'
  | 'tool_running' | 'cancelling'

export type TurnOutcome = 'completed' | 'error' | 'cancelled' | 'length_capped' | 'max_turns' | 'unknown'

export type TurnSnapshot = {
  modelId: string; model: string; baseUrlHost: string   // 域名脱敏，永不含 key
  capabilities: { tools: boolean }
}

export type SessionEvent =
  | { type: 'turn_started';       turnId: string; snapshot: TurnSnapshot }
  | { type: 'text_delta';         turnId: string; messageId: string; text: string }
  | { type: 'thinking_delta';     turnId: string; messageId: string; text: string }
  | { type: 'message_completed';  turnId: string; messageId: string; usage?: Usage }
  | { type: 'tool_call_completed';turnId: string; callId: string; name: string; input: unknown }
  | { type: 'approval_requested'; turnId: string; requestId: string; callId: string; name: string; summary: string }
  | { type: 'approval_resolved';  turnId: string; requestId: string; outcome: 'allow'|'deny'|'cancelled'; via: 'user'|'policy' }
  | { type: 'tool_result';        turnId: string; callId: string; content: string; isError: boolean }
  | { type: 'input_queued';       queueId: string; preview: string }
  | { type: 'input_injected';     turnId: string; queueId: string; boundary: 'intra_turn'|'inter_turn' }
  | { type: 'status';             state: SessionState; note?: string }
  | { type: 'notice';             level: 'info'|'warning'|'error'; code: NoticeCode; text: string } // api_retry/model_switch/…
  | { type: 'turn_finalized';     turnId: string; outcome: TurnOutcome; error?: ErrorInfo; usage?: Usage }
```

具名补全（v0.2，Q9）：

```ts
export type NoticeCode = 'api_retry' | 'stream_fallback' | 'late_event_dropped'
  | 'queue_recycled' | 'approval_dismissed' | 'config_migrated'
  | 'orphan_keys_found' | 'model_limit_reached'
export type ErrorInfo = { class: ErrorClass; code: string /* BUDINGX_<域>_<序号>，冻结入 constants */
  message: string /* 脱敏后 */; retryable: boolean; status?: number }
export type Usage = { inputTokens?: number; outputTokens?: number }
```

规则（v0.2 补回合语义，Q1）：**一个 turn = 一次用户提交的完整续跑链**——`turn_started` 与 `TurnSnapshot` 冻结**每次提交一次**，中途所有「工具结果回填→再次调模型」的迭代共用同一 `turnId`；`intra_turn` 注入边界**每次迭代各一次**（回填后、下次调用前）；迭代安全阀 `maxIterations` 默认 **32**（我的判断，可配），超限⇒`turn_finalized{outcome:'max_turns'}`+notice，不静默截断。**每 turn 至多一个 `turn_finalized`**（守卫丢弃迟到事件并发 `late_event_dropped` notice）；delta 必先于对应 completed；事件可 JSON 序列化（为 SP006+ 宿主预留，本轮不建 host/ 目录）；顺序不变量由 SL-02 fixture 断言。

### 3.3 会话与回合（core/src/session.ts）

**消息模型**：`Message { id, role, blocks: (text|thinking|tool_use|tool_result|interrupt_mark)[], meta }`；提交前 `normalizeForAPI`：孤儿 tool_result 剥离、tool_use id 去重、缺失补占位（行为规格=盘点 §2，实现自有）。

**状态迁移**（核心路径）：

```text
idle ──submit──▶ requesting ──首 delta──▶ streaming ──有 tool_use──▶ tool_running ──结果回填──▶ requesting(续轮)
                    │                        │                            │
                    └──────── interrupt( Esc / 队列steer / fatal / finalize ) ────────▶ cancelling ─▶ idle
streaming/requesting/tool_running ──工具声明需审批──▶ awaiting_approval ──allow──▶ 工具执行
    awaiting_approval ──deny（含该卡上按 Esc，v0.2/Q7）──▶ 合成 deny 结果 → tool_result 回填路径（回合继续）
    awaiting_approval 无卡时再按 Esc ──▶ 整回合打断（interrupt('user')，取消分派优先清审批队列）
```

**双中断语义（U3）**：

| | 打断改方向 | 排队补充 |
| --- | --- | --- |
| 触发 | Esc（执行中） | 执行中输入回车 |
| 动作 | `session.interrupt('user')` | 入 Core 队列（FIFO，SP002 单优先级） |
| 落史 | 部分输出**保留**；孤儿 tool_use 补 `is_error` 合成结果；追加 `interrupt_mark(reason:'user')` | 不打断；在**工具结果回填后、下次迭代模型调用前**注入为 user 消息（`input_injected intra_turn`）；finalized 后仍有剩余 ⇒ 自动 drain（v0.2/Q6）：驻留 `QUEUE_AUTOSTART_MS=400`（我的判断）窗口内按 Esc 可回收到输入框（`queue_recycled` notice），超时逐条起新回合——「空闲 Esc 回收」即指此窗口，TC-04 按键语义以本节为准 |
| 取消有界 | provider abort + 工具句柄 `cancel()`，超时常量 `CANCEL_BUDGET_MS=5000`（我的判断）后强制标记 | 无 |
| 收尾 | auto-restore：纯取消且队空、无新输入、该回合用户消息后仅合成内容 ⇒ 移除该回合内容并**把用户原文还原到输入框**（行为=盘点 §2） | steer 语义：steer 取消**不写** interrupt_mark（后续输入自带上下文） |

**审批最小闭环（SL-08）**：`ApprovalGateway.request(req): Promise<allow|deny>` 由宿主注入；TUI 提供交互实现（§3.6）；本轮无规则引擎（SP003），桩策略=每次询问。拒绝→合成 deny 结果回填、会话继续、无 pending 泄漏。

**工具接口（仅契约+测试桩）**：`ToolHandler { name, describe(input), requiresApproval?(input), execute(input, {signal, onUpdate}) }`；SP002 串行分派保序（并发调度归 SP003）；`tool_result` 上限 `TOOL_OUTPUT_CAP`（默认 32K 字符，我的判断）。

**配置快照（SL-06/MM-03）**：`TurnSnapshot` 于 `turn_started` 冻结；回合内 profile 修改不影响本回合；slash 与配置命令只在回合间处理（行为=盘点 §3 边界规则）。

### 3.4 Provider（provider/src/openai.ts）

```ts
export type ErrorClass = 'auth'|'not_found'|'rate_limited'|'overloaded'|'network'|'timeout'
  | 'aborted'|'invalid_stream'|'context_overflow'|'tool_unsupported'|'bad_request'|'unknown'
export type ProviderEvent =
  | { type:'text_delta'; text } | { type:'thinking_delta'; text }        // 非标准 reasoning 字段宽容映射
  | { type:'tool_call_delta'; index; callId?; nameDelta?; argsDelta? }
  | { type:'message_completed'; finishReason:'stop'|'tool_calls'|'length'|'content_filter'|'unknown' }
  | { type:'retry'; attempt; maxAttempts; delayMs; errorClass }
  | { type:'failed'; error: ProviderError }                              // 终态错误，含脱敏 message
```

- 迁入现 `streamChat` 全部分帧/限额/HTTPS 行为（PS-01 回归基准），新增 tool_calls 跨事件组装（PS-02）。
- 重试（PS-04）：`retryable = {rate_limited, overloaded, network, timeout}`；指数退避 base 500ms×2ⁿ±jitter，**上限默认 5 次**（我的判断，旧仓为 10），尊重 `Retry-After`；重试仅同 model 同请求——**provider 层无换模型 API**（U2 通用设计的结构性保证）；连续 overloaded 达上限→`failed` 并 notice 提示，是否 fallback 由**会话层未来决定**（本轮不实现）。
- 取消（PS-05）：`AbortSignal.any([用户, 超时])` 贯穿 fetch/reader；abort 归类 `aborted` 不重试。
- 限额可配置（PS-06）：`ProviderLimits { eventBufferBytes=1MiB, maxResponseChars=64KiB(默认，替代预览 32KiB 硬编码), connectTimeoutMs, idleStreamTimeoutMs }`。
- 连通验证探测（v0.2/Q8）：独立入口 `probe(profile, opts)`——默认非流式最小请求（`messages:[{role:'user',content:'ok'}]`、`max_tokens:1`、10s 硬超时），按 §3.4 错误分类返回结果；`opts.tools=true` 时追加一次带静态 echo tool 的小请求以验证工具能力（仅显式触发，控制 live 成本，计入验收预算）。探测是**同档案**显式调用，不违反「无换模型 API」约束（该约束专指生成路径的静默降级）。

### 3.5 模型管理与存储（storage/src/*.ts）

```jsonc
// ~/.budingx/config.json（version 1）
{ "version": 1, "defaultModelId": "m1",
  "models": [ { "id":"m1","label":"显示名","baseUrl":"https://api.example.com/v1",
                "model":"model-name","apiKeyRef":"m1",
                "capabilities": { "tools": true }, "createdAt":"…","updatedAt":"…" } ] }
// ~/.budingx/credentials.json（version 1；与 config 分离，导出/诊断默认排除）
{ "version": 1, "keys": { "m1": "sk-…" } }
```

- 档案 id 与凭据绑定（v0.2/Q3，封堵「删除重建继承旧 key」旁路）：`id` 由 `crypto.randomUUID()` 生成且**永不复用**；credentials 记录绑定 `(id, baseUrlHost)` 双键——任何读取时 host 不符即视为无 key（要求重输）；`rm` 档案默认连带删除其 key（确认提示）；启动时孤儿 key（无档案引用）诊断 + `orphan_keys_found` notice，可一键清理，不静默删除。MM-05 文件审查按此规则判定。
- 配置来源优先级（v0.2/Q2，兑现 R5「非破坏」）：`CLI 参数 > BUDINGX_* 环境变量 > config.json 默认档案`；env/参数路径完整保留（0.1.1 用法与 CI/`--prompt` 自动化不破），三源合并纳入 MM fixture。
- 写入：`tmp → fsync → rename` 原子替换；`version` 迁移前留 `.bak`；未知字段**保留**（前向兼容，MM-06 fixture）。
- Windows 权限：NTFS 继承用户配置文件 ACL，不另造加密（边界文档化；加密存储登记为未来候选，我的判断）。
- key 转发边界（MM-04）：`apiKeyRef` 属档案级；`baseUrl` 主机名变更 ⇒ 验证前要求显式重输 key（保留并升级预览的删 key 告警语义）。
- UI 回显仅 `…abcd` 后 4 位；日志经 §3.4 `ProviderError` 脱敏管道。
- 会话内命令：`/model [id]`、`/models`（列表）、`/provider add|edit|rm|check`（具体命令族实现期定，命令系统治理属 SP006）；`/model` 切换不清史（MM-03）。

### 3.6 TUI（tui/，Ink ^8.0.0 + react ^19，U5）

组件：`<Transcript>`（终态历史经 `<Static>` 落终端 scrollback + 当前回合 live 区）、`<PromptEditor>`、`<QueueStrip>`、`<ApprovalDialog>`、`<StatusBar>`。

- **渲染管线**：SessionEvent → reducer → 帧模型；delta 以 `maxFps=30` 合帧；live 文本按行揭示；终态原子切换（live→Static）。**不启用 alt-screen**（SP006 再评），回看用终端原生 scrollback——绕开 Ink alt-screen×resize 在修区。
- **键位（v0.2 修正）**：执行中 Esc=interrupt('user')（awaiting_approval 时分叉见 §3.3/Q7）；空闲/自动起回合驻留窗口 Esc=回收排队项；执行中输入=排队；**Ctrl+C：执行中单次=打断；空闲改为双按退出（第一下提示）——这是对 0.1.1「空闲单击即退出」的有意变更**（builder 勘误：预览实为单击退出，「保持预览语义」表述不成立；防误触优先，我的判断，**可否决**），Ink raw 模式下 Ctrl+C 为 0x03 输入字节、自行处理不依赖 SIGINT；↑/↓=输入历史。
- **多行输入编辑器（最大自研块，独立编写区①）**：自有 `EditorBuffer { lines[], cursor{r,c}, selection, undoStack, history }` + `string-width` 宽度定位；bracketed paste 走 Ink `usePaste`；IME 组合按终端最终串处理并做候选窗定位（`useCursor`）。
- **审批卡**：仅渲染队首、resolve-once（claim 语义）、用户输入中抑制停打重现、取消清空、无「已选仍显示」残留（TC-05；行为规格=盘点 §4）。
- **降级 shim（独立编写区②，v0.2 勘误）**：仅需自读 `NO_COLOR`（chalk 6 已处理 `FORCE_COLOR`/`TERM=dumb`，不重复造）；非 TTY 保持现有 `--prompt` 单次路径（TC-06）；Windows VT 依赖 Windows Terminal/conhost 现代版本，检测 `process.env.WT_SESSION` 与 ConHost 降级文案（实现期实测）。

### 3.7 许可与证据链（MIT 合规）

- `THIRD-PARTY-NOTICES.md` 追加：ink 8.0.0（MIT）、react 19.x（MIT）+ 直接依赖树（已核全 MIT/ISC/CC0，见 o8-research-ink ②）；产品代码引用第三方 API 正常书写，不复制第三方源码。
- **独立编写区**（多行编辑器、审批竞态守卫、状态机、渲染 reducer、输入队列）：实现只依据本设计 + CAP ID；**代码评审含与旧仓对应文件相似度抽查**（旧仓同层代码属泄露源码衍生，零复制容忍）；实现提交信息引用 CAP/AC ID 而非旧仓路径。

## 4. 变更集（Create/Modify 概览；精确文件在 plan.zh.md）

- 新建：`src/core/`、`src/provider/`、`src/storage/`（各含 src/、test/、tsconfig）；`scripts/checks/module-boundaries.mjs`；fixtures（SSE 录制流、假时钟重试、并发时序）。
- 改造：`src/tui/`（源码拍平 + Ink 应用化；cli.ts 收敛为装配层；streamChat/config 迁出；test 引用随 bin 路径更新）；根 `package.json`（build 图、scripts；devDeps 增 `@types/react`，typescript 沿用 5.9.3）；`src/tui/package.json`（deps+ink/react/string-width；bin=dist/tui/cli.js）。
- 文档：`docs/current-status.md`、`docs/architecture.md`（DRAFT→SP002 实况）、`README.md`（TUI 节）、`THIRD-PARTY-NOTICES.md`。
- 产品版本：实现完成并验收后经 `version:prepare` 定 **0.2.0**（pre-release 通道与否在发布授权时定；本轮不发布）。

## 5. 失败与取消路径（逐场景）

| 场景 | 行为 | 出口 |
| --- | --- | --- |
| 流截断/非法事件 | `failed(invalid_stream)`，不重试同一坏流 | notice+终态 error |
| 429/5xx 超限 | 有界重试后 `failed` | 终态 error，文案含建议 |
| 取消与完成竞态 | 先到者定终态，守卫丢弃后者（notice 记录） | 终态恰一次 |
| 审批等待中退出/取消 | pending 请求整体 reject+清空 | 无泄漏 |
| 配置写失败/损坏 | 报错+备份保留，不静默清档 | MM-06 |
| TUI 崩溃 | Ink unmount + 光标/raw-mode 恢复自检；`--prompt` 路径不受影响 | 人工清单验证 |
| 队列注入时 API 合法性冲突 | 注入仅发生在 tool_result 回填之后边界（结构性规避） | SL-05 |

## 6. AC → 设计章节 → 验证层映射（32 条全量）

| AC | 设计 | 验证层 |
| --- | --- | --- |
| PS-01…06/07 | §3.4、§3.1 | fixture/单测；07=脚本检查 |
| PS-08 | §3.4 | live（凭据到位时）；否则 UNVERIFIED |
| MM-01…07 | §3.5、§3.3 快照 | 单测（临时 HOME）+fixture；06=旧 fixture 回归 |
| SL-01…09 | §3.2、§3.3 | 单测+假 provider/桩工具时序；09=脚本检查 |
| TC-01 | **已由 U5 关闭**：交付=依赖登记+版本钉扎（THIRD-PARTY-NOTICES diff 检查） | 脚本+人工核对 |
| TC-02…07 | §3.6 | 渲染单测（帧模型断言）+ **Windows 人工清单**（WT+conhost 各一轮）；06=真实进程 |
| TC-08 | §3.1/§4 | 构建脚本 + `npm pack` 隔离安装 smoke |

## 7. 风险与开放项

- **R1 CJK/IME 打字体验（高，U5 豁免调研后的承接措施）**：Ink #759 open。缓解改为：实现里程碑 M1「垂直切片」即在 Windows Terminal + ConHost 人工 smoke（中文连打、粘贴、打断、resize、退出恢复）；**若不可接受，回退路线=E 混合自研输入层**（o8-research-alternatives ④ 已有预案），架构因事件契约解耦只需替换 tui 层。此为启用后续里程碑的条件，不阻塞设计批准。
- **R2 Ink 周级渲染 churn**：钉死 8.0.0，升级走独立变更+回归；alt-screen 不启用（§3.6）。
- **R3 多行编辑器成本**：估 2-3k 行含测试（我的感受值，非承诺）；M1 先交付「多行+光标+粘贴」最小可用，undo/选区 M3 补齐。
- **R4 live 凭据 OPEN**：PS-08/部分 TC 验收时点顺延，不冒充通过。
- **R5 预览用户升级**：0.1.1→0.2.0 配置不兼容（新增文件，非破坏）；破坏性升级说明按 O1=A 在 SP006/SP011 兑现。
- 回退：全部改动未发布前可整轮 revert；`~/.budingx` 新文件不参与发布包。

## 8. 里程碑（计划预览，plan.zh.md 细化）

M0 脚手架+边界检查 → M1 垂直切片（provider fixture 闭环+状态机+Ink 最小对话+CJK 人工 smoke=**R1 门槛**）→ M2 双中断+队列+审批闭环 → M3 模型管理持久化+快照+编辑器补全 → M4 构建/bin/tarball smoke+回归全量。

## 9. 变更记录

| 日期 | 变化 | 来源 |
| --- | --- | --- |
| 2026-11-16 | v0.1 draft 提交审阅；O8 依 U5 关闭为 Ink 8.0.0（spike 豁免，R1 承接）；O6 确认同仓目录 | Agent 综合 SP001 交接、双路调研与用户决定 |
| 2026-11-16 | v0.2 draft：builder 复核 9 问全部处理（无上抛未决项，其中 Ctrl+C 变更、queue 400ms 驻留、maxIterations=32、probe 形态、string-width 入白名单为 Agent 代决可否决）；3 处勘误修正 | 独立 builder 复核代理（ink/chalk tarball 实包取证） |
| 2026-11-16 | **v0.3 approved**：用户会话批准「继续SP002,我批准了设计」；正文无实质变更（仅登记批准身份与授权范围） | USER_CONFIRMED（用户 2026-11-16 会话原话） | 批准覆盖：计划编写、实现、测试、交付记录与各阶段本地提交（提交说明中文），以及完成后按 buding-merge 规程合入 master；**不含**用户验收、推送、打标签、npm 发布、远端设置、分支/worktree 清理 |

## 10. Builder 复核意见处理（v0.1→v0.2）

| # | 问题 | 处理 | 归属 |
| --- | --- | --- | --- |
| Q1 | 续轮 turn 边界/快照次数/注入边界/轮数上限未定 | §3.2 规则段：一提交=一 turn、快照一次、注入每迭代一次、`maxIterations=32`+`max_turns` 终态 | 代决（上限值可否决） |
| Q2 | env 配置去留/优先级未写 | §3.5：参数>env>文件，0.1.1 用法保留，三源合并入 fixture | 代决（兑现 R5 非破坏） |
| Q3 | apiKeyRef 复用 id 可静默继承旧 key；无孤儿回收 | §3.5：uuid 不复用 + (id,host) 双键 + rm 连带删 + 孤儿诊断 notice | 缺陷修复 |
| Q4 | 白名单与 string-width 自相矛盾；@types/react；测试框架措辞 | §3.1/§3.6/§4：显式入白名单；devDeps 修正；统一 node --test，需求 PS-01「Vitest」措辞勘误 | 缺陷修复 |
| Q5 | tsc 输出镜像与声称形状不符 | §3.1：源码拍平 `src/<mod>/`、bin=dist/tui/cli.js、先补回归再迁移 | 代决 |
| Q6 | 自动起新回合与空闲 Esc 回收互斥 | §3.3：finalized 后 400ms 驻留窗口内 Esc 可回收，超时自动 drain；TC-04 以此为准 | 代决（窗口值可否决） |
| Q7 | awaiting_approval 下 Esc 语义分叉 | §3.3：卡上 Esc=deny 当前请求（回合继续）；无卡再按=整回合打断 | 代决 |
| Q8 | `/provider check` 探测行为未定 | §3.4：probe() 最小请求 + 显式 tools 探测 + 成本边界 | 代决 |
| Q9 | NoticeCode/ErrorInfo/Usage 未定义 | §3.2：补全类型定义，错误码表实现期冻结进 constants | 补全 |
| 勘误 | 调研档 string-width 版本、chalk FORCE_COLOR、0.1.1 Ctrl+C 单击退出 | 已修正于 §3.6/§4 与调研档 errata 附注 | 事实修正 |
