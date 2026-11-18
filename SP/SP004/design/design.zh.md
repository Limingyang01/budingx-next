# SP004 · 真实编码任务 · 设计文档

- 需求 slug：`command-execution`、`coding-task-loop`、`git-worktree-safety`、`task-planning`
- 已确认 SP：SP004（USER_CONFIRMED，路线图 r6）
- 版本：v1.1
- 状态：**draft（待 Agent 自审）**
- 材料来源：
  - 路线图 SP004 行（`docs/iteration-plan.md`）— USER_CONFIRMED
  - 能力矩阵「终端及后台任务」「Git 与 worktree」「任务计划、追问与用户转向」— USER_CONFIRMED
  - 能力清单 CAP-L2-04/05/06/08、CAP-L3-09/15 — USER_CONFIRMED
  - 参考仓行为事实盘点（`skills/buding-sdd/references/reference-repo-inventory.md` §1/§3/§6/§7）与排查文档 §4 SP004 — 只读参考
  - 本仓既有实现：`src/core`（Session/权限/工具端口）、`src/workspace`（文件工具/策略/检查点）、`src/tui`（Ink 8）
- 身份区分：功能名称、出口门槛、三档权限语义为 USER_CONFIRMED；模块划分、契约形状、算法与交互细节为 MODEL_PROPOSED；未决点列于 §9。

---

## 1. 背景与目标

### 1.1 前后行为

| | 当前（master `76edf2c`） | 本轮目标 |
| --- | --- | --- |
| 命令执行 | **不存在**。`src/workspace` 只有 Read/Write/Edit/Glob/Grep 五个文件工具 | Agent 可执行真实进程命令：退出码/stdout/stderr 分离、跨平台 quoting、cwd/环境可控、超时、输出上限、后台任务可查可取消 |
| 编码闭环 | Session 有工具回合与迭代骨架，但**没有「测试失败→修复」语义**，也没有任何能产生失败输出的工具 | Agent 能完成定位→修改→运行测试→读取失败→修复→复测；用户可追问与转向 |
| Git 安全 | **不存在**。工作区工具与 Git 无关 | 识别脏工作区/staged/untracked；改动归属只含 Agent 自身；worktree 进出可恢复；无授权不执行提交/推送 |
| 计划与追问 | **不存在**。没有计划/待办状态 | 多步骤计划可拆解、展示、批准；计划模式阻断写操作；执行前基线校验；结构化追问可等待/取消 |

### 1.2 目标（出口门槛，USER_CONFIRMED）

1. 在隔离项目中完成「定位 → 修改 → 运行测试 → 修复」闭环。
2. 用户追问/转向、Git 脏工作区、Windows quoting、后台状态/取消/输出上限、自身修改撤销**有实测**。
3. **没有提交或推送授权不执行 Git 发布。**
4. 无旧仓源码/提示词/内部类型迁入；模块边界检查通过。

### 1.3 明确排除

| 排除项 | 归属 | 理由 |
| --- | --- | --- |
| 子代理派发、后台任务六件套（TaskCreate/TaskGet/…） | SP007 | 路线图依赖顺序 |
| 浏览器操作 / Computer Use | SP012 / SP013 | 现行范围，晚于 SP004 |
| 定时任务 | SP014 | 同上 |
| Desktop / VS Code / 远程 / IM | — | 现行范围外 |
| 无头 CLI 协议、完整斜杠命令面（`/plan`、`/tasks`、`/commit`、`/review`…） | SP006 / SP007 | SP004 交付底层能力与契约，命令族属体验主战场 |
| 跨会话恢复、项目记忆、上下文压缩对计划的影响 | SP005 | 依赖 SP004 产出 |
| 真实模型端到端（live Provider） | — | 依赖用户凭据；无凭据记 UNVERIFIED |
| npm 发布、打标签、远端设置 | — | 不在 2026-11-17 委托内 |

### 1.4 保留行为（不得回归）

- SP002 Session 契约：事件族、状态机、排队注入、双中断语义、工具回合装配。
- SP003 文件工具：读后编辑门、`.git` 底线、凭据底线、越界路径拒绝、diff/检查点撤销、@ 引用。
- SP003 三档权限：`仅可查看 / 工作区内修改 / 完全权限`，完全权限不绕过底线规则。
- 模块边界：`core` 不得依赖 IO 与 UI；`workspace` 不得依赖 TUI。

---

## 2. 当前状态（事实标注）

### 2.1 已存在（经源码核对）

| 事实 | 位置 |
| --- | --- |
| `Session` 有迭代循环（`MAX_ITERATIONS = 32`）、工具回合、审批挂起、队列注入与取消预算 | `src/core/session.ts` |
| 工具端口：`ToolHandler{name, parameters, summary, describe, requiresApproval?, capability?, target?, execute}` | `src/core/tools.ts` |
| 权限端口：`PermissionPolicy{decide, remember, getMode, setMode, onModeChanged}`；`PermissionRequest{tool, capability, path?}` | `src/core/permissions.ts` |
| 权限能力枚举只有 `'read' \| 'write'` | `src/core/permissions.ts` |
| 事件族 `SessionEvent` 为可辨识联合类型，含 `tool_result`/`change_set`/`denial_recorded`/`status` 等 | `src/core/events.ts` |
| 文件工具五个（Read/Write/Edit/Glob/Grep）由 `createWorkspaceTools` 装配，checkpoint 记录可撤销 | `src/workspace/tools.ts` |
| 策略底线：越界路径、凭据文件名、`~/.budingx` 数据根 → `deny`；`.git` 强制询问 | `src/workspace/policy.ts` |
| TUI 渲染层 `Frame` 含 transcript/approval/notices/changes/denials/permissionMode | `src/tui/render/types.ts` |
| 模块边界脚本禁止 `core` 依赖 `node:fs`/`node:child_process`/`node:http`… 与任何 UI 库；禁止 `core` 依赖 `provider/storage/tui/workspace` | `scripts/checks/module-boundaries.mjs` |
| 构建：`tsc -p src/tui/tsconfig.json`，`include` 覆盖 `../core ../provider ../storage ../workspace ./` | `src/tui/tsconfig.json` |
| 测试：`node --test src/*/test/*.test.mjs`（构建后跑 `.mjs` 测试） | `package.json` |

### 2.2 不存在（必须新建）

- `src/exec`（命令执行与后台任务管理）— 拟新增
- `src/git`（Git 只读状态、worktree、提交门禁）— 拟新增
- `src/plan`（计划/待办状态机、追问契约）— 拟新增
- `core` 侧命令执行端口与计划端口 — 拟新增（纯类型与状态机，无 IO）

### 2.3 假设（须在实施时验证）

- A-1：目标工作区存在 `git` 可执行文件（Git for Windows / POSIX git）。**未检测到时** Git 能力返回「非 Git 仓库或无 git 可用」，不得伪造状态。
- A-2：Windows 上 `cmd.exe` 与 `powershell.exe` 均可用；本轮默认解释器策略见 §4.2。
- A-3：`node:child_process.spawn` 支持 `windowsHide`；进程树终止依赖 `taskkill /T /F`（Windows）与进程组信号（POSIX）。

---

## 3. 方案总览：责任层与依赖

```text
┌─────────────────────────────────────────────────────────────┐
│ src/tui        Ink 8 宿主：命令卡片、计划卡片、追问卡片       │
│                （只消费事件与端口，不含业务判定）              │
├─────────────────────────────────────────────────────────────┤
│ src/core       纯契约与状态机（无 IO）：                      │
│   exec.ts      命令执行端口、结果形状、后台任务句柄契约        │
│   plan.ts      计划/待办状态机、计划模式、追问契约             │
│   coding.ts    编码任务目标状态机、完成证据判定                │
│   session.ts   既有回合编排（扩展：计划模式门、失败回喂）      │
│   permissions.ts 权限端口（扩展 capability: 'execute'）       │
├─────────────────────────────────────────────────────────────┤
│ src/exec       真实进程执行（node:child_process）             │
│ src/git        Git 只读状态/worktree/提交门禁（node:child_process）│
│ src/plan       计划与追问的宿主无关实现（状态机实现）          │
│ src/workspace  既有文件工具 + 策略 + 检查点（本轮复用）        │
└─────────────────────────────────────────────────────────────┘
```

**依赖规则（MODEL_PROPOSED）**

| 模块 | 允许依赖 | 禁止依赖 |
| --- | --- | --- |
| `src/core` | 纯类型 | 任何 `node:*` IO、任何 UI 库、任何其他 `src/*` 模块 |
| `src/exec` | `node:child_process`、`node:os`、`node:path`、`../core/*` | `../tui/*`、UI 库 |
| `src/git` | `node:child_process`、`node:fs`、`node:path`、`../core/*` | `../tui/*`、UI 库 |
| `src/plan` | `../core/*` | `node:fs`、`../tui/*`、UI 库 |
| `src/tui` | 全部 | — |

`src/exec` 与 `src/git` 需新增到 `scripts/checks/module-boundaries.mjs` 的 `RULES`：
`exec: { ui: UI_BANNED, io: [], dirs: ['tui'] }`、`git: { ui: UI_BANNED, io: [], dirs: ['tui'] }`、`plan: { ui: UI_BANNED, io: [], dirs: ['tui'] }`。
并需在 `src/tui/tsconfig.json` 的 `include` 增加 `../exec/**/*.ts`、`../git/**/*.ts`、`../plan/**/*.ts`。

---

## 4. 命令执行（command-execution）

### 4.1 core 端口（拟新增 `src/core/exec.ts`）

```ts
export type CommandCapability = 'read' | 'write' | 'execute'

/** 一次命令调用的规格（模型可提供）。 */
export type CommandSpec = {
  /** 命令文本（交给 shell 解释）。 */
  command: string
  /** 工作目录；缺省为工作区根。 */
  cwd?: string
  /** 追加的环境变量；与基线环境合并。 */
  env?: Record<string, string>
  /** 超时毫秒；缺省用 EXEC_DEFAULT_TIMEOUT_MS，> EXEC_MAX_TIMEOUT_MS 被夹紧。 */
  timeoutMs?: number
  /** 是否转为后台执行。 */
  runInBackground?: boolean
}

export type CommandOutcome = 'completed' | 'failed' | 'timeout' | 'cancelled' | 'blocked' | 'running'

export type CommandResult = {
  outcome: CommandOutcome
  /** 进程退出码；被信号终止、未启动或仍在后台运行时为 undefined。 */
  exitCode?: number
  stdout: string
  stderr: string
  /** stdout+stderr 合并后的最终文本（已截断并标注）。 */
  output: string
  /** 输出是否因上限被截断。 */
  truncated: boolean
  /** 原始字节数（截断前）。 */
  bytes: number
  durationMs: number
  /** 后台任务的句柄；前台执行时为 undefined。 */
  taskId?: string
  /** 因超过阻塞预算被自动转入后台（参考 F-02）。 */
  autoBackgrounded?: boolean
  /** 用户手动转后台（Ctrl+B；本轮仅数据位，交互属 SP006）。 */
  backgroundedByUser?: boolean
  /** 完整输出落盘路径（后台任务或超大输出，对齐 F-03/F-04）。 */
  persistedOutputPath?: string
  /** 落盘文件的字节数。 */
  persistedOutputSize?: number
  /** 命令是否被中断（对齐参考 `interrupted` 字段）。 */
  interrupted?: boolean
  /** 命令是否预期无输出（对齐参考 `noOutputExpected` 字段）。 */
  noOutputExpected?: boolean
  /** 失败/阻断原因（可读）。 */
  reason?: string
}

/** 核心只持有契约；真实执行由 src/exec 注入。 */
export interface CommandRunner {
  run(spec: CommandSpec, context: { signal: AbortSignal; cwd: string }): Promise<CommandResult>
  /** 查询后台任务状态与输出。 */
  status(taskId: string): CommandResult | undefined
  /** 取消后台任务（终止整棵进程树）。 */
  cancel(taskId: string): boolean
  list(): CommandResult[]
}
```

