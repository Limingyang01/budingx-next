# SP004 真实编码任务 · 实施计划

版本：v1.3｜状态：**文档修订待用户确认，实施暂停**｜依据：[design.zh.md](design.zh.md) v1.3｜分支：`feature/SP004/real-coding-task`｜文档起点 `363d1eb`，核对的本地 master `5b0e7cc`｜命令默认从仓库根执行

> **执行方式**：按 `superpowers:executing-plans` 或 `superpowers:subagent-driven-development` 逐任务执行；步骤用 `- [ ]` 复选框跟踪。
>
> **当前状态（2026-11-18）**：用户指示「先只完成文档，正式开发前等我通知再动手」。**本计划已就绪但未执行**；T1 起的一切代码改动、提交与分支创建均等待用户放行。

---

## Goal

把 budingx 从「能改文件」推进到「能完成真实编码任务」：模型获得受权限与底线规则约束的真实命令执行能力（跨平台 quoting、超时、输出上限、后台任务可查可取消）；具备「测试失败→修复」的编码闭环与用户追问/转向；能识别 Git 脏工作区、隔离自身改动并按授权受控提交；多步骤任务可拆解、审批与追问。出口以路线图 SP004 门槛为准：隔离项目完成定位→修改→运行测试→修复；用户追问/转向、Git 脏工作区、Windows quoting、后台状态/取消/输出上限和自身修改撤销有实测；没有提交或推送授权不执行 Git 发布。

## Architecture

- 新模块 `src/exec`（真实进程）：解释器选择、spawn、输出截断、超时、后台任务表、进程树终止、`Bash`/`PowerShell` 工具装配。
- 新模块 `src/git`（真实 Git）：porcelain 解析、状态快照、worktree 进出、提交范围分析与受控提交。
- 新模块 `src/plan`（宿主无关状态机）：计划存储与审批、执行前基线校验。
- `src/core` 保持无 IO：新增纯端口 `CommandRunner`（`exec.ts`）、计划/追问契约（`plan.ts`）、编码任务状态机（`coding.ts`）；扩展 `ToolCapability` 增 `'execute'`、事件族增命令/计划/追问事件、`Session` 增计划模式闸门与完成证据校验。
- `src/tui`：命令、计划审批、待办和追问四类界面及场景验收。
- 依赖方向 `tui → {exec, git, plan, workspace} → core`；`core` 不依赖任何 IO/其他 `src/*` 模块（边界检查新增 exec/git/plan 条目）。

## Spec（权威来源）

- 设计：[design.zh.md](design.zh.md) v1.3
- 需求：[command-execution](../command-execution/requirements.md) v0.3、[coding-task-loop](../coding-task-loop/requirements.md) v0.3、[git-worktree-safety](../git-worktree-safety/requirements.md) v0.3、[task-planning](../task-planning/requirements.md) v0.3
- 路线图 **r9** SP004、能力矩阵 **v4**（含「TUI 还原度（结构等价）」行）、排查文档 r1 §4 SP004、参考仓行为事实盘点（只读对照）、**[TUI 还原度基线](../../../docs/tui-fidelity-gap-baseline.md) 与路线图 r9「TUI 还原度要求」节**

## Global Constraints

1. 不新增运行时第三方依赖；只用 Node.js 内置模块（`node:child_process`、`node:fs`、`node:path`、`node:os`）；不迁入参考仓源码、提示词、内部类型或 bundle。
2. JS/TS：2 空格、ESM、无分号、UTF-8；中文注释与文案（用户可见文案随既有 `lang` 约定，机器面保持英文）。
3. 行为变更先写有意义的失败回归（RED），再最小实现（GREEN）；零测试、全 skip、基础设施报错不算 RED。
4. 不动 `~/.claude`；用户数据只写 `~/.budingx`；不硬编码用户名、盘符、cwd。
5. 既有 SP002/SP003 行为不得回归：`npm run test:unit` 既有 **332 项**（2026-11-18 实测）必须持续全绿。**注意**：其中 `G01 Ink 隐藏 Key 输入、持久化且不回显`（`src/tui/test/app.test.mjs:117`）为**既有的并发隔离缺陷**（单文件通过、tui 目录并发时失败、全量运行时通过；master 同提交可复现），**不在 SP004 范围内修改**，但实施时需在 T0 阶段确认其不影响本轮新用例。
6. **本轮禁止在用户真实仓库执行 Git 写操作**（提交/合并/推送）；Git 验证一律使用临时仓库 fixture；`push` 实现不交付。
7. 每阶段完成即本地提交（中文提交说明）；合入 master 与推送远端在 2026-11-17 委托内，但需交叉验证门禁 GREEN；npm 发布、打标签、远端设置、分支/worktree 删除不在授权内。
8. 证据分层记录：L0 纯函数 / L1 真实进程 / L1 真实 Git / L2 伪 TTY e2e / L3 真终端人工 / live Provider；互不冒充。
9. `core` 不得引入 `node:*` IO；命令执行与 Git 一律经新模块，判定统一走 SP003 权限策略。
10. 参考 TUI 固定在 `b5c9be8`。v1.3 的协议、安全边界、局部视觉场景和已登记差异是执行依据。
11. 计划/追问/Git 能力按 **r8** 口径核对（SP004 出口门槛、功能目录与六个 CAP 归属均未变；CAP-L2-05 PowerShell 独立交付；CAP-L3-09 沙箱改为「明确声明能力与局限，不冒充 OS 沙箱」）。
12. **本仓数据路径**：后台任务输出落 `~/.budingx/sessions/<sessionId>/tasks/`；计划落 `~/.budingx/plans/<sessionId>/`；worktree 落 `~/.budingx/worktrees/`——三者均**不写用户项目目录**。
13. 按设计 §9.7 和验收报告验证 VIS-01…04。四类界面与能力同步完成，SP006 继续承担全局渲染和键位基础设施。
14. 独立实现及 AST 复核按 §9.8 / T24；精确视觉及截图取证须先确认设计使用权。

## Review Focus（评审重点）

- **完全权限下的底线**：完全权限模式下执行触碰凭据、`~/.budingx`、越界路径的命令，是否仍然被拒（合理预期：拒）。
- **Windows quoting 与 Unicode 路径**：含空格/中文的路径经 `args` 数组形式是否 100% 正确；命令文本形式下元字符是否被意外解释（合理预期：`args` 正确，文本形式行为确定且可复现）。
- **输出上限**：超大输出是否被截断且带显式标记，而非把整段灌进模型上下文（合理预期：截断 + 标记）。
- **进程树取消**：取消后子进程是否真的消失（Windows 上 `npm test` 派生的 node 进程是否残留）。
- **用户改动不被吞**：脏工作区中 Agent 修改后，用户的 staged/unstaged/untracked 是否原样存在（合理预期：存在）。
- **完成声明的空转**：模型在没有测试证据时能否声称完成（合理预期：不能，回注要求继续）。
- **计划模式绕过**：调研阶段经单次批准执行，待批计划阶段拒绝并发副作用，硬拒绝始终优先。
- **卡片与能力脱节**：计划/追问/命令能力已实现但卡片未接线，或卡片缺状态符号/阻塞来源/退出码（合理预期：四类场景完成状态对照与按键回放）。
- **预支 SP006**：本轮在 `src/tui/render` 内引入虚拟列表/冻结缓存/帧缓冲差分/上下文键位（合理预期：无——渲染层改造属 SP006 P0 独立批次）。

