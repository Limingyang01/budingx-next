# SP004 真实编码任务 · 实施计划

版本：v1.2｜状态：**prepared（待用户放行后执行）**｜依据：[design.zh.md](design.zh.md) v1.2（approved，Agent 自审 2026-11-18；v1.1 为参考仓只读审计后修订，v1.2 为 TUI 还原度约束对齐）｜分支：`feature/SP004/real-coding-task`（基线 `master` = `76edf2c`）｜cwd 约定：所有命令在仓库根执行

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
- `src/tui`：命令卡片、计划卡片、追问卡片的最小渲染与交互接线。
- 依赖方向 `tui → {exec, git, plan, workspace} → core`；`core` 不依赖任何 IO/其他 `src/*` 模块（边界检查新增 exec/git/plan 条目）。

## Spec（权威来源）

- 设计：[design.zh.md](design.zh.md) v1.0
- 需求：[command-execution](../command-execution/requirements.md) v0.1、[coding-task-loop](../coding-task-loop/requirements.md) v0.1、[git-worktree-safety](../git-worktree-safety/requirements.md) v0.1、[task-planning](../task-planning/requirements.md) v0.1
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
10. **参考仓对照为强制项**：命令执行、计划/追问、Git/worktree、主循环四域的行为以设计 §9 的审计事实（F-01…F-19）为准；实施中若发现参考行为与本设计不符，**以参考为准修正实现**，偏离须登记理由。
11. 计划/追问/Git 能力按 **r8** 口径核对（SP004 出口门槛、功能目录与六个 CAP 归属均未变；CAP-L2-05 PowerShell 独立交付；CAP-L3-09 沙箱改为「明确声明能力与局限，不冒充 OS 沙箱」）。
12. **本仓数据路径**：后台任务输出落 `~/.budingx/sessions/<sessionId>/tasks/`；计划落 `~/.budingx/plans/<sessionId>/`；worktree 落 `~/.budingx/worktrees/`——三者均**不写用户项目目录**。
13. **TUI 还原度约束（2026-11-18 对齐）**：用户要求针对参考仓 buding-worker-space 还原能力与 TUI 布局/UI/交互，作为 SP001–SP016 的横向约束落地（[路线图 r9](../../../docs/iteration-plan.md)「TUI 还原度要求」、[还原度基线](../../../docs/tui-fidelity-gap-baseline.md)、设计 §9.7）。**不新增 SP 编号、不放宽本轮任何出口门槛。** 本轮义务有二：① 计划/待办/追问/命令四类卡片按参考行为事实交付**最小形态**（状态符号 ✔/■/□/⊘、阻塞来源、选项列表、退出码与截断标记），卡片与工具实现**同步交付**，不允许「能力有、界面没接」；② **不得预支 SP006 P0**——禁止在 src/tui/render 内引入虚拟列表、冻结缓存、帧缓冲差分、上下文键位系统或 chord 分发，也不得改四区骨架排布。折叠汇总（CAP-L1-30）与完整卡片族属 SP006。
14. **还原度不放宽其他边界**：权限模式仍固定三档（不还原参考仓 7 模式数量）；仍按 SP001 决定 3「读机制、不抄代码」；参考副本中为 no-op stub 的工具目录不作为能力来源，工具只按行为事实立项。

## Review Focus（评审重点）

