# provider-streaming · STATUS

1. **目标与版本**：[需求 v0.1（已批准）](requirements.md)（AC PS-01…08）；[设计 v0.3 approved](../design/design.zh.md)（本需求相关：§3.1、§3.4、§6 映射）；[实施计划](../design/plan.zh.md) T2/T3；[验证报告](../test-report.md)。
2. **阶段清单**：需求 ✅ → 设计 ✅（2026-11-16 批准）→ 计划 ✅ → 实施 ✅ → 测试 ✅ → 交付 ✅（本地提交并推送功能分支）。阻塞：无。遗留：PS-08 live 凭据 OPEN（验收时由用户提供）。
3. **用户决定**：U1「继续SP002迭代的开发工作」；U4「批准」（需求 v0.1+设计轮启动）；U2「没有指定哪家服务」（通用设计为 Agent 推论）；U5「没有版权问题你直接使用一样的即可，无需再调研」（O8=Ink）；2026-11-16「继续SP002,我批准了设计」（设计批准，覆盖计划/实现/测试/本地提交）。
4. **执行记录**：实现于 `src/provider/{openai,sse,errors}.ts` 与 `src/core/tool-calls.ts`（装配归 Core，因 core 不得 import provider）。验证：产品单元 103 项全绿，其中本需求相关 16 项（sse 5 + openai 11）；`src/provider/test/fixtures/legacy-chat.mjs` 冻结 0.1.1 基线证明分帧等价。边界检查 `scripts/checks/module-boundaries.mjs` 并入 `npm test`（PS-07）。PS-08 = UNVERIFIED（缺真实凭据与预算，未用 mock 冒充）。
5. **下一轮**：验收时补 live 证据（流式一轮、tool_calls 回合、手动取消、错误 key）；SP003 承接真实工具实现，provider 契约面不变。

## 2026-11-17 缺口收尾

按用户要求补齐报告中本模块相关缺口，详见 [验证报告 §12](../test-report.md#12-2026-11-17-缺口收尾g01g17) 与 [实施计划](../design/gap-closure-plan.md)。历史 PASS 保留当时覆盖范围；当前代码与新增回归不替代 live Provider 或真实终端人工验收。验收、版本准备和发布状态未因本次修复自动改变。

2026-11-17 e2e/真实 Provider 回执见 [报告 §16](../test-report.md#16-真实模型与扩展端到端验证2026-11-17)：真实模型流式、工具审批回合、取消与鉴权错误通过；clear 可见内容同步及工具参数 schema 传递已修复。L3 真终端人工仍 UNVERIFIED，不把流测试当成人工验收。

## 0.2.0 发布准备（2026-11-17）

本模块纳入 SP002 的 0.2.0；源码版本、prepared 台账和[发行说明](../../../release-notes/v0.2.0.md)已同步。发布由维护者手动触发，尚无 published 回执。历史验证与真实终端人工 UNVERIFIED 保持各自证据边界。

## 0.2.0 已发布（2026-11-17）

本模块随 0.2.0 发布，latest 已更新；[运行 #7](https://github.com/Limingyang01/budingx-next/actions/runs/44055301185) 的 Windows/Linux 验证与 OIDC publish 均 success。发布源码 `6ed77d8`，公开 provenance 和官方隔离安装/签名已核实，台账 published。此前 prepared 记录是发布前快照；未验证的人机终端体验维持原边界。详细证据见 [test-report §19](../test-report.md#19-020-正式发布收尾2026-11-17)。
