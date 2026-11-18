# SP004 · 真实编码任务

状态：**实施与验证完成，待合入 master**｜功能分支 `feature/SP004/real-coding-task`（HEAD `1f166fb`，30 个本地提交）｜实施基线 `e808679`｜文档起点 `363d1eb`｜参考 TUI `b5c9be8`

## 本轮目标与边界

- 目标：交付「真实编码任务」——Agent 能在隔离项目中完成定位→修改→运行测试→修复的完整闭环；命令执行真实进程且受权限与底线规则约束；Git 工作区改动归属清晰、worktree 隔离可恢复；多步骤任务可拆解、展示、批准与追问。
- 出口门槛（路线图 SP004，USER_CONFIRMED）：隔离项目完成定位→修改→运行测试→修复；用户追问/转向、Git 脏工作区、Windows quoting、后台状态/取消/输出上限和自身修改撤销有实测；**没有提交或推送授权不执行 Git 发布**。
- 功能目录（沿用路线图命名）：[command-execution](command-execution/requirements.md) v0.1、[coding-task-loop](coding-task-loop/requirements.md) v0.1、[git-worktree-safety](git-worktree-safety/requirements.md) v0.1、[task-planning](task-planning/requirements.md) v0.1。
- 清单对应：CAP-L2-04（跨平台命令执行）、CAP-L2-05（测试执行与结果解读）、CAP-L2-06（长任务/后台命令监控）、CAP-L2-08（计划模式工具族）、CAP-L3-09（沙箱/权限边界）、CAP-L3-15（目标/计划/追问与主动行为）。
- 不包含：子代理派发与后台任务六件套（SP007）、浏览器操作（SP012）、Computer Use（SP013）、定时任务（SP014）、Desktop、VS Code、远程/H5 与 IM（现行范围外）、无头 CLI 协议与完整斜杠命令面（SP006）、跨会话恢复与项目记忆（SP005）、PR/GitHub 审查命令族（SP006/SP007）。
- 输入基线：master HEAD `76edf2c`（SP003 已合入 `3e796be`）；SP002 已实现并发布 0.2.0（npm latest=0.2.0）；本轮在 `src/core`（Session/权限契约）、`src/workspace`（文件工具/策略/检查点）、`src/tui`（Ink 界面）之上扩展。
- 依赖与启动条件：
  - USER_CONFIRMED（2026-11-18 用户会话）：「开始 SP004 的开发」→ 授权启动本轮。
  - USER_CONFIRMED（2026-11-17 委托）：取消常规人工审查，设计文档为 Agent 自审对象；自审通过即包含从 master 创建功能分支、计划/实施/测试/交付自主推进、各阶段本地提交（中文提交说明）、交叉验证门禁 GREEN 后按 buding-merge 合入 master，并**自主推送远端**；打标签、npm 发布、远端设置、分支/worktree 删除不在委托内。
  - USER_CONFIRMED（2026-11-17 r6）：权限模式固定三档（仅可查看/工作区内修改/完全权限），SP003/SP004 交付；完全权限不得绕过 deny 规则与凭据保护。
  - 边界：本轮验证用本地 fixture、临时目录与真实进程完成；真实模型端到端依赖用户凭据（沿用 SP002 凭据状态，无则记 UNVERIFIED）。
- 本次授权涵盖文档修订、在当前 SP004 功能分支提交和推送。用户「继续开发SP004」+「继续」（2026-11-18）视为对 v1.3 的确认与实施放行；T0 已完成。

## 需求索引（迭代进度入口）

每阶段完成或停等时更新本表：阶段列按 `需求→设计→计划→实施→测试→交付` 打勾并标注当前停点原因，集成状态列随本地提交更新真实 SHA；断线或换会话的 Agent 先读本表定位，再进对应 STATUS 续接。

