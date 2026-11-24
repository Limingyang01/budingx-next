# SP009 · 0.9.2 验证记录

## T1 WebFetch 与子代理失败

2026-11-24，开发分支 `feature/SP009/tui-gap-optimizations`，基线 `b8c920d`，Windows、Node 22.22.0。命令均从现有 checkout 的仓根执行。

| 验收 | 结果 | 证据 |
| --- | --- | --- |
| AC-SUBAGENT-01 | PASS | 本机 HTTP 及独立进程验证长/短文本、Unicode 裁剪、审批、私网拒绝、响应头后超时、网络错误、HTTP 404 和重定向。生产工具派发连续抓取 6 个长页后正常结束回合。公开 RFC 9110 返回 HTTP 200，正文 502906 个 UTF-16 码元，工具输出 32768 个码元，含截断提示且无 `BUDINGX_CORE_003` |
| AC-SUBAGENT-02 | PASS | Core 保持真实错误的两个熔断阈值并发出不同操作提示。并行派发中，失败子代理返回工具原始错误码、调用参数和已完成工具输出，另一子代理及主回合继续。后台通知和 TaskOutput 包含失败原因 |
| AC-SUBAGENT-03 | PASS | 用户授权使用现有隔离配置，MiniMax-M3.1-Flash 经真实 OpenAI 兼容端点完成 3 次任务，共 6/6 次请求，每次上限 128 输出 token。每次先调用 WebFetch，再根据返回正文答题，三次均返回可用结论且无 `AGENT_FAILED`。实际费用 UNVERIFIED |

红灯集中运行 11 项，9 项按预期失败，2 项既有保护通过。构建后运行 [T1 定向命令](design/plan.zh.md#t1-定向命令)，80 项通过，0 失败，0 跳过。追加父 Agent 同参数重复派发仍熔断的保护用例后，重跑 `AC-SUBAGENT-02` 定向 3/3 通过。规格与模块边界检查通过。真实 Provider 命令为 `node --env-file=.env.e2e.local scripts/testing/sp009-live-subagent.mjs`，退出 0，脱敏回执为 `artifacts/SP009-0.9.2/live-subagent-1795491536411.json`。公开网络与真实 Provider 作为独立证据，未替代全量测试和集成门禁。

未运行 0.9.2 全量门禁、制品发布预演及正式发布。其余任务与 AC 待实施和取证。