**关键设计点**

- `core` 只认识 `CommandSpec`/`CommandResult`/`CommandRunner`，不认识 `child_process`（满足模块边界）。
- 结果**始终**分离 `exitCode`/`stdout`/`stderr`；非零退出码不吞掉（CE-01/CT-08）。
- `outcome` 是可辨识枚举，不使用字符串自由态。

### 4.2 解释器与 quoting（CE-02 / CE-03）

**问题**：Windows 上 `cmd.exe` 与 `powershell.exe` 对引号的解释不同，同一命令串在两个解释器下行为不同。

**方案（MODEL_PROPOSED）**

1. 工具面提供两个工具：
   - `Bash`：POSIX 语义；在 Windows 上用 `cmd.exe /d /s /c` 包裹，在 POSIX 上用 `/bin/sh -c`。
   - `PowerShell`：Windows PowerShell 语义；在 Windows 上用 `powershell.exe -NoProfile -NonInteractive -Command`；**在 POSIX 上不可用**（返回明确失败「本平台无 PowerShell」）。
2. **元字符策略（明确规则，可复现）**：
   - `Bash` 工具在 Windows 上**不自动解释** `& | > < ^` 等元字符——因为 `cmd.exe` 一定会解释。改为：**`Bash` 工具在所有平台都把命令文本原样交给解释器，并要求调用方自行使用平台语法**；工具在结果中回显**实际使用的解释器**（`cmd.exe` / `sh` / `powershell.exe`）与**实际命令行**，使行为可复现、可诊断。
   - 工具参数另提供 `args: string[]`（可选）。提供时**绕过 shell**，直接以参数数组 spawn（无任何引号/元字符解释）。这是 Windows 上唯一能保证空格/Unicode 路径 100% 正确的路径。
3. **路径与 Unicode（CE-02）**：
   - `cwd` 统一解析为绝对路径并做边界检查（工作区内或显式授权的 worktree 目录内）。
   - `args` 数组形式下不做任何转义，空格与中文路径原样传递（Windows 使用 `windowsVerbatimArguments = true`）。
   - `command` 文本形式下，Windows 走 `cmd.exe` 的既有转义规则；文档与工具 `summary` 明确告知「含空格路径请用 `args` 形式」。
4. **环境（CE-15）**：基线环境为 `process.env` 的**白名单拷贝**（`PATH`、`HOME`、`USERPROFILE`、`TEMP`、`TMP`、`SystemRoot`、`ComSpec`、`LANG`…），**不**注入宿主无关的完整环境；`env` 传入项覆盖基线项；结果中不回显环境变量值。

### 4.3 超时、输出上限与交互式（CE-04 / CE-05 / CE-12 / CE-13）

| 关注点 | 规则（MODEL_PROPOSED） |
| --- | --- |
| 默认超时 | `EXEC_DEFAULT_TIMEOUT_MS = 120000`（2 分钟）——与参考 F-01 数值一致 |
| 最大超时 | `EXEC_MAX_TIMEOUT_MS = 600000`（10 分钟）——与参考 F-01 数值一致 |
| 硬上限 | `EXEC_HARD_TIMEOUT_MS = 900000`（15 分钟）；超过即拒绝启动并给出原因 |
| 环境变量覆盖 | `BUDINGX_EXEC_DEFAULT_TIMEOUT_MS` / `BUDINGX_EXEC_MAX_TIMEOUT_MS` 可覆盖默认与上限（对齐 F-01 的可配置性，但用新仓命名，不沿用旧名 `BASH_*`） |
| 阻塞预算 | `EXEC_BLOCKING_BUDGET_MS = 15000`（15 秒）——与参考 F-02 一致。前台命令超过此预算**自动转后台**（见 §4.4） |
| 输出上限 | `EXEC_OUTPUT_CAP = 32768` 字节（与 `TOOL_OUTPUT_CAP` 同量级）；stdout/stderr **分别**按上限截断，合并文本再截断到同一上限 |
| 截断标注 | 截断时在文本末尾追加 `\n… [输出已截断：显示 N 字节 / 共 M 字节]` |
| 超大输出落盘 | 输出超过 `EXEC_PERSIST_THRESHOLD`（默认 1 MB；参考 F-04 的阈值为 64 MB，本仓取更小以免占用磁盘）时，**完整输出落盘**到会话隔离目录，并回传 `persistedOutputPath` + `persistedOutputSize`（F-04）；模型可按需读取 |
| 交互式命令 | 显式失败：`CommandResult.outcome = 'failed'`，`reason` 指出「命令需要交互式输入，本产品不提供 TTY」。**判定方式**：命令文本命中已知交互族（`vim`/`nano`/`emacs`/`less`/`more`/`top`/`htop`/`ssh`/`psql`/`mysql`/`python`（无 `-c`）…），或请求 `interactive: true` 时 stdin 立即关闭 → 子进程因 EOF 退出 → 归类为 `failed` 并标注「疑似交互式」。**不无限挂起**。 |
| 阻塞等待类（CE-13） | 命令文本命中 `sleep`/`ping`/`timeout`/`wait` 等纯等待族时**拦截并拒绝**，返回 `outcome='blocked'`、`reason` 指引改用 `runInBackground`。可被 `allowBlocking` 显式放行（用于确实需要等待的测试）。 |

### 4.4 后台任务（CE-06 / CE-07 / CE-16 / CE-17）

> **v1.1 修正**：v1.0 曾声明「不落盘、仅驻内存」且「不实现自动转后台」，与参考 F-02/F-03 差距过大。本节按审计结论重写。

**模型**

```ts
export type BackgroundTask = {
  taskId: string
  command: string
  interpreter: string
  cwd: string
  startedAt: number
  state: 'running' | 'completed' | 'failed' | 'timeout' | 'cancelled'
  exitCode?: number
  stdout: string
  stderr: string
  truncated: boolean
  /** 完整输出的落盘路径（参考 F-03/F-04）。 */
  outputPath?: string
  /** 落盘文件的字节数。 */
  outputSize?: number
  /** 因超过阻塞预算被自动转入后台（参考 F-02）。 */
  autoBackgrounded: boolean
  /** 用户手动转后台（Ctrl+B，SP006 交互；本轮仅数据位）。 */
  backgroundedByUser: boolean
}
```

**规则**

1. **显式后台**：`runInBackground: true` → 立即返回 `{ outcome: 'running', taskId }`。
2. **自动转后台（v1.1 新增，对齐 F-02）**：前台命令超过 `EXEC_BLOCKING_BUDGET_MS = 15000` 未结束 → **自动转为后台任务**，工具结果回填明确说明：
   ```
   exit_code: <pending>
   background_task_id: <id>
   auto_backgrounded: true
   --- note ---
   命令超过阻塞预算（15s）已自动转入后台，输出写入：<outputPath>
   ```
   回合**不因**该命令阻塞等待而卡死；模型可在后续轮次查询状态。
3. **输出落盘（v1.1 新增，对齐 F-03）**：后台任务的完整输出**写入文件**，路径规则：
   - 根目录：`~/.budingx/sessions/<sessionId>/tasks/<taskId>.out`
   - 同会话内唯一；与会话隔离；**不写入用户项目目录**。
   - 内存中同时保留截断快照（`EXEC_OUTPUT_CAP`），供 `status()` 快速返回。
   - 输出超过 `EXEC_PERSIST_THRESHOLD` 的前台命令同样落盘，回传 `persistedOutputPath`/`persistedOutputSize`（F-04）。
4. **完成通知**：后台任务结束时产生 `command_finished` 事件（含 `taskId`、状态、退出码、输出路径）；后续回合的模型上下文附带「某后台任务已完成」提示，使模型能在不轮询的情况下获知结果（参考 F-02 的 "you will be notified when it completes" 体验）。
5. **状态查询**：`status(taskId)` 返回当前快照（状态 + 内存快照 + 输出路径 + 退出码）。
6. **取消**：`cancel(taskId)`：终止整棵进程树，状态置 `cancelled`；重复取消幂等返回 `false`（已终态）。
7. **进程树终止**：
   - Windows：`spawn('taskkill', ['/PID', String(pid), '/T', '/F'])`；随后 `child.kill()` 兜底。
   - POSIX：spawn 时 `detached: true` 建立进程组，`process.kill(-pgid, 'SIGTERM')`，超时 2s 后 `SIGKILL`。
8. **生命周期**：后台任务存活于 `Session` 生命周期；`Session.dispose()` 终止所有仍在运行的后台任务。跨进程恢复属 SP005。
9. **不做**「Ctrl+B 手动转后台」的交互（属 SP006 TUI 体验），但 `backgroundedByUser` 数据位预留。

### 4.5 权限接线（CE-08…CE-11）

**`core/permissions.ts` 扩展**：`ToolCapability` 由 `'read' | 'write'` 扩为 `'read' | 'write' | 'execute'`（MODEL_PROPOSED）。

**判定链路（单一来源，不允许 `src/exec` 自行放行）**

```text
模型请求 Bash/PowerShell
  → Session 组装 PermissionRequest{tool:'Bash', capability:'execute', path?:目标路径}
  → PermissionPolicy.decide()
      ① 底线规则（永远 deny，不可覆盖）：
         - 越界路径（含 junction）→ deny
         - 凭据类文件名（.env/.pem/.key/credentials.json…）→ deny
         - ~/.budingx 数据根 → deny
         - .git 目录 → ask（强制询问，三档下均不自动放行）
      ② 模式：
         - read_only      → deny（命令执行不在「仅可查看」范围内，CE-08）
         - workspace_edit → ask（默认询问；只读命令族可豁免，见下）
         - full_access    → allow（但底线规则仍生效，CE-10）
      ③ 用户规则（allow/deny）→ 命中则覆盖②
  → allow → 执行；ask → 走既有 ApprovalGateway 三档；deny → 不执行，返回 denied 理由
```

