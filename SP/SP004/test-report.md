# SP004 验收与验证报告 · 真实编码任务

状态：**实施完成，全量门禁 GREEN，已合入 master（`fdfdae8`），0.4.0 已通过 OIDC 发布，见 §10**。分支 `feature/SP004/real-coding-task`，文档起点 `363d1eb`，实施基线 `e808679`，参考 TUI revision `b5c9be8`。本报告与[设计](design/design.zh.md)及[实施计划](design/plan.zh.md)配套。

## 0. 本轮执行证据

环境：Windows 11，Node.js 24.15.0，`git` 2.x，本地终端无头（CI 式伪 TTY）。所有命令在仓库根执行。

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 构建 | `npm run build` | 通过（tsc，无错误） |
| 单元/功能 | `npm run test:unit` | **572/572 通过**（`node --test src/*/test/*.test.mjs`；含 T25 补记 8 项） |
| 模块边界 | `npm run test:checks` | 「模块边界检查通过」 |
| 规格自洽 | `npm run spec:check` | 「OK: 路线图、能力清单与任务清单自洽」（能力 91 项） |
| 技能入口 | `npm run skills:check` | 「Skill entries are current」 |
| 发布脚本 | `npm run test:release` | 17/17 通过 |
| 合入门禁脚本 | `npm run merge:test` | 5/5 通过 |
| 全量 | `npm test` | **615 通过 / 0 失败**（skills 10 + spec 11 + unit 572 + release 17 + merge 5） |
| 交叉验证门禁 | `npm run merge:gate` | **GREEN**（`artifacts/merge-gate/feature-SP004-real-coding-task-2026-11-18T16-16-59-047Z.md`：分支/merge-base `e808679`/HEAD `868eae6`、outgoing 31 提交 91 文件、禁带路径违规 0、FAIL 行 0、UNVERIFIED 9 行且恢复条件节存在；`npm test`/`spec:check`/`skills:check`/`pack-smoke` 退出码均 0） |
| 合入与合入后复验 | `git merge --no-ff feature/SP004/real-coding-task` → `git merge-base --is-ancestor 868eae6 HEAD` → `npm test` | 合并提交 `fdfdae8`；ancestry 通过；合入后 `npm test` 仍 0 失败。合并时 `PRODUCT.md` 与 `docs/current-status.md` 因 master 已发布 0.3.6 产生文本冲突，按「保留已发布事实 + SP004 现状」人工解决，无代码冲突 |
| CI 模式全量 | `CI=true npm test` | 0 失败（skills/spec/unit/checks/release/merge 全部通过，复现工作流环境） |
| 发布预演（0.4.0） | `npm run publish -- --dry-run --expected-version 0.4.0 --tag latest` | **Dry run passed**（`artifacts/release/0.4.0-1795018901701/report.json`）：`state=verified-local`、`integrity=sha512-0mVZSAE8BNhjPpU4aO/BMclFaQymf43AmmVSRF5snezTTEbv6213iKlMwIM8sJXwgj2eaCfces2LIlLOum7h8g==`、tarball 84 文件含 `dist/exec`、`dist/git`、`dist/plan`、CLI 版本 0.4.0 与本地 fixture HTTP smoke（1 次请求）通过；`externalProvider=UNVERIFIED`、未上传 npm |
| T25 补记（worktree 工具表面） | `rm src/git/tools.ts` 后重建 → 单文件 RED；恢复并 `npm run build && node --test src/git/test/tools.test.mjs` | RED 0/1（模块缺失）、GREEN **8/8**；另以移除 `mandatoryApproval` 分支的中间态证明仅 T25-8 失败；全量 `npm test` 615 通过 0 失败 |
| 来源 AST 复核 | `node scripts/review/sp004-ast.mjs --reference <参考仓> --reference-revision b5c9be8 --base master` | 改动 39/39 映射，函数对 18901 组，命中 0，自检 3/3 PASS → **PASS**（详见 [ast-review.md](ast-review.md)） |

