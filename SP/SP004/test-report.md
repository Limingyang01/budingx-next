# SP004 验收与验证报告 · 真实编码任务

状态：**审查修复已在 SP004 功能分支验证，等待用户复审**。分支 `feature/SP004/real-coding-task`，修复前评审点 `868eae6`，实施基线 `e808679`，参考 TUI `b5c9be8`。本次只推送功能分支，master 仍等待用户确认。

## 0. 本轮执行证据

复验环境为 Windows、Node.js 22.22.0，使用本地 HTTP、真实临时 Git 仓及伪 TTY。命令均从仓库根执行。

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 构建 | `npm run build` | 通过（tsc，无错误） |
| 单元/功能 | `npm run test:unit` | **580/580 通过**（`npm test` 内运行） |
| 模块边界 | `npm run test:checks` | 「模块边界检查通过」 |
| 规格自洽 | `npm run spec:check` | 「OK: 路线图、能力清单与任务清单自洽」（能力 91 项） |
| 技能入口 | `npm run skills:check` | 「Skill entries are current」 |
| 发布脚本 | `npm run test:release` | 17/17 通过 |
| 合入门禁脚本 | `npm run merge:test` | 5/5 通过 |
| 全量 | `npm test` | **623 通过 / 0 失败 / 0 跳过**（skills 10 + spec 11 + unit 580 + release 17 + merge 5） |
| 交叉验证门禁 | `npm run merge:gate` | 本次只推送功能分支，未执行 master 合入门禁 |
| 来源 AST 复核 | `node scripts/review/sp004-ast.mjs --reference <参考仓> --reference-revision b5c9be8 --base master` | 改动 40/40 映射，函数对 19,359 组，命中 0，自检 4/4 PASS → **PASS**（详见 [ast-review.md](ast-review.md)） |

## 1. 视觉与交互验收

下表的 PASS 限自动化实际断言的行为和键序。参考实现像素级对照为 UNVERIFIED，恢复条件见 §5。

| ID | 回放步骤与断言 | 关联 AC | 状态 |
| --- | --- | --- | --- |
| VIS-01 命令 | 运行、stdout、stderr 与非零退出、截断与展开、转后台并完成、取消、审批提示；同一 call ID 只有一条工具结果，取消后焦点回输入区。用例：`tui/test/sp004-cards.test.mjs`（T15-1…3、T15-8…10）、`exec/test/tools.test.mjs` | CE-01、04–07、16–18、CT-08 | PASS（所列自动化用例）；像素 UNVERIFIED |
| VIS-02 计划 | 调研展示、焦点移动、编辑正文并批准、拒绝反馈、Esc、漂移重审、原档位与输入焦点恢复、一次性批准。用例：`tui/test/runtime.test.mjs`、`tui/test/sp004-cards.test.mjs`（完整正文编辑）、`core/test/plan-mode.test.mjs`、`plan/test/host.test.mjs` | TP-01、03–05、10 | PASS（所列自动化用例）；像素 UNVERIFIED |
| VIS-03 待办 | 独立 TodoWrite 更新与进行中文案；派生视图的空列表、状态、阻塞与 TTL。用例：`tui/test/runtime.test.mjs`、`tui/test/sp004-cards.test.mjs`（T15-5） | TP-01、02、09 | PASS（所列自动化用例）；像素 UNVERIFIED |
| VIS-04 追问 | 多题导航、选项状态渲染、最后一题 Other、Esc 取消、旧答案保留与工具结果身份。独立预览、备注输入和确认页仍未验证。用例：`tui/test/sp004-cards.test.mjs`（含最后一题 Other）、`core/test/question.test.mjs` | TP-06–08、CT-05、06 | PASS（所列自动化用例）；像素 UNVERIFIED |

自动化断言的是帧文本、键序与状态，不是像素：伪 TTY 下没有真实字体/DPI/IME，参考截图不作为发行资产。

## 2. 工具协议验收