---

## 任务清单

### T0 · 实施前重核

用户确认 v1.3 后执行。核对实际 master / feature / upstream、可用 Windows 与 POSIX 解释器、证据环境及既有门禁。重新对照权限模式、Session 接口和现有渲染入口。产出隔离后端及各平台能力探测结果、参考 TUI 的执行条件和视觉权利确认状态。缺已验证隔离能力时普通 shell 保持关闭，对应实测记录 UNVERIFIED。验证 `git status --short --branch`、`git log -1 master`、`npm run spec:check`，并记录基线测试命令及数量。

**完成事实（2026-11-18）**：用户「继续开发SP004」+「继续」视为 v1.3 确认与实施放行。分支 `feature/SP004/real-coding-task` 与远端一致、工作区干净；master=origin/master=`5b0e7cc`；参考仓 `b5c9be8` 干净只读。node v24.15.0；git 2.56.0.windows.4.niugit；Git Bash 5.2.12、Windows PowerShell 5.1.19041.6456、pwsh7 均可用。无 WindowsSandbox/docker/bwrap → 无已验证隔离后端，普通 shell 默认关闭，真实后端隔离实测 UNVERIFIED（T20 以宿主注入可信上下文取证）。视觉权利未确认 → 像素级 UNVERIFIED，按行为交互验收。`npm run spec:check`、`npm run test:checks` 通过；`npm run test:unit` = **359/359 通过**（基线按 359 计；文档旧记 332 为更早基线；G01 并发缺陷本次全量未复现，不在本轮修改）。环境修复：node_modules 缺 lowlight/marked/hast，`npm ci` 恢复。接口核对：`ToolCapability` 需增 `execute`；Session 分派按 capability 走策略、`dispose()` 需终止后台；新模块 `src/exec`、`src/git`、`src/plan` 由 T16 加入 tsconfig include；测试从 `src/tui/dist/` 导入编译产物。

### T1 · core 命令执行与计划端口（纯契约）

- **设计**：§4.1、§3
- **AC**：CE-01（契约前置）、CE-05（契约前置）、TP-06（契约前置）、CT-01（前置）
- **依赖**：T0
- **Create**：`src/core/exec.ts`、`src/core/plan.ts`、`src/core/coding.ts`、`src/core/test/exec.test.mjs`、`src/core/test/plan.test.mjs`、`src/core/test/coding.test.mjs`
- **Modify**：`src/core/permissions.ts`（`ToolCapability` 增 `'execute'`）、`src/core/events.ts`（增 `command_started`/`command_finished`/`plan_updated`/`question_requested`/`question_answered`/`question_cancelled`）、`src/core/constants.ts`（增 `BUDINGX_EXEC_*` 错误码）
- **Consumes**：无（纯类型与常量）
- **Produces**：
  - `CommandSpec{command, cwd?, env?, timeoutMs?, runInBackground?, args?, interactive?}`、`CommandOutcome = 'completed'|'failed'|'timeout'|'cancelled'|'blocked'|'running'`、`CommandResult{outcome, exitCode?, stdout, stderr, output, truncated, bytes, durationMs, taskId?, reason?}`
  - `interface CommandRunner{ run(spec, ctx:{signal,cwd}): Promise<CommandResult>; status(taskId): CommandResult|undefined; cancel(taskId): boolean; list(): CommandResult[] }`
  - `PlanStep{id,title,status,blockedBy?,note?}`、`Plan{id,goal,steps,approval,fingerprint?,createdAt,updatedAt}`、`interface PlanStore{current,create,update,requestApproval,approve,reject,progress}`
  - `PendingQuestion{questionId,question,options,allowFreeText,createdAt}`、`QuestionOption{id,label,description?}`
  - `CodingTaskState`、`interface CodingTaskTracker{get,start,supplement,redirect,observeCommand,canClaimDone}`
  - `ToolCapability` 增 `'execute'`
- **RED**：`exec.test.mjs` 断言 `CommandResult` 的 outcome 枚举与必填字段形状、`CommandRunner` 接口的四个方法签名存在（编译期契约由 TS 检查，测试断言常量与错误码值）；`plan.test.mjs` 断言计划步骤状态枚举与 `PlanStore` 方法名；`coding.test.mjs` 断言 `canClaimDone` 的判定表（无命令 → 不通过；最近命令失败 → 不通过；最近命令成功但非测试类 → 不通过；测试类成功 → 通过）
- **GREEN**：只写类型、常量与纯逻辑（`canClaimDone` 判定表为纯函数）
- **验证**：`npm run build && node --test src/core/test/exec.test.mjs src/core/test/plan.test.mjs src/core/test/coding.test.mjs`

**完成事实（2026-11-18）**：RED 三文件因模块缺失失败 → GREEN 18/18 通过，全量 377/377（基线 359 + 新增 18）。`CommandSpec` 按设计 §4.1 五字段（计划旧文 args/interactive 不入模型规格）；追问端口按设计 §6.4 多题形状。Ruling：`observeCommand(command, result)` 携带命令文本、`CodingTaskState.testEvidence` 记录最近成功测试证据（设计判定表「至少一次测试成功」行的落实）；`BUDINGX_EXEC_001…007` 命名 MODEL_PROPOSED；TurnOutcome 补五值并同步 `src/tui/render/reducer.ts` 标签映射（新值本轮不产生）。

### T2 · 命令解释器选择与只读命令族判定

- **设计**：§4.2、§4.5（只读豁免）
- **AC**：CE-02（前置）、CE-03（前置）、CE-08（前置）
- **依赖**：T1
- **Create**：`src/exec/interpreter.ts`、`src/exec/readonly-commands.ts`、`src/exec/test/interpreter.test.mjs`
- **Consumes**：`CommandSpec`、平台信息
- **Produces**：
  - `selectInterpreter(tool: 'Bash'|'PowerShell', platform: NodeJS.Platform): { shell: string; args: string[]; label: string } | { error: string }`
  - `isReadOnlyCommand(command: string, args?: string[]): boolean`
  - `isBlockingWaitCommand(command: string): boolean`
  - `isInteractiveCommand(command: string): boolean`