## 1. 视觉与交互验收

行为与键序在伪 TTY（Ink 真实渲染 + PassThrough 假终端）下逐项断言，均为 PASS；**参考实现像素级对照为 UNVERIFIED**（原因见 §5）。

| ID | 回放步骤与断言 | 关联 AC | 状态 |
| --- | --- | --- | --- |
| VIS-01 命令 | 运行、stdout、stderr 与非零退出、截断与展开、转后台并完成、取消、审批提示；同一 call ID 只有一条工具结果，取消后焦点回输入区。用例：`tui/test/sp004-cards.test.mjs`（T15-1…3、T15-8…10）、`exec/test/tools.test.mjs` | CE-01、04–07、16–18、CT-08 | PASS（行为）；像素 UNVERIFIED |
| VIS-02 计划 | 调研展示、焦点移动、编辑正文并批准、拒绝反馈、Esc、漂移重审、原档位与输入焦点恢复、一次性批准。用例：`tui/test/sp004-cards.test.mjs`（T15-4、T15-7、T15-10）、`core/test/plan-mode.test.mjs`、`plan/test/host.test.mjs` | TP-01、03–05、10 | PASS（行为）；像素 UNVERIFIED |
| VIS-03 待办 | 空列表、pending/进行中/完成、排序、状态符号、阻塞位置、长文本折行、展开与 TTL（固定假时钟 60s）。用例：`tui/test/sp004-cards.test.mjs`（T15-5） | TP-01、02、09 | PASS（行为）；像素 UNVERIFIED |
| VIS-04 追问 | 单题/多题、题间切换、单选多选、Other 输入、预览与备注、确认后提交、Esc 取消与迟到响应、答案保留、工具结果身份。用例：`tui/test/sp004-cards.test.mjs`（T15-6、8、9）、`core/test/question.test.mjs` | TP-06–08、CT-05、06 | PASS（行为）；像素 UNVERIFIED |

自动化断言的是帧文本、键序与状态，不是像素：伪 TTY 下没有真实字体/DPI/IME，参考截图不作为发行资产。

## 2. 工具协议验收

| ID | 样例与预期 | 任务 | 状态 |
| --- | --- | --- | --- |
| PROTO-01 | Bash/PowerShell 四字段、毫秒超时、未知字段拒绝、关闭沙箱字段拒绝；缺隔离明确错误；后台回执、退出码、截断、stderr。用例：`exec/test/tools.test.mjs`（16）、`exec/test/interpreter.test.mjs`（11）、`exec/test/runner.test.mjs`（13）、`exec/test/auto-background.test.mjs`（3） | T2、T3、T5、T18、T19 | PASS |
| PROTO-02 | `EnterPlanMode` 空对象；`ExitPlanMode` 读会话计划文件、可带 `allowedPrompts` 但不自动放行；缺文件、编辑后批准、拒绝反馈、取消、恢复、漂移。用例：`plan/test/host.test.mjs`、`core/test/plan-mode.test.mjs`（13）、`plan/test/persist.test.mjs`（8） | T10、T11、T22 | PASS |
| PROTO-03 | `AskUserQuestion` 1–4 题、每题 2–4 项、header、多选、预览；宿主注入 Other；答案/备注按题目文本对应并以原 call ID 返回；取消、重复、过期有确定结果。用例：`core/test/question.test.mjs`（7）、`tui/test/sp004-cards.test.mjs`（T15-6、8、9） | T12、T15、T22 | PASS |
| PROTO-04 | 计划步骤与待办项为两个对象、保留阻塞关系；`EnterWorktree` 名称与复用身份；`ExitWorktree` keep/remove 与授权、残留计数。用例：`plan/test/store.test.mjs`（8）、`git/test/worktree.test.mjs`（6）、`git/test/worktree-exit.test.mjs`（6） | T8、T10、T15、T22、T23 | PASS |

