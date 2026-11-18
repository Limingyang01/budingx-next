# SP004 参考 TUI 对照与行为差异（自测记录）

- 参考仓：本地只读 `budingWorkerSpace`，revision `b5c9be8`（用户 2026-11-18 指定「参考 TUI 就是这个」）。
- 本仓：`budingx-next` master（SP004 合入 `fdfdae8` + T25 补记），源码版本 0.4.0（准备）。
- 方法：只读参考仓源码，核对组件结构、键位、状态符号与信息层次；按 SP001 决定 3「读机制、不抄代码」只比较行为与结构，不复制实现。像素级/单元格级差分需要两路真实交互终端，本环境无头，见「未验证边界」。
- 结论口径：**行为等价或差异已解释**；差异分三类——①等价（语义与可用性一致）②有意简化（设计未强制、删减不降低体验）③待接线（协议已实现但生产未启用）。

## 1. 能力与组件映射

| 能力 | 参考实现（`budingWorkerSpace` @ `b5c9be8`） | 本仓实现 | 判定 |
| --- | --- | --- | --- |
| 命令执行与进度 | `src/components/BashModeProgress.tsx`：组合 `UserBashInputMessage`（原始命令）+ `ShellProgressMessage`（`ShellProgress{fullOutput,output,elapsedTimeSeconds,totalLines}`），运行中滚动尾部输出 | `src/tui/render/cards.ts` 的 `commandCardLines`：命令、解释器、cwd、状态（运行中/后台/完成/失败/取消）、尾部若干行 + `Ctrl+E` 展开、`exit_code`、耗时、后台任务 ID 与输出路径 | 等价（信息层次一致；本仓为纯函数渲染，可离线单测） |
| 待办列表 | `src/components/TaskListV2.tsx`：`completed/pending/in progress` 计数，排序 `recentCompleted(30s) → inProgress → pending → 其余 completed`，未完成 id 集合用于阻塞标记 | `todoCardLines` + `todosFromPlan`：由计划步骤派生，完成数/总数、状态符号、阻塞标注，最近完成项 60 秒折叠、`Ctrl+E` 展开 | 等价（排序目标一致：进行中优先、近期完成次之、旧完成折叠） |
| 计划模式进入/批准 | `src/tools/EnterPlanModeTool/` + `src/components/permissions/EnterPlanModePermissionRequest/`；`src/tools/ExitPlanModeTool/` + `ExitPlanModePermissionRequest.tsx`（`PermissionDialog color="planMode"`，标题 `Exit plan mode?` / `Ready to code?`，选项 `Yes`/`No` + `Yes, auto-accept edits`/`Yes, and bypass permissions`/`Yes, manually approve edits`/清空上下文变体） | `src/plan/tools.ts` 的 `EnterPlanMode`/`ExitPlanMode` + `src/plan/host.ts`（计划文件 `~/.budingx/plans/<sessionId>/<planId>.md`、指纹、漂移校验）+ `src/tui/render/cards.ts` 的 `planCardLines` 与审批槽（`1` 允许 / `3`/`Esc` 拒绝 / `e` 编辑正文 / `↑↓` 焦点） | 行为等价、交互有意差异化（见 §2-A） |
| 多题追问 | `src/components/permissions/AskUserQuestionPermissionRequest/`：`QuestionView`、`QuestionNavigationBar`（`←`/`→` + `✓ Submit` 页签、每题 header chip）、`SubmitQuestionsView`（`Review your answers` 确认页、未答完整警告、submit/cancel）、`PreviewBox`、`use-multiple-choice-state` | `src/core/questions.ts` + `session.askQuestion/answerQuestion/cancelQuestion` + `questionCardLines`：1–4 题逐题作答、`↑↓`/`Tab` 光标、`←→` 切题、空格选择、`Enter` 确认/推进、最后一题提交、`Other` 行输入、`Esc` 取消、同一 call ID 单一结果 | 语义等价、呈现有意简化（见 §2-B） |
| 命令审批 | `src/components/permissions/BashPermissionRequest/`、`PowerShellPermissionRequest/`、`FileEditPermissionRequest/`、`FileWritePermissionRequest/`，统一 `PermissionDialog` | `src/tui/app.tsx` 审批槽 + `src/core/session.ts` 统一权限入口（`1`/`2`/`3`、`y`/`n`、`Esc`，计划批准可 `e` 编辑正文） | 等价（同一策略引擎与记忆语义） |
| 隔离工作树 | `src/tools/EnterWorktreeTool/`、`src/tools/ExitWorktreeTool/` | `src/git/tools.ts` 的 `EnterWorktree`/`ExitWorktree`（T25）+ `src/git/worktree.ts` 库函数 | 协议等价；生产接线待做（见 §2-C） |
| 计划文件位置 | `src/utils/plans.ts` 的 `getPlanFilePath(agentId?)` | `src/plan/serialize.ts` 的 `planFilePath(sessionId, planId, home)`，落在 `~/.budingx/plans/<sessionId>/<planId>.md` | 等价（本仓按 `~/.budingx` 统一根与会话隔离） |
| 任务清单工具 | 参考另有 `TodoWriteTool`、`TaskCreate/Get/List/Output/Stop/UpdateTool` | 本轮未提供独立待办工具，待办由计划步骤派生（设计 §6.1 允许） | 有意简化（见 §2-D） |