- **完全权限下的底线**：完全权限模式下执行触碰凭据、`~/.budingx`、越界路径的命令，是否仍然被拒（合理预期：拒）。
- **Windows quoting 与 Unicode 路径**：含空格/中文的路径经 `args` 数组形式是否 100% 正确；命令文本形式下元字符是否被意外解释（合理预期：`args` 正确，文本形式行为确定且可复现）。
- **输出上限**：超大输出是否被截断且带显式标记，而非把整段灌进模型上下文（合理预期：截断 + 标记）。
- **进程树取消**：取消后子进程是否真的消失（Windows 上 `npm test` 派生的 node 进程是否残留）。
- **用户改动不被吞**：脏工作区中 Agent 修改后，用户的 staged/unstaged/untracked 是否原样存在（合理预期：存在）。
- **完成声明的空转**：模型在没有测试证据时能否声称完成（合理预期：不能，回注要求继续）。
- **计划模式绕过**：计划模式下是否有任何写/执行工具能落地（合理预期：全部被阻断）。
- **卡片与能力脱节**：计划/追问/命令能力已实现但卡片未接线，或卡片缺状态符号/阻塞来源/退出码（合理预期：四类卡片最小形态齐备，RED 用例覆盖）。
- **预支 SP006**：本轮在 `src/tui/render` 内引入虚拟列表/冻结缓存/帧缓冲差分/上下文键位（合理预期：无——渲染层改造属 SP006 P0 独立批次）。

---

## 任务清单

### T1 · core 命令执行与计划端口（纯契约）

- **设计**：§4.1、§3
- **AC**：CE-01（契约前置）、CE-05（契约前置）、TP-06（契约前置）、CT-01（前置）
- **依赖**：无（首个任务）
- **Create**：`src/core/exec.ts`、`src/core/plan.ts`、`src/core/coding.ts`、`src/core/test/exec.test.mjs`、`src/core/test/plan.test.mjs`
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
- **验证**：`npm run build && node --test src/core/test/exec.test.mjs src/core/test/plan.test.mjs`
- **完成事实**：待填

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
- **RED**：断言 Windows 下 `Bash` → `cmd.exe` 且带 `/d /s /c`；POSIX 下 `Bash` → `sh -c`；Windows 下 `PowerShell` → `powershell.exe -NoProfile -NonInteractive -Command`；**POSIX 下 `PowerShell` 返回明确 error**（OPEN-05）；`git status`/`ls`/`npm --version` 判定为只读；`rm -rf`/`git commit`/`npm install` 判定为非只读；`sleep 10`/`ping` 判定为阻塞等待族；`vim`/`top` 判定为交互式族
- **GREEN**：以显式表驱动实现，不做自然语言解析
- **验证**：`npm run build && node --test src/exec/test/interpreter.test.mjs`
- **完成事实**：待填

### T3 · 真实进程执行（前台）

- **设计**：§4.3、§4.1
- **AC**：CE-01、CE-02、CE-04、CE-05、CE-08（前置）、CE-12、CE-13、CE-15
- **依赖**：T1、T2
- **Create**：`src/exec/runner.ts`、`src/exec/output.ts`、`src/exec/test/runner.test.mjs`
- **Consumes**：`CommandSpec`、`CommandResult`、解释器选择结果
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
- **GREEN**：实现 spawn、stdin 立即关闭、stdout/stderr 分流累积、字节上限截断（保留首尾）、超时 timer、AbortSignal 监听
- **验证**：`npm run build && node --test src/exec/test/runner.test.mjs`
- **完成事实**：待填

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
- **完成事实**：待填

### T5 · 命令工具装配与权限接线

- **设计**：§4.5、§4.6
- **AC**：CE-08、CE-09、CE-10、CE-11
- **依赖**：T3、T4
- **Create**：`src/exec/tools.ts`、`src/exec/test/tools.test.mjs`
- **Modify**：`src/core/session.ts`（命令工具接入点）、`src/workspace/policy.ts`（`execute` 能力判定）
- **Consumes**：`CommandRunner`、`PermissionPolicy`、SP003 底线规则
- **Produces**：`createCommandTools({ runner, cwd })` → `{ tools: ToolHandler[] }`（`Bash`、`PowerShell`）
- **RED**：
  1. `read_only` 模式执行写盘命令 → 被拒，磁盘不变（CE-08）
  2. `workspace_edit` 模式 → 走 ask 分支（审批三档）后才执行（CE-09）
  3. `workspace_edit` 模式执行只读命令族 → 免审批直接执行（CE-09，保守白名单）
  4. `full_access` 模式执行普通命令 → 自动执行（CE-10）
  5. `full_access` 模式执行触碰 `.env`/`~/.budingx`/越界路径的命令 → **仍被拒**，且磁盘不变（CE-10/CE-11）
  6. 工具结果文本含 `exit_code:`、`interpreter:` 段（CE-01/可解析性）