| 功能/优化目录 | 来源 / 身份 | 验收目标 | 责任范围 | 阶段 | 需求 / 设计 / 计划 / STATUS | 验证 | 集成状态 | 下一步 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [command-execution](command-execution/requirements.md) | 路线图（USER_CONFIRMED 名称）；AC 切分 MODEL_PROPOSED | CE-01…20：真实进程执行、退出码/输出分离、Windows quoting、cwd/环境、超时、输出上限、后台任务状态与取消、三模式边界、底线规则、交互式明确失败、阻塞命令拦截、中断传播、**阻塞预算自动转后台、后台输出落盘、破坏性命令警告、执行隔离门禁、命令内受限编辑** | 新增 `src/exec` 模块 + core 端口契约 | 需求/设计/计划 v1.3 · 实施 T1–T5、T18–T21 完成 | [需求 v0.3](command-execution/requirements.md) ／ [设计 v1.3](design/design.zh.md) ／ [计划 v1.3](design/plan.zh.md) ／ [STATUS](command-execution/STATUS.md) | CE-01…20 全部回填（[验收报告](test-report.md)）；真实隔离后端 UNVERIFIED | 本地 30 个提交（HEAD `1f166fb`），**未合入 master** | 门禁 GREEN 后合入 master 并推送 |
| [coding-task-loop](coding-task-loop/requirements.md) | 路线图；AC 切分 MODEL_PROPOSED | CT-01…09：测试失败回喂修复循环、最大迭代、排队补充、用户转向、追问与回答、完成证据门槛、命令失败不吞、中断传播 | core 回合编排 + 工具结果契约 | 需求/设计/计划 v1.3 · 实施 T12–T14 完成 | [需求 v0.3](coding-task-loop/requirements.md) ／ [设计 v1.3](design/design.zh.md) ／ [计划 v1.3](design/plan.zh.md) ／ [STATUS](coding-task-loop/STATUS.md) | CT-01…09 全部回填；生产 runtime 未启用完成闸门（UNVERIFIED） | 本地 30 个提交，**未合入 master** | 门禁 GREEN 后合入 master 并推送 |
| [git-worktree-safety](git-worktree-safety/requirements.md) | 路线图；AC 切分 MODEL_PROPOSED | GW-01…09：脏工作区识别、用户改动不丢、改动归属、未授权不写、worktree 进出与失败回落、非 Git 仓库明确、提交范围受控、**slug 校验、恢复复用、keep/remove 退出语义、remoteUrl 脱敏** | 新增 `src/git` 模块 | 需求/设计/计划 v1.3 · 实施 T6–T9、T23 完成 | [需求 v0.3](git-worktree-safety/requirements.md) ／ [设计 v1.3](design/design.zh.md) ／ [计划 v1.3](design/plan.zh.md) ／ [STATUS](git-worktree-safety/STATUS.md) | GW-01…09 全部回填 | 本地 30 个提交，**未合入 master** | 门禁 GREEN 后合入 master 并推送 |
| [task-planning](task-planning/requirements.md) | 路线图；CAP-L2-08/CAP-L3-15；AC 切分 MODEL_PROPOSED | TP-01…10：计划状态机与进度、计划模式降级为需批准、建议≠批准、用户可编辑计划与拒绝反馈、执行前基线校验、结构化多题追问、取消追问、完成报告真实、**计划持久化与落盘** | core 计划端口 + `src/plan` + 工具族 + TUI 四类局部场景 | 需求/设计/计划 v1.3 · 实施 T10–T12、T15、T22 完成 | [需求 v0.3](task-planning/requirements.md) ／ [设计 v1.3](design/design.zh.md) ／ [计划 v1.3](design/plan.zh.md) ／ [STATUS](task-planning/STATUS.md) | TP-01…10 全部回填；像素级视觉对照 UNVERIFIED | 本地 30 个提交，**未合入 master** | 门禁 GREEN 后合入 master 并推送 |

## TUI、协议与安全验收