## 2. 差异与理由

**A. 计划批准交互**
- 参考用通用 `PermissionDialog`，一次列出多个「Yes + 权限档位」组合（auto-accept / bypass / manual / 清空上下文变体）。
- 本仓把批准放在计划卡片里：`1` 允许、`3`/`Esc` 拒绝、`e` 在输入框里直接编辑计划正文后 `Enter` 提交、`↑↓` 移动步骤焦点；批准后恢复到「进入计划模式前的档位」，不在批准对话框里改档位。
- 理由：设计 §6.2/§6.3 规定计划批准 = 「宿主提交原文或用户编辑正文 → 计算批准指纹 → 校验后恢复原档位」，且**计划批准不自动授予 Git/命令特权**；把档位变更混进批准选项会与「恢复原档位」冲突。差异属有意设计，可用性不低于参考（少一层弹窗、多正文编辑能力）。

**B. 追问呈现**
- 参考为逐题页签 + 独立「Review your answers」确认页（可回看、未答完有警告、再 submit/cancel）。
- 本仓为线性作答：`←→` 可在题间回看修改，最后一题 `Enter` 即提交；未答完时在卡片上标注状态，`Esc` 取消。
- 理由：设计 §6.4 只要求多题结构（1–4 题、每题 2–4 选项、header、multiSelect、自动 Other、答案按题目文本、备注、挂起/取消/单一结果），未要求独立确认页；VIS-04 的「确认后提交」由最后一题提交覆盖。属有意简化；若后续需要回看确认页，可在同一 `QuestionCard` 状态上增一层视图而不改协议。

**C. 隔离工作树接线（待做）**
- 协议层已按设计 §7.3/§8 交付并有 8 项用例（进入、keep、remove 授权、残留计数、强制审批）。
- 生产 `src/tui/runtime.ts` 未接入：进入工作树后命令与文件工具仍指向主工作区，接线会误导模型。已记 UNVERIFIED（验收报告 §5），依赖会话 cwd 抽象（SP005）。

**D. 独立待办工具**
- 参考有 `TodoWriteTool` 与 Task 系列工具；本轮按计划未纳入（设计 §6.1 要求「待办与计划分离」但未强制独立工具），待办卡片由计划步骤派生。
- 若后续要对齐，可在不改卡片渲染的前提下补 `TodoWrite` 工具与 `TodoStore` 持久化。

## 3. 未验证边界

1. **像素级/单元格级对照**：本环境无头，无法并排采证两路真实终端；两种尺寸（100×30、70×20）的单元格与 PNG 差分记为 UNVERIFIED。恢复条件：具备图形终端与参考运行环境后，按验收报告 §1 的 VIS-01…04 断言逐项目检。
2. **真实交互手感**（滚动、IME、CJK 宽字符折行）在真实终端下的表现：同上，属 UNVERIFIED，需人工 smoke。
3. **参考仓版本锁定**：对照基于 `b5c9be8`；参考仓后续变化未跟踪。
4. **独立来源**：本对照只比较行为与结构，来源合规以 [ast-review.md](ast-review.md) 为准；AST 命中 0 不构成法律洁净室证明。

## 4. 自测结论

- 四类卡片（命令/计划/待办/追问）在伪 TTY 下完成行为级验证，与参考的同类能力**语义等价**，差异均为有意设计并已说明理由。
- 参考仓没有与本仓一一对应的计划卡片与多题追问向导，因此「视觉复刻」不成立，只承诺「使用体验不低于参考」：计划可编辑正文后批准、漂移回待审；追问支持多题/多选/Other/取消。
- 唯一的待接线项是隔离工作树工具面（协议已交付、生产未启用），原因与恢复条件已写入验收报告 §5。

证据入口：[验收与验证报告](test-report.md)（§1 视觉与交互、§4 48 条 AC、§5 未验证项）。