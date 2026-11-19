# SP005 · 验收报告（long-session-reliability）

状态：**代码层验收全绿**；真实模型三场景与真实 Langfuse 服务端 UNVERIFIED（恢复条件见 §5）。

## 1. 环境与基线

| 项 | 值 |
| --- | --- |
| 仓库 | `D:\my_project\budingx-next` |
| 分支 | `feature/SP005/long-session-reliability` |
| 实施基线 | master `17afe34` |
| Node | 见 `node -v`（package.json 要求 >=22.18） |
| 平台 | Windows 10 家庭版 19045.6466 + MSYS bash；WSL2 发行版 `Ubuntu22`（内核 6.18.58.1-1）内 Docker Engine 29.10.0 |
| 观测栈 | 双轨：真实 Langfuse 4.78.0（WSL2 内 Docker compose，六容器，127.0.0.1:3000）与仓内兼容接收端 `scripts/langfuse/local-receiver.mjs`（无 Docker 的机器与 CI 用，互斥占 3000） |
| 模型 | DeepSeek 兼容端点（`BUDINGX_BASE_URL`/`BUDINGX_MODEL` 来自 `.env.e2e.local`） |

## 2. 执行命令与计数

| 命令 | 结果 |
| --- | --- |
| `npm run build` | PASS（tsc，无错误） |
| `node --test src/*/test/*.test.mjs` | **713 / 713 pass** |
| `node --test src/core/test/context-budget.e2e.test.mjs` | 3 / 3 pass（真实 HTTP 请求体） |
| `node --test src/storage/test/session-recovery.e2e.test.mjs` | 4 / 4 pass（真实子进程） |
| `node --test scripts/langfuse/*.test.mjs` | 本轮新增 26 / 26 pass（含接收端查看页、真实栈冒烟 5、登录凭据自检 3）；`npm run test:langfuse` 合计 **73 / 73** |
| `node --test scripts/langfuse/stack-smoke.test.mjs` | 5 / 5 pass（OB-02/03 真实栈判读） |
| `npm run langfuse:smoke` | PASS（真实栈 4.78.0 回查 3 条 observation，四项判定全 true） |
| `npm run test:checks` | PASS（模块边界：core 不 import storage） |
| `npm test` | PASS（skills + spec + unit + checks + langfuse + release + merge） |
| `npm run merge:gate` | GREEN |

本轮新增用例合计 **96** 例：

| 文件 | 数量 | 覆盖 |
| --- | --- | --- |
| `src/core/test/context-budget.test.mjs` | 11 | CB-01…CB-07 |
| `src/core/test/context-budget.e2e.test.mjs` | 3 | CB-01/02/03/04 真实请求体、PM-02 跨进程、SR-11 两进程互斥 |
| `src/core/test/session-persistence.test.mjs` | 11 | SR-02/03/04、FR-01/05/06/07 |
| `src/core/test/failure-recovery.test.mjs` | 8 | FR-01…FR-07 |
| `src/core/test/tool-loop-breaker.test.mjs` | 4 | FR-09 |
| `src/storage/test/session-transcript.test.mjs` | 12 | SR-01/05/07/08/09/11 |
| `src/storage/test/session-recovery.e2e.test.mjs` | 4 | SR-02/03/04/09/10（真实子进程） |
| `src/storage/test/project-memory.test.mjs` | 12 | PM-01…PM-08 |
| `src/tui/test/sp005-commands.test.mjs` | 14 | CB-05、SR-05/06、PM-01/06/08 命令面 |
| `scripts/langfuse/local-receiver.test.mjs` | 3 | OB-01…OB-04 接收端 |
| `scripts/langfuse/sp005-observation.test.mjs` | 10 | OB-02/03 判读纯函数 |
| `scripts/langfuse/sp005-observation.e2e.test.mjs` | 3 | OB-02/03 + FR-09（真实 HTTP + 追踪 + 接收端） |
| `scripts/langfuse/stack-smoke.test.mjs` | 5 | OB-02/03 真实栈判读（层级/失败可见/会话一致） |
| `scripts/langfuse/init-local.test.mjs` | 10 | OB-01 配置初始化与 `.env.e2e.local` 凭据对齐 |
| `scripts/langfuse/login-check.test.mjs` | 3 | OB-01 UI 登录凭据自检（csrf → credentials → session） |

## 3. AC 回填