**只读命令族豁免（CE-08 的实现细节）**：v1.1 修正为**结构化命令表**（对齐参考 F-09），而非粗白名单：

```ts
/** 命令 → 允许的子命令 → 参数名 → 参数类型 */
export type ReadOnlyCommandSpec = {
  /** 允许的子命令（未列出则该命令无子命令概念）。 */
  subcommands?: string[]
  /** 允许的参数名 → 类型（'none' 表示开关型，'string'/'number' 表示取值型）。 */
  flags?: Record<string, 'none' | 'string' | 'number'>
}
```

- 表内容对齐参考（46 项规模）：`git diff/log/show/status/ls-files/rev-parse/rev-list/describe/cat-file/blame/shortlog/reflog/for-each-ref/merge-base/config --get/remote/branch（仅列表）/tag（仅列表）/worktree list/stash list/ls-remote/grep` + `gh pr view/list/diff/checks`、`gh issue view/list`、`gh repo view`、`gh run list/view`、`gh auth status`、`gh release list/view`、`gh workflow list/view`。
- **未知参数即不豁免**：`git diff --unknown-flag` 不算只读 → 按需询问。
- 豁免**仅在 `workspace_edit` 模式生效**；`read_only` 模式仍整体 deny 命令执行（CE-08）；`full_access` 自动执行。
- 豁免判定为**保守**：不在表中的一律按需询问。

**底线规则的命令侧扩展（CE-11）**：命令文本中出现 `~/.budingx`、`.budingx`、已知凭据路径（`.env`、`credentials.json`、`*.pem`、`*.key`）时**拒绝**。此检查在 `src/exec` 内作为**最后一道闸**执行（在策略 allow 之后），确保完全权限模式也不绕过。

### 4.6 破坏性命令警告层（CE-18，v1.1 新增）

> 对齐参考 F-08：参考仓的 `destructiveCommandWarning.ts` **只提示不阻断**（文件头明确「purely informational — doesn't affect permission logic or auto-approval」）。新仓保持该语义，但把警告接入审批弹窗。

**规则**

- 命令文本匹配破坏性模式 → 在审批弹窗中显示警告文案，**不自动拒绝**（底线规则仍优先拒绝）。
- 模式族（参考模式对齐，参数可扩展）：
  - 数据丢失：`git reset --hard`、`git checkout .`、`git restore .`、`git clean -f`（排除 `-n`/`--dry-run`）
  - 远端改写：`git push --force` / `--force-with-lease` / `-f`
  - 不可逆删除：`git stash drop`、`git stash clear`、`git branch -D` / `--delete --force`
  - 安全绕过：`git commit/push/merge --no-verify`
  - 文件系统：`rm -rf`、`rm -r`、`del /s`、`Remove-Item -Recurse -Force`、`format`、`dd if=… of=/dev/`
- 警告文案：「⚠ 该命令可能造成不可逆的数据丢失：<原因>」。
- **只读模式下的破坏性命令**：底线拒绝（写能力被禁），不进入警告路径。

### 4.7 沙箱能力声明层（CE-19，v1.1 新增）

> 对齐参考 F-10 的**能力面**（不实现 OS 级沙箱；OS 级隔离留 SP011 worktree-isolation）。

**声明结构**

```ts
export type SandboxPolicy = {
  /** 允许写入的路径（工作区根 + 显式授权目录）。 */
  allowWrite: string[]
  /** 拒绝写入的路径（凭据、用户数据根、.git 等）。 */
  denyWrite: string[]
  /** 允许读取的路径（工作区根 + 显式授权目录）。 */
  allowRead: string[]
  /** 拒绝读取的路径（凭据文件、用户数据根）。 */
  denyRead: string[]
  /** 允许访问的网络域名；空数组表示不限制网络。 */
  allowedDomains: string[]
  /** 为 true 时仅允许 managedDomains。 */
  allowManagedDomainsOnly: boolean
  /** 为 true 时只读路径（managed read paths only）。 */
  allowManagedReadPathsOnly: boolean
}
```

**规则**

- 该策略在**完全权限模式**下**仍然生效**（不可绕过）——这是「完全权限不等于无限制」的落地形式。
- 命令执行前：命令涉及的路径若落在 `denyWrite`/`denyRead` → 拒绝（并给出规则来源）。
- 网络域名策略：命令文本中出现 URL/域名时，若 `allowedDomains` 非空且域名不在其中 → 提示/拒绝（**提议**：本轮仅提示，不阻断，因域名提取易误判；阻断留后续）。
- **不提供** `dangerouslyDisableSandbox` 参数（见 §9.4）。

### 4.8 命令内受限编辑（CE-20，v1.1 新增）

> 对齐参考 F-07：参考仓把 `sed -i 's/a/b/g' file` 识别为**受限原地编辑**，渲染为文件 diff 而非原始命令输出。

**规则**

- **识别**：仅识别简单形式 `sed -i[-E|-r] 's/<pat>/<repl>/<flags>' <file...>`；多表达式、脚本文件、复杂 flag 一律按普通命令处理（保守）。
- **允许的 sed 命令**：仅 `s`（替换）。其余（`w`/`W`/`e`/`E`/`i`/`a`/`c`/`d` 等）**拒绝**。
- **危险 flag 组合**：拒绝（如 `-i` 与 `-n` 同时、备份后缀指向越界路径等）。
- **路径校验**：目标文件必须在工作区内；否则拒绝。
- **呈现**：识别为命令内编辑时，**额外产出结构化 diff**（复用 SP003 的 `diffLines`），使改动可预览、可走检查点撤销。
- **与 Edit 工具的关系**：命令内编辑**不替代** Edit 工具；其改动同样登记进 SP003 `CheckpointStore`（改动归属的唯一真相来源，GW-02/GW-03 依赖它）。

### 4.9 工具装配（拟新增 `src/exec/tools.ts`）

```ts
export function createCommandTools(options: {
  runner: CommandRunner
  cwd: string
}): { tools: ToolHandler[] }
```

产出两个 `ToolHandler`：`Bash` 与 `PowerShell`。
- `capability: () => 'execute'`
- `requiresApproval: () => true`（策略判定优先；`requiresApproval` 仅在无策略时生效）
- `target(input)`: 从 `cwd`/`command` 中解析目标路径用于策略判定；解析不出则 `{ kind: 'none' }`。
- `execute(input, ctx)`: 组装 `CommandSpec` → `runner.run(spec, { signal: ctx.signal, cwd })` → 返回 `JSON.stringify(result)` 或人可读摘要（**必须包含 exitCode**）。

**结果文本格式（固定，保证模型可解析）**：

```text
exit_code: 0
interpreter: cmd.exe
duration_ms: 123
--- stdout ---
...
--- stderr ---
...
```

若被截断，追加 `--- truncated --- 段落` 说明；若转后台，追加 `background_task_id` 与 `auto_backgrounded`（对齐参考 F-02 的可读回执）；若超大输出落盘，追加 `persisted_output_path` 与 `persisted_output_size`（F-04）。

---

## 5. 编码任务循环（coding-task-loop）

### 5.1 既有骨架与本轮扩展

SP002 `Session.runTurn` 已有迭代循环：组装消息 → 调模型 → 工具分派 → 结果回填 → 下一迭代（`MAX_ITERATIONS = 32`）。**本轮不改其骨架**，只在三处接入：

| 接入点 | 行为 | 对应 AC |
| --- | --- | --- |
| ① 工具结果回填 | 命令工具结果已含退出码与 stderr；**非零退出码不得被判为「成功结束回合」** | CT-08、CT-01 |
| ② 完成声明校验 | Agent 声称完成时，核心核对**最近一次命令执行证据**：无命令执行记录 → 判定「无证据完成」，回注要求继续；最近一次测试运行失败 → 判定「失败未修复」，回注要求继续 | CT-07、CT-01 |
| ③ 迭代上限 | 达到 `MAX_ITERATIONS` → `outcome = 'max_turns'`，保留最后失败证据 | CT-02 |

### 5.2 编码任务目标状态机（拟新增 `src/core/coding.ts`）

```ts
export type TaskPhase =
  | 'orienting'      // 定位问题
  | 'editing'        // 修改代码
  | 'testing'        // 运行测试
  | 'fixing'         // 修复失败
  | 'awaiting_user'  // 等待用户回答（追问）
  | 'done'
  | 'failed'

export type CodingTaskState = {
  taskId: string
  goal: string
  phase: TaskPhase
  /** 用户是否明确否定/替换了当前目标（CT-04）。 */
  goalReplacedAt?: number
  /** 最近一次命令执行证据。 */
  lastTest?: { command: string; exitCode?: number; outcome: CommandOutcome; at: number }
  /** 迭代计数。 */
  iterations: number
}

export interface CodingTaskTracker {
  get(): CodingTaskState | undefined
  start(goal: string): CodingTaskState
  /** 用户补充：纳入当前目标，不替换。 */
  supplement(text: string): void
  /** 用户转向：替换目标（CT-04）。 */
  redirect(goal: string): void
  observeCommand(result: CommandResult): void
  /** 完成声明是否成立（CT-07）。 */
  canClaimDone(): { ok: boolean; reason?: string }
}
```

**判定规则（`canClaimDone`）**

| 情形 | 结果 |
| --- | --- |
| 无任何命令执行证据 | 不通过：`未执行过任何命令，无法证明任务完成` |
| 最近一次命令 outcome 为 `failed`/`timeout`/`blocked` | 不通过：`最近一次命令未成功（exit=…），需继续修复` |
| 最近一次命令成功但不是测试类命令 | **不通过**（需至少一次测试执行）：`未运行测试` |
| 至少一次测试类命令成功（exit=0） | 通过 |

**测试类命令判定**：命令文本匹配 `test|spec|jest|vitest|mocha|pytest|go test|cargo test|npm run (test|check)|npm test|pnpm test|make test|tox|unittest` 等模式。判定是**启发式**，在文档与工具 summary 中说明。

### 5.3 用户转向（CT-03 / CT-04）

- **补充**（CT-03）：走 SP002 既有队列注入路径（`input_injected` 边界 `intra_turn`）。**既有实现已具备**，本轮补回归用例证明在命令执行场景下仍成立。
- **转向**（CT-04）：需要区分「补充」与「否定当前目标」。判定由**显式工具** `TaskRedirect`（或 `UpdateGoal`）承担，而不是靠文本启发式——避免误判。`TaskRedirect` 工具调用即替换 `goal` 并重置 `phase` 为 `orienting`，旧目标不再驱动后续动作。
- 转向在计划模式（§6）下同样允许，且不解除计划模式。

### 5.4 追问（CT-05 / CT-06，见 §6.4）

`AskUserQuestion` 工具是追问的唯一入口：模型调用后回合**挂起**等待回答，回答注入后继续当前回合。