- **GREEN**：`src/exec` 内最后一道凭据/数据根闸 + 复用 SP003 策略判定；`target()` 解析命令中的目标路径供策略判定
- **验证**：`npm run build && node --test src/exec/test/tools.test.mjs`；回归 `npm run test:unit`
- **完成事实**：待填

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
- **GREEN**：以 checkpoint 的 `path` 集合为唯一真相来源做交集/差集
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

### T9 · 提交授权门禁与受控提交

- **设计**：§7.4
- **AC**：GW-04、GW-09
- **依赖**：T7
- **Create**：`src/git/commit.ts`、`src/git/test/commit.test.mjs`
- **Consumes**：`analyzeChanges` 结果、会话授权集合
- **Produces**：`createGitCommitter({ authorize })` → `{ commit(changes, message): Promise<{sha, files}> }`；`authorize` 为会话级授权集合，**模型不可写入**
- **RED**（临时仓库）：
  1. 无授权时请求提交 → 拒绝，仓库状态不变，且记录 `denial_recorded`（GW-04）
  2. 有授权时提交 → 仅 `include` 中文件进入提交；用户 `userOwned` 文件**未被提交**（GW-09）
  3. 断言提交内容用逐文件 `git add --`，未使用 `git add .`/`-A`（GW-09）
  4. 授权存在但范围清单漂移（分析后文件被改）→ 提交前重新校验，不一致则拒绝（GW-09）
  5. **push 能力不存在**：模块导出面无 push 函数（GW-04）
- **GREEN**：实现授权检查、范围重校验、逐文件 add、提交后产出 SHA
- **验证**：`npm run build && node --test src/git/test/commit.test.mjs`
- **完成事实**：待填

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

### T11 · 计划模式闸门（core/session 接线）

- **设计**：§6.2
- **AC**：TP-03、TP-05（接线）
- **依赖**：T10、T1
- **Modify**：`src/core/session.ts`（工具分派前的能力闸门）、`src/core/events.ts`（`plan_updated`）
- **Create**：`src/core/test/plan-mode.test.mjs`
- **Consumes**：`ToolCapability`、计划模式状态
- **Produces**：Session 构造选项 `planMode?: PlanModeController`
- **RED**：
  1. 计划模式激活时，`Write`/`Edit`/`Bash`/`PowerShell` 调用均被阻断，**不执行**（TP-03）
  2. `Read`/`Glob`/`Grep` 在计划模式下**允许**（TP-03）
  3. 被阻断时工具结果回填结构化理由「计划模式中…」（TP-03）
  4. 计划批准后首次写操作前执行基线校验，漂移则拒绝（TP-05）
- **GREEN**：在 Session 工具分派处按 capability 判定（`'write'|'execute'` 阻断，`'read'` 放行）
- **验证**：`npm run build && node --test src/core/test/plan-mode.test.mjs`；回归 `npm run test:unit`
- **完成事实**：待填

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
  3. 回答注入后回合继续，答案以 **user 消息**进入历史（TP-07/CT-06）
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
- **依赖**：T5、T7、T11、T13
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

### T15 · TUI 最小卡片渲染

- **设计**：§6.5
- **AC**：TP-01、TP-02（可视化）、CE-01（可视化）、TP-06（可视化）
- **依赖**：T5、T10、T12
- **Modify**：`src/tui/render/types.ts`、`src/tui/render/reducer.ts`、`src/tui/app.tsx`、`src/tui/runtime.ts`
- **Create**：`src/tui/test/sp004-cards.test.mjs`
- **Consumes**：`SessionEvent` 新事件族
- **Produces**：`Frame` 增 `planCard`/`questionCard`/`commandCard` 字段；reducer 处理新事件
- **RED**（伪 TTY）：
  1. `command_started`/`command_finished` → 命令卡片显示命令、解释器、退出码（CE-01 可视化）
  2. `plan_updated` → 计划卡片显示步骤、状态符号、阻塞来源（TP-01/TP-02）
  3. `question_requested` → 追问卡片显示问题与选项（TP-06）
  4. 卡片内容做行数自适应（窄终端不崩溃）
