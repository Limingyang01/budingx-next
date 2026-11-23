# subagent-fidelity · STATUS（0.9.1）

- 范围：SF-01…SF-05；关联 LF-03；分支 `feature/SP009/fix-0.9.1`（基线 master `0af9249`）。
- 授权：用户 2026-11-23 截图反馈 +「修复到 0.9.1」+「参考参考仓子代理功能」+ AGENTS.md 委托。

| 阶段 | 状态 |
| --- | --- |
| 需求/设计/计划 | ✅ |
| D1 事件与透传 | ✅ |
| D2 系统消息渲染 | ✅ |
| D3 默认无预算 | ✅ |
| D4 AST/收口 | ✅ |
| 端到端验证 | ✅ |

证据：sp009-agent-notify.test.mjs N-01/N-02（meta 系统行、无原始 XML、模型上下文仍含 XML）；agent-runtime.test.mjs「未显式设置 tokenLimit 不再中断」。提交 `b9457fb`。npm test 全绿；待门禁 GREEN 后合入 master。