[设计 v1.3](design/design.zh.md) 固定四类 SP004 局部场景与 48 条既有 AC。以参考 TUI 的终端单元格、同环境像素及按键回放分别取证。精确视觉复现和截图取证待确认参考设计使用权；全局终端布局和键位系统仍由 SP006 交付。

[实施计划](design/plan.zh.md) T0–T24 覆盖工具协议、单次审批、宿主隔离、专用 worktree 提交以及独立实现与 AST 复核。验收状态与恢复条件见[验收报告](test-report.md)。

## 验收与交接

- 本轮出口门槛（对照路线图 SP004）：① 隔离项目完成定位→修改→运行测试→修复；② 用户追问/转向、Git 脏工作区、Windows quoting、后台状态/取消/输出上限和自身修改撤销有实测；③ 没有提交或推送授权不执行 Git 发布；④ 无旧仓源码/提示词/内部类型迁入，模块边界检查通过。
- 实际验收：**T0–T24 全部完成**。`npm test` 607/607 通过（unit 564 + skills 10 + spec 11 + release 17 + merge 5）；`npm run test:checks`、`spec:check`、`skills:check` 通过；48 条 AC 逐条回填为 PASS 45 条，CE-11/CE-19/SAFE-02 的真实平台隔离后端与 CT-07 生产闸门启用为 UNVERIFIED（恢复条件见[验收报告](test-report.md) §5）。AST 来源复核 PASS（18901 组函数对，命中 0）。
- 未完成/延期项（属 UNVERIFIED，非本轮 FAIL）：真实平台隔离后端落地（生产保持 fail-closed）、完成证据闸门在生产 runtime 的启用、真终端像素级视觉对照、live Provider 端到端、发布包核验（发布前准备阶段）。恢复条件见[验收报告](test-report.md) §5。
- 下一轮输入（预计，供 SP005）：命令任务与计划状态随会话生命周期存活但不跨进程恢复的契约；后台任务句柄的生命周期边界；本轮后台输出仅驻内存，跨进程持久化留给 SP005。
- 风险/回退：
  - R-01 命令执行绕过权限底线 → 判定统一走 SP003 策略 + 底线规则，`src/exec` 不得自行放行；负向回归覆盖完全权限下的越界与凭据。
  - R-02 进程树杀不干净（Windows 残留）→ 使用进程组/任务树终止策略并以真实进程证据核对残留。
  - R-03 输出上限被绕过 → 截断在写出层强制，工具结果携带显式截断标记。
  - R-04 Git 误伤用户改动 → 改动归属以 Agent 自有变更记录（SP003 checkpoint）为准，禁止 reset/stash/自动删除。
  - R-05 计划模式被工具绕过 → 阻断在 Session 工具分派层（按 capability），任何新工具默认受同一闸门约束。
  - R-06 完成声明空转 → `canClaimDone` 要求至少一次测试类命令成功。
  - 回退：本轮产出预期落在 `feature/SP004/real-coding-task` 分支，产品版本保持 0.2.0 不动，失败可整体弃分支。
