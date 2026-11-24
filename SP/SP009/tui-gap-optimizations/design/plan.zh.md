# SP009 · 0.9.2 实施计划

目标：交付 [需求正本](../requirements.md) 的 12 项优化。设计依据为 [设计 v1.0](design.zh.md)，基线 `b8c920d`，分支 `feature/SP009/tui-gap-optimizations`。记录在 [STATUS](../STATUS.md)，各任务独立记录红绿验证。计划执行使用当前 checkout。

架构沿用现有 Core、工具、Storage 和宿主边界，使用 TypeScript 和 Node 测试。每批先写表中断言，再查生产调用点，落最少完整改动，跑定向测试和 `git diff --check`，同步 [产品说明书](../../../../PRODUCT.md) 与状态后提交。无本仓 formatter 配置时沿用既有文件风格。命令 cwd 为仓根。禁止读取真实用户数据，保留 0.9.1 兼容，辅助 fixture 不冒充 Provider 验证。

| 任务 | 改动路径与责任 | Consumes → Produces | 单元 RED → GREEN | 功能 RED → GREEN |
| --- | --- | --- | --- | --- |
| T1 #42 AC-SUBAGENT-01…03 | `src/provider/web-fetch.ts`、`src/core/session.ts`、`src/core/events.ts`、`src/core/tools.ts`、`src/core/agent-runtime.ts`、`src/tui/runtime.ts` | WebFetch 现有下载与权限 → ≤32768 码元的成功结果及截断提示；工具结果/回合终态 → 有界子代理诊断 | `sp006-web-fetch.test.mjs` 断言长正文结果长度、短文本、网络/HTTP/私网/超时；`session-persistence.test.mjs` 与 `tool-loop-breaker.test.mjs` 断言成功截断、真正错误码和不同策略提示 | `agent-tools.test.mjs` 断言真实 Session 并行组内失败和成功分别回灌；`agent-runtime.test.mjs` 验证后台原因；公开长网页与隔离真实 Provider live 各留证据，真实 Provider ≥3 次方可关闭 AC-SUBAGENT-03 |
| T2 #05/#06 AC-FORK-01…02、AC-NAME-01…02 | `src/storage/session-store.ts`、`src/storage/session-transcript.ts`、`src/tui/commands/builtin-session.ts`、`src/tui/commands/types.ts`、`src/tui/app.tsx`、`src/tui/runtime.ts` | 当前 ownership 和转录 → 派生来源/分支点、用户标题、已锁持有者的重命名；当前恢复入口 → 新会话切换 | `session-transcript.test.mjs` 断言旧标题回退、无效标题、派生 ID 和状态隔离、损坏来源不产生目标 | `session-recovery.e2e.test.mjs` 并发真实进程与中途失败检验完整提交；拟新增 `src/tui/test/sp009-session-branches.test.mjs` 用命令、真实帧及重启核对历史、权限和标题 |
| T3 #24/#26 AC-RESUME-01…02、AC-EXPORT-01…02，依赖 T2 | `src/tui/panels.tsx`、`src/tui/export.ts`、`src/tui/headless.ts`、`src/tui/commands/builtin-extended.ts`、`src/storage/session-store.ts`、`src/core/transcript.ts`、`src/workspace/tools.ts` | 当前工作区的可恢复会话及有界正文 → 选择器命中；会话转录与持久化修改证据 → Markdown | `sp006-resume-history.test.mjs` 验证边界、损坏和正则字符；`sp009-export.test.mjs` 验证代码块、旧记录缺失、独占写入、凭据/隐藏指令去除 | `sp006-resume-e2e.test.mjs` 真实帧搜索后续问并复验 `/continue`；`sp009-export.test.mjs` 真实 Git 修改后经 TUI、无头导出同一 ID，无关文件排除 |
| T4 #16/#20 AC-INPUT-01…02、AC-TRANSCRIPT-01…02 | `src/tui/app.tsx`、`src/tui/editor/buffer.ts`、`src/tui/render/reducer.ts`、`src/tui/render/history-window.tsx`、`src/tui/render/transcript.tsx`、`src/tui/render/restored-transcript.ts`、`src/tui/keybindings/defaults.ts` | 现有输入和事件 → stash/确认/上限；转录视图 → 全量开关与选择项展开 | `editor.test.mjs` 验证光标、10000/100000 边界与拒绝后历史不变；`render.test.mjs` 验证思考、工具与系统通知一次渲染 | `sp006-tui-frames.test.mjs` 真实帧测试中文粘贴、两次提交、发送全文、恢复长转录、窄屏审批、各键位 |
| T5 #41/#34 AC-RULES-01…02、AC-SKILL-01…03，供 T6 复用 | `src/tui/project-instructions.ts`、`src/tui/runtime.ts`、`src/tui/skills.ts`、`src/tui/commands/builtin-extended.ts`、`src/core/session.ts`、`src/core/tools.ts` | 现有规则和技能加载器 → 解析资源、路径局部规则、模型目录、按回合限制的工具裁决 | `sp006-project-instructions.test.mjs` 验证叶文本、循环、预算、真实路径及同名优先；`sp006-skills.test.mjs` 验证来源、禁用、受信资源及 reload | `sp009-skills-display.test.mjs` 手动和模型触发后真实执行允许/拒绝/取消/下一轮；`sp006-project-instructions.test.mjs` 隔离 Git 多目录变更后由运行时检查刷新、压缩和恢复 |
| T6 #36/#39 AC-TASKS-01…02、AC-WORKTREE-01…03 | `src/tui/tasks.ts`、`src/tui/panels.tsx`、`src/tui/app.tsx`、`src/tui/runtime.ts`、`src/tui/worktree.ts`、`src/git/worktree.ts`、`src/storage/session-store.ts`、`src/exec/background.ts` | 后台/子代理注册表及现有 Worktree API → 会话内详情/日志/停止；绑定元数据 → 同 cwd 的活动或已拒绝切换 | `worktree.test.mjs`、`worktree-exit.test.mjs` 验证授权、目标不符、竞态、冲突和退出；拟新增 `src/tui/test/sp009-tasks.test.mjs` 验证有界尾部、任务归属、已终态停止 | 拟新增 `src/tui/test/sp009-worktree-ui.test.mjs` 用两棵真实 Git 树及 Ink 帧验证 cwd 传播、绑定恢复、丢失树与工作区保护；`sp009-tasks.test.mjs` 实际 Shell 树和 Agent 取消 |
| T7 #33 AC-MCP-01…03 | `src/tui/mcp/types.ts`、`src/tui/mcp/client.ts`、`src/tui/mcp/index.ts`、`src/tui/runtime.ts`、`src/tui/headless.ts`、`src/tui/serve.ts`、`src/tui/commands/builtin-extended.ts`、`src/tui/panels.tsx` | 原 JSON-RPC 和装配 → 传输、生命周期、资源、确认回调与脱敏状态 | `sp006-mcp.test.mjs` 验证配置兼容、来源隔离、连接/目录失败和无调用重放；`sp006-mcp-approval.test.mjs` 验证确认、拒绝、超时和取消 | `sp008-serve-extensions-matrix.test.mjs` 与拟新增 `src/tui/test/sp009-mcp-transports.test.mjs` 验证四协议真实本机端点，TUI/headless/serve 三入口，断连恢复和交互 |
| T8 收口、交付和版本 | `SP/SP009/requirements-summary.md`、`SP/SP009/tui-gap-optimizations/STATUS.md`、拟新增 `SP/SP009/tui-gap-optimizations/test-report.md`、`PRODUCT.md`、版本脚本管理的版本清单和发行说明 | T1–T7 证据与 Git 状态 → 可追溯 AC、自审、门禁、集成和 release dry-run 回执 | `npm test`；用实际结束状态、数量及摘要核对 | `npm run merge:gate`；门禁和合入条件满足后才集成。按发布技能准备 0.9.2、执行真实制品 dry-run，正式 npm 发布由维护者触发 |

### T1 定向命令

`npm run build` 后执行：

```powershell
node --test src/tui/test/sp006-web-fetch.test.mjs src/core/test/session-persistence.test.mjs src/core/test/tool-loop-breaker.test.mjs src/core/test/agent-runtime.test.mjs src/core/test/agent-tools.test.mjs src/tui/test/sp007-failure-boundaries.test.mjs src/tui/test/sp009-agent-notify.test.mjs
```

预期所有目标被执行且零失败。空间、网络与 Provider 状态分别登记，临时日志放仓库忽略的 `artifacts/`。相关任务采用同一构建命令和表中对应文件运行，测试层与实际命令追加至验证记录。

### 复审重点

需要主动注入失败的路径包括响应头已到达但正文超时、父 Agent 重试熔断、派生写入中断和并发追加、工作区索引泄漏、历史缺少修改证据、技能取消后权限泄漏、远程 MCP 在飞请求断开、Worktree 批准期间源/目标发生变化、后台子进程退出与停止并发。验证 0.9.1 的持久化数据、stdio 配置和命令入口仍能使用。