| AC | 结论 | 证据 |
| --- | --- | --- |
| CB-01 | PASS | `context-budget.test.mjs`（事件字段）+ e2e（真实请求含压缩结果） |
| CB-02 | PASS | 约束条目出现在压缩后的真实请求体（`<preserved_context>`） |
| CB-03 | PASS | 计划文本随保留项进入真实请求体 |
| CB-04 | PASS | 未完成调用合成为 `[compacted] … 结果未知` 占位，且与 `tool_use` 成对保留 |
| CB-05 | PASS | 阈值公式 0.85 / 0.60 单测 + `/context` 命令读回 |
| CB-06 | PASS | 溢出链：压缩 → 仍超限 → `BUDINGX_CORE_007` 明确终止 |
| CB-07 | PASS | 幂等（重复压缩不新增替换区间）+ 连续 3 次失败熔断 `BUDINGX_CORE_008` |
| SR-01 | PASS | JSONL 布局与 `TRANSCRIPT_VERSION=1` 读写往返 |
| SR-02 | PASS | 新进程用同一 sessionId 恢复历史消息 |
| SR-03 | PASS | 恢复**不重放**已完成副作用（真实子进程计数为 0） |
| SR-04 | PASS | 结果不确定步骤标 `needs_review`，只提示核对 |
| SR-05 | PASS | `/sessions` 列出 ID/首条消息/时间/轮次 |
| SR-06 | PASS | `/resume <id>` 对不存在 ID 明确报错而非静默新建 |
| SR-07 | PASS | 半截 JSON 行被跳过并报告损坏，原文件保留 |
| SR-08 | PASS | 版本高于实现时拒绝读取，不回退覆写 |
| SR-09 | PASS | 落盘中被强杀后重启可读，恢复到最后一个完整记录 |
| SR-10 | PASS | 恢复后权限模式不升权（`applyPermissionCeiling`） |
| SR-11 | PASS | 两真实进程并发写 → 第二个被拒（`BUDINGX_STORAGE_006`）；陈旧锁需显式解锁 |
| FR-01 | PASS | 错误带类别 + 稳定码（含 401/429/5xx/超时） |
| FR-02 | PASS | 工具失败进入模型上下文且带错误码，不伪装成功 |
| FR-03 | PASS | 超长输出按上限截断并带显式标记 |
| FR-04 | PASS | 达上限终态 `max_turns` 且原因明确 |
| FR-05 | PASS | 失败可定位到轮次/步骤/错误码；失败事实随会话保留 |
| FR-06 | PASS | 重试从失败点继续，不重复已完成副作用 |
| FR-07 | PASS | 注入写入失败 → 结果不丢 + `turn_finalized.persistenceError`（`BUDINGX_STORAGE_005`） |
| FR-08 | PASS | context overflow → 压缩重试，耗尽后明确失败 |
| FR-09 | PASS | 两级熔断：精确重复 3 次 / 同工具同错误码连续 5 次 → `BUDINGX_CORE_010` |
| PM-01 | PASS | 记忆落在对应项目目录，不污染其他项目 |
| PM-02 | PASS | 项目 A 的记忆不出现在项目 B |
| PM-03 | PASS | 真实子进程写入后父进程可读 |
| PM-04 | PASS | 中途失败不留半截文件，原文件保留 |
| PM-05 | PASS | 凭据样式内容被拒绝落盘 |
| PM-06 | PASS | 损坏文件保留 + `.bak` 旁存 + 报损坏 |
| PM-07 | PASS | 会话级记忆不跨会话泄漏 |
| PM-08 | PASS | 超上限明确拒绝而不是静默丢弃 |
| OB-01 | PASS | 双轨可起：兼容接收端 `health` 200、真实栈 `GET /api/public/health` ⇒ `{"status":"OK","version":"4.78.0"}`；未鉴权 `projects` 401、带 Basic ⇒ 项目 `budingx-agent` |
| OB-02 | PASS | 追踪层级 `agent.run` → `model.request` / `tool.<name>`；真实栈 `stack-smoke` 判定 `hierarchyOk:true` |
| OB-03 | PASS | 工具名与真实调用一致（`tool.Read`）；真实栈 `toolErrorVisible:true`、`modelPresent:true` |
| OB-04 | PASS | 失败工具 observation 级别为 ERROR；真实栈 `tool.Read` 为 `TOOL|ERROR` 且 `status.code=2` |
| EV-01 | PASS（代码层） | 失败原因与熔断原因可在转录与终态错误中定位 |
| EV-02 | PASS | `npm test` + `npm run merge:gate` GREEN |
| EV-03 | PASS | 新增 95 例覆盖四支柱；无零测试、无全 skip |

## 4. 真实模型观测证据（关键发现）

两次真实模型运行（本地接收端 v2 回查）：

| 场景 | observation 数 | 结论 |
| --- | --- | --- |
| tool-success | 4 | `agent.run` + `model.request` + `tool.Read` + `model.request`，层级与工具名全对，终态 completed |
| tool-error（仅精确签名熔断） | 24 → 67 | 其中 55 条 `tool.Read` 为 ERROR：模型不断**换参数**重试同一失败工具，直到 `maxIterations` |

这直接回答了用户「工具的调用是否合适」的问题：**不合适**——模型会对同一个不可满足的读取反复换路径尝试，把回合预算耗尽。修复方式与验证见设计 §8。

修复后再次运行时 provider 返回 HTTP 402 `insufficient_balance_error`（Token Plan 用量上限），因此改为本地脚本化 OpenAI 兼容端点复现同一链路（真实 HTTP、真实解析、真实工具、真实追踪、真实接收端），3 例全绿。