| ID | 样例与预期 | 任务 | 状态 |
| --- | --- | --- | --- |
| PROTO-01 | Bash/PowerShell 四字段、毫秒超时、未知字段拒绝、关闭沙箱字段拒绝；缺隔离明确错误；后台回执、退出码、截断、stderr。用例：`exec/test/tools.test.mjs`（16）、`exec/test/interpreter.test.mjs`（11）、`exec/test/runner.test.mjs`（13）、`exec/test/auto-background.test.mjs`（3） | T2、T3、T5、T18、T19 | PASS |
| PROTO-02 | `EnterPlanMode` 空对象；`ExitPlanMode` 读会话计划文件、可带 `allowedPrompts` 但不自动放行；缺文件、编辑后批准、拒绝反馈、取消、恢复、漂移。用例：`plan/test/host.test.mjs`、`core/test/plan-mode.test.mjs`（13）、`plan/test/persist.test.mjs`（8） | T10、T11、T22 | PASS |
| PROTO-03 | `AskUserQuestion` 1–4 题、每题 2–4 项、header、多选、预览；宿主注入 Other；答案/备注按题目文本对应并以原 call ID 返回；取消、重复、过期有确定结果。用例：`core/test/question.test.mjs`（7）、`tui/test/sp004-cards.test.mjs`（T15-6、8、9） | T12、T15、T22 | PASS |
| PROTO-04 | 计划步骤与待办项为两个对象、保留阻塞关系；`EnterWorktree` 名称与复用身份；`ExitWorktree` keep/remove 与授权、残留计数。用例：`plan/test/store.test.mjs`（8）、`git/test/worktree.test.mjs`（6）、`git/test/worktree-exit.test.mjs`（6） | T8、T10、T15、T22、T23 | PASS |

`WritePlan`、`TodoWrite`、`GitStatus`、`EnterWorktree`、`ExitWorktree`、`GitCommit`、`StartCodingTask`、`TaskRedirect`、`TaskStatus` 与 `TaskCancel` 通过正式 TUI runtime 注册。生产入口回归检查真实发出的本地 HTTP 工具请求及原调用 ID。

## 3. 权限、Git、来源验收

| ID | 验证证据 | 任务 | 状态 |
| --- | --- | --- | --- |
| SAFE-01 | 各模式硬 deny 优先、未知操作无只读豁免、待批/迟到/重复授权不产生副作用、前台/后台/自动转后台共用同一启动门禁、无后端能力时零 spawn。用例：`workspace/test/policy.test.mjs`（11）、`exec/test/tools.test.mjs`、`exec/test/background.test.mjs`（7）、`core/test/plan-mode.test.mjs` | T5、T11、T19–T21 | PASS |
| SAFE-02 | 平台隔离后端内运行合成进程、核验整树与网络/Git 元数据约束；完成「定位→修改→失败测试→修复→通过」闭环。用例：`exec/test/isolated-project.test.mjs`、`tui/test/coding-loop.test.mjs` | T14、T20 | 部分 UNVERIFIED（见 §5：无真实隔离后端，进程在宿主环境运行） |
| GIT-01 | 临时仓原 checkout 含 staged/unstaged/untracked；成功提交只在专用分支产生核准树，原索引、文件与 HEAD 不变。用例：`git/test/commit.test.mjs`、`tui/test/runtime.test.mjs` | T7–T9 | PASS |
| GIT-02 | 拒绝未授权、审批后漂移、混合改动、并发 ref 变化、重复授权与意外钩子；普通命令入口不获得 Git 写权限；失败可安全重试。用例：`git/test/commit.test.mjs`、`exec/test/tools.test.mjs`（T5-5） | T5、T7、T9、T20 | PASS |
| SRC-01 | 来源记录含参考 SHA、行为来源、自有模块与第三方条款；制品不含参考源码/内部类型/资产/提示词/bundle。见 `ast-review.md`、`THIRD-PARTY-NOTICES.md` | T24、T17 | PASS（来源记录），发布包核验见 §5 |
| SRC-02 | 归一化 AST 对比出具范围、长度、分值与处置；合成正负例；未解决项不得通过。见 `ast-review.md` | T24 | PASS（命中 0） |

## 4. 48 条 AC 回填