- Git/产品发布：**文档已提交并推送** —— 提交 `84f2004`，分支 `feature/SP004/real-coding-task`（自 `master` `931ad47` 创建），远端 `refs/heads/feature/SP004/real-coding-task` SHA 已核对一致（`84f200404446c8489dd40489a87e76c8dc2b2c69`）；GitHub API 复核分支存在。**合入 master 未执行**（需交叉验证门禁 GREEN，且属交付阶段）；**npm 发布未执行**（不在授权内）。本次提交仅含文档与 `docs/current-status.md` 一处同步，**无产品代码、依赖或产物**。
- **2026-11-18 还原度对齐提交**：提交 本次对齐提交（分支 feature/SP004/real-coding-task，基于 f0cf5a6）。内容为规划与文档对齐，**20 个文件、无产品代码**（git diff --stat -- src/ 为空）：新增 docs/tui-fidelity-gap-baseline.md 与本轮 SP/SP004/test-report.md；路线图升 r9；能力矩阵拆分「可用性」与「还原度」两行；能力清单升 v1.4（分母 47→49）；SP004 全套文档对齐（设计 v1.2 §9.7 / 计划 v1.2 / 四需求 / 四 STATUS）。交叉验证门禁 GREEN（npm run merge:gate，四项检查退出码均为 0），全量 375 项自动化通过。
- **推送已执行**：合并 master 后提交 `8438f1f` 已推送至 `origin/feature/SP004/real-coding-task`，远端 SHA `8438f1fe231acc4c0fad0117c7e833a65e0d7993` 与本地一致（`git ls-remote` 核对）。推送需先配置 Git 凭据助手——本机 Git 自带 `git-credential-manager.exe`，Windows 凭据管理器已存有 GitHub 凭据；配置 `credential.helper` 指向该可执行文件（带空格路径须用 `!"..."` 形式包裹）后推送成功。
- **本会话环境限制（2026-11-18 实测）**：初测时存在三项沙箱权限限制（① `.git/index.lock` ② 写 `src/tui/dist/` ③ `node --test` 的 `spawn EPERM`）；**提交前复核：①③ 已解除**（分支已创建；`npm run build` 成功；测试运行器正常），**② 亦已解除**（清理 `dist/` 后重建成功）。
- **既有基线实测（2026-11-18）**：`npm run test:unit` = **332 项，331 通过，1 失败**。失败用例为 `G01 Ink 隐藏 Key 输入、持久化且不回显`（`src/tui/test/app.test.mjs:117`）。
  - **该失败为既有的测试隔离缺陷，与本次改动无关**：本次 `src/` 未被触及（`git diff master --stat -- src/` 为空）；在 master 的独立 worktree（同一提交 `931ad47`）上复现——**单独运行该文件 8 项全通过**，**`src/tui/test/*.test.mjs` 并发运行则失败**（139 项中 1 失败），**全量 `src/*/test/*.test.mjs` 运行则 332 项全通过**。
  - 根因线索：用例断言 `ui.configStore.load().models[0]`，并发时可能读到被其他用例污染的配置存储（`models[0]` 为 `undefined`）。
  - **处置**：属 SP003/既有 TUI 测试的隔离问题，**不在 SP004 授权范围内**，本轮不修改；记录在此供后续修复。实施 SP004 时若受影响，需在 T0 阶段先定位并隔离。

## 验收与交接

验收入口为 [test-report.md](test-report.md)：48 条 AC 逐条映射到实际用例与计数，验证层分 L0/L1/L2 记录，未验证项单列恢复条件。已发布产品的实际使用说明和版本由当前发布记录管理。用户已确认 v1.3；T0–T24 完成，等待交叉验证门禁后合入 master。

## 变更记录

