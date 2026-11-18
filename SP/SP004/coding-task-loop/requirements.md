# coding-task-loop · 编码任务循环

状态：**文档修订待确认**｜版本：v0.3｜依据：路线图 SP004、参考 TUI `b5c9be8`、[设计 v1.3](../design/design.zh.md)

## 目标

Agent 能完成一个真实编码任务闭环：定位问题 → 修改代码 → 运行测试 → 读取失败 → 修复 → 复测，直至目标达成或明确失败；过程中用户可追问、补充或改变方向，且当前进度与目标保持可见。

## 边界

- 循环的「执行」部分依赖 `command-execution` 与 SP003 的文件工具；本需求负责**回合编排、任务状态与用户转向**。
- 不做跨会话恢复（SP005）、不做子代理（SP007）、不做无头 CLI 协议（SP006）。

## 参考对照点

来源：[参考仓行为事实盘点](../../../skills/buding-sdd/references/reference-repo-inventory.md) §1、[排查文档 §4 SP004](../../../docs/reference-tui-replication-audit.md)、**2026-11-18 参考仓只读审计（见[设计 §9](../design/design.zh.md)，F-16/F-19）**。

| 锚点 | 参考行为 | 本轮目标 |
| --- | --- | --- |
| CAP-L3-15 | 目标状态机 + 多阶段计划；缺关键输入时追问并等待；建议≠批准 | 行为等价 |
| 参考 §1 | 回合内固定顺序：组装消息 → 调模型并流式消费 → 工具分派 → 结果回填 → 下一迭代；tool_use 存在即续跑 | 行为等价：SP002 Session 已有迭代骨架，本轮补「编码任务」语义（测试失败回喂、修复循环） |
| 参考 §3 | 执行中输入不被拒，排队注入 | 行为等价：SP002 已实现，本轮验证在命令执行场景下仍成立 |
| 参考 F-16 | 回合终止原因枚举 10 项：`completed`/`max_turns`/`aborted_streaming`/`aborted_tools`/`blocking_limit`/`prompt_too_long`/`image_error`/`model_error`/`stop_hook_blocking`/`stop_hook_prevented` | **对齐**：SP002 现有 5 值，本轮补齐缺失项（与 SP005/SP007 的终止原因契约一致） |
| 参考 F-19 | 参考仓**无**完成证据校验机制；`VerifyPlanExecutionTool` 为 generated stub | **有意加强**：新仓保留 `canClaimDone`（要求测试成功）与执行前基线校验；明确标注为**新仓自主增强**，不声称「与参考对齐」 |

## TUI 与本轮验收

按 VIS-01 / VIS-04 验证命令与追问的回合归属和状态。端到端使用真实隔离后端，协议 fixture 验证下一次模型请求。 统一基线、证据及恢复条件见[验收报告](../test-report.md)。独立来源和 AST 复核见[设计 §9.8](../design/design.zh.md#98-独立实现与-ast-复核)。

## 验收条件（AC）

- **CT-01** Given 一个编码任务，When Agent 执行修改后运行测试，Then 测试失败信息被回喂给模型并触发修复迭代，而非直接结束回合。
- **CT-02** Given 测试持续失败，When 达到最大迭代次数，Then 回合以 `max_turns` 终止并保留最后一次失败证据；`TurnOutcome` 与参考 10 项终止原因对齐。
- **CT-03** Given 用户在执行中补充要求，When 输入进入队列，Then 在当前回合工具结果回填后注入，并被后续迭代采纳。
- **CT-04** Given 用户改变方向（明确否定当前目标），When 输入到达，Then 当前目标被替换而不是叠加，旧目标不再驱动后续动作。
- **CT-05** Given 任务缺少关键输入，When Agent 判定无法继续，Then 通过追问工具向用户提问并等待回答，不臆造缺失信息。
- **CT-06** 用户回答按题目文本关联，通过原 call ID 的单一工具结果进入历史和下一模型请求，回合可继续。
- **CT-07** Given 任务完成，When Agent 声称完成，Then 必须附带实际测试运行结果或 diff 证据；无证据的完成声明视为不合格。
- **CT-08** Given 命令失败（退出码非零），When 结果回填，Then 失败原因进入工具结果，模型可据此继续，不被吞掉。
- **CT-09** Given 用户中断，When 回合进行中，Then 取消传播到模型流与正在运行的命令进程树。

## 开放问题

- OPEN-01：完成证据的最低门槛是「至少一次测试运行」还是「测试全绿」。默认方案：**声明完成时必须携带最近一次测试运行结果（通过或失败均可，但失败时不得声明完成）**；全绿作为交付门槛由测试收口阶段核对，不作为回合内硬约束。
- OPEN-02：`TurnOutcome` 新增值（`blocking_limit`/`prompt_too_long`/`image_error`/`stop_hook_*`）的实现范围。默认方案：**本轮补齐枚举与映射**（终止原因的产出路径若依赖 SP006 hooks，则 `stop_hook_*` 只保留枚举与占位，不实现触发）。

## 身份

AC 切分为 MODEL_PROPOSED，随设计文档自审；功能名称与出口门槛为 USER_CONFIRMED（路线图 r8；r6→r7→r8 下 SP004 范围均未变）。
