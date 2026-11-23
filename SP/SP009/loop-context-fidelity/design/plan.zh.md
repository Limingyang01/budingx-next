# SP009 追加 · loop-context-fidelity — 计划（v1）

分支 `feature/SP009/fix-0.9.1` · cwd 仓库根 · 命令均为真实脚本。

| 任务 | AC | 文件 | 验证 | RED→GREEN |
| --- | --- | --- | --- | --- |
| L1 交互无默认上限 | LF-01/04 | `core/session.ts`、`core/constants.ts`、`tui/cli.ts` | `node --test src/core/test/sp009-loop-context.test.mjs` + mountTty 长循环 | 先写「40 次工具迭代仍完成」用例（旧 32 上限失败）→ 改 while 条件 → 绿 |
| L2 无头 --max-turns | LF-02 | `tui/cli.ts`、`tui/headless.ts` | 真实无头进程 | 先断言 `--max-turns 2` 以 error_max_turns 收尾、未设则不限 → 实现 → 绿 |
| L3 子代理预算保留 | LF-03 | `core/agent-runtime.ts`（断言不改行为） | 既有子代理测试 | 回归保持绿 |
| L4 窗口解析 | LC-03 | `core/context-window.ts`（新） | 单元 | 先写优先级/非法回退用例 → 实现 → 绿 |
| L5 元数据发现 | LC-01 | `provider/openai.ts`、`tui/model-management.ts` | fixture /models | 先断言 context_length 被解析缓存 → 实现 → 绿 |
| L6 档案字段+面板 | LC-02 | `storage/config-store.ts`、`tui/model-manager.tsx` | 单元 + mountTty | 先断言 contextWindow 持久化/面板编辑 → 实现 → 绿 |
| L7 默认接预算 | LC-04 | `tui/cli.ts`、`tui/runtime.ts` | mountTty + 单元 | 先断言无 env 时 session 携带预算 → 实现 → 绿 |
| L8 阈值对齐 | LC-05/06 | `core/context-budget.ts` | 单元 + 小窗口压缩 E2E | 先断言 trigger=窗口−13k、小窗口自动压缩触发 → 实现 → 绿 |
| L9 AST+收口 | 全部 | `scripts/review/sp009-ast.mjs`、测试 | `npm test`、`npm run merge:gate` | 命中 0、全绿 |
| L10 端到端+Langfuse | 用户验证要求 | `scripts/eval/live.mjs`、Langfuse | 真实模型长循环/技能/压缩 | live 回合 + trace 回查，问题即修复复验 |

执行顺序 L1→L2→L3→L4→L5→L6→L7→L8→L9→L10；每任务回填 STATUS，中文本地提交。