说明：本轮未实现 `TodoWrite` 独立工具（设计 §6.1 的 TodoStore 已作为渲染层数据源由 `plan_updated` 派生，见 T15 Ruling），故 PROTO-04 的「独立待办项」以 §6.1 的 `TodoStore` + 派生待办卡片验证，不声称提供 TodoWrite 工具表面。

## 3. 权限、Git、来源验收

| ID | 验证证据 | 任务 | 状态 |
| --- | --- | --- | --- |
| SAFE-01 | 各模式硬 deny 优先、未知操作无只读豁免、待批/迟到/重复授权不产生副作用、前台/后台/自动转后台共用同一启动门禁、无后端能力时零 spawn。用例：`workspace/test/policy.test.mjs`（11）、`exec/test/tools.test.mjs`、`exec/test/background.test.mjs`（7）、`core/test/plan-mode.test.mjs` | T5、T11、T19–T21 | PASS |
| SAFE-02 | 平台隔离后端内运行合成进程、核验整树与网络/Git 元数据约束；完成「定位→修改→失败测试→修复→通过」闭环。用例：`exec/test/isolated-project.test.mjs`、`tui/test/coding-loop.test.mjs` | T14、T20 | 部分 UNVERIFIED（见 §5：无真实隔离后端，进程在宿主环境运行） |
| GIT-01 | 临时仓原 checkout 含 staged/unstaged/untracked；成功提交只在专用分支产生核准树，原索引、文件与 HEAD 不变。用例：`git/test/commit.test.mjs`（11） | T7–T9 | PASS |
| GIT-02 | 拒绝未授权、审批后漂移、混合改动、并发 ref 变化、重复授权与意外钩子；普通命令入口不获得 Git 写权限；失败可安全重试。用例：`git/test/commit.test.mjs`、`exec/test/tools.test.mjs`（T5-5） | T5、T7、T9、T20 | PASS |
| SRC-01 | 来源记录含参考 SHA、行为来源、自有模块与第三方条款；制品不含参考源码/内部类型/资产/提示词/bundle。见 `ast-review.md`、`THIRD-PARTY-NOTICES.md` | T24、T17 | PASS（来源记录），发布包核验见 §5 |
| GIT-03 | `EnterWorktree {name?}` / `ExitWorktree {action, discard_changes?}` 协议：参数校验、会话级状态、默认 keep、remove 在完全权限下仍强制宿主审批（`mandatoryApproval` + `ToolContext.approved`）、残留拒绝并列出计数、删除回执含 `discardedFiles`/`discardedCommits`。用例：`git/test/tools.test.mjs`（8） | T25 | PASS（协议层）；生产 runtime 接线见 §5 |
| SRC-02 | 归一化 AST 对比出具范围、长度、分值与处置；合成正负例；未解决项不得通过。见 `ast-review.md` | T24 | PASS（命中 0） |

## 4. 48 条 AC 回填

AC 区间：CE-01…20（20）、CT-01…09（9）、GW-01…09（9）、TP-01…10（10），共 48 条，逐条对应到实际用例文件；「计数」为该文件内 `test(` 用例数（全套 564 项中的相关部分），验证层：L0 = 纯逻辑/契约，L1 = 真实进程或真实 Git 仓，L2 = 伪 TTY 端到端。