- **RED**：Windows 探测 Git Bash 并执行 POSIX quoting，POSIX 探测 Bash，Windows 独立探测 PowerShell，缺解释器或 POSIX PowerShell 返回错误。固定只读操作与未知参数分别判定，复杂语句不可获得豁免。
- **GREEN**：以显式表驱动实现，不做自然语言解析
- **验证**：`npm run build && node --test src/exec/test/interpreter.test.mjs`
- **完成事实（2026-11-18）**：RED 模块缺失失败 → GREEN 11/11 通过，全量 388/388（377 + 新增 11）。`selectInterpreter` 表驱动探测真实路径（Windows Git Bash 候选 `C:/Program Files/Git/bin/bash.exe` 等；PowerShell 用 `%SystemRoot%/System32/WindowsPowerShell/v1.0/powershell.exe`，参数 `-NoProfile -NonInteractive -Command`；POSIX PowerShell 明确不可用）。`tokenizeCommand` 引号感知分词，复合元字符（; & | > < ` $( ) 换行）与不闭合引号返回 undefined → 不豁免；只读白名单逐参数校验（git 仅 status/log/diff/show/rev-parse/branch 列表形态/remote -v/--version；裸 `git branch <name>` 属创建分支不豁免）；argv 形式同判定。Ruling：第三参 `{exists?}` 探测注入（跨平台测试）；tsconfig include 提前加 `../exec/**/*.ts`。

### T3 · 真实进程执行（前台）

- **设计**：§4.3、§4.1
- **AC**：CE-01、CE-02、CE-04、CE-05、CE-08（前置）、CE-12、CE-13、CE-15
- **依赖**：T1、T2、T20
- **Create**：`src/exec/runner.ts`、`src/exec/output.ts`、`src/exec/test/runner.test.mjs`
- **Consumes**：`CommandSpec`、`CommandResult`、解释器选择结果、宿主可信执行上下文（T20 后端接线）
- **Produces**：`createCommandRunner(options:{ defaultCwd: string; env?: Record<string,string> })` → `CommandRunner`
- **RED**（真实进程）：
  1. 执行 `node -e "process.stdout.write('out');process.stderr.write('err')"` → `exitCode=0`，`stdout` 含 `out`，`stderr` 含 `err`，三者分离（CE-01）
  2. 执行 `node -e "process.exit(3)"` → `exitCode=3`，`outcome='failed'`，**非零码不被吞**（CE-01/CT-08）
  3. `cwd` 指向含空格与中文的临时目录 → 子进程 `process.cwd()` 与该目录一致（CE-02）
  4. `args` 形式执行含空格/中文路径的 node 脚本 → 参数原样到达，无引号截断（CE-02）
  5. 超时：`node -e "setTimeout(()=>{},60000)"` 且 `timeoutMs=300` → `outcome='timeout'`，进程已终止，耗时 < 5s（CE-04）
  6. 输出上限：输出 100KB → `truncated=true`、`bytes>cap`、文本含 `[输出已截断` 标记（CE-05）
  7. `env` 传入自定义变量 → 子进程读到该值（CE-15）
  8. 交互式族命令 → `outcome='failed'` 且 `reason` 含「交互式」，**不挂起**（CE-12）
  9. 阻塞等待族命令 → `outcome='blocked'` 且 `reason` 指引后台（CE-13）
- **GREEN**：使用托管操作或隔离后端启动，拒绝路径先验证零 spawn。实现 stdin 立即关闭、stdout/stderr 分流累积、字节上限截断（保留首尾）、超时 timer、AbortSignal 监听
- **验证**：`npm run build && node --test src/exec/test/runner.test.mjs`
- **完成事实（2026-11-18）**：RED 模块缺失失败 → GREEN 13/13 通过，全量 412/412（399 + 新增 13）。`createCommandRunner` 拒绝顺序（全部零 spawn，注入计数 spawn 断言）：预 abort → 硬上限拒启 → 交互式族 failed → 阻塞族 blocked（指引 runInBackground）→ 隔离门禁 deny → 解释器缺失 failed；通过后 `spawn(shell, [...args, command], { shell:false, windowsHide:true })`，stdin 立即关闭，stdout/stderr 分流累积（保留首尾各 cap/2 + 精确总字节），合并输出同上限再截断，标注「[输出已截断：显示 N 字节 / 共 M 字节]」。超时/取消经 `killTree` 终止整棵进程树。Ruling：设计 CommandSpec 无 args 字段，RED#4 以引号包裹命令文本验证参数原样到达；killTree 在 Windows 必须等 `taskkill /PID <pid> /T /F` 完成后再 child.kill 兜底（先杀父进程会导致 taskkill 无法定位孤儿子进程，实测超时用例 60s 不终止）。status/cancel/list 为 T3 桩，T4 实现。

### T4 · 后台任务与进程树取消

- **设计**：§4.4
- **AC**：CE-06、CE-07、CE-14（部分）
- **依赖**：T3
- **Create**：`src/exec/background.ts`、`src/exec/test/background.test.mjs`
- **Consumes**：`CommandRunner` 实现
- **Produces**：`createCommandRunner` 扩展支持 `runInBackground`；`status(taskId)`、`cancel(taskId)`、`list()`
- **RED**（真实进程）：
  1. `runInBackground=true` → 立即返回 `outcome='running'` 且 `taskId` 非空（CE-06）
  2. 轮询 `status(taskId)` → 状态从 `running` 变 `completed`/`failed`，输出可见（CE-06）
  3. `cancel(taskId)` → 状态 `cancelled`；重复取消返回 `false`（幂等）（CE-07）
  4. **进程树**：启动 `node -e "require('child_process').spawn(process.execPath,['-e','setTimeout(()=>{},60000)'])"` 后取消 → 子进程在 5s 内消失（CE-07 / R-02）
  5. AbortSignal 触发 → 任务转 `cancelled`（CE-14）
- **GREEN**：后台任务表（内存）、Windows `taskkill /T /F` + `child.kill()` 双保险、POSIX 进程组 SIGTERM→SIGKILL
- **验证**：`npm run build && node --test src/exec/test/background.test.mjs`
- **完成事实（2026-11-18）**：RED 5 条真实进程失败（旧实现把后台命令当前台执行，断言失败/超时）→ GREEN 5/5；全量 `npm run test:unit` 417/417 通过。`src/exec/background.ts` 内存任务表：register 立即 running+taskId（`task-<uuid>`）、status/list 实时输出快照、cancel 幂等（终态/未知 id 返回 false）、超时 timer 与 AbortSignal 均走 killTree；孙进程取消后 5s 内消失实测通过（Windows taskkill /T /F 先于 child.kill 兜底）。Ruling：`CommandRunner` 增可选 `dispose?(): void`（Session.dispose 接线需要）；status/list 按 T1 契约返回 CommandResult 快照（outcome=任务状态），BackgroundTask 为内部记录类型供 T18/T19 落盘与事件使用。

### T5 · 工具适配器与同一权限入口

- **设计**：§4.5–§4.9。**AC**：CE-01、CE-08…11、CE-16、CE-17。**依赖**：T3、T4、T20、T21。
- **Create**：`src/exec/tools.ts`、`src/exec/test/tools.test.mjs`。**Modify**：`src/core/session.ts`、`src/workspace/policy.ts`。
- **Consumes/Produces**：执行路由和 SP003 策略 → Bash、PowerShell 的模型 schema 和公共结果适配器。
- **RED → GREEN**：先验证字段名与单位、未知字段拒绝、硬 deny 优先、未识别目标无豁免、禁止通用入口获得 Git 写权限。前台、后台和自动后台复用同一启动门禁；同一调用只输出一个工具结果，非零状态、耗时、截断和后台回执可断言。
- **验证**：`npm run build && node --test src/exec/test/tools.test.mjs`。

### T6 · Git 只读状态识别

- **设计**：§7.1
- **AC**：GW-01、GW-08
- **依赖**：T1
- **Create**：`src/git/status.ts`、`src/git/porcelain.ts`、`src/git/test/status.test.mjs`
- **Consumes**：仓库路径
- **Produces**：`readGitStatus(cwd): Promise<GitStatus>`；`parsePorcelain(raw: string): { staged, unstaged, untracked, conflicted }`
- **RED**（真实 Git，临时仓库 fixture）：
  1. 空仓库 → `isRepository=true`、`staged/unstaged/untracked` 均为空（GW-01）
  2. 三类改动齐备 → 三类分别正确计数（GW-01）
  3. 路径含空格/中文 → porcelain 解析不误切（`-z` 解析）
  4. 非 Git 目录 → `isRepository=false`（GW-08）
  5. `git` 不可用（PATH 置空）→ `gitAvailable=false`，不抛未捕获异常（GW-08）
- **GREEN**：`git status --porcelain=v1 -z --branch` 调用与解析；**只读**，不改配置不写索引
- **验证**：`npm run build && node --test src/git/test/status.test.mjs`
- **完成事实**：待填

### T7 · 改动归属与提交范围分析

- **设计**：§7.2
- **AC**：GW-02、GW-03
- **依赖**：T6、SP003 checkpoint
- **Create**：`src/git/attribution.ts`、`src/git/test/attribution.test.mjs`
- **Consumes**：SP003 `CheckpointStore` 记录、`GitStatus`
- **Produces**：`analyzeChanges({ status, ownPaths })` → `{ include: {path, operation}[], userOwned: string[], untouched: string[] }`
- **RED**（临时仓库 + 真实文件）：
  1. 用户预置 staged + unstaged + untracked，Agent 改另一文件 → `include` 只含 Agent 文件；`userOwned` 含用户三类改动（GW-02/GW-03）
  2. 断言全程未发生 reset/stash/clean（可用 Git 引用前后快照比对）（GW-02）
  3. Agent 改动与用户改动同文件不同区域 → 该文件只出现一次且标注混合（GW-03）
- **GREEN**：以基线、索引及 checkpoint 前像和后像确定补丁归属，混合修改或外部漂移标记冲突
- **验证**：`npm run build && node --test src/git/test/attribution.test.mjs`
- **完成事实**：待填

### T8 · worktree 进出

- **设计**：§7.3
- **AC**：GW-05、GW-06、GW-07
- **依赖**：T6
- **Create**：`src/git/worktree.ts`、`src/git/test/worktree.test.mjs`
- **Consumes**：仓库路径、worktree 根目录（默认 `~/.budingx/worktrees`）
- **Produces**：`enterWorktree({ cwd, name, root? })` → `{ path, branch, baseBranch }`；`exitWorktree(current)` → `{ cwd }`
- **RED**（真实 Git）：
  1. 主工作区有未提交改动 → 进入 worktree 后主工作区状态**不变**，新目录独立（GW-05）
  2. 退出后回到原 cwd，主工作区状态仍不变；隔离目录**未被删除**（GW-06）
  3. 名称冲突（同名分支已存在）→ 明确失败，**cwd 不变**，无半成品目录（GW-07）
  4. 非 Git 目录 → 明确失败「非 Git 仓库」（GW-07/GW-08）
  5. 非法名称（`../evil`、`a/b`、超长）→ 拒绝（路径穿越防护）
- **GREEN**：`git worktree add` / `git worktree list`，名称正则 `^[a-z0-9][a-z0-9-_]{0,40}$`，路径在 root 下解析并做越界检查
- **验证**：`npm run build && node --test src/git/test/worktree.test.mjs`
- **完成事实**：待填

### T9 · Git 提交授权与专用 worktree

- **设计**：§7.2、§7.4。**AC**：GW-03、GW-04、GW-09。**依赖**：T7、T8。
- **Create**：`src/git/commit.ts`、`src/git/test/commit.test.mjs`。**Consumes**：归属补丁、Git 工作树身份、会话审批。**Produces**：授权后仅对指定专用分支提交，返回 SHA 与实际文件清单。
- **RED**：未授权和重复授权均不写 ref。原 checkout 含 staged、unstaged、untracked 时，专用分支仍只提交审批补丁且原索引和文件保持原样。对同文件混合修改、过期 HEAD、内容漂移、并发 ref 变更、待提交树不一致和钩子失败逐一拒绝，核对两侧状态与授权不复用。
- **GREEN**：构造审批快照，校验补丁和树，调用受控提交入口。无法证明带有效钩子的实际提交树一致时中止。真实仓库 fixture 检查结果 tree 和原 checkout 状态。
- **验证**：`npm run build && node --test src/git/test/commit.test.mjs`。

### T10 · 计划状态机与审批（src/plan）

- **设计**：§6.1、§6.3
- **AC**：TP-01、TP-02、TP-04、TP-09
- **依赖**：T1
- **Create**：`src/plan/store.ts`、`src/plan/validate.ts`、`src/plan/test/store.test.mjs`
- **Consumes**：`Plan`、`PlanStep`、`PlanStore` 端口
- **Produces**：`createPlanStore()` → `PlanStore`；`validateBeforeExecute(plan, snapshot)` → `{ ok: boolean; drift: {item,expected,actual}[] }`
- **RED**（纯逻辑）：
  1. 创建计划 → 步骤状态 `pending`，`approval='none'`（TP-01）
  2. 更新步骤 → 状态与 `blockedBy` 生效（TP-02）
  3. `requestApproval` → `approval='pending'`；此时**不得**有任何执行入口（TP-04）
  4. `approve` → `approval='approved'` 且写入 `fingerprint`；`reject` → `approval='rejected'`（TP-04）
  5. 步骤数超 50 → 拒绝（OPEN-02）
  6. `progress()` 计数准确；完成后报告含实际完成数与残留项（TP-09）
  7. 基线漂移校验：文件缺失/指纹变化/HEAD 变化 → `ok=false` 且 `drift` 列出差异项（TP-05）
- **GREEN**：纯状态机实现
- **验证**：`npm run build && node --test src/plan/test/store.test.mjs`
- **完成事实**：待填

### T11 · 计划模式闸门

- **设计**：§6.2–§6.3。**AC**：TP-03…05。**依赖**：T5、T10。
- **Modify**：`src/core/session.ts`。**Create**：`src/core/test/plan-mode.test.mjs`。**Consumes**：统一权限入口、PlanStore 和 ApprovalGateway。**Produces**：单一计划模式状态转换。
- **RED → GREEN**：测试底层允许的只读不请求批准、调研期写或执行须单次批准、基础 deny 不得覆盖。ExitPlanMode 读取会话计划文件。批准/拒绝/取消、并发、计划漂移及原档位恢复逐项测试。待批期间不得启动副作用。
- **验证**：`npm run build && node --test src/core/test/plan-mode.test.mjs`。

### T12 · 追问工具与回合挂起

- **设计**：§6.4
- **AC**：TP-06、TP-07、TP-08、CT-05、CT-06
- **依赖**：T1、T11
- **Modify**：`src/core/session.ts`（追问挂起与回答注入）、`src/core/events.ts`
- **Create**：`src/core/test/question.test.mjs`
- **Consumes**：`PendingQuestion`、`ApprovalGateway`（复用挂起通道）
- **Produces**：`AskUserQuestion` 工具；Session 提交接口 `answerQuestion(questionId, answer)`
- **RED**：
  1. 模型调用 `AskUserQuestion` → 回合进入挂起态并发 `question_requested` 事件，含问题与选项（TP-06/CT-05）
  2. 选项少于 2 个 → 工具拒绝并要求至少 2 个
  3. 回答注入后回合继续，以原 call ID 的单一 **tool_result** 进入历史和下一次 Provider 请求（TP-07/CT-06）
  4. 取消追问 → 发 `question_cancelled`，任务落到可恢复态，不无限等待（TP-08）
- **GREEN**：复用既有 `awaiting_approval` 状态承载挂起，新增三个事件类型避免破坏既有状态机
- **验证**：`npm run build && node --test src/core/test/question.test.mjs`；回归 `npm run test:unit`
- **完成事实**：待填

### T13 · 编码任务目标状态机与完成证据

- **设计**：§5.2、§5.3
- **AC**：CT-01、CT-02、CT-04、CT-07、CT-08
- **依赖**：T1、T5
- **Create**：`src/core/coding.ts`（实现）、`src/core/test/coding.test.mjs`
- **Modify**：`src/core/session.ts`（完成证据校验、迭代上限、转向接线）
- **Consumes**：`CommandResult`、`CodingTaskTracker`
- **Produces**：`createCodingTaskTracker()` → `CodingTaskTracker`；`isTestCommand(command): boolean`
- **RED**：
  1. 无任何命令证据时 `canClaimDone()` 不通过（CT-07）
  2. 最近命令 `failed` → 不通过（CT-07/CT-01）
  3. 最近命令成功但非测试类 → 不通过（CT-07）
  4. 测试类命令成功 → 通过（CT-07）
  5. `redirect()` 替换目标后旧目标不再驱动 `phase`（CT-04）
  6. `supplement()` 纳入当前目标且不替换（CT-03 前置）
  7. 达到 `MAX_ITERATIONS` → `outcome='max_turns'` 且保留最后失败证据（CT-02）
  8. `isTestCommand` 覆盖 `npm test`/`vitest`/`pytest`/`go test`/`cargo test` 等
- **GREEN**：纯状态机 + Session 校验点接线
- **验证**：`npm run build && node --test src/core/test/coding.test.mjs`；回归 `npm run test:unit`
- **完成事实**：待填

### T14 · 隔离项目端到端闭环（真实编码任务）

- **设计**：§5、§6.3、§7.2
- **AC**：CT-01、CT-08、GW-02、GW-03、TP-05（端到端）
- **依赖**：T5、T7、T11、T13、T19
- **Create**：`src/tui/test/coding-loop.test.mjs`（伪 TTY e2e）、`src/exec/test/isolated-project.test.mjs`
- **Consumes**：全部前述能力
- **Produces**：端到端场景用例（非新生产接口）
- **RED**（真实文件 + 真实进程 + 伪 TTY）：
  1. 在临时项目里放一个失败测试 → Agent 流程：定位→修改→运行测试→读失败→修复→复测通过（CT-01/CT-08）
  2. 全程用户预置的无关文件改动保持不变（GW-02/GW-03）
  3. 计划批准后目标文件被外部改动 → 执行被拒并列出漂移项（TP-05）
- **GREEN**：用例驱动（不新增生产逻辑，除非暴露出真实缺陷——缺陷按 systematic-debugging 定位修复）
- **验证**：`npm run build && node --test src/tui/test/coding-loop.test.mjs src/exec/test/isolated-project.test.mjs`
- **完成事实**：待填

### T15 · 四类 TUI 视觉、交互与协议验收

- **设计**：§4.9、§6、§9.7。**AC**：CE-01/05/06/18、TP-01…08、CT-05/06。**依赖**：T5、T11、T12、T18、T19、T22。
- **Modify**：`src/tui/render/types.ts`、`src/tui/render/reducer.ts`、`src/tui/app.tsx`、`src/tui/runtime.ts`。**Create**：`src/tui/test/sp004-cards.test.mjs` 和合成回放 fixture。**Consumes**：工具事件、批准回执和问题结果。**Produces**：已有布局槽内的四类可交互界面。
- **RED**：按 [验收报告](../test-report.md) 的 VIS-01…04 回放，断言焦点、状态、光标、按键及输出归属。协议 fixture 断言同一个调用 ID 只产生一个结果。对授权范围内的视觉对照，捕获参考和本仓的两种尺寸单元格与位图，稳定区域差异零或有逐项已确认例外。
- **GREEN**：复用现有 Ink 布局及输入处理，卡片与工具同步接线。真实终端补测按键、跨尺寸、中文输入和主题。
- **验证**：`npm run build && node --test src/tui/test/sp004-cards.test.mjs`。保存尺寸、环境、重放序列、单元格差分、PNG 差分和逐项结论。

### T16 · 模块边界与构建接线

- **设计**：§3、§11
- **AC**：出口门槛④
- **依赖**：T1–T15（按依赖执行）
- **Modify**：`scripts/checks/module-boundaries.mjs`（新增 exec/git/plan 条目）、`src/tui/tsconfig.json`（include 新增三个模块）
- **Create/Modify**：`src/*/index.ts` 导出面
- **Consumes**：无
- **Produces**：边界检查覆盖新模块
- **RED**：`npm run test:checks` 在规则未加入前不报错 → **加入后**需验证：`core` 若 import `node:child_process` 则被检出（用临时违规文件验证一次，随后移除）
- **GREEN**：补齐规则与 include
- **验证**：`npm run test:checks && npm run build`
- **完成事实**：待填

### T17 · 全量回归与交付记录

- **设计**：§10
- **AC**：全部 48 条（CE 20 + CT 9 + GW 9 + TP 10）
- **依赖**：T1–T16、T18–T24
- **Create**：`SP/SP004/test-report.md`、四份 STATUS 回写、`SP/SP004/requirements-summary.md` 回写、`PRODUCT.md` 同步
- **Consumes**：全部任务完成事实
- **Produces**：交付证据与交接材料
- **验证顺序**：
  1. `npm run test:unit`（既有 302 项 + 本轮新增）
  2. `npm run test:checks`（模块边界）
  3. `npm run spec:check`、`npm run skills:check`
  4. `npm test`（全量）
  5. 交叉验证门禁 `npm run merge:gate`
- **RED**：不适用（验收阶段；每个 AC 已有单测 + 功能用例）
- **GREEN 判据**：逐条 AC 映射到实际用例与计数；未执行项标 UNVERIFIED；真终端人工与 live Provider 明确 UNVERIFIED
- **完成事实**：待填

---

## v1.1 新增任务（参考仓审计驱动的补充）

### T18 · 后台输出落盘与完成通知

- **设计**：§4.4（v1.1）、§9.1 F-03/F-04
- **AC**：CE-17
- **依赖**：T4
- **Create**：`src/exec/persist.ts`、`src/exec/test/persist.test.mjs`
- **Consumes**：`CommandResult`、会话 ID
- **Produces**：`resolveTaskOutputPath(sessionId, taskId)` → 绝对路径；`persistOutput(path, content)` → `{ path, size }`；完成事件构造器
- **RED**（真实进程）：
  1. 后台任务产生输出 → 文件写入 `~/.budingx/sessions/<sid>/tasks/<tid>.out`，内容与实际输出一致（CE-17）
  2. 超大前台输出（> 阈值）→ 落盘 + `persistedOutputPath`/`persistedOutputSize` 回传（CE-17）
  3. 不同会话 ID → 路径不同，互不覆盖（CE-17）
  4. 任务完成 → 产生 `command_finished` 事件，含 taskId/状态/退出码/输出路径（CE-17）
- **GREEN**：按 `~/.budingx` 会话隔离路径写文件；**不写用户项目目录**
- **验证**：`npm run build && node --test src/exec/test/persist.test.mjs`
- **完成事实（2026-11-18）**：RED 6 条（模块缺失）→ GREEN 6/6；全量 `npm run test:unit` 423/423（417+6）。新增 `src/exec/persist.ts`（resolveTaskOutputPath/persistOutput/buildCommandFinishedEvent）；`OutputCollector` 增 full 模式与 fullContent()；runner 增 sessionId/home/persistThreshold/onCommandFinished 注入，前台超阈值落盘回传 persistedOutputPath/Size；background 落盘后**终态原子发布**（修复轮询读到半终态竞态），完成回调发 command_finished。落盘 best-effort 不影响命令终态；数据只写 `~/.budingx/sessions/<sid>/tasks/`，不写用户项目。Ruling：完整输出内存全量保留（受超时约束），流式落盘留后续优化。

### T19 · 阻塞预算自动转后台

- **设计**：§4.4 规则 2（v1.1）、§9.1 F-02
- **AC**：CE-16
- **依赖**：T4
- **Modify**：`src/exec/runner.ts`（前台执行器接入阻塞预算计时）
- **Create**：`src/exec/test/auto-background.test.mjs`
- **Consumes**：`EXEC_BLOCKING_BUDGET_MS = 15000`
- **Produces**：前台执行超预算 → 自动转为后台任务并返回 `outcome='running'` + `autoBackgrounded=true`
- **RED**（真实进程）：
  1. 命令运行 >15s → 工具结果含 `background_task_id`、`auto_backgrounded=true` 与输出路径；**回合不被该命令阻塞**（CE-16）
  2. 命令在预算内完成 → 正常返回 `completed`，**不**误转后台（CE-16）
  3. 转后台后任务可被 `status()` 查询与 `cancel()` 取消（CE-16）
- **GREEN**：前台执行器用独立计时器，预算到达时移交后台任务表并立即返回
- **验证**：`npm run build && node --test src/exec/test/auto-background.test.mjs`
- **完成事实**（2026-11-18）：RED 3 条真实进程失败（超预算命令前台跑完返回 completed、长命令阻塞回合 30s）→ GREEN 3/3；全量 426/426 通过。实现：`CommandRunnerOptions.blockingBudgetMs?`（测试注入缩短，生产默认 `EXEC_BLOCKING_BUDGET_MS=15000`）；前台独立 budgetTimer 到达即移交 `background.register`（复用同一子进程与 full 收集器，register 不重复挂 data 监听），立即返回 `outcome='running'`+`taskId`+`autoBackgrounded=true`+reason（含预算毫秒数与落盘路径）；超时/取消/落盘/完成事件由后台表接管；finalize 与启动失败路径均清 budgetTimer。
- **备注**：本任务用**缩短的预算常量**（测试注入）以避免 15s 级用例拖慢回归；生产默认值仍为 15000

### T20 · 隔离后端接线与危险操作提示

- **设计**：§4.5–§4.7。**AC**：CE-10、CE-11、CE-18、CE-19、GW-04。**依赖**：T0、T1、T2。
- **Create**：`src/exec/destructive.ts`、`src/exec/sandbox-policy.ts`、`src/exec/test/destructive.test.mjs`、`src/exec/test/sandbox-policy.test.mjs`。**Produces**：宿主执行能力探测、受控策略和结构化拒绝。
- **RED → GREEN**：单元覆盖缺后端、缺网络或文件约束时零 spawn，警告不改写策略及普通命令无 Git 授权。真实后端用合成目标证明子进程无法访问宿主受保护文件、Git 元数据和被拒网络，前后台同等执行。平台不可用记 UNVERIFIED。
- **验证**：`npm run build && node --test src/exec/test/destructive.test.mjs src/exec/test/sandbox-policy.test.mjs`，另记录每个平台真实后端验证命令及结果。
- **完成事实（2026-11-18）**：RED（两测试文件模块缺失）→ GREEN 10/10（destructive 4 + sandbox-policy 7）；全量 399/399。`detectDestructiveCommand` 表驱动分词+复合语句保守正则扫描，`destructiveWarningText` 固定文案；`createSandboxPolicy({backend?})` 纯决策层：模型控制字段（dangerouslyDisableSandbox/sandbox/isolation）拒绝、无后端/未验收拒绝（EXEC_005）、网络域名不可强制拒绝；拒绝路径零 spawn 由结构保证。真实后端合成目标验证：本机无 WindowsSandbox/docker/bwrap，记 UNVERIFIED（T0 探测）；runner 注入 spawn 计数断言在 T3 落实。

### T21 · 命令内受限编辑（sed -i）与结构化只读命令表

- **设计**：§4.8、§4.5（v1.1）、§9.1 F-07/F-09
- **AC**：CE-20、CE-09（只读豁免精度）
- **依赖**：T2、SP003 `diffLines`/`CheckpointStore`
- **Create**：`src/exec/sed-edit.ts`、`src/exec/readonly-commands.ts`、`src/exec/test/sed-edit.test.mjs`、`src/exec/test/readonly-commands.test.mjs`
- **Consumes**：命令文本、工作区、`diffLines`、`CheckpointStore`
- **Produces**：
  - `parseSedEdit(command): SedEditInfo | undefined`（`{ filePath, pattern, replacement, flags, extendedRegex }`）
  - `validateSedEdit(info, workspace): { ok: boolean; reason?: string }`（仅允许 `s`；拒绝 `w/W/e/E` 等与危险 flag 组合；路径必须工作区内）
  - `isReadOnlyCommand(command, args?): boolean`（结构化表：命令→子命令→参数类型）
- **RED**：
  1. `sed -i 's/a/b/g' f` → 识别为命令内编辑并产出 diff（CE-20）
  2. `sed -i 'a/i' f`（插入）、`sed -i 'w out' f`（写文件）、`sed -i -n -i f`（危险组合）→ **拒绝**（CE-20）
  3. 目标文件在工作区外 → 拒绝（CE-20）
  4. 命令内编辑的改动登记进 checkpoint（可撤销、计入改动归属）（CE-20 / GW-02）
  5. `git diff`、`git status`、`git log` → 只读豁免（CE-09）
  6. `git diff --unknown-flag` → **不豁免**（参数未知）（CE-09）
  7. `git push`、`git commit`、`npm install` → **不豁免**（CE-09）
- **GREEN**：自写受限解析与白名单表；diff 复用 SP003 `diffLines`
- **验证**：`npm run build && node --test src/exec/test/sed-edit.test.mjs src/exec/test/readonly-commands.test.mjs`
- **完成事实**：待填

### T22 · 计划持久化、审批通道与语义修正

- **设计**：§6.1/§6.2/§6.3/§6.4（v1.1）、§9.1 F-11/F-12/F-13/F-14/F-15
- **AC**：TP-03、TP-04、TP-06、TP-07、TP-10
- **依赖**：T10、T11、T12
- **Modify**：`src/plan/store.ts`（持久化）、`src/core/session.ts`（计划模式语义降级 + 审批通道 + 追问多题）
- **Create**：`src/plan/serialize.ts`、`src/plan/test/persist.test.mjs`
- **Consumes**：`PlanStore`、`PendingQuestion`、SP003 `ApprovalGateway`
- **Produces**：
  - `serializePlan(plan): string`（Markdown + YAML frontmatter）
  - `parsePlan(text): Plan`
  - `planFilePath(sessionId, planId)` → `~/.budingx/plans/<sessionId>/<planId>.md`
  - 计划模式：只调用 T11 状态转换；本任务细化会话文件读写、审批正文和反馈接线
  - 追问：`questions[1-4]`，每题 `{question, header, options[2-4], multiSelect}`；答案按题目文本关联；自动 Other
- **RED**：
  1. 计划创建 → 落盘为 `.md`；读回内容与内存结构一致（TP-10）
  2. 批准可携带**用户编辑后的正文** → `approvedText` 记录且指纹重算（TP-04）
  3. 拒绝携带反馈 → 反馈回灌模型（TP-04）
  4. 计划模式下：`Read` 允许、`Bash` 走**需批准**（非硬拒绝）、`Write` 需批准（TP-03）
  5. 退出计划模式 → 恢复 `preMode`（TP-03）
  6. 追问：1–4 题、每题 2–4 选项；题数 0 或 >4 → 拒绝；选项 <2 → 拒绝（TP-06）
  7. 追问答案按题目文本关联并回填原 call ID 的工具结果（TP-07）
  8. 计划与待办为**两个对象**：待办项无 `blockedBy`、状态仅 3 个（TP-02）
- **GREEN**：持久化与解析、权限档位语义、审批通道复用、多题追问
- **验证**：`npm run build && node --test src/plan/test/persist.test.mjs src/core/test/plan-mode.test.mjs src/core/test/question.test.mjs`
- **完成事实**：待填

### T23 · Git 状态增强与 worktree 退出语义

- **设计**：§7.1、§7.3（v1.1）、§9.1 F-17/F-18
- **AC**：GW-01、GW-05、GW-06、GW-07
- **依赖**：T6、T8
- **Modify**：`src/git/status.ts`、`src/git/worktree.ts`
- **Create**：`src/git/test/status-extended.test.mjs`、`src/git/test/worktree-exit.test.mjs`
- **Consumes**：Git 仓库路径
- **Produces**：`GitStatus` 增 `remoteUrl`（脱敏）/`isHeadOnRemote`/`worktreeCount`；`exitWorktree({ action: 'keep'|'remove', discard_changes?: boolean }, authorization?)`
- **RED**：
  1. Git 调用带 `--no-optional-locks`（不争抢索引锁）（GW-01）
  2. `remoteUrl` 含 token → **脱敏**（GW-01）
  3. `worktreeCount` 正确（GW-01）
  4. slug 违规（>64 字符、空段、含 `..`）→ 拒绝（GW-07）
  5. 目标 worktree 已存在 → **恢复复用**而非重复创建（GW-05）
  6. `action:'remove'` 且有未提交/未合并 → 缺少 `discard_changes:true` 或宿主单次授权时拒绝并列出残留（GW-06）
  7. `action:'keep'` → worktree 与分支保留（GW-06）
  8. 移除后回执含 `discardedFiles`/`discardedCommits` 计数（GW-06）
- **GREEN**：按 F-17/F-18 语义实现
- **验证**：`npm run build && node --test src/git/test/status-extended.test.mjs src/git/test/worktree-exit.test.mjs`
- **完成事实**：待填

---

### T24 · 独立来源及 AST 复核

- **设计**：§9.8。**依赖**：T15、T16、T23 及拟交付变更。**Create**：仅在放行后新增项目维护脚本 `scripts/review/sp004-ast.mjs`。**Produces**：报告中的复核结果和本地审计记录。
- **验证**：`node scripts/review/sp004-ast.mjs --reference <参考仓> --reference-revision b5c9be8 --base <功能基线>`。先用合成 TS/TSX 检查相似片段、无关实现和样板排除，再输出路径、范围、指标及人工处置。未覆盖路径、解析失败或未处理命中不得记 PASS。文件列表限本轮改动及对应参考源码。
- T17 收口须取得 T24 结论。明记公共协议所需重合、复核理由和未验证边界。

## 测试收口映射（AC → 任务 → 用例）

| AC | 任务 | 单元用例（文件） | 功能/端到端用例（文件） |
| --- | --- | --- | --- |
| CE-01 | T3/T5 | `exec/test/runner.test.mjs`（退出码与三流分离） | `tui/test/sp004-cards.test.mjs`（命令卡片显示 exit_code） |
| CE-02 | T2/T3 | `exec/test/interpreter.test.mjs` | `exec/test/runner.test.mjs`（含空格/中文 cwd 与 args） |
| CE-03 | T2 | `exec/test/interpreter.test.mjs` | `exec/test/runner.test.mjs`（元字符行为确定） |
| CE-04 | T3 | — | `exec/test/runner.test.mjs`（超时终止） |
| CE-05 | T3 | — | `exec/test/runner.test.mjs`（截断与标记） |
| CE-06 | T4 | — | `exec/test/background.test.mjs`（后台状态查询） |
| CE-07 | T4 | — | `exec/test/background.test.mjs`（取消与进程树消失） |
| CE-08 | T5 | `exec/test/tools.test.mjs` | `exec/test/isolated-project.test.mjs` |
| CE-09 | T5 | `exec/test/tools.test.mjs` | 同上 |
| CE-10 | T5 | `exec/test/tools.test.mjs` | 同上 |
| CE-11 | T5 | `exec/test/tools.test.mjs` | 同上 |
| CE-12 | T2/T3 | `exec/test/interpreter.test.mjs` | `exec/test/runner.test.mjs`（交互式明确失败） |
| CE-13 | T2/T3 | `exec/test/interpreter.test.mjs` | `exec/test/runner.test.mjs`（阻塞拦截） |
| CE-14 | T4 | — | `exec/test/background.test.mjs`（AbortSignal） |
| CE-15 | T3 | — | `exec/test/runner.test.mjs`（env 生效） |
| CE-16 | T19 | — | `exec/test/auto-background.test.mjs`（自动转后台 + 不误转） |
| CE-17 | T18 | — | `exec/test/persist.test.mjs`（落盘 + 会话隔离 + 完成事件） |
| CE-18 | T20 | `exec/test/destructive.test.mjs` | 同上 |
| CE-19 | T20 | `exec/test/sandbox-policy.test.mjs` | 各平台真实隔离后端及零 spawn 回归 |
| CE-20 | T21 | `exec/test/sed-edit.test.mjs` | 同上（改动进 checkpoint） |
| CT-01 | T13/T14 | `core/test/coding.test.mjs` | `tui/test/coding-loop.test.mjs` |
| CT-02 | T13 | `core/test/coding.test.mjs` | 同上 |
| CT-03 | T13 | `core/test/coding.test.mjs` | 同上 |
| CT-04 | T13 | `core/test/coding.test.mjs` | 同上 |
| CT-05 | T12 | `core/test/question.test.mjs` | 同上 |
| CT-06 | T12 | `core/test/question.test.mjs` | 同上 |
| CT-07 | T13 | `core/test/coding.test.mjs` | 同上 |
| CT-08 | T13/T14 | `core/test/coding.test.mjs` | `exec/test/isolated-project.test.mjs` |
| CT-09 | T4/T12 | — | `exec/test/background.test.mjs` |
| GW-01 | T6/T23 | `git/test/status.test.mjs`（解析）、`git/test/status-extended.test.mjs` | `git/test/status.test.mjs`（真实仓库） |
| GW-02 | T7/T21 | `git/test/attribution.test.mjs` | 同上 |
| GW-03 | T7 | `git/test/attribution.test.mjs` | 同上 |
| GW-04 | T9 | `git/test/commit.test.mjs` | 同上 |
| GW-05 | T8/T23 | — | `git/test/worktree.test.mjs`、`git/test/worktree-exit.test.mjs` |
| GW-06 | T8/T23 | — | `git/test/worktree-exit.test.mjs` |
| GW-07 | T8/T23 | — | `git/test/worktree.test.mjs`（slug 校验）、`git/test/worktree-exit.test.mjs` |
| GW-08 | T6/T8 | `git/test/status.test.mjs` | 同上 |
| GW-09 | T9 | `git/test/commit.test.mjs` | 同上 |
| TP-01 | T10/T15/T22 | `plan/test/store.test.mjs` | `tui/test/sp004-cards.test.mjs` |
| TP-02 | T10/T15/T22 | `plan/test/store.test.mjs`（待办与计划分离） | `tui/test/sp004-cards.test.mjs` |
| TP-03 | T11/T22 | `core/test/plan-mode.test.mjs`（降级为需批准，非硬阻断） | 同上 |
| TP-04 | T10/T22 | `plan/test/store.test.mjs`、`plan/test/persist.test.mjs`（用户编辑 + 拒绝反馈） | 同上 |
| TP-05 | T10/T11/T14 | `plan/test/store.test.mjs`、`core/test/plan-mode.test.mjs` | `tui/test/coding-loop.test.mjs` |
| TP-06 | T12/T15/T22 | `core/test/question.test.mjs`（多题 1–4、选项 2–4） | `tui/test/sp004-cards.test.mjs` |
| TP-07 | T12/T22 | `core/test/question.test.mjs`（同 call ID 的结果与下一 Provider 请求） | 同上 |
| TP-08 | T12 | `core/test/question.test.mjs` | 同上 |
| TP-09 | T10 | `plan/test/store.test.mjs` | 同上 |
| TP-10 | T10/T22 | `plan/test/store.test.mjs`、`plan/test/persist.test.mjs` | 同上（会话内可查 + 落盘，跨进程恢复属 SP005） |

**覆盖核对**：48 条 AC 全部至少各有一例单元 + 一例功能用例；无空缺行。

---

## 执行前置与风险

- 用户确认 v1.3 后先执行 T0，记录实际分支、测试、隔离后端和参考运行环境。
- 安全或 Git 负向用例使用自有合成数据与临时仓。缺可验证隔离能力时普通命令保持关闭，并记录恢复条件。
- 精确视觉对照须确认使用权，参考不可运行时在验收报告标 UNVERIFIED。保持四类卡片局部交互覆盖，SP006 负责全局渲染改造。
- 代码实施、集成及发布分别按届时授权与门禁执行。此次用户授权提交推送 v1.3 文档至当前功能分支。

执行按各任务依赖拓扑排序，编号用于追踪。T0 在用户确认后开始，T17 最后收口。