- **GREEN**：Ink 组件自绘
- **验证**：`npm run build && node --test src/tui/test/sp004-cards.test.mjs`；回归 `npm run test:unit`
- **完成事实**：待填

### T16 · 模块边界与构建接线

- **设计**：§3、§11
- **AC**：出口门槛④
- **依赖**：T1–T15
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
- **依赖**：T1–T16、T18–T21
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
- **完成事实**：待填

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
- **完成事实**：待填
- **备注**：本任务用**缩短的预算常量**（测试注入）以避免 15s 级用例拖慢回归；生产默认值仍为 15000

### T20 · 破坏性命令警告与沙箱能力声明层

- **设计**：§4.6、§4.7（v1.1）、§9.1 F-08/F-10
- **AC**：CE-18、CE-19
- **依赖**：T1、T2
- **Create**：`src/exec/destructive.ts`、`src/exec/sandbox-policy.ts`、`src/exec/test/destructive.test.mjs`、`src/exec/test/sandbox-policy.test.mjs`
- **Consumes**：命令文本、`SandboxPolicy`
- **Produces**：
  - `detectDestructive(command): { pattern: string; warning: string } | undefined`
  - `type SandboxPolicy = { allowWrite, denyWrite, allowRead, denyRead, allowedDomains, allowManagedDomainsOnly, allowManagedReadPathsOnly }`
  - `checkSandbox(policy, { paths, domains }): { allowed: boolean; reason?: string }`
- **RED**：
  1. `git reset --hard`/`git push --force`/`git clean -f`/`rm -rf`/`git stash drop`/`--no-verify` → 命中并给出警告文案（CE-18）
  2. `git clean -n`/`git push`（无 force）→ **不**命中（CE-18）
  3. 警告本身**不**导致拒绝（只提示）——拒绝与否由策略决定（CE-18）
  4. `denyWrite` 含某路径 → 命令触及该路径时被拒绝，**完全权限模式下同样拒绝**（CE-19）
  5. `allowedDomains` 非空且域名不在其中 → 报告不符（CE-19）
  6. **导出面无「关闭沙箱/绕过」参数**（CE-19）
- **GREEN**：模式表驱动实现（自写，不引入第三方规则引擎）
- **验证**：`npm run build && node --test src/exec/test/destructive.test.mjs src/exec/test/sandbox-policy.test.mjs`
- **完成事实**：待填

### T21 · 命令内受限编辑（sed -i）与结构化只读命令表

- **设计**：§4.8、§4.5（v1.1）、§9.1 F-07/F-09
- **AC**：CE-20、CE-09（只读豁免精度）
- **依赖**：T2、T5、SP003 `diffLines`/`CheckpointStore`
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
  - 计划模式：写/执行类**降级为需批准**（非硬阻断）；`preMode` 记忆与退出恢复
  - 追问：`questions[1-4]`，每题 `{question, header, options[2-4], multiSelect}`；答案按题目文本关联；自动 Other