---

## 6. 任务计划与追问（task-planning）

### 6.1 计划状态机与待办清单（拟新增 `src/plan/store.ts`）

> **v1.1 修正（关键）**：① 计划由**纯内存**改为**持久化为 `.md` 文件**（对齐 F-12）；② 待办项结构按参考 F-14 改为 `{content, status, activeForm}` 三字段三状态，**`id`/`blockedBy` 属计划步骤而非待办项**；③ 计划与待办是**两个不同对象**，分别建模。

**计划（Plan）——有 `id`/`blockedBy`，可持久化**

```ts
export type PlanStepStatus = 'pending' | 'in_progress' | 'completed' | 'blocked'

export type PlanStep = {
  id: string
  title: string
  status: PlanStepStatus
  /** 被哪些步骤阻塞（TP-02）。 */
  blockedBy?: string[]
  note?: string
}

export type Plan = {
  id: string
  goal: string
  steps: PlanStep[]
  /** 计划是否已批准（建议≠批准，TP-04）。 */
  approval: 'none' | 'pending' | 'approved' | 'rejected'
  /** 批准时的计划指纹，用于执行前校验（TP-05）。 */
  fingerprint?: string
  /** 批准时可携带用户编辑后的计划正文（对齐 F-13 的 planWasEdited）。 */
  approvedText?: string
  createdAt: number
  updatedAt: number
}
```

**待办（Todo）——三字段三状态，无 id**

```ts
export type TodoStatus = 'pending' | 'in_progress' | 'completed'

export type TodoItem = {
  /** 任务描述（参考 F-14 的 content）。 */
  content: string
  status: TodoStatus
  /** 进行中的动词短语，用于卡片展示（参考 F-14 的 activeForm）。 */
  activeForm: string
}
```

**与参考的两点差异（有意）**

1. 新仓待办**额外**允许 `id`（可选）以便跨轮稳定引用，但**不引入** `blockedBy`（阻塞关系属计划步骤）。参考 F-14 明确待办无 id 无 blockedBy。
2. 新仓待办状态仍是 3 个（不引入 `blocked`）；「被阻塞」用计划步骤的 `blocked` 状态表达。

**规则**

- 单计划最多 `PLAN_MAX_STEPS = 50` 步，超出拒绝并要求拆分（原 OPEN-02）。
- 步骤 id 为 `step-1`… 稳定序号；`blockedBy` 引用同计划内步骤 id。
- **持久化（v1.1 新增，对齐 F-12）**：
  - 路径：`~/.budingx/plans/<sessionId>/<planId>.md`
  - 与会话隔离；不写入用户项目目录（偏离参考的「项目内 plansDirectory」，理由见 §9.4）。
  - 内容：Markdown 正文 + YAML frontmatter（承载 `goal`/`approval`/`steps` 的结构化元信息）。
  - 读取：会话恢复时从该路径读回；文件缺失 → 计划视为不存在（参考有「恢复尝试」，新仓本轮只做**读取**，恢复属 SP005）。
  - **用户可编辑**：批准前用户可编辑计划正文；编辑后以 `approvedText` 记录并参与指纹重算（F-13）。
- 计划**随会话生命周期**存活（TP-10），跨进程恢复属 SP005。

**接口**

```ts
export interface PlanStore {
  current(): Plan | undefined
  create(goal: string, steps: { title: string }[]): Plan
  update(stepId: string, patch: Partial<PlanStep>): Plan
  /** 请求批准：进入 pending。 */
  requestApproval(planText: string): Plan
  approve(approvedText?: string): Plan
  reject(reason?: string): Plan
  /** 进度报告（TP-09）。 */
  progress(): { total: number; completed: number; inProgress: number; blocked: number; pending: number }
}
```

**待办接口**（独立于计划）

```ts
export interface TodoStore {
  list(): TodoItem[]
  set(items: TodoItem[]): TodoItem[]
  /** 进度：已完成 / 总数。 */
  progress(): { completed: number; total: number }
}
```

### 6.2 计划模式（TP-03 / CAP-L2-08）

> **v1.1 修正（关键）**：v1.0 写「计划模式阻断所有 write 与 execute 能力」，与参考 F-11 冲突——参考仓的 plan 是**权限模式**（`mode: 'plan'`），plan 模式下 Bash **不被硬阻断**（`permissions.ts:1276` 显示 plan+bypass 可 allow）。硬阻断会让「计划模式内无法调研运行结果」，使用体验下降。本节按审计结论重写。

参考仓用 `EnterPlanMode`/`ExitPlanMode` 工具族表达，新仓对应：

| 工具 | 语义 |
| --- | --- |
| `EnterPlanMode` | 进入计划模式：**记住当前权限模式**（新仓字段 `preMode`，对齐参考 `prePlanMode`），并把写类/执行类工具的判定**降级为需批准**；只读工具与只读命令**免批准**。记录基线快照（工作区文件指纹摘要 + Git HEAD）。 |
| `ExitPlanMode` | 退出计划模式。**必须携带计划内容**：退出时提交计划 → 计划进入 `approval='pending'`。**未批准前不得自动执行写操作。** 退出时**恢复 `preMode`**（参考 `handlePlanModeTransition` 的语义）。 |

**「降级为需批准」的精确语义（v1.1）**

| 工具能力 | 计划模式内 | 说明 |
| --- | --- | --- |
| `read`（Read/Glob/Grep/LSP 等） | **允许** | 调研是计划阶段的正当行为 |
| `write`（Write/Edit/NotebookEdit 等） | **需批准** | 从「模式自动允许」降级为「逐次询问」；批准后放行（参考的权限弹窗机制） |
| `execute`（Bash/PowerShell） | **需批准**（只读命令族免批准） | 允许在计划阶段跑只读命令；写盘命令逐次询问。**不硬阻断**（F-11） |
| `git` 写操作 | **需批准** | 同 write |

**与 v1.0 的差异及理由**：v1.0 的硬阻断是**更严格**的偏离，但会造成实际不可用——模型在计划阶段无法执行 `git status`、`npm test` 等调研命令，无法产出有证据的计划。本轮改为「降级为需批准」，既保住「建议≠批准」的底线，又不牺牲调研能力。计划模式**不解除**底线规则（越界、凭据、用户数据根仍拒绝）。

**写操作「未批准不得自动执行」的实现点（TP-03/TP-04）**：计划处于 `approval='pending'` 时，`write`/`execute` 工具在获得**显式批准**前不执行；被拒或未批准时，工具**不执行**并返回结构化结果（`计划待批准：先批准计划或退出计划模式`），该结果回填给模型，让模型知道为什么没做成。

### 6.3 批准与执行前校验（TP-04 / TP-05）

- 建议（计划文本）≠ 批准：`ExitPlanMode` 只产出待审计划；**批准是独立动作**。
- **批准通道（v1.1 修正，对齐 F-13）**：批准走**权限弹窗**通道（复用 SP003 的 `ApprovalGateway`），而非一个抽象的 `approve()` 调用。理由：参考仓的批准与「用户可否编辑计划」「拒绝时带反馈」是一体的。
- **批准输入可含用户编辑后的计划正文**：`approvedText`（对齐参考 `planWasEdited`）。批准时若用户改过正文，**重新计算指纹**并以编辑后的正文为准。
- **拒绝必须携带反馈**：`reject(reason)` 的 `reason` 回灌给模型（对齐参考 F-13 的「拒绝时带反馈」），使模型能据此修订，而不是只得到一个「被拒」。
- 批准后、第一次写操作前，校验：
  1. 工作区根路径未变；
  2. Git HEAD 未变（若为 Git 仓库）；
  3. 计划涉及的文件仍存在且内容指纹与批准时一致（缺失/漂移即拒绝）。
  4. 漂移项以结构化列表回报：`{ item, expected, actual }`。
- 校验失败 → 拒绝执行，要求重新审视计划；**不静默继续**。
- **v1.1 标注**：参考仓**没有**实现执行前校验（`VerifyPlanExecutionTool` 为 `@generated stub`）。本节是**新仓自主增强**，不是能力对齐项（见 §9.1 F-19、§9.4）。

### 6.4 追问（TP-06 / TP-07 / TP-08 / CT-05 / CT-06）

> **v1.1 修正**：参考 F-15 的追问是**多题结构**（1–4 题）、选项 2–4、必带 `header`、支持 `multiSelect`、**自动提供 Other 选项**、答案按**题目文本**关联、允许用户备注。v1.0 的「单题 + 选项 id + 2–5 选项」与参考不符，按审计结论重写。

```ts
export type QuestionOption = {
  /** 显示文本，1–5 词（参考 F-15 的 label）。 */
  label: string
  /** 选项含义说明（参考 F-15 的 description，必填）。 */
  description: string
  /** 聚焦时渲染的预览内容（参考 F-15 的 preview，可选）。 */
  preview?: string
}

export type Question = {
  /** 完整问题文本，以问号结尾（参考 F-15 的 question）。 */
  question: string
  /** 短标签，作为 chip 展示（参考 F-15 的 header，必填）。 */
  header: string
  /** 2–4 个互斥选项（参考 F-15）。 */
  options: QuestionOption[]
  /** 是否允许多选（参考 F-15 的 multiSelect，默认 false）。 */
  multiSelect: boolean
}

export type PendingQuestion = {
  questionId: string
  questions: Question[]
  /** 允许用户自由文本作答（Other 选项自动存在）。 */
  allowFreeText: boolean
  createdAt: number
}

/** 答案按「题目文本 → 答案文本」关联；多选以逗号分隔（参考 F-15）。 */
export type QuestionAnswers = Record<string, string>

/** 用户对所选项的补充备注（参考 F-15 的 annotations）。 */
export type QuestionAnnotations = Record<string, { preview?: string; notes?: string }>
```

- `AskUserQuestion` 工具参数：`{ questions: Question[] }`，题数 1–4；**校验**：题目文本全局唯一；同一题内选项 `label` 唯一；不满足即拒绝并说明。
- **Other 选项自动存在**（参考 F-15：「There should be no 'Other' option, that will be provided automatically」）——模型不需自行构造 Other，宿主提供自由作答入口。
- 回合**挂起**：`Session` 进入 `awaiting_approval`（复用既有审批状态，避免新增状态造成契约变更；事件用新的 `question_requested`/`question_answered`）。
- 回答：`{ questionId, answers: QuestionAnswers, annotations?: QuestionAnnotations }`；答案经 `Session` 注入为 **user 消息**（role=user），保证进入历史（CT-06/TP-07）。
- 取消：`question_cancelled` → 任务停在 `awaiting_user`→`failed`（可恢复状态，不无限等待，TP-08）。
- 追问**消耗迭代预算**（计入 `MAX_ITERATIONS`）：追问后仍需继续迭代，计入更安全。

### 6.5 TUI 最小卡片（TP-01/TP-02 可视化）