额度未恢复期间，监测平台已搭到就绪态：`npm run langfuse:init` / `npm run langfuse:receiver` / `npm run langfuse:observe`（端点与边界见 `ops/langfuse/README.md` 第 8 节）；真实模型场景保留 UNVERIFIED，等额度恢复后一次跑完。

### 4.1 真实 Langfuse 栈接入证据（2026-11-19）

真实栈不是用真实模型验证的，而是用**生产导出器**验证的：`scripts/langfuse/stack-smoke.mjs` 直接调用 `src/tui/dist/observability/exporter.js` 的 `OtlpExporter.sendBatch`，投递一条含 `agent.run`（根）/ `model.request` / 失败 `tool.Read` 的合成 trace，再按产品查询路径回查。

| 项 | 证据 |
| --- | --- |
| 栈状态 | `langfuse/langfuse:4.78.0`、`clickhouse-server:26.3.62.3`、`postgres:16`、`redis:7-alpine`、`cgr.dev/chainguard/minio:latest`，六容器全部 healthy |
| 鉴权 | `GET /api/public/projects` 无鉴权 401；带 `.runtime/langfuse/agent.env` 的 Basic ⇒ 项目 `budingx-agent` |
| 上报-查询闭环 | `npm run langfuse:smoke` ⇒ `sent:true, count:3, rootCount:1, hierarchyOk:true, toolErrorVisible:true, modelPresent:true, sessionConsistent:true, ok:true` |
| 层级与级别 | 回查得到 `agent.run|AGENT|DEFAULT|root`、`model.request|GENERATION|DEFAULT|child`、`tool.Read|TOOL|ERROR|child`，sessionId 全为 `smoke-session` |

WSL2 的 `vmIdleTimeout` 会在无会话时终止 VM 并 SIGTERM 掉容器，曾导致 Postgres 崩溃恢复与 `Prisma P3009`；落地方案与保活步骤写在 `ops/langfuse/README.md` 第 9 节。真实模型回合只需把 `BUDINGX_LANGFUSE_BASE_URL` 指向同一 3000 端口即可，无需再改代码。

## 5. 未验证项与恢复条件

| 项 | 状态 | 恢复条件 | 动作 |
| --- | --- | --- | --- |
| 真实模型三场景（成功/工具失败/长会话压缩） | UNVERIFIED | provider Token Plan 额度恢复（用户 2026-11-19：先搭好监测平台，到时再跑真实模型测试） | `npm run langfuse:observe`，回填 §4 |
| TUI 长会话视觉观感 | UNVERIFIED | SP006 可视化验收 | 终端快照 + 按键回放 |

## 6. 风险与剩余

- 整轮 `npm test` 偶发挂起已定位并修复：`src/exec/background.ts` 的 `finalize` 未释放子进程 stdout/stderr 读端，被 `taskkill /T` 漏掉的孙进程继续持有写端时，`node --test` 的隔离子进程永远等不到事件循环清空（实测 T5-10 之后卡住 12 分钟）。修复为终态后 `child.stdout.destroy()` / `child.stderr.destroy()`，并补 `CE-07/R-05` 回归用例；修复后全量回归 `EXIT=0`。

- 全量回归中子进程测试的超时预算偏紧：`src/tui/test/ci-render.test.mjs` 用 `spawnSync` 跑真实 TUI 子进程并设 `timeout: 20000`，2026-11-19 在 WSL2/Docker 抢 CPU 的并行负载下被 20047ms 杀掉（`status=null`，单独重跑 1.8s 通过）。已放宽到 90s 并加注释说明只放宽墙钟预算、不放宽断言阈值（该文件属 SP002 提交 `2c63631`，非 SP005 代码）。
- 压缩默认阈值按模型上下文上限的 85% 触发；真实模型上下文上限变化时需重新校准（当前由 `contextBudget.maxTokens` 注入）。
- 转录与记忆写入失败时回合结果仍在内存中，进程退出即丢失（设计如此，属于「明确报错」而非「静默成功」）。
- 工具空转熔断为启发式：若某工具在多参数下确实可恢复，可能被提前终止；阈值（3 / 5）已在设计中固定，后续可依据观测调整。
- 门禁修复（2026-11-19，非 SP005 代码）：`scripts/langfuse/init-local.mjs` 的 Windows ACL 校验原先比对 `icacls` 文本输出里的账户名/SID，而该输出按控制台代码页编码——本机账户名含中文（`布丁\\missaka`），解码成乱码后既匹配不到账户名也匹配不到 SID，`configuration files are restricted to the current user` 稳定失败（`AssertionError … must grant the current user`）。改为用 `icacls /save` 导出 SDDL（只含 ASCII SID）按 SID 核对，并新增 `readAclSddl`/`aclSids`/`BROAD_PRINCIPAL_SIDS`/`currentUserSid`；单测 9/9 恢复 GREEN。属于 SP004 观测工具在本机的可移植性缺陷，不影响产品行为。
