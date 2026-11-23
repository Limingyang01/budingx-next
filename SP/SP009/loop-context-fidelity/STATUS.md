# loop-context-fidelity · STATUS（0.9.1）

- 范围：LF-01…LF-04、LC-01…LC-06；分支 `feature/SP009/fix-0.9.1`（基线 master `0af9249`）。
- 授权：用户 2026-11-23 截图反馈 + 上下文动态化/压缩对齐指令 +「修复到 0.9.1」+「必须端到端验证后才算完成」+ AGENTS.md 委托。

| 阶段 | 状态 | 证据 |
| --- | --- | --- |
| 需求/设计/计划 | ✅ | requirements/design/plan |
| L1 交互无默认上限 | ✅ | session.ts maxIterations 缺省 Infinity；sp009-loop-context LF-01（40 迭代）；E2E LF-01 |
| L2 无头 --max-turns | ✅ | headless.ts 解析+校验；E2E LF-02（error_max_turns / 退出码 2） |
| L3 子代理默认无预算 | ✅ | agent-runtime tokenLimit=Infinity、maxIterations 无默认；agent-runtime.test 新用例 |
| L4 窗口解析 | ✅ | core/context-window.ts；sp009-loop-context LC-03 |
| L5 元数据发现 | ✅ | openai.discoverModelMetadata；model-management.loadModelIds |
| L6 档案字段+面板 | ✅ | ModelProfile.contextWindow、/models 面板字段；model-manager 测试 |
| L7 默认接预算 | ✅ | runtime contextBudgetLive（getter 动态）；E2E LC-04 |
| L8 阈值对齐 | ✅ | trigger=窗口−13k 且恒高于压缩目标；CB-05、LC-05；E2E 暴露并修复小窗口隐患 |
| L9 压缩改模型摘要 | ✅ | compact-summary.ts + summaryText；context-budget.e2e（2 请求含摘要）、LC-06、E2E LC-06 |
| L10 AST+收口 | ✅ | sp004-ast PASS；npm test 全绿 |
| 端到端验证 | ✅ | sp009-e2e.test.mjs 4/4（真实子进程+HTTP fixture） |

提交：`b9457fb`（核心运行时）等。待门禁 GREEN 后合入 master。