本轮只做**最小渲染**：
- 计划卡片：步骤列表 + 状态符号（`✔` 完成 / `■` 进行中 / `□` 待办 / `⊘` 阻塞）+ 阻塞来源。
- 追问卡片：问题文本 + 选项列表 + 提示「选择或输入回答」。
- 命令卡片：命令文本 + 解释器 + 退出码 + 输出摘要（截断）。

**不**做（SP006）：完成项 TTL、ctrl+t 展开、todo 卡片动画、完整 `/plan` `/tasks` 命令族。

---

## 7. Git 与工作树安全（git-worktree-safety）

### 7.1 只读状态识别（GW-01 / GW-08）

拟新增 `src/git/status.ts`：

```ts
export type GitStatus = {
  isRepository: boolean
  gitAvailable: boolean
  head?: string
  branch?: string
  /** 远端地址（可能含 token，需脱敏，对齐 F-17 的 remoteUrl）。 */
  remoteUrl?: string
  /** HEAD 是否已推送到远端（对齐 F-17 的 isHeadOnRemote）。 */
  isHeadOnRemote?: boolean
  staged: string[]       // 已暂存修改
  unstaged: string[]     // 未暂存修改
  untracked: string[]    // 未跟踪文件
  /** 冲突文件（merge/rebase 冲突）。 */
  conflicted: string[]
  /** 仓库内 worktree 数量（对齐 F-17 的 worktreeCount）。 */
  worktreeCount?: number
  ahead?: number
  behind?: number
}
```

实现：调用 `git --no-optional-locks status --porcelain=v1 -z --branch`（**必须带 `--no-optional-locks`**，对齐 F-17：避免 Git 争抢索引锁导致与本仓检查点操作互相阻塞；`-z` 保证路径含空格/Unicode 不被引号包裹），解析两字符状态码 + 路径。`--branch` 提供 HEAD/分支/ahead/behind。

- 非 Git 仓库 → `isRepository: false`，**不伪造**状态（GW-08）。
- `git` 不可用 → `gitAvailable: false`，同样明确报告。
- 全部调用只读、**不使用** `-c` 改配置、不写索引。
- **与参考的差异（有意）**：参考的 `GitFileStatus` 只区分 `{tracked, untracked}`（F-17），新仓保留更细的三分类 + conflicted + ahead/behind —— 对「区分用户既有改动」更有用，属**加强**。
- `remoteUrl` 若含凭据（`https://user:token@host`）→ **脱敏后再返回**，不把 token 交给模型（对齐 AGENTS.md 凭据保护底线）。

### 7.2 改动归属（GW-02 / GW-03）

**来源**：SP003 的 `CheckpointStore` 已记录本会话写入的每个文件（path/operation/before/after/diff）。本轮**复用**它作为「Agent 自有改动」的唯一真相来源：

- `Agent 自有改动集合 = checkpoint.records.map(r => r.path)`。
- 生成改动摘要时，**只**取自有集合；staged/unstaged 中属于用户既有的部分**明确标注为「用户既有改动，未触碰」**（GW-02/GW-03）。
- **禁止**：自动 `git reset`、`git stash`、`git checkout --`、`git clean`。本轮 `src/git` **不提供**任何这类写操作的实现（GW-02）。

### 7.3 worktree 进出（GW-05 / GW-06 / GW-07）

| 能力 | 规则（MODEL_PROPOSED，对齐 F-18） |
| --- | --- |
| 进入 | `git worktree add <path> -b <branch>`；`<path>` 默认 `~/.budingx/worktrees/<repo-slug>/<name>`（§9 OPEN-01）；`<name>` 需通过 slug 校验 |
| **slug 校验（F-18）** | 总长 ≤ 64 字符；按 `/` 分段，**每段非空**且只含字母、数字、点、下划线、连字符；**禁止 `.` 与 `..` 段**（防路径穿越）；违反即拒绝 |
| 分支名 | `<base-branch>-budingx/<flattened-slug>`；`/` 折叠为 `+`（对齐参考 F-18 的 `flattenSlug`），保证映射单射；名称冲突时拒绝并提示已有分支名 |
| 隔离性 | 新 worktree 是独立目录；主工作区已有 staged/unstaged/untracked **不受影响**（GW-05） |
| **恢复复用（F-18）** | 目标 worktree 已存在时**恢复复用**（切回该目录），不重复创建 |
| 退出 | 回到原工作目录；**默认 `keep`**（保留 worktree 与分支，不删除） |
| **退出 `remove`（F-18）** | 显式 `action: 'remove'` 时删除 worktree 与分支；若 worktree 有**未提交文件或未合并提交**，**必须显式 `confirm: true`**，否则**拒绝并列出残留项**；执行后回执含 `discardedFiles` / `discardedCommits` 计数 |
| 失败回落 | 创建失败（名称冲突、目录权限、磁盘满、非 Git 仓库）→ 明确失败原因 + **保持原 cwd 不变** + 不留半成品（GW-07）；若已创建但后续步骤失败 → 清理本次新建的目录（仅本轮自己创建的路径，不触碰未知路径） |
| 会话作用域 | worktree 是**会话级**（与参考仓一致）。会话结束不自动删除 |
| **hook 包装（F-18，P3）** | 参考支持「hook 驱动的 worktree 包装」（非纯 git）。**本轮只做纯 git 路径**，hook 包装留 SP006 hooks 轮次 |

### 7.4 提交门禁（GW-04 / GW-09）

**本轮交付**：

1. `GitStatus` 只读能力。
2. **提交范围分析**（GW-09）：给定 Agent 自有改动集合，产出「将要纳入的文件清单」+「不纳入的用户改动清单」。
3. **受控提交执行**（GW-09 的一部分）：`git commit` 仅在**有明确授权**时执行，且：
   - 提交前重新校验范围清单（防止范围漂移）；
   - 只 `git add` 自有文件（逐个显式 `git add -- <path>`，**不用 `git add .` / `-A`**）；
   - 提交信息由用户提供或 Agent 生成但**必须经用户确认**（§9 OPEN-02）；
   - 提交后产出 SHA 与包含文件清单。
4. **门禁**（GW-04）：模型请求提交/推送时，若无授权记录 → 拒绝并记录 `denial_recorded`（复用 SP003 的拒绝追踪）。**推送（push）本轮不实现**——路线图明确「没有提交或推送授权不执行 Git 发布」，且 push 属于用户明确保留的授权边界。

**授权记录**：会话内维护 `gitAuthorizations: Set<'commit'>`，来源为用户显式动作（TUI 确认）。模型**无法**自行写入该集合。

---

## 8. 对参考实现的对照与有意偏离

| 参考行为 | 新仓做法 | 依据 |
| --- | --- | --- |
| 7 档权限模式 | 固定三档（仅可查看/工作区内修改/完全权限） | 用户 r6 决定（已采纳偏离） |
| Bash `run_in_background` + `timeout` 上限 | 等价实现；**不实现「阻塞超预算自动转后台」**（自动切换会伪装完成） | MODEL_PROPOSED 优化，理由记于 §4.4 |
| Bash 后台输出写任务文件 | 后台输出驻内存任务表（截断保留），**不落盘用户目录** | 避免污染用户数据；跨进程持久化属 SP005 |
| Ctrl+B 手动转后台 | 本轮不实现（属 SP006 TUI 体验） | 路线图分工 |
| `EnterWorktree`/`ExitWorktree` 工具表面 | 等价（会话级），目录位置独立于项目仓库 | MODEL_PROPOSED |
| `EnterPlanMode`/`ExitPlanMode` + 计划审批卡片 | 等价 + 计划模式阻断**所有**写与执行能力 | MODEL_PROPOSED（更严格，§9 OPEN-04） |
| todo 卡片 ✔/■/□ + blocked by + 30s TTL + ctrl+t | 本轮交付数据结构与最小卡片；TTL/展开属 SP006 | 路线图分工 |
| `AskUserQuestion` 选择题卡片 | 等价（工具 + 结构化选项 + 等待/取消） | MODEL_PROPOSED |
| shift+tab 权限模式轮播 | SP003 已交付，本轮不重复 | 已有能力 |
| 只读命令豁免审批 | 保守白名单，仅 `workspace_edit` 模式豁免 | MODEL_PROPOSED（更保守） |
| PowerShell 与 Bash 同安全判定 | 等价：两者共用同一策略与底线检查 | MODEL_PROPOSED |
| 参考仓 `/commit`、`/review` 等命令族 | 本轮只交付底层能力与门禁 | 路线图分工 |

**未迁入声明**：本轮不迁入参考仓任何源码、提示词、内部 SDK 类型、全局状态、生成 bundle、配置或历史记录。全部实现独立编写；参考仓仅提供行为事实对照（`CAP-*` 锚点）。

---

## 9. 参考仓对照审计结果（2026-11-18 只读复核）

> 方法：对本地参考仓 `budingWorkerSpace` 做**只读**grep 审计（未修改、未复制任何源码）。以下每条均给出行为事实与证据位置；「未证实」表示未能从本次只读证据确认。
> 用途：修正本设计的遗漏边界与语义偏差，并登记有意偏离。

### 9.1 关键事实修正（直接影响本设计）