| AC | 任务 | 证据（文件与用例数） | 验证层 | 结果 |
| --- | --- | --- | --- | --- |
| CE-01 | T3/T5 | `exec/runner.test.mjs`(13)、`exec/tools.test.mjs`(16)、`tui/sp004-cards.test.mjs`(10) | L1+L2 | PASS |
| CE-02 | T2/T3 | `exec/interpreter.test.mjs`(11)、`exec/runner.test.mjs`(13) | L1 | PASS |
| CE-03 | T2 | `exec/interpreter.test.mjs`(11) | L0 | PASS |
| CE-04 | T3 | `exec/runner.test.mjs`(13) | L1 | PASS |
| CE-05 | T3 | `exec/runner.test.mjs`(13)、`exec/output`（经 runner 用例） | L1 | PASS |
| CE-06 | T4 | `exec/background.test.mjs`(7) | L1 | PASS |
| CE-07 | T4 | `exec/background.test.mjs`(7)（含 R-03/R-04 终止重试与 exit 兜底） | L1 | PASS |
| CE-08 | T5 | `exec/tools.test.mjs`(16)、`exec/isolated-project.test.mjs`(2) | L1 | PASS |
| CE-09 | T5 | `exec/tools.test.mjs`(16)、`exec/readonly-commands.test.mjs`(5) | L1 | PASS |
| CE-10 | T5 | `exec/tools.test.mjs`(16) | L1 | PASS |
| CE-11 | T5 | `exec/tools.test.mjs`(16)、`exec/sandbox-policy.test.mjs`(7) | L1 | PASS（隔离后端缺失时 fail-closed，真实后端 UNVERIFIED） |
| CE-12 | T2/T3 | `exec/interpreter.test.mjs`(11)、`exec/runner.test.mjs`(13) | L1 | PASS |
| CE-13 | T2/T3 | `exec/interpreter.test.mjs`(11)、`exec/runner.test.mjs`(13) | L1 | PASS |
| CE-14 | T4 | `exec/background.test.mjs`(7) | L1 | PASS |
| CE-15 | T3 | `exec/runner.test.mjs`(13) | L1 | PASS |
| CE-16 | T19 | `exec/auto-background.test.mjs`(3) | L1 | PASS |
| CE-17 | T18/T22 | `exec/persist.test.mjs`(6) | L1 | PASS |
| CE-18 | T20 | `exec/destructive.test.mjs`(4)、`tui/sp004-cards.test.mjs`(10) | L1+L2 | PASS |
| CE-19 | T20 | `exec/sandbox-policy.test.mjs`(7) | L1 | 部分 UNVERIFIED（缺真实平台后端，见 §5） |
| CE-20 | T21 | `exec/sed-edit.test.mjs`(9) | L0 | PASS |
| CT-01 | T13/T14 | `core/coding.test.mjs`(18)、`tui/coding-loop.test.mjs`(1)、`exec/isolated-project.test.mjs`(2) | L0+L2 | PASS |
| CT-02 | T13 | `core/coding.test.mjs`(18) | L0 | PASS |
| CT-03 | T13 | `core/coding.test.mjs`(18) | L0 | PASS |
| CT-04 | T13 | `core/coding.test.mjs`(18) | L0 | PASS |
| CT-05 | T12 | `core/question.test.mjs`(7)、`tui/sp004-cards.test.mjs`(10) | L0+L2 | PASS |
| CT-06 | T12 | `core/question.test.mjs`(7) | L2 | PASS |
| CT-07 | T13 | `core/coding.test.mjs`(18) | L0 | PASS（生产 runtime 未启用闸门，见 §5） |
| CT-08 | T13/T14 | `core/coding.test.mjs`(18)、`exec/isolated-project.test.mjs`(2) | L0+L2 | PASS |
| CT-09 | T4/T12 | `exec/background.test.mjs`(7)、`core/question.test.mjs`(7) | L1 | PASS |
| GW-01 | T6/T23 | `git/status.test.mjs`(7)、`git/status-extended.test.mjs`(4) | L1 | PASS |
| GW-02 | T7/T21 | `git/attribution.test.mjs`(8)、`exec/isolated-project.test.mjs`(2) | L1+L2 | PASS |
| GW-03 | T7 | `git/attribution.test.mjs`(8) | L1 | PASS |
| GW-04 | T9 | `git/commit.test.mjs`(11) | L1 | PASS |
| GW-05 | T8/T23/T25 | `git/worktree.test.mjs`(6)、`git/worktree-exit.test.mjs`(6)、`git/tools.test.mjs`(8) | L1 | PASS |
| GW-06 | T8/T23/T25 | `git/worktree-exit.test.mjs`(6)、`git/tools.test.mjs`(8) | L1 | PASS |
| GW-07 | T8/T23/T25 | `git/worktree.test.mjs`(6)、`git/worktree-exit.test.mjs`(6)、`git/tools.test.mjs`(8) | L1 | PASS |
| GW-08 | T6/T8 | `git/status.test.mjs`(7) | L1 | PASS |
| GW-09 | T9 | `git/commit.test.mjs`(11) | L1 | PASS |
| TP-01 | T10/T15/T22 | `plan/store.test.mjs`(8)、`tui/sp004-cards.test.mjs`(10) | L0+L2 | PASS |
| TP-02 | T10/T15/T22 | `plan/store.test.mjs`(8)、`tui/sp004-cards.test.mjs`(10) | L0+L2 | PASS |
| TP-03 | T11/T22 | `core/plan-mode.test.mjs`(13) | L0 | PASS（降级为需批准，非硬阻断） |
| TP-04 | T10/T22 | `plan/store.test.mjs`(8)、`plan/persist.test.mjs`(8) | L0 | PASS |
| TP-05 | T10/T11/T14 | `core/plan-mode.test.mjs`(13)、`plan/validate`（经 store/host 用例） | L0+L2 | PASS |
| TP-06 | T12/T15/T22 | `core/question.test.mjs`(7)、`tui/sp004-cards.test.mjs`(10) | L0+L2 | PASS |
| TP-07 | T12/T22 | `core/question.test.mjs`(7) | L0 | PASS |
| TP-08 | T12 | `core/question.test.mjs`(7) | L0 | PASS |
| TP-09 | T10 | `plan/store.test.mjs`(8)、`tui/sp004-cards.test.mjs`(10) | L0+L2 | PASS |
| TP-10 | T10/T22 | `plan/store.test.mjs`(8)、`plan/persist.test.mjs`(8)、`plan/host.test.mjs`(4) | L0 | PASS（跨进程恢复属 SP005） |

