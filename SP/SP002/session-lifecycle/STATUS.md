# session-lifecycle · STATUS

1. **目标与版本**：[需求 v0.1（已批准）](requirements.md)（AC SL-01…09）；[设计 v0.3 approved](../design/design.zh.md)（本需求相关：§3.2 事件契约、§3.3 状态机/双中断/队列/审批/快照）；[实施计划](../design/plan.zh.md) T4/T5/T6；[验证报告](../test-report.md)。
2. **阶段清单**：需求 ✅ → 设计 ✅（2026-11-16 批准）→ 计划 ✅ → 实施 ✅ → 测试 ✅ → 交付 ✅（本地提交并推送功能分支）。阻塞：无。
3. **用户决定**：U3「有时候想到问题会补充打断执行」+「这两种情况都有吧」（双中断 USER_CONFIRMED，设计 §3.3 落表）；U1/U2/U4/U5 同 [provider-streaming STATUS](../provider-streaming/STATUS.md) 第 3 条；2026-11-16「继续SP002,我批准了设计」。
4. **执行记录**：实现于 `src/core/{events,provider,tools,constants,normalize,tool-calls,session}.ts`。状态集合 idle/requesting/streaming/tool_running/awaiting_approval/cancelling，非法迁移被拒并发 notice；每回合至多一个终态，重复终态发 `late_event_dropped`；`TurnSnapshot` 每回合冻结一次；执行中输入 FIFO 排队、工具结果回填后 `intra_turn` 注入、回合结束后 `inter_turn` 自动起新回合、驻留窗口 400ms 内空闲 Esc 可回收；纯取消且无输出时还原用户原文。验证：core 相关 29 项（session 16 + normalize 7 + tool-calls 6）+ TUI 审批 3 项全绿。2026-11-17 交付后复验发现队列 drain 定时器被 `unref()` 导致排队输入不会自动起新回合（SL-05），已修复并复测 session 16/16、产品单元 103/103 全绿，详见 [验证报告 §7](../test-report.md)。
5. **下一轮**：真终端双中断/排队人工确认（报告 §5）；工具级联取消策略与权限规则归 SP003/SP004，SP002 默认不继承旧仓兄弟级联假设。

## 2026-11-17 缺口收尾

按用户要求补齐报告中本模块相关缺口，详见 [验证报告 §12](../test-report.md#12-2026-11-17-缺口收尾g01g17) 与 [实施计划](../design/gap-closure-plan.md)。历史 PASS 保留当时覆盖范围；当前代码与新增回归不替代 live Provider 或真实终端人工验收。验收、版本准备和发布状态未因本次修复自动改变。