| # | 参考仓事实（证据） | 对本设计的影响 | 修正 |
| --- | --- | --- | --- |
| F-01 | 超时：默认 `120000`ms、上限 `600000`ms（`src/utils/timeouts.ts:3-4`），可由 `BASH_DEFAULT_TIMEOUT_MS`/`BASH_MAX_TIMEOUT_MS` 环境变量覆盖 | §4.3 写的默认值/上限**数值恰好一致**，但缺「环境变量可覆盖」 | §4.3 增补环境变量覆盖规则（新仓用 `BUDINGX_EXEC_*` 命名，不沿用旧名） |
| F-02 | 助手模式阻塞预算 `ASSISTANT_BLOCKING_BUDGET_MS = 15_000`（`src/tools/BashTool/BashTool.tsx:57`、`PowerShellTool.tsx:162`），超时后**自动转后台**并给出 `backgroundTaskId` 与输出文件路径 | §4.4 声明「本轮不实现自动转后台」——与参考差距大，且用户明确要求「后台状态/取消/输出上限有实测」 | **改为本轮实现自动转后台**（预算 15s），因为它是「长任务/后台监控 CAP-L2-06」的核心行为。原 OPEN-03 关闭 |
| F-03 | 后台输出**落盘**到任务输出文件（`getTaskOutputPath(backgroundTaskId)`，`BashTool.tsx:607-614`），模型可再读 | §4.4 原写「不落盘、仅驻内存」——与参考差距大 | **改为落盘**到 `~/.budingx` 下会话隔离的任务目录（对齐参考的「输出文件 + 完成通知」体验），并保留内存快照 |
| F-04 | 超大输出**落盘**并回传 `persistedOutputPath`/`persistedOutputSize`（`BashTool.tsx:730-749`），>64MB 截断 | §4.3 只写「内存截断」 | 增补「超大输出落盘 + 回传路径与原始字节数」，模型可按需读取 |
| F-05 | 工具结果字段含 `interrupted`、`isImage`、`backgroundTaskId`、`backgroundedByUser`、`assistantAutoBackgrounded`、`dangerouslyDisableSandbox`、`returnCodeInterpretation`、`noOutputExpected`（`BashTool.tsx:280-293`） | §4.6 结果形状字段不全 | `CommandResult` 增 `interrupted`、`backgroundedByUser`、`autoBackgrounded`、`persistedOutputPath`、`persistedOutputSize`、`noOutputExpected` |
| F-06 | Bash 工具参数含 `filePath` + `newContent`（`BashTool.tsx:244-245`）与 `dangerouslyDisableSandbox`（`:242`） | §4.6 参数契约缺这两组 | 增补；`dangerouslyDisableSandbox` 在新仓**不做免沙箱绕过**（无沙箱即无此参数），理由记 §9.4 |
| F-07 | `sed -i 's/a/b/g' file` 被识别为**受限原地编辑**并渲染为文件 diff：仅允许 `s///` 替换，拒绝 `w`/`W`/`e`/`E` 命令与危险 flag 组合（`src/tools/BashTool/sedEditParser.ts`、`sedValidation.ts:44-247`） | §4 完全未覆盖此能力 | **新增需求面**：命令内编辑（sed 原地编辑）须走受限校验并以 diff 呈现；至少覆盖「识别 + 拒绝危险写法 + 以 diff 渲染」 |
| F-08 | 危险命令**只提示不阻断**：模式化识别 `git reset --hard`、`git push --force`、`git clean -f`、`git checkout .`、`git restore .`、`git stash drop/clear`、`git branch -D`、`--no-verify` 等（`src/tools/BashTool/destructiveCommandWarning.ts`，文件头明确「purely informational — doesn't affect permission logic or auto-approval」） | §4.5 只做「底线拒绝」，没有「危险命令警告」层 | **新增「破坏性命令警告」层**：命中模式 → 审批弹窗显示警告文案；**不自动拒绝**（除底线规则外） |
| F-09 | 只读命令白名单是**结构化命令表**（46 项，含 `git diff/log/show/status/ls-files/rev-parse/branch/tag`、`gh pr view/list/diff/checks`、`gh issue view/list`、`gh run list`、`gh auth status` 等，且每个命令的**子命令与参数**都有类型化允许表）——`src/utils/shell/readOnlyCommandValidation.ts` | §4.5 我写的是「粗白名单」 | 改为**结构化只读命令表**：命令 → 允许的子命令 → 允许的参数类型；参数未知即不豁免 |
| F-10 | 沙箱是**真实实现**（`src/utils/sandbox/sandbox-adapter.ts`）：文件系统 `allowWrite`/`denyWrite`/`denyRead`/`allowRead` + 网络 `allowedDomains`/`allowManagedDomainsOnly`/`allowManagedReadPathsOnly`，并强制 deny 写 `settings.json`/`skills` 目录 | §9 OPEN-02 声明「不引入独立沙箱层」 | **范围修正**：本轮不实现 OS 级沙箱，但**必须实现能力声明层**（允许写/拒绝写/允许读/拒绝读/网络域名策略），并在「完全权限」模式下仍受其约束；OS 级隔离留 SP011 worktree-isolation |
| F-11 | 计划模式是**权限模式**（`mode: 'plan'`），进入/退出经 `prepareContextForPlanMode`/`handlePlanModeTransition`（`src/utils/permissions/permissionSetup.ts:1462-1493,582-642`），用 `prePlanMode` 记住原模式并在退出时恢复；**plan 模式下 Bash 并不被硬阻断**（`permissions.ts:1276` 显示 plan+bypass 可 allow） | §6.2 我写「计划模式阻断所有 write 与 execute 能力」——**与参考语义冲突** | **改为**：计划模式 = 「写类工具需批准、只读命令免批准」的**权限档位**，而非硬阻断；执行类工具在计划模式下**降级为需批准**。原 OPEN-04 关闭 |
| F-12 | 计划以**磁盘 `.md` 文件**保存：`<plansDir>/<slug>.md`，slug 与会话绑定；子代理用 `<slug>-agent-<id>.md`；`plansDirectory` 必须位于项目根内否则报错；计划缺失时尝试恢复（`src/utils/plans.ts:32-260`） | §6.1 我写「纯内存、随会话存活」 | **改为**：计划持久化为 `.md` 文件（会话隔离目录），支持读取/编辑/恢复；「用户可在批准前编辑计划」（`planWasEdited`）纳入 |
| F-13 | 计划审批走**权限弹窗**通道（`checkPermissions` + `permissionResult.updatedInput`），可携带**用户编辑后的计划**；拒绝时带反馈文本回灌模型（`ExitPlanModeV2Tool.ts:203-320,431-483`） | §6.3 我写「批准是独立动作」但没写「用户可编辑计划 + 拒绝带反馈」 | 增补：批准输入可含用户编辑后的计划文本；拒绝必须携带反馈并回灌模型 |
| F-14 | TodoWrite 的项结构为 `{content, status, activeForm}`，**status 枚举只有 3 个**：`pending`/`in_progress`/`completed`（`src/utils/todo/types.ts:5-15`），**无 id、无 blockedBy** | §6.1 我写了 `id` + `blockedBy` + `blocked` 状态 | **修正**：待办项 = `{content, status, activeForm}` 三字段三状态。`blockedBy` 属**计划步骤**能力，不属 todo。两者是**不同对象**（计划 vs 待办），需分别建模 |
| F-15 | `AskUserQuestion` 参数：`questions[]`（1–4 题），每题 `{question, header(≤chip宽), options[2-4]{label, description, preview?}, multiSelect}`；选项 label 在题内唯一、题目文本全局唯一；**自动提供「Other」选项**；答案以 `Record<questionText, answerString>` 回传，多选逗号分隔；可带 `annotations`（用户备注） | §6.4 我写「单题、选项 2–5、id 选选项」 | **改为多题结构**（1–4 题）、选项 2–4、`header` 必填、`multiSelect` 支持、自动 Other 选项、按**题目文本**而非 id 关联答案、允许用户备注 |
| F-16 | 回合终止原因枚举确为 10 项：`completed`/`max_turns`/`aborted_streaming`/`aborted_tools`/`blocking_limit`/`prompt_too_long`/`image_error`/`model_error`/`stop_hook_blocking`/`stop_hook_prevented`（`src/query.ts`、`src/query/`） | §5.1 我写「沿用 SP002 既有骨架」未提终止原因对齐 | `TurnOutcome` 需与该枚举对齐（当前新仓只有 5 值），补 `blocking_limit`/`prompt_too_long`/`image_error`/`stop_hook_*` |
| F-17 | Git 状态用 `git --no-optional-locks status --porcelain`（**不带 `-z`**），`GitFileStatus` 只区分 `{tracked, untracked}`（`src/utils/git.ts:359-416`）；`GitRepoState` 字段为 `{commitHash, branchName, remoteUrl, isHeadOnRemote, isClean, worktreeCount}` | §7.1 我设计了三类 + conflicted + ahead/behind | 保留新仓更细的三分类（更有用），但**必须用 `--no-optional-locks`**（避免 Git 争抢索引锁），并补 `remoteUrl`/`isHeadOnRemote`/`worktreeCount` |
| F-18 | worktree 实现：`.claude/worktrees/<slug>` 路径（参考仓在项目内）、分支名 `worktree-<flattenSlug>`（`/` → `+`）、slug 分段校验（≤64 字符、每段仅字母数字点下划线连字符、禁 `.`/`..` 段）、支持 **hook 驱动的 worktree 包装**（非纯 git）、退出可 `keep`/`remove`，`remove` 在有未提交或未合并提交时**必须 confirm=true** 否则拒绝并列出；输出含 `discardedFiles`/`discardedCommits` | §7.3 我设计 `~/.budingx/worktrees` + 自定义分支名 + 失败回落 | 增补：slug 分段校验规则、`keep`/`remove` 语义、**删除前确认与残留清单**（`discardedFiles`/`discardedCommits`）、已存在 worktree 可**恢复复用**（resume） |
| F-19 | 参考仓**无完成证据校验机制**：全仓 grep `canClaimDone`/`requireTestPass` 等无命中；`VerifyPlanExecutionTool` 为 `@generated stub`（`src/tools/VerifyPlanExecutionTool/VerifyPlanExecutionTool.ts` 头注释明写 generated stub） | §5.2 我设计了 `canClaimDone`（要求测试成功）+ §6.3 我设计了「执行前基线校验」 | 二者均为**有意加强**，参考仓没有。保留但**明确标注为新仓增强**，不声称「对齐参考」；且 `VerifyPlanExecution` 在参考是 stub，说明「计划执行校验」是本仓自主设计 |

### 9.2 遗漏的功能点（新仓设计未覆盖，按重要性排序）

| 级别 | 遗漏点 | 参考证据 | 建议归属 |
| --- | --- | --- | --- |
| **P0** | **助手模式阻塞预算 15s → 自动转后台** | `BashTool.tsx:57,607-614` | command-execution（新增 AC） |
| **P0** | **后台输出落盘 + 完成通知 + 模型可再读** | `getTaskOutputPath`、`BashTool.tsx:607-614` | command-execution |
| **P0** | **超大输出落盘 + 回传路径/大小（>64MB 截断）** | `BashTool.tsx:730-749` | command-execution |
| **P0** | **计划持久化为 `.md` 文件 + 会话隔离 + 恢复 + 用户可编辑** | `src/utils/plans.ts:32-260`、`ExitPlanModeV2Tool.ts:98-130` | task-planning |
| **P0** | **计划审批走权限弹窗通道 + 拒绝带反馈回灌** | `ExitPlanModeV2Tool.ts:203-320,431-483` | task-planning |
| **P1** | **`sed -i` 受限原地编辑 + 以 diff 渲染** | `sedEditParser.ts`、`sedValidation.ts` | command-execution（新增面） |
| **P1** | **破坏性命令警告层（提示不阻断）** | `destructiveCommandWarning.ts` | command-execution |
| **P1** | **结构化只读命令表（含 gh CLI 家族）** | `readOnlyCommandValidation.ts`（46 项） | command-execution + 权限 |
| **P1** | **计划模式 = 权限档位（原模式记忆与恢复）** | `permissionSetup.ts:1462-1493` | task-planning + core 权限 |
| **P1** | **沙箱能力声明层（读写路径 + 网络域名策略）** | `sandbox-adapter.ts` | command-execution |
| **P1** | **worktree `keep`/`remove` + 删除前确认 + 残留清单 + 恢复复用** | `ExitWorktreeTool.ts:31-56`、`worktree.ts:53-90,260-271` | git-worktree-safety |
| **P2** | **`TurnOutcome` 对齐参考 10 项终止原因** | `src/query.ts` | core（coding-task-loop 邻接） |
| **P2** | **Git 状态用 `--no-optional-locks`；补 remoteUrl/isHeadOnRemote/worktreeCount** | `git.ts:359-416,463-500` | git-worktree-safety |
| **P2** | **命令结果字段补 `interrupted`/`noOutputExpected`/`returnCodeInterpretation`** | `BashTool.tsx:280-293` | command-execution |
| **P2** | **`gh` CLI 只读族**（PR/issue/run 查询） | `readOnlyCommandValidation.ts:986-1191` | command-execution |
| **P3** | **shell 命令解析能力层级**（AST、heredoc、管道、复合命令拆解、50 子命令安全检查上限、shell 补全） | `src/utils/bash/`（`bashParser.ts` 50ms/5万节点上限、`ast.ts`、`heredoc.ts`、`shellCompletion.ts` 1s 超时） | 本轮只做**必要的复合命令拆分与危险识别**；完整解析器留后续 |
| **P3** | **审批弹窗的可编辑前缀规则**（`npm run:*` 形式）与危险规则检测 | `bashPermissions.ts:161-347`、`permissionSetup.ts:85-269` | SP003 规则体系已覆盖前缀规则；**危险规则检测**本轮补 |
| **P3** | **worktree hook 驱动包装（非纯 git）** | `worktree.ts:543-572` | SP006 hooks 轮次；本轮只做纯 git 路径 |
| **P3** | **`git stash`/切分支自动 stash** | `git.ts:424-451` | **不采用**：新仓禁止自动 stash（AGENTS.md 明令） |