| 日期 | 范围或状态变化 | 原因/来源 | 影响及处理 |
| --- | --- | --- | --- |
| 2026-11-18 | 建立 SP004 迭代汇总与四个功能目录（command-execution / coding-task-loop / git-worktree-safety / task-planning），共 43 条 AC 进入 intake | 用户会话「开始 SP004 的开发」 | 仅开轮与需求整理；设计、计划、实现、提交、合并按 2026-11-17 委托由 Agent 自审推进，push 在委托内，发布/打标签/远端设置仍单独授权 |
| 2026-11-18 | **文档阶段完成**：产出设计 v1.0（自审通过）与计划 v1.0（T1–T17 + 43 条 AC 映射）；四份需求/STATUS 与本汇总同步 | 用户会话「先只完成文档，正式开发前等我通知再动手」 | **实施、代码改动与提交全部暂停**，待用户明确放行后从 T1 开始；分支未创建（沙箱拒绝 `.git/index.lock`），产出均为未提交文件 |
| 2026-11-18 | **参考仓只读审计后修订（设计 v1.1 / 计划 v1.1）**：新增设计 §9 审计结果（19 项事实修正 F-01…F-19、21 项遗漏点、9 项设计修正 C-01…C-09、5 项保留偏离、审计边界、r7 对齐）；新增 5 条 AC（CE-16…20）、6 个任务（T18–T23）；AC 总数 43→48 | 用户要求「对比旧仓库，看是否遗漏边界或功能点细节」 | 关键修正：① 后台输出**落盘**（原仅内存）；② **实现** 15s 阻塞预算自动转后台（原声明不做）；③ 计划**持久化**为 `.md` 且批准走权限通道、拒绝带反馈（原纯内存）；④ 计划模式由「硬阻断」改为「**降级为需批准**」（原设计与参考冲突，会导致计划阶段无法调研）；⑤ 待办与计划**分离**、待办改 `{content,status,activeForm}` 三字段；⑥ 追问改**多题**结构（1–4 题、选项 2–4、按题目文本关联）；⑦ 只读命令改**结构化命令表**；⑧ 新增**沙箱能力声明层**（印证 r7 的 CAP-L3-09 新口径）；⑨ 新增**破坏性命令警告**与**命令内受限编辑**；⑩ worktree 增 slug 校验/`keep`/`remove`/恢复复用；⑪ Git 状态改用 `--no-optional-locks` 并对 remoteUrl 脱敏 |
| 2026-11-18 | 与**路线图 r7** 对齐核对 | 并行会话推进 AGENTS.md 与路线图到 r7 | SP004 功能目录与出口门槛**未变**；CAP-L2-05（PowerShell 独立交付）确认仍必交 → OPEN-05 关闭；CAP-L3-09（沙箱）降为可选且目标改为「明确声明能力与局限，不冒充 OS 沙箱」→ 正面印证 v1.1 沙箱修正 |
| 2026-11-18 | 与**路线图 r8** 对齐核对（提交前复核） | 并行会话推进 AGENTS.md 与路线图到 r8（现行 SP001–SP016 连续编号） | SP004 功能目录、出口门槛与六个 CAP 归属（CAP-L2-04/05/06/08、CAP-L3-09/15）**全部未变**；r8 重编号只涉及 SP004 之后的轮次 → **无需回退任何设计决策**。设计 §9.6 已补 r8 复核小节 |
| 2026-11-18 | **文档提交并推送**（分支 `feature/SP004/real-coding-task`，仅文档，无产品代码） | 用户会话「提交文档并且推送远端，我会审查」 | 提交 `84f2004`，远端 SHA 已核对一致；本轮**只提交文档**；实施、代码、测试、交付、合入 master 均未执行，仍待用户放行 |
| 2026-11-18 | 修订设计、计划、验收、需求与状态至本版 | 用户要求对照参考 TUI、明确协议和独立实现并修复安全缺口 | 只提交推送文档至现有分支；开发等待用户确认 |
| 2026-11-18 | **实施放行，T0 完成**：基线 `npm run test:unit` = 359/359 通过（旧记 332 为更早基线）；环境修复 npm ci；隔离后端探测无已验证后端（普通 shell 默认关闭，实测 UNVERIFIED）；视觉权利未确认（像素级 UNVERIFIED）；计划 T0 补完成事实 | 用户「继续开发SP004」+「继续」视为 v1.3 确认与放行 | 进入 T1 core 端口；执行台账 `.superpowers/sdd/plan.zh/progress.md` |
| 2026-11-19 | **实施与验证完成（T0–T24）**：30 个本地提交（HEAD `1f166fb`）；全量 `npm test` 607/607、`test:checks`/`spec:check`/`skills:check` 通过；48 条 AC 回填（PASS 45，UNVERIFIED 3 项恢复条件已写）；AST 复核 PASS（函数对 18901、命中 0）；`PRODUCT.md` 与四份 STATUS 同步 | 2026-11-17 委托：Agent 自审 + 门禁 GREEN 后合入 master 并自主推送 | 待 `npm run merge:gate` GREEN 后按 buding-merge 合入 master、推送；npm 发布与打标签仍由用户手动触发 |
