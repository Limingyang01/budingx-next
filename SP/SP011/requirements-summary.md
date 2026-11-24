# SP011 · 多代理团队

状态：PLANNED｜更新：2026-11-24｜输入基线：master 4f3fb55，TUI 0.9.1。本文登记本次差距补排涉及的两项交接；整轮规划见[路线图](../../docs/iteration-plan.md#迭代总表)及[高级能力计划](../../docs/advanced-capabilities-plan.md#sp011--多代理团队)。

## 本轮目标与边界

- 目标：团队共享任务的协调与成员隔离工作树，配合 SP009 0.9.2 的通用任务与 Worktree 能力，形成可认领、可交接、可回收的并行开发闭环。
- 不包含：浏览器、Computer Use、定时调度与全能力制品打包（属 SP012–SP016）；通用后台任务操作与单会话 Worktree 闭环（属 [SP009 0.9.2](../SP009/tui-gap-optimizations/requirements.md)）。
- 输入基线：master 4f3fb55，TUI 0.9.1；SP010 中期基线尚未开轮。
- 依赖与启动条件：SP009 0.9.2 的通用任务（详情/日志/终止）与单会话 Worktree（绑定/切换/合并）接口冻结后方可开工；团队生命周期、消息与至少三成员实战的整轮要求沿用高级能力计划。
- 计划/批准身份：USER_CONFIRMED（2026-11-24 补排范围）；细化 AC 与归属为 MODEL_PROPOSED，未授权实施。

## 需求索引

| 功能目录 | 来源 / 身份 | 交付范围 | 阶段 | 需求与状态 | 验证 |
| --- | --- | --- | --- | --- | --- |
| task-coordination | 高级能力计划、盘点 #36、2026-11-24 用户补排指令。细化 AC 为 MODEL_PROPOSED | 团队共享任务、依赖、分派/认领、交接与租约 | PLANNED | [需求](task-coordination/requirements.md) · [状态](task-coordination/STATUS.md) | UNVERIFIED |
| worktree-isolation | 高级能力计划、盘点 #39、2026-11-24 用户补排指令。细化 AC 为 MODEL_PROPOSED | 独立成员工作树、安全审查、结果整合与清理 | PLANNED | [需求](worktree-isolation/requirements.md) · [状态](worktree-isolation/STATUS.md) | UNVERIFIED |

SP010 提供已验收的中期基线。两项复用 [SP009 0.9.2 通用任务与 Worktree 能力](../SP009/tui-gap-optimizations/requirements.md)。团队生命周期、消息和至少三成员实战的整轮要求沿用高级能力计划。

## 验收与交接

- 本轮出口门槛：两项功能的 AC 逐条 PASS（真实进程与真实 Git 证据，不用模拟请求冒充团队运行）；至少三成员真实并行，任务认领唯一、租约可恢复、依赖可阻断，成员隔离下互不污染；不得用 SP009 的通用能力冒充团队能力。
- 实际验收：UNVERIFIED；本次仅需求登记，无 Git 提交。
- 未完成/延期项：团队生命周期、成员消息与预算同步未在本轮细化，沿用高级能力计划，开轮时补写需求与 AC。
- 下一轮输入：SP015 以团队任务与成员工作树的实际交付做组合验收。
- 风险/回退：0.9.2 的通用任务与 Worktree 接口若变更，SP011 需同步适配；回退方式是保留 0.9.2 既有行为、团队能力单独回退。
- Git/产品发布：未执行。

## 变更记录

| 日期 | 范围或状态变化 | 原因/来源 | 影响及处理 |
| --- | --- | --- | --- |
| 2026-11-24 | 建立本轮汇总与两项交接需求 | 用户 2026-11-24 补排指令；盘点 #36、#39 | 需求登记，未授权实施 |