### 9.3 需修正的设计决策

| # | 原设计 | 修正后 | 理由 |
| --- | --- | --- | --- |
| C-01 | 计划模式硬阻断 `write`+`execute` | 计划模式=**权限档位**：写类与执行类**降级为需批准**，只读免批准；进入时记住原模式，退出恢复 | 参考 F-11：plan 是权限模式且 Bash 不被硬阻断；硬阻断会让「计划模式内无法调研运行结果」，体验下降 |
| C-02 | 计划纯内存、随会话存活 | 计划持久化为会话隔离目录下的 `.md`；支持读/写/恢复；用户可在批准前编辑 | 参考 F-12；且能支撑 SP005 跨会话恢复 |
| C-03 | 待办含 `id`/`blockedBy`/`blocked` 状态 | 待办 = `{content, status∈{pending,in_progress,completed}, activeForm}`；**计划步骤**另设 `id`/`blockedBy`；两者分离 | 参考 F-14 |
| C-04 | 追问为单题、选项带 id、2–5 个 | 多题 1–4；每题 `{question, header, options[2-4], multiSelect}`；自动 Other；答案按题目文本关联；允许用户备注 | 参考 F-15 |
| C-05 | 后台输出仅内存 | 落盘到 `~/.budingx` 会话隔离任务目录 + 内存快照；超大输出亦落盘并回传路径 | 参考 F-03/F-04；否则模型无法在后续轮次读完整输出 |
| C-06 | 不实现自动转后台 | **实现** 15s 阻塞预算自动转后台（并回填 `backgroundTaskId` 与输出路径） | 参考 F-02；这是 CAP-L2-06 核心 |
| C-07 | 只读命令粗白名单 | 结构化命令表（命令→子命令→参数类型） | 参考 F-09；粗白名单会把 `git push` 误判为只读 |
| C-08 | 不引入沙箱能力 | 引入**能力声明层**（allowWrite/denyWrite/allowRead/denyRead/网络域名），OS 级隔离留 SP011 | 参考 F-10 |
| C-09 | `TurnOutcome` 沿用 SP002 5 值 | 对齐参考 10 项（补 `blocking_limit`/`prompt_too_long`/`image_error`/`stop_hook_*`） | 参考 F-16；与后续 SP005/007 的终止原因契约一致 |

### 9.4 确认保留的有意偏离（不因本次审计改变）

| 参考行为 | 新仓决定 | 理由 |
| --- | --- | --- |
| `dangerouslyDisableSandbox` 可绕过沙箱 | **不提供**该参数 | 新仓无 OS 级沙箱，提供「关掉沙箱」参数会给出虚假安全感；能力声明层不可绕过 |
| 切分支前自动 stash | **不采用** | AGENTS.md 禁止自动 stash/reset；用户无关改动不得被吞 |
| 参考无完成证据校验 | **保留新仓 `canClaimDone`** | 属加强而非对齐；明确标注，避免声称「与参考一致」 |
| 参考 `VerifyPlanExecution` 是 stub | **新仓自主实现执行前基线校验** | 同上；参考未实现，不是能力对齐项 |
| 参考 7 档权限模式 | 固定三档 | 用户 r6 决定（已采纳偏离） |
| 参考 `plan` 为文件、`plansDirectory` 在项目内 | 新仓放 `~/.budingx`（与项目分离） | 用户数据统一 `~/.budingx`；避免污染用户仓库；隔离性更好 |

### 9.5 本次审计的边界

- 只读 grep 审计，**未运行**参考仓任何代码，**未修改**参考仓任何文件，**未复制**其源码。
- 未覆盖：参考仓 `src/` 全部 2360 文件的逐文件通读；仅审计 SP004 四领域的相关位置。
- 部分结论为「未证实」：例如 `shellCompletion` 的补全质量、`bashParser` 的 AST 完整性、sandbox 在 Windows/Linux 的具体实现（本次仅确认存在 `sandbox-adapter.ts` 与策略字段，未确认各平台执行器细节）。
- 参考仓为 **local recovery build**，约 17 个工具目录是生成 stub；本节已对 `VerifyPlanExecutionTool` 明确标注为 stub，**其余工具是否存在未察觉的 stub 需在实施时逐个核实**。

### 9.6 与路线图 r7（2026-11-18）的对齐

审计期间仓库并行推进到**路线图 r7**（移除五个暂缓轮次，当前 16 个 SP）。核对结果：**SP004 的功能目录、出口门槛与 CAP 归属在 r7 下未变**，仅两处需同步确认：

| 项 | r7 变化 | 对 SP004 的影响 | 处置 |
| --- | --- | --- | --- |
| SP004 出口门槛 | **未变**（隔离项目完成定位→修改→运行测试→修复；追问/转向、Git 脏工作区、Windows quoting、后台状态/取消/输出上限、自身修改撤销有实测；无授权不执行 Git 发布） | 无 | 无需改动 |
| SP004 功能目录 | **未变**（command-execution / coding-task-loop / git-worktree-safety / task-planning） | 无 | 无需改动 |
| CAP-L2-05（Windows 原生 PowerShell） | 仍为 **必交**，归属 SP004 | 确认 `PowerShell` 工具**独立交付**（不只是别名） | 已同步到命令执行需求；OPEN-05 关闭 |
| CAP-L3-09（沙箱隔离） | 由必交降为 **可选**；目标状态改为「**明确声明能力与局限，不冒充 OS 沙箱**」 | **正面印证** v1.1 的沙箱修正：交付能力声明层并明示局限，而非假装有 OS 沙箱 | 已同步；OS 级隔离不承诺 |
| Desktop、VS Code、远程/H5 与 IM | 已移出当前范围 | 与 SP004 无依赖关系 | 无影响 |

**结论**：本审计产出的修订与 r7 不冲突，**无需回退任何设计决策**。

**r8 复核（2026-11-18，提交前）**：路线图再次推进到 **r8**（现行 SP001–SP016 连续编号；r7 的 SP010→SP008 等重编号只发生在 SP004 之后）。逐项核对：

| 项 | r8 状态 | 影响 |
| --- | --- | --- |
| SP004 功能目录 | **未变**（command-execution / coding-task-loop / git-worktree-safety / task-planning） | 无 |
| SP004 出口门槛 | **未变**（逐字一致） | 无 |
| CAP-L2-04 / L2-05 / L2-06 / L2-08 / L3-09 / L3-15 | **归属 SP004 全部未变**（必交/可选状态同 r7） | 无 |
| SP001–SP007 编号 | **未变**（r8 重编号只涉及 SP004 之后的轮次） | 无 |

**结论**：r8 不影响 SP004 的任何设计决策，**无需回退**。

---

## 9.7 TUI 还原度约束（2026-11-18 对齐）

用户 2026-11-18 要求针对参考仓 buding-worker-space 还原能力与 TUI 布局/UI/交互。该要求作为横向约束落地（[路线图 r9](../../../docs/iteration-plan.md)「TUI 还原度要求」节；[还原度基线](../../../docs/tui-fidelity-gap-baseline.md)），**不新增 SP 编号、不改变 SP004 的依赖与出口门槛**。

### 9.7.1 本轮在还原度上的位置

还原度分三层，本轮只负责 L3（能力面）与 L3 的卡片表现：

| 层 | 内容 | 归属 | 本轮 |
| --- | --- | --- | --- |
| L1 布局骨架 | 首屏/消息区/输入区/页脚四区 | SP006 P0 | 不做 |
| L2 交互契约 | 上下文键位/chord/保留键 | SP006 P0 | 不做 |
| L3 能力面 | 工具族与 Agent 主循环 | **SP004（能力）/ SP007（子代理）** | **本轮主体** |
| L3 卡片表现 | 工具卡片的视觉形态 | SP004 最小 / SP006 P1 完整 | **本轮最小形态** |

### 9.7.2 卡片表现的对齐要求

§6.5 的「TUI 最小卡片」须与工具实现**同步交付**。参考行为事实与本轮最小形态的对应：

| 参考事实 | 本轮最小形态 | 差异（归 SP006） |
| --- | --- | --- |
| todo 卡片 ✔/■/□ + blocked by | 计划卡片步骤列表 + 状态符号（✔/■/□/⊘）+ 阻塞来源 | 完成项 30s TTL、ctrl+t 展开、行数自适应 |
| AskUserQuestion 选择题卡片 | 追问卡片：问题文本 + 选项列表 + 提示「选择或输入回答」 | 键盘导航细节、反馈输入态 |
| Bash 工具卡片（命令/解释器/退出码/输出摘要） | 命令卡片：命令文本 + 解释器 + 退出码 + 输出摘要（带截断标记） | 卡片动画与折叠汇总 |
| EnterPlanMode/ExitPlanMode 计划审批卡片 | 计划模式闸门 + 批准/拒绝反馈 | 审批卡片的完整三档与前缀规则编辑 |

**约束**：

- 最小形态**不得缺席**——不允许「能力已实现但卡片未接线」的状态进入交付。
- 卡片状态符号、阻塞来源、选项结构、退出码与截断标记按上表对齐；不得自造与参考语义冲突的表述。
- 折叠汇总（Read N files / Searched N patterns）属 SP006 P0 / CAP-L1-30，本轮**不预支**。