AC 区间：CE-01…20（20）、CT-01…09（9）、GW-01…09（9）、TP-01…10（10），共 48 条，逐条对应到实际用例文件；「计数」为该文件内 `test(` 用例数（原实施期用例数，复验总数见 §0），验证层：L0 = 纯逻辑/契约，L1 = 真实进程或真实 Git 仓，L2 = 伪 TTY 端到端。

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
| CT-07 | T13 | `core/coding.test.mjs` 与 `tui/test/runtime.test.mjs` 验证完成证据、命令失败及后端缺失时退出 | L0+L1 | PASS（正式入口，后端使用测试替身） |
| CT-08 | T13/T14 | `core/coding.test.mjs`(18)、`exec/isolated-project.test.mjs`(2) | L0+L2 | PASS |
| CT-09 | T4/T12 | `exec/background.test.mjs`(7)、`core/question.test.mjs`(7) | L1 | PASS |
| GW-01 | T6/T23 | `git/status.test.mjs`(7)、`git/status-extended.test.mjs`(4) | L1 | PASS |
| GW-02 | T7/T21 | `git/attribution.test.mjs`(8)、`exec/isolated-project.test.mjs`(2) | L1+L2 | PASS |
| GW-03 | T7 | `git/attribution.test.mjs`(8) | L1 | PASS |
| GW-04 | T9 | `git/commit.test.mjs`(11) | L1 | PASS |
| GW-05 | T8/T23 | `git/worktree.test.mjs`(6)、`git/worktree-exit.test.mjs`(6) | L1 | PASS |
| GW-06 | T8/T23 | `git/worktree-exit.test.mjs`(6) | L1 | PASS |
| GW-07 | T8/T23 | `git/worktree.test.mjs`(6)、`git/worktree-exit.test.mjs`(6) | L1 | PASS |
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

48 条 AC 保留逐条映射。CE-11、CE-19 和 SAFE-02 的真实平台隔离、参考终端对照及真实 Provider 均为 UNVERIFIED。CT-07 已在正式入口覆盖。

## 5. 未验证项与恢复条件

- **真实平台隔离后端（CE-11、CE-19、SAFE-02）**：Runner 只通过宿主验证的后端接口启动并终止进程。后端能力、当前工作区和环境白名单在启动前校验。默认 CLI 没有已验证的后端，普通命令保持拒绝。当前过程测试替身只验证启动、取消、错误语义与事件接线。恢复验收需要实际提供后端，并分别验证 Windows/Linux 的文件、网络和 Git 元数据隔离。
- **参考像素对照（VIS-01…04）**：参考提交包含 `ExitPlanModePermissionRequest.tsx` 及 `AskUserQuestionPermissionRequest/`，含独立预览、题间导航、备注和提交确认等参考路径。本轮仅运行本仓伪 TTY 回归，真实对照须确认设计使用权并在同环境采集 100×30、70×20 的单元格和 PNG。
- **真实 Provider（live）**：本轮用例使用本地 HTTP fixture、scriptProvider 或伪 TTY，未调用真实模型 API。恢复条件：配置真实 Provider 后跑 `npm run test:unit -- live` 类手工场景（仓库未提供自动 live 套件），单独记证据。
- **发布包核验（SRC-01 的制品侧）**：本轮未打包发布。恢复条件：发布前准备阶段用 `npm pack --dry-run` 核对清单并核对 `THIRD-PARTY-NOTICES.md`，实际 npm 发布由用户在 GitHub 手动触发。
- **AST 分值不证明来源**：见 `ast-review.md` 的边界说明；不等于法律洁净室认证。

## 6. 本轮变更与验证范围

- 修复涉及执行后端契约、专用 worktree 与审批、计划和待办接线、追问按键、证据闸门、AST 脚本和验收记录。自动化测试使用自有临时仓和合成工作区。
- 文档检查：`npm run spec:check`、`npm run skills:check`、`git diff --check`；48 条 AC 与 25 个任务映射见[实施计划](design/plan.zh.md#测试收口映射ac--任务--用例)。
- [产品说明书](../../PRODUCT.md)已在同轮同步：§5.4 记录四类卡片与键位，§7 记录命令执行与 worktree 限制。
