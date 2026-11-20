# long-session-reliability · STATUS

## 当前状态

| 项 | 值 |
| --- | --- |
| 需求 slug | `long-session-reliability` |
| 所属 SP | SP005（长会话与数据可靠性） |
| 需求版本 | v0.3（FR-09 / CB-04 实现期补记；真实栈与兼容接收端双轨补记） |
| 设计版本 | v1.1（新增 §4.8 配对要求、§8 工具空转熔断） |
| 实施计划版本 | v1.1（T0–T14 完成事实回填、映射表改为真实路径） |
| 生命周期 | **DELIVERED**（测试全绿、真实模型端到端两场景 PASS、交付记录就绪；已合入 master `293a337` 并推送；0.5.0 已发布；0.5.0 发布后的独立复审修复已完成，0.5.1 已发布） |
| 阶段 | 需求 ✅ → 设计 ✅ → 计划 ✅ → 文档自审 ✅ → 实施 ✅ → 测试 ✅ → 交付记录 ✅ → 合入 ✅（master `293a337`）→ 发布 ✅（0.5.0）→ 发布后复审修复 ✅（0.5.1）→ 长会话渲染优化与上下文可见性 ✅（0.5.2 已准备） |
| 功能分支 | `feature/SP005/long-session-reliability`（从 master `17afe34` 建）；复审修复 `feature/SP005/fix-0.5.1`（从 0.5.0 发布后的 master 最新提交建） |
| 设计文档 | [design/design.zh.md](./design/design.zh.md) |
| 实施计划 | [design/plan.zh.md](./design/plan.zh.md) |
| 验收报告 | 轮次结论 [SP/SP005/test-report.md](../test-report.md)；逐条细节 [test-report.md](./test-report.md) |
| AC 总数 | 42 条（CB-01…07 共 7、SR-01…11 共 11、FR-01…09 共 9、PM-01…08 共 8、OB-01…04 共 4、EV-01…03 共 3）；其中 PM-06 与 SR-10 的 0.5.0 证据不足，已由 0.5.1 复审用例补正，见 [SP/SP005/test-report.md](../test-report.md) §9 |
| Git 范围 | 功能分支提交并推送远端（用户 2026-11-20 授权）；**已合入 master**（合并提交 `293a337`，用户 2026-11-20 授权）并推送远端 |

## 授权与来源

| 来源 | 原话 / 精确出处 | 覆盖范围 |
| --- | --- | --- |
| USER_CONFIRMED（2026-11-19 本轮会话） | 「开始SP005，做完后跑端到端的测试，测试过程你可以使用langfuse去看看测试的效果以及工具的调用是否合适，你在本地搭好langfuse的监测」 | 启动 SP005 正式 SDD；端到端测试；本地 Langfuse 监测 |
| USER_CONFIRMED（2026-11-19 本轮会话） | 「测试完成后待我决定后再合入master分支」 | **合入 master 由用户决定**，Agent 不自行合入 |
| USER_CONFIRMED（2026-11-20 本轮会话） | 「有token了，可以跑真实的测试了，测试的同时用langfuse去做监测遇到问题直接修复，完成后提交并推送远端」 | 真实模型端到端、Langfuse 监测、发现问题即修、提交并**推送功能分支**；仍未授权合入 master |
| USER_CONFIRMED（2026-11-20 本轮会话） | 「合入master，并且停止容器」 | **合入 master**（合并提交 `293a337`）与停止本地 Langfuse 容器 |
| USER_CONFIRMED（2026-11-20 本轮会话） | 「合完推送远端，完成发布前的准备工作，到时我直接点发布即可」 | 合入后**推送远端** + 完成 0.5.0 发布准备；实际 npm 上传由用户在 Actions 手动触发 |
| USER_CONFIRMED（2026-11-17 委托） | 设计文档为 Agent 自审对象；自审通过后自主推进计划/实施/测试/交付与各阶段本地提交（中文说明） | 分支、实施、本地提交 |
| 路线图 | `docs/iteration-plan.md` SP005 行（名称、四个功能目录、出口验收、依赖 SP004） | 范围与出口标准 |

## 交付内容

| 支柱 | 主要产物 |
| --- | --- |
| context-budget | `src/core/context-budget.ts`（预算核算、确定性压缩、保留项、幂等与熔断）、`context_compacted` 事件 |
| session-recovery | `src/core/transcript.ts`、`src/storage/session-transcript.ts`、`src/storage/session-store.ts`、`src/storage/private-file.ts` |
| failure-recovery | `src/core/session-persistence.ts`、既有 `Session` 接线（错误码、`persistenceError`、`needs_review`）、两级工具空转熔断 |
| project-memory | `src/storage/project-memory.ts`（项目级/会话级记忆、原子写、凭据拒写、损坏隔离） |
| TUI | `/sessions`、`/resume <id>`、`/context`、`/memory` |
| 观测 | `scripts/langfuse/local-receiver.mjs`（Langfuse 兼容接收端，含只读查看页 `local-ui.html` → `local-ui.mjs`）、`scripts/langfuse/sp005-observation.mjs`（真实回合观测与判读）、`scripts/langfuse/stack-smoke.mjs`（真实栈接入链路冒烟） |

## 关键决定