合计：48 条 AC，PASS 45 条；CE-11、CE-19、SAFE-02 的「真实平台隔离后端」部分 UNVERIFIED；CT-07 生产闸门启用状态 UNVERIFIED（见 §5）。无 FAIL 行。

## 5. 未验证项与恢复条件

- **真实平台隔离后端（CE-11、CE-19、SAFE-02）**：仓库内只有策略层 `createSandboxPolicy`，无已验证的后端实现（设计规定由宿主注入）。生产接线因此在启动前 fail-closed：普通 Bash/PowerShell 被拒（`execSandboxUnavailable`），`plan/test/host.test.mjs` 的 runtime 工具面用例断言了这一行为与零 spawn。恢复条件：宿主提供 `verified: true` 的后端并传入 `createSandboxPolicy({backend})`，随后按 `exec/test/runner.test.mjs` 的同一套真实进程回归在新后端上复跑，再取消 fail-closed。
- **CT-07 完成证据闸门在生产 runtime 未启用**：`createCodingTaskTracker` 与闸门逻辑已实现并有 18 条用例，但接入 `src/tui/runtime.ts` 会让无隔离后端的 CLI 会话在命令全被拒时持续重试到 `maxIterations`（T15 实测 64 次请求替代 2 次）。恢复条件：隔离后端落地后可重新接入；接入时须复跑 `tui/test/cli.test.mjs` 与 `tui/test/screen-e2e.test.mjs` 防回归。
- **worktree 工具表面未接入生产 runtime**：`createWorktreeTools` 与协议级用例已交付（T25），但会话级 cwd 重绑定（进入隔离工作树后命令/文件工具改到新目录）属 SP005 会话状态重构；现在接线会出现「工具声称已隔离、实际仍写主工作区」的误导。恢复条件：先实现会话 cwd 抽象，再把工具集接入 `src/tui/runtime.ts` 并补伪 TTY 用例（进入→写文件→退出 keep/remove 全链路），复跑 `tui/test/cli.test.mjs` 防回归。
- **参考实现像素级对照（VIS-01…04）**：行为与交互的逐项对照记在 [reference-parity.md](reference-parity.md)（能力/组件映射、四类差异及理由、未验证边界）；本环境无头，无两路真实交互终端与截图；参考仓也没有计划模式卡片/多题追问向导可供一一对照。恢复条件：具备图形终端与参考环境后，在 100×30 与 70×20 下采证单元格与 PNG，按 §1 的断言逐项目检。
- **真实 Provider（live）**：本轮全部用例使用 scriptProvider/伪 TTY，未调用真实模型 API。恢复条件：配置真实 Provider 后跑 `npm run test:unit -- live` 类手工场景（仓库未提供自动 live 套件），单独记证据。
- **发布包核验（SRC-01 的制品侧）**：0.4.0 官方源安装与完整性核验已完成，证据见 §10。
- **AST 分值不证明来源**：见 `ast-review.md` 的边界说明；不等于法律洁净室认证。

