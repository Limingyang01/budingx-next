# long-session-reliability · STATUS

## 当前状态

| 项 | 值 |
| --- | --- |
| 需求 slug | `long-session-reliability` |
| 所属 SP | SP005（长会话与数据可靠性） |
| 需求版本 | v0.2（FR-09 / CB-04 实现期补记） |
| 设计版本 | v1.1（新增 §4.8 配对要求、§8 工具空转熔断） |
| 实施计划版本 | v1.1（T0–T14 完成事实回填、映射表改为真实路径） |
| 生命周期 | **VERIFYING**（测试全绿、交付记录就绪；**合入 master 等用户决定**） |
| 阶段 | 需求 ✅ → 设计 ✅ → 计划 ✅ → 文档自审 ✅ → 实施 ✅ → 测试 ✅ → 交付记录 ✅ → 合入 ⏸ 等用户 |
| 功能分支 | `feature/SP005/long-session-reliability`（从 master `17afe34` 建） |
| 设计文档 | [design/design.zh.md](./design/design.zh.md) |
| 实施计划 | [design/plan.zh.md](./design/plan.zh.md) |
| 验收报告 | 轮次结论 [SP/SP005/test-report.md](../test-report.md)；逐条细节 [test-report.md](./test-report.md) |
| AC 总数 | 42 条（CB-01…07 共 7、SR-01…11 共 11、FR-01…09 共 9、PM-01…08 共 8、OB-01…04 共 4、EV-01…03 共 3） |
| Git 范围 | 功能分支本地提交；**未合入 master、未推送** |

## 授权与来源

| 来源 | 原话 / 精确出处 | 覆盖范围 |
| --- | --- | --- |
| USER_CONFIRMED（2026-11-19 本轮会话） | 「开始SP005，做完后跑端到端的测试，测试过程你可以使用langfuse去看看测试的效果以及工具的调用是否合适，你在本地搭好langfuse的监测」 | 启动 SP005 正式 SDD；端到端测试；本地 Langfuse 监测 |
| USER_CONFIRMED（2026-11-19 本轮会话） | 「测试完成后待我决定后再合入master分支」 | **合入 master 由用户决定**，Agent 不自行合入 |
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
| 观测 | `scripts/langfuse/local-receiver.mjs`（Langfuse 兼容接收端）、`scripts/langfuse/sp005-observation.mjs`（真实回合观测与判读） |

## 关键决定

1. **core 不 import storage**：转录端口声明在 `src/core/transcript.ts`，实现在 `src/storage/session-transcript.ts`；`npm run test:checks` 守护该边界。
2. **camelCase 记录字段**：转录与记忆的落盘字段沿用仓库既有的 camelCase 风格（`sessionId`、`occurredAt`），不引入 snake_case 映射层。
3. **needs_review 即「不盲重放」**：恢复时 `tool_step.status` 为 `needs_review` 的步骤只提示核对，不重跑；`completed` 的步骤一律不重放。
4. **本机无 Docker/WSL**：真实 Langfuse 栈不可用，改为仓内 Langfuse 兼容接收端（OTLP 接入 + v2 查询），SP004 的 `verify-agent.mjs` / `query-traces.mjs` 未改一行即可用。
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
| 真实回合观测 | 待额度 | `npm run langfuse:observe`（402 期间不跑，脚本会在缺 key/配置时明确报错） |
| 文档 | 就绪 | `ops/langfuse/README.md` 第 8 节（端点表、边界、两种端到端用法） |

## 未验证项与恢复条件

| 项 | 状态 | 恢复条件 |
| --- | --- | --- |
| 真实模型端到端（三场景） | **UNVERIFIED** | provider 侧 Token Plan 额度恢复（当前 HTTP 402 `insufficient_balance_error`）后重跑 `npm run langfuse:observe`；用户 2026-11-19 决定「先搭好监测平台，到时再跑真实模型测试」 |
| 真实 Langfuse 服务端（Docker/WSL） | **UNVERIFIED** | 本机具备 Docker 或 WSL2 发行版后按 `ops/langfuse/README.md` 启动，用同一 `query-traces.mjs` 复核 |
| TUI 长会话的像素级观感 | **UNVERIFIED** | 归 SP006 可视化验收 |

## 下一步

1. 等用户决定是否合入 master（`npm run merge:gate` 已 GREEN）。
2. provider 额度恢复后补跑真实模型三场景，把 `sp005-observation` 结果回填本文件与 `test-report.md` §5。