- **RED**：
  1. 计划创建 → 落盘为 `.md`；读回内容与内存结构一致（TP-10）
  2. 批准可携带**用户编辑后的正文** → `approvedText` 记录且指纹重算（TP-04）
  3. 拒绝携带反馈 → 反馈回灌模型（TP-04）
  4. 计划模式下：`Read` 允许、`Bash` 走**需批准**（非硬拒绝）、`Write` 需批准（TP-03）
  5. 退出计划模式 → 恢复 `preMode`（TP-03）
  6. 追问：1–4 题、每题 2–4 选项；题数 0 或 >4 → 拒绝；选项 <2 → 拒绝（TP-06）
  7. 追问答案按**题目文本**关联注入 user 消息（TP-07）
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
- **Produces**：`GitStatus` 增 `remoteUrl`（脱敏）/`isHeadOnRemote`/`worktreeCount`；`exitWorktree({ action: 'keep'|'remove', confirm?: boolean })`
- **RED**：
  1. Git 调用带 `--no-optional-locks`（不争抢索引锁）（GW-01）
  2. `remoteUrl` 含 token → **脱敏**（GW-01）
  3. `worktreeCount` 正确（GW-01）
  4. slug 违规（>64 字符、空段、含 `..`）→ 拒绝（GW-07）
  5. 目标 worktree 已存在 → **恢复复用**而非重复创建（GW-05）
  6. `action:'remove'` 且有未提交/未合并 → 未给 `confirm:true` 则**拒绝并列出残留**（GW-06）
  7. `action:'keep'` → worktree 与分支保留（GW-06）
  8. 移除后回执含 `discardedFiles`/`discardedCommits` 计数（GW-06）
- **GREEN**：按 F-17/F-18 语义实现
- **验证**：`npm run build && node --test src/git/test/status-extended.test.mjs src/git/test/worktree-exit.test.mjs`
- **完成事实**：待填

---

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
| CE-19 | T20 | `exec/test/sandbox-policy.test.mjs` | 同上 |
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
| TP-07 | T12/T22 | `core/test/question.test.mjs`（按题目文本关联） | 同上 |
| TP-08 | T12 | `core/test/question.test.mjs` | 同上 |
| TP-09 | T10 | `plan/test/store.test.mjs` | 同上 |
| TP-10 | T10/T22 | `plan/test/store.test.mjs`、`plan/test/persist.test.mjs` | 同上（会话内可查 + 落盘，跨进程恢复属 SP005） |

**覆盖核对**：48 条 AC 全部至少各有一例单元 + 一例功能用例；无空缺行。

---

## 执行前置与风险

1. **执行前置**：用户 2026-11-18 指示「先只完成文档，正式开发前等我通知再动手」→ **本计划不自动启动**。
2. **本会话环境限制（2026-11-18 实测；提交前复核已解除）**：
   - ① `git checkout -b` 曾报 `.git/index.lock: Permission denied` → **已解除**，分支 `feature/SP004/real-coding-task` 已创建。
   - ② `npm run build` 曾无法写入 `src/tui/dist/`（`EPERM`）→ **已解除**，清理 `dist/` 后重建成功。
   - ③ `node --test` 曾因测试运行器需 `ChildProcess.spawn` 全部报 `spawn EPERM` → **已解除**，测试可正常运行。
   - 结论：三项均为沙箱权限限制而非代码缺陷，现已全部解除，**不再阻塞实施**。
3. **既有基线（2026-11-18 实测）**：`npm run test:unit` = **332 项，331 通过，1 失败**。失败项 `G01 Ink 隐藏 Key 输入、持久化且不回显` 为**既有的并发隔离缺陷**（`src/` 本轮未触及；master 同提交 `931ad47` 在 `src/tui/test/*.test.mjs` 并发运行下同样失败），**不在 SP004 范围内修复**。实施第一步应复核该基线：若失败集合与上述一致（即仅此 1 项），视为既有基线；出现**新增失败**则先定位。
4. **风险**：见设计 §9 R-01…R-07 与 OPEN-01…OPEN-06；实施中遇到 OPEN 项阻塞时按 MODEL_PROPOSED 默认方案执行并在 STATUS 登记，实质行为分叉才停等用户。
5. **还原度防预支检查（2026-11-18 新增）**：实施期间若发现本轮范围需要改四区骨架或引入渲染层扩展，**不在本轮做**——记入 SP006 开轮输入（[还原度基线](../../../docs/tui-fidelity-gap-baseline.md) §5 的 P0 批次），本轮只保证四类卡片的最小形态接线正确。
