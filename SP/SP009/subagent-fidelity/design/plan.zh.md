# SP009 追加 · subagent-fidelity — 计划（v1）

| 任务 | AC | 文件 | 验证 |
| --- | --- | --- | --- |
| D1 事件契约 + 会话透传 | SF-02/04 | events.ts、session.ts | `sp009-agent-notify.test.mjs` N-01 |
| D2 reducer 系统消息渲染 | SF-01/04/05 | render/reducer.ts | N-01/N-02（meta 行、无 XML） |
| D3 子代理预算默认 Infinity | SF-05/LF-03 | agent-runtime.ts | agent-runtime.test.mjs 新用例 |
| D4 AST 映射 + 收口 | 全部 | scripts/review/sp004-ast.mjs | 命中 0；全量测试绿 |

执行顺序 D1→D2→D3→D4；每任务回填 STATUS，中文本地提交。
