# SP009 追加 · skill-authoring — 计划（v1）

分支 `feature/SP009/fix-0.9.1` · cwd 仓库根 · 命令均为真实脚本。

| 任务 | AC | 文件 | 验证 | RED→GREEN |
| --- | --- | --- | --- | --- |
| S1 多级别发现 | SA-01/02/03/04 | `src/tui/skills.ts` | `node --test src/tui/test/sp009-skill-authoring.test.mjs` + 改写 `sp006-skills.test.mjs` SM-01 | 先写向上遍历/首胜/扩展键用例（旧实现失败）→ 实现 → 绿 |
| S2 内置 skillify | SA-05/06 | `src/tui/skills-bundled.ts`（新）、`commands.ts`、`builtin-extended.ts` | 同上 + mountTty 帧级 | 先断言 /skillify 展开为上下文且含级别选择/确认流程关键词 → 实现 → 绿 |
| S3 刷新监听 | SA-07/08 | `src/tui/skills-watch.ts`（新）、`app.tsx`、`runtime.ts` | 真实文件事件 + mountTty | 先写「新增 SKILL.md → onChange 触发、防抖合并、dispose 静默」→ 实现 → 绿 |
| S4 AST 复核 | 全部 | `scripts/review/sp009-ast.mjs` | `node scripts/review/sp009-ast.mjs` | 映射新/改文件 → 命中 0 |
| S5 收口 | 全部 | 测试汇总 | `npm test` | 全绿 |

执行顺序 S1→S2→S3→S4→S5；每任务完成回填 STATUS 与本报告，中文本地提交。