1. **core 不 import storage**：转录端口声明在 `src/core/transcript.ts`，实现在 `src/storage/session-transcript.ts`；`npm run test:checks` 守护该边界。
2. **camelCase 记录字段**：转录与记忆的落盘字段沿用仓库既有的 camelCase 风格（`sessionId`、`occurredAt`），不引入 snake_case 映射层。
3. **needs_review 即「不盲重放」**：恢复时 `tool_step.status` 为 `needs_review` 的步骤只提示核对，不重跑；`completed` 的步骤一律不重放。
4. **观测平台双轨**：起初本机无 Docker/WSL，改用仓内 Langfuse 兼容接收端（OTLP 接入 + v2 查询，SP004 的 `verify-agent.mjs` / `query-traces.mjs` 未改一行即可用）；2026-11-19 用户要求在 WSL 内装 Docker 后，真实 Langfuse 栈（4.78.0）已落地并完成接入链路验收。接收端保留给无 Docker 的机器与 CI，两者互斥占用 3000 端口。
5. **两级熔断**：真实模型观测证明「换参数重试同一失败工具」会让精确签名熔断失效，因此增加「同工具 + 同错误码连续失败 5 次」这一级。

## 观测平台就绪（本机）

用户 2026-11-19（额度不足时）指示：「目前那个模型好像没有token了，你可以先搭建好监测平台，到时再跑真实模型测试」。据此本轮把监测平台搭到「可一键起、可回查、可复跑」的状态：

| 项 | 状态 | 证据 |
| --- | --- | --- |
| 兼容接收端启动 | 就绪 | `npm run langfuse:receiver`（等效 `node scripts/langfuse/local-receiver.mjs`，默认 `127.0.0.1:3000`） |
| 配置初始化 | 就绪 | `npm run langfuse:init` → `.runtime/langfuse/{local.env,agent.env,login.json}` |
| 健康检查 | 就绪 | `GET /api/public/health` ⇒ `{"status":"OK","version":"local-receiver"}` |
| 鉴权 | 就绪 | 未鉴权 `GET /api/public/v2/observations` ⇒ 401 |
| 观测留存 | 就绪 | span 落盘 `.runtime/langfuse/local-receiver/`，重启回读（重启后 `meta.totalItems=103`） |
| 浏览器查看 | 就绪 | 打开 <http://127.0.0.1:3000/>：按 trace 分组的观测树、级别着色、耗时、input/output、过滤与自动刷新；数据源 `GET /ui/observations` |
| 真实 Langfuse 栈 | 就绪（2026-11-19） | WSL2（Ubuntu 22.04）内 Docker Engine 启动 `budingx-langfuse` 六容器；`GET /api/public/health` ⇒ `{"status":"OK","version":"4.78.0"}`；`/api/public/projects` 用项目 Key 可查 `budingX Agent` |
| 真实栈接入链路 | 就绪 | `npm run langfuse:smoke`：生产导出器投递合成 trace（`agent.run` + `model.request` + 失败 `tool.Read`）→ v2 回查 `hierarchyOk/toolErrorVisible/modelPresent/sessionConsistent` 全 true，报告 `.runtime/langfuse/stack-smoke.json` |
| WSL 保活 | 须知 | WSL2 无会话时按 `vmIdleTimeout` 终止 VM，容器会被 SIGTERM（表现为 Postgres 崩溃、迁移 `Prisma P3009`）；需常驻 `wsl -d <发行版> -u root -- tail -f /dev/null` 或 `%USERPROFILE%\.wslconfig` 设 `vmIdleTimeout=-1` |
| 真实回合观测 | 就绪（2026-11-20 完成） | `npm run langfuse:observe` 两场景 `EXIT=0`：tool-success `calls=1 usage=1228`、tool-error `calls=5 usage=1362`（熔断停机 `BUDINGX_CORE_010`）；trace `66d4179…` / `8043bca…`；报告 `.runtime/langfuse/sp005-observation.json` |
| 工具参数与结果可见 | 就绪（2026-11-20 修复） | 真实栈回查 `tool.Read` 带 `in: {"path":"facts.txt"}`、`out: "1→alpha…"`；`model.request` 带真实 tokens（653/588） |
| 文档 | 就绪 | `ops/langfuse/README.md` 第 8 节（兼容接收端端点表与边界）、第 9 节（WSL2 真实栈落地、保活与 `langfuse:smoke`） |

## 未验证项与恢复条件

| 项 | 状态 | 恢复条件 |
| --- | --- | --- |
| 真实模型长会话压缩（超预算后的自然压缩回合） | **UNVERIFIED** | 需真实模型填满上下文预算；当前用 `context-budget.e2e.test.mjs` 的真实请求体证明压缩内容。补法：在 `sp005-observation.mjs` 增长会话填充场景后重跑 |
| TUI 长会话的像素级观感 | **UNVERIFIED** | 归 SP006 可视化验收 |

## 下一步

1. 已在 master 落地（`293a337`）并推送远端；0.5.0 已通过 [GitHub Actions #20](https://github.com/Limingyang01/budingx-next/actions/runs/44654008000) 的 OIDC 发布，npm `latest` 已核对。见 [0.5.0 发行说明与发布回执](../../../release-notes/v0.5.0.md)。
2. 长会话卡顿已在 `feature/SP005/fix-0.5.2` 修复（流式增量、虚拟列表、状态栏上下文与 effort），证据见 [SP/SP005/test-report.md](../test-report.md) §11。
3. 0.5.0 发布后复审发现的缺陷已在 `feature/SP005/fix-0.5.1` 修复并随 0.5.1 发布（[运行 #21](https://github.com/Limingyang01/budingx-next/actions/runs/44658158215)，源码 `9903776`），修复清单见 [0.5.1 发行说明](../../../release-notes/v0.5.1.md) 与 [SP/SP005/test-report.md](../test-report.md) §9。
2. 真实模型长会话压缩场景补跑后，把结果回填本文件与 `test-report.md` §5。
3. 重启机器后：先 `wsl -d <发行版> -u root -- systemctl is-active docker`，再按 `ops/langfuse/README.md` 第 9 节保活与起栈，最后 `npm run langfuse:smoke` 复核接入链路。
