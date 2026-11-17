# provider-streaming · STATUS

1. **目标与版本**：[需求 v0.1（已批准）](requirements.md)（AC PS-01…08）；[设计 v0.3 approved](../design/design.zh.md)（本需求相关：§3.1、§3.4、§6 映射）；[实施计划](../design/plan.zh.md) T2/T3；[验证报告](../test-report.md)。
2. **阶段清单**：需求 ✅ → 设计 ✅（2026-11-16 批准）→ 计划 ✅ → 实施 ✅ → 测试 ✅ → 交付 ✅（本地提交并推送功能分支）。阻塞：无。遗留：PS-08 live 凭据 OPEN（验收时由用户提供）。
3. **用户决定**：U1「继续SP002迭代的开发工作」；U4「批准」（需求 v0.1+设计轮启动）；U2「没有指定哪家服务」（通用设计为 Agent 推论）；U5「没有版权问题你直接使用一样的即可，无需再调研」（O8=Ink）；2026-11-16「继续SP002,我批准了设计」（设计批准，覆盖计划/实现/测试/本地提交）。
4. **执行记录**：实现于 `src/provider/{openai,sse,errors}.ts` 与 `src/core/tool-calls.ts`（装配归 Core，因 core 不得 import provider）。验证：产品单元 103 项全绿，其中本需求相关 16 项（sse 5 + openai 11）；`src/provider/test/fixtures/legacy-chat.mjs` 冻结 0.1.1 基线证明分帧等价。边界检查 `scripts/checks/module-boundaries.mjs` 并入 `npm test`（PS-07）。PS-08 = UNVERIFIED（缺真实凭据与预算，未用 mock 冒充）。
5. **下一轮**：验收时补 live 证据（流式一轮、tool_calls 回合、手动取消、错误 key）；SP003 承接真实工具实现，provider 契约面不变。