### 9.7.3 本轮明确不做（防止预支 SP006）

- 不在 src/tui/render 内引入虚拟列表、冻结缓存、帧缓冲差分、上下文键位系统或 chord 分发——这些是 SP006 P0 的独立可验收批次。
- 不改四区骨架的布局结构；本轮只增加卡片**内容**，不改现有行的排布机制。
- 不做 Vim 模式、鼠标选区、备用屏（R-A 可选项，非 P0/P1 门槛）。

### 9.7.4 边界（不因还原要求放宽）

- 权限模式仍固定三档；参考仓 7 模式仅作安全底线语义来源（deny 规则、凭据保护），**不还原模式数量**。
- 仍按 SP001 决定 3「读机制、不抄代码」：参考仓无 LICENSE、视为未开源，只参考行为与结构事实。
- 参考副本约 17 个工具目录为生成 no-op stub（__stubMissing）；**工具只按行为事实立项**，stub 目录名不作为能力来源。
- 还原度提高**不放宽** SP004 既有出口门槛，也不改变 §10 的风险项与 §9.3 的有意偏离。

## 10. 风险与开放项

| ID | 内容 | 处置 |
| --- | --- | --- |
| R-01 | 命令执行绕过权限底线 | 判定统一走 SP003 策略；`src/exec` 内保留最后一道凭据/数据根闸；负向回归覆盖完全权限 |
| R-02 | Windows 进程树杀不干净（残留 node.exe/npm） | `taskkill /T /F` + `child.kill()` 双保险；真实进程证据核对残留（需人工确认任务管理器） |
| R-03 | 输出上限被绕过 | 截断在写出层强制（stdout/stderr 分别截断）；工具结果带显式截断标记 |
| R-04 | Git 误伤用户改动 | 改动归属唯一来源是 SP003 checkpoint；`src/git` 不实现 reset/stash/clean；提交只逐文件 `git add` |
| R-05 | 计划模式被工具绕过 | 阻断在 Session 工具分派层（按 capability），任何新工具默认受同一闸门约束 |
| R-06 | 「完成声明」被空转 | `canClaimDone` 要求至少一次测试类命令成功；无证据回注要求继续 |
| R-07 | 追问挂起导致回合死锁 | 追问有超时与取消；取消后任务落到可恢复态，不无限等待 |
| OPEN-01 | worktree 隔离目录位置 | 默认 `~/.budingx/worktrees/<repo-slug>/<name>`（与项目分离，避免污染仓库）；可参数覆盖 |
| OPEN-02 | 提交能力交付形态与提交信息来源 | 默认：交付「范围分析 + 受控提交」，提交信息须用户确认；推送不实现 |
| ~~OPEN-03~~ | ~~「阻塞超预算自动转后台」与 Ctrl+B~~ | **已关闭（2026-11-18 审计）**：自动转后台**本轮实现**（15s 预算，对齐 F-02）；Ctrl+B 交互留 SP006 |
| ~~OPEN-04~~ | ~~计划模式是否阻断命令执行~~ | **已关闭（2026-11-18 审计）**：改为**权限档位**（降级为需批准），对齐 F-11；硬阻断会造成计划阶段无法调研，体验下降 |
| OPEN-05 | `PowerShell` 工具在 POSIX 平台 | 默认返回明确失败「本平台无 PowerShell」，不静默回退到 sh |
| OPEN-06 | 完成证据最低门槛 | 默认：最近一次测试类命令成功；本轮不强制「全绿」 |
| OPEN-07 | 网络域名策略是提示还是阻断 | 默认**仅提示**（域名提取易误判）；阻断留后续 |
| OPEN-08 | 超大输出落盘阈值 | 默认 1 MB（参考 F-04 为 64 MB；新仓取更小以免占用磁盘） |
| OPEN-09 | 沙箱能力声明层的网络策略是否本轮生效 | 默认生效但**仅提示**（同上）；OS 级隔离留 SP011 |
| OPEN-10 | 参考仓其余工具是否存在未察觉的 stub | 本轮只读审计仅确认 `VerifyPlanExecutionTool` 为 stub；**实施时需逐个核实本轮要用到的工具** |

---

## 11. 验收条件（AC → 责任层映射）

完整 AC 见各需求文档（CE/CT/GW/TP）。汇总：

| 需求 | AC 区间 | 数量 | 责任层 |
| --- | --- | --- | --- |
| command-execution | CE-01…CE-20 | 20 | `src/exec` + `src/core/exec.ts` + 权限扩展 + 沙箱声明层 |
| coding-task-loop | CT-01…CT-09 | 9 | `src/core/coding.ts` + Session 扩展 |
| git-worktree-safety | GW-01…GW-09 | 9 | `src/git` + SP003 checkpoint 复用 |
| task-planning | TP-01…TP-10 | 10 | `src/plan` + `src/core/plan.ts` + TUI 最小卡片 |
| **合计** | — | **48** | — |

**测试层映射（每条 AC 至少各有一例单元 + 一例功能）**

| 层 | 手段 |
| --- | --- |
| L0 纯逻辑 | 计划状态机、追问契约、代码目标状态机、权限请求组装、Git porcelain 解析、quoting 规则、只读命令族判定 |
| L1 真实进程 | 命令执行真实 spawn：退出码、stdout/stderr、超时、输出上限、后台任务与取消、进程树终止、工作目录与 Unicode 路径 |
| L1 真实 Git | 临时仓库 fixture：脏工作区识别、staged/unstaged/untracked、worktree 创建与失败回落、非 Git 仓库 |
| L2 伪 TTY e2e | 命令卡片/计划卡片/追问卡片渲染、审批三档接线、计划模式阻断提示 |
| L3 真终端人工 | Windows Terminal/ConHost 真实观感与进程残留核对 — **UNVERIFIED**（恢复条件：人工清单） |
| live Provider | 真实模型端到端编码闭环 — **UNVERIFIED**（无凭据时） |

---

## 12. 变更集

| 路径 | 动作 | 说明 |
| --- | --- | --- |
| `src/core/exec.ts` | 拟新增 | 命令执行端口与结果契约（纯类型） |
| `src/core/plan.ts` | 拟新增 | 计划端口、追问契约（纯类型） |
| `src/core/coding.ts` | 拟新增 | 编码任务目标状态机与完成证据判定 |
| `src/core/permissions.ts` | 修改 | `ToolCapability` 增 `'execute'` |
| `src/core/events.ts` | 修改 | 增 `question_requested`/`question_answered`/`question_cancelled`/`command_started`/`command_finished`/`plan_updated` 事件 |
| `src/core/session.ts` | 修改 | 计划模式闸门、完成证据校验、追问挂起与回答注入、命令工具装配位 |
| `src/exec/` | 拟新增 | 解释器选择、spawn、输出截断、超时、后台任务、进程树终止、工具装配 |
| `src/git/` | 拟新增 | porcelain 解析、状态快照、worktree 进出、提交范围分析与受控提交 |
| `src/plan/` | 拟新增 | 计划存储与审批、执行前基线校验 |
| `src/tui/render/types.ts` | 修改 | `Frame` 增 plan/question/command 卡片字段 |
| `src/tui/render/reducer.ts` | 修改 | 新事件 → 卡片状态 |
| `src/tui/app.tsx` | 修改 | 卡片渲染与追问交互 |
| `src/tui/runtime.ts` | 修改 | 装配命令工具、Git 工具、计划工具 |
| `scripts/checks/module-boundaries.mjs` | 修改 | 新增 exec/git/plan 边界规则 |
| `src/tui/tsconfig.json` | 修改 | include 新增三个模块 |
| `package.json` | **不修改** | 无新增运行时第三方依赖（只用 Node 内置） |

**依赖与许可**：本轮**不新增任何运行时第三方依赖**。所有能力使用 Node.js 内置模块（`node:child_process`、`node:fs`、`node:path`、`node:os`）与既有 Ink/React 实现。

---

## 13. 自审记录（Agent 自审对象）

> 本节在设计自审通过时填写：结论、依据、允许动作范围。

- 自审结论：**通过（v1.0）**
- 自审要点：
  1. 与路线图 SP004 出口门槛逐项对齐：定位→修改→测试→修复（§5）、追问/转向（§5.3/§6.4）、Git 脏工作区（§7.1/§7.2）、Windows quoting（§4.2）、后台状态/取消/输出上限（§4.3/§4.4）、自身修改撤销（复用 SP003 checkpoint，§7.2）、无授权不发布（§7.4）。
  2. 模块边界合规：命令执行与 Git 落在新模块 `src/exec`/`src/git`，`core` 只持端口与状态机（§3）。
  3. 与 SP003 已交付能力不重复、不回归：权限策略、底线规则、checkpoint、文件工具全部复用（§1.4/§7.2）。
  4. 参考对照完整且只读机制不抄代码（§8），差异均有理由；有意偏离（更严格/更保守）三处并登记（§9 OPEN-03/04、§4.5 只读豁免）。
  5. 风险均有对应测试层与负向回归（§10）。
  6. 边界诚实：真终端人工与 live Provider 明确标 UNVERIFIED（§10）。
- 允许动作范围（2026-11-17 委托）：本设计的批准覆盖**同版计划、实施、测试、交付与各阶段本地提交**；**当前处于「仅文档」阶段，用户 2026-11-18 指示「先只完成文档，正式开发前等我通知再动手」→ 实施与提交暂缓，待用户通知**。交叉验证门禁 GREEN 后合入 master 与推送远端在委托内；npm 发布、打标签、远端设置、分支/worktree 删除不在授权内。
- 批准来源：USER_CONFIRMED（2026-11-17 审查与集成委托，取消常规人工审查，设计文档为 Agent 自审对象）+ USER_CONFIRMED（2026-11-18「开始 SP004 的开发」「先只完成文档，正式开发前等我通知再动手」）。

---

## 14. 版本记录

| 版本 | 日期 | 变化 | 身份 |
| --- | --- | --- | --- |
| v1.0 | 2026-11-18 | 首版设计：命令执行端口与解释器策略、后台任务模型、权限接线、编码任务状态机、计划/追问状态机、Git 状态与 worktree/提交门禁、参考对照与偏离、风险与 OPEN | MODEL_PROPOSED（技术方案），经 Agent 自审通过 |
| v1.1 | 2026-11-18 | **对照参考仓只读审计后修订**：新增 §9 审计结果（19 项事实修正 F-01…F-19、21 项遗漏点、9 项设计修正 C-01…C-09、5 项保留偏离、审计边界）；据此修正后台输出落盘与自动转后台、计划持久化与审批通道、计划模式语义为权限档位、待办与计划分离、追问多题结构、结构化只读命令表、沙箱能力声明层、worktree 退出语义、`TurnOutcome` 对齐 | MODEL_PROPOSED（技术方案），经 Agent 自审通过 |