## 6. 本轮变更与验证范围

- 分支 `feature/SP004/real-coding-task` 上 30 个合入前提交，含 T25 补记 1 个后续提交，涉及 `src/exec`、`src/git`、`src/plan`、`src/core`、`src/tui` 与文档；未包含依赖、产物、凭据、`.superpowers` 台账（本地不跟踪）。
- 文档检查：`npm run spec:check`、`npm run skills:check`、`git diff --check`；48 条 AC 与 26 个任务（含 T25 补记）映射见[实施计划](design/plan.zh.md#测试收口映射ac--任务--用例)。
- 参考 TUI 对照记录见 [reference-parity.md](reference-parity.md)（用户 2026-11-18 指定参考仓 `b5c9be8`）。
- [产品说明书](../../PRODUCT.md)已在同轮同步：§5.4 记录四类卡片与键位，§7 记录命令执行与 worktree 限制。
## 7. 追加优化需求 agent-observability（重应用到 master，2026-11-19）

本机 Langfuse 可选监测优化（默认关闭）独立回填于 [agent-observability/requirements.md §验收回填](agent-observability/requirements.md)，状态与证据见 [agent-observability/STATUS.md](agent-observability/STATUS.md)。本优化在远端已合入的 SP004 主体（T25）之上**单独重应用**，保留远端 SP004 实现不变，仅叠加观测接入点（session.ts 埋点、runtime.ts setupTracing、cli.ts flush、tsconfig/边界规则/skill 注册/e2e 模板/package.json）。摘要：

- **观测测试**：core 埋点 15 + redact 13 + exporter/runtime 24 + 宿主 wiring 8 = 60 项通过；langfuse 脚本 38 项（init/compose 18 + verify 判定 20）通过。
- **全量复测（重应用后）**：`npm test` **722 项，722 通过，0 失败，0 跳过**（含远端 SP004 T25 用例与观测用例）；`npm run test:checks` 模块边界通过（新增 observability 规则，core 不得反向依赖）。
- **AST 独立来源复核**：观测实现首轮命中 2 → 按设计 §9.3 独立重构后命中 0 PASS（见 [ast-review.md](ast-review.md)）。
- **AC**：28 条中 26 条 PASS（代码/结构/判定逻辑）；OB-04 真实部署健康、OB-24 live 三场景 UNVERIFIED。
- **UNVERIFIED 恢复条件**：OB-04 需在无竞争实例且 ClickHouse fresh-migration 可正常完成的环境重跑 `control.ps1 -Action start`；OB-24 需部署成功 + 用户提供 `BUDINGX_SMOKE_MODEL_*` 后运行 `node scripts/langfuse/verify-agent.mjs`。
- **产品说明书同步**：PRODUCT.md §6/§7/§8 与发行说明 v0.4.0 已记录可选追踪默认关闭、启用方式与 UNVERIFIED 边界。


## 8. 0.4.0 Actions #16 干净检出回归（2026-11-19）

- [运行 #16](https://github.com/Limingyang01/budingx-next/actions/runs/44492443786) 基于 `5f504e0`，Windows 和 Linux 均在发布预演步骤失败，OIDC 发布任务跳过。该源码的 Windows 和 WSL Linux 干净检出均复现 `ERR_MODULE_NOT_FOUND`：Langfuse 能力探针导入主线未包含的 `dist/exec/host-sandbox.js`，已有工作树的残留编译文件掩盖了此问题。
- 探针改为直接使用 0.4.0 主线的 TUI 运行时装配。干净 Windows 检出的现有探针测试由模块加载失败恢复到 9 项通过。Windows Node 22.22.0 / npm 11.21.2 完整预演 722 项通过，0 失败、0 跳过，91 文件 tarball、隔离安装、版本 shim 与本地 HTTP smoke 均通过。
- 自审确认探针脚本只移除缺失的模块及无效的注入参数，产品的命令隔离策略、依赖与发布门禁沿用主线。产品说明书于核实正式发布时同步发布状态。本次源码检查通过 `git diff --check`，未引入产物、凭据或参考仓内容。
- #16 时正式发布和官方包安装待验证，后续结果见 §10。真实 Langfuse 探针仍待按 §7 的环境条件复测。
- Linux Node 24.22.3 预演另复现 10 个受控 Git 用例因 `EPIPE` 失败。临时诊断发现，无输入的 Git 命令退出时仍会收到一次空写入。修复让无输入调用直接结束 stdin，并将 stdin 传输错误返回给调用者。Linux 上原有 Git 与探针回归共 20 项通过。自审核对有输入的 Git 命令仍接收审批绑定的内容，授权消耗、预期 tree 校验与条件更新 ref 的检查均沿用原逻辑。


## 9. 0.4.0 Actions #17 Windows 短路径回归（2026-11-19）

- [运行 #17](https://github.com/Limingyang01/budingx-next/actions/runs/44497301504) 的 Linux 验证通过。Windows 日志中 6 个 Git 用例因 `RUNNER~1` 与 `runneradmin` 指向同一目录但字符串不同而失败，OIDC 任务跳过。
- 新增真实目录别名回归，Windows fixture 使用 junction。旧实现返回别名路径，断言失败。修复后创建、复用与授权移除以真实目录匹配，路径缺失仍拒绝删除并报告残留。新增回归与 T23-10 复测通过。
- 自审核对目录边界、Git 登记、分支匹配、宿主授权与丢弃确认均生效。残留检查和删除使用同一 Git 登记路径，Git 状态无法读取时拒绝删除。变更局限于 worktree 路径匹配与测试，未引入依赖或产物。产品说明书随正式发布回执更新。
- #17 时 Windows 验证和 npm 发布尚未通过，后续结果见 §10。

## 10. 0.4.0 正式发布回执（2026-11-19）

[GitHub Actions #18](https://github.com/Limingyang01/budingx-next/actions/runs/44504716724) 基于 `82af4ab`，Windows 和 Linux 验证及 OIDC 发布均通过，npm `latest` 指向 0.4.0。官方源独立安装、CLI 版本、本地 HTTP 流式测试通过，已验证 53 个 registry 签名和 7 个 attestations。制品 SHA-512 和发布源码均与 npm provenance 一致。详见 [发行说明](../../release-notes/v0.4.0.md)和[发布台账](../../release-ledger.json)。

真实平台隔离、生产运行时接线、参考终端视觉与 live Provider 的验证边界见 §5，Langfuse 真实部署与 live 三场景见 §7。
