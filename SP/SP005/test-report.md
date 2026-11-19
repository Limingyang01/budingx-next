# SP005 验收与验证报告 · 长会话与数据可靠性

状态：**代码层验收全绿，交叉验证门禁 GREEN；未合入 master（等用户决定）**。分支 `feature/SP005/long-session-reliability`，文档起点 master `17afe34`，实施提交 `a76199e`。本报告是轮次级结论；逐条细节见 [long-session-reliability 验收报告](long-session-reliability/test-report.md)，配套 [需求](long-session-reliability/requirements.md)、[设计](long-session-reliability/design/design.zh.md)、[实施计划](long-session-reliability/design/plan.zh.md)与 [STATUS](long-session-reliability/STATUS.md)。

## 0. 本轮执行证据

环境：Windows 10 家庭版 10.0.19045 + MSYS bash（无 Docker、无 WSL 发行版、BIOS 未开启虚拟化）；Node.js 见 `node -v`（`package.json` 要求 >=22.18）。所有命令在仓库根执行。

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 构建 | `npm run build` | 通过（tsc，无错误） |
| 单元/功能 | `npm run test:unit` | **713/713 通过**（`node --test src/*/test/*.test.mjs`） |
| 模块边界 | `npm run test:checks` | 通过（`core` 不 import `storage`） |
| 规格自洽 | `npm run spec:check` | 通过（路线图、能力清单与任务清单自洽） |
| 技能入口 | `npm run skills:check` | 通过（Skill entries are current） |
| 观测脚本 | `npm run test:langfuse` | 64/64 通过 |
| 发布脚本 | `npm run test:release` | 17/17 通过 |
| 合入门禁脚本 | `npm run merge:test` | 5/5 通过 |
| 全量 | `npm test` | **820 通过 / 0 失败**（skills 10 + spec 11 + unit 713 + langfuse 64 + release 17 + merge 5，`EXIT=0`，日志 `.runtime/npm-test-full4.log`） |
| 交叉验证门禁 | `npm run merge:gate` | **GATE GREEN**（`artifacts/merge-gate/feature-SP005-long-session-reliability-2026-11-19T13-51-19-581Z.md`；`npm test` / `spec:check` / `skills:check` / `pack-smoke` 全绿） |

本轮新增用例 96 例（12 个测试文件；另含 1 例整轮挂起回归，见 §5），全部对应用例文件与 AC 的映射见 [细节报告 §2](long-session-reliability/test-report.md)。

## 1. 端到端观测与「工具调用是否合适」

本机没有 Docker 也没有 WSL 发行版，真实 Langfuse 栈无法启动。为了让用户要求的「用 Langfuse 看测试效果、看工具调用是否合适」在本机可执行，本轮交付一个 Langfuse 兼容接收端 `scripts/langfuse/local-receiver.mjs`：实现健康检查、OTLP JSON 摄入（`/api/public/otel/v1/traces`，Basic 认证）与 v2 observations 回查，SP004 的 `query-traces.mjs` / `verify-agent.mjs` 未改一行即可使用。启动与端点见 `ops/langfuse/README.md` 第 8 节，命令为 `npm run langfuse:init` → `npm run langfuse:receiver` → `npm run langfuse:observe`。

已实测的接收端行为：`GET /api/public/health` 返回 `{"status":"OK","version":"local-receiver"}`；未鉴权 `GET /api/public/v2/observations` 返回 401；观测按 span 落盘 `.runtime/langfuse/local-receiver/`，重启不丢（重启后回查 `meta.totalItems=103`）。

浏览器查看：启动接收端后打开 <http://127.0.0.1:3000/>，即可按 trace 查看观测树（`agent.run` → `model.request` / `tool.<Name>`）、级别着色、耗时与 input/output，支持过滤与自动刷新；数据源是同进程的 `GET /ui/observations`。

真实模型侧的关键结论（进入设计 §8 与需求 FR-09 的原因）：

| 场景 | 观测结论 | 结果 |
| --- | --- | --- |
| tool-success（真实模型） | `agent.run` 唯一根，`model.request`、`tool.Read`、`model.request` 层级与工具名全对，终态 completed | PASS |
| tool-error（真实模型） | 55 条 `tool.Read` 为 ERROR：模型不断**换参数**重试同一个不可满足的读取，直到耗尽迭代预算 | 不合适的工具调用，已修（两级空转熔断） |
| 修复后真实模型复跑 | provider 返回 HTTP 402 `insufficient_balance_error`（Token Plan 用量上限） | UNVERIFIED |

额度耗尽后，以本地脚本化 OpenAI 兼容端点复现同一条链路（真实 HTTP 请求、真实解析、真实工具执行、真实追踪上报、真实接收端回查），`scripts/langfuse/sp005-observation.e2e.test.mjs` 3/3 通过，覆盖 OB-02/OB-03 与 FR-09；该证据证明链路正确，不替代真实模型效果验收。

## 2. 42 条 AC 回填

AC 区间：CB-01…07（7）、SR-01…11（11）、FR-01…09（9）、PM-01…08（8）、OB-01…04（4）、EV-01…03（3），共 **42 条**。验证层：L0 纯逻辑/契约、L1 真实进程或真实 HTTP、L2 端到端。

| 分组 | AC | 结论 | 主要证据 |
| --- | --- | --- | --- |
| context-budget | CB-01…07 | 7/7 PASS | `src/core/test/context-budget.test.mjs`(11)、`context-budget.e2e.test.mjs`(3，真实请求体) |
| session-recovery | SR-01…11 | 11/11 PASS | `src/storage/test/session-transcript.test.mjs`(12)、`session-recovery.e2e.test.mjs`(4，真实子进程) |
| failure-recovery | FR-01…09 | 9/9 PASS | `src/core/test/failure-recovery.test.mjs`(8)、`tool-loop-breaker.test.mjs`(4)、`session-persistence.test.mjs`(11) |
| project-memory | PM-01…08 | 8/8 PASS | `src/storage/test/project-memory.test.mjs`(12)、`src/tui/test/sp005-commands.test.mjs`(14) |
| 观测 | OB-01…04 | 4/4 PASS | `scripts/langfuse/local-receiver.test.mjs`(3)、`sp005-observation.test.mjs`(10)、`sp005-observation.e2e.test.mjs`(3) |
| 端到端与交付 | EV-01…03 | 3/3 PASS（EV-01 代码层） | 本报告 §0、§1；`npm test` + `npm run merge:gate`；失败原因可在转录与终态错误中定位 |

逐条证据（CB/SR/FR/PM/OB/EV 每一行）见 [细节报告 §3](long-session-reliability/test-report.md)。

## 3. 交付物与文档同步

| 类别 | 产物 |
| --- | --- |
| 产品代码 | `src/core/context-budget.ts`、`transcript.ts`、`session-persistence.ts`、`session.ts` 接线；`src/storage/{private-file,session-transcript,session-store,project-memory}.ts`、`atomic.ts`（`writeTextAtomic`） |
| 命令面 | `/sessions`、`/resume <id>`、`/context`、`/memory`（`src/tui/commands.ts`、`runtime.ts`） |
| 观测 | `scripts/langfuse/local-receiver.mjs`、`sp005-observation.mjs` 与两个配套测试；`ops/langfuse/README.md` 第 8 节；`package.json` 新增 `langfuse:init`/`langfuse:receiver`/`langfuse:observe` |
| 文档 | `PRODUCT.md` 5.5 节与已知限制、`docs/iteration-plan.md` SP005 行、`docs/agent-capability-matrix.md` 五行能力状态、本轮需求/设计/计划/STATUS |

## 4. 未验证项与恢复条件

| 项 | 状态 | 恢复条件 | 恢复动作 |
| --- | --- | --- | --- |
| 真实模型三场景（成功 / 工具失败 / 长会话压缩） | UNVERIFIED | provider Token Plan 额度恢复（当前 HTTP 402 `insufficient_balance_error`）；用户 2026-11-19 明确「先搭好监测平台，到时再跑真实模型测试」 | `npm run langfuse:receiver` 已在跑时执行 `npm run langfuse:observe`，把结果回填 [细节报告 §4](long-session-reliability/test-report.md) 与本报告 §1 |
| 真实 Langfuse 服务端（Docker/WSL 栈，含 UI 与 ClickHouse） | UNVERIFIED | 本机具备 Docker 或 WSL2 发行版 | 按 `ops/langfuse/README.md` 第 1–7 节起栈，用 `scripts/langfuse/query-traces.mjs` 复核同一批追踪 |
| TUI 长会话的像素级观感（`/context`、会话选择器） | UNVERIFIED | SP006 可视化验收 | 终端快照 + 按键回放 |

以上三项不影响本轮代码层验收结论：链路、协议、隔离、原子写与失败语义均有 L0/L1 证据。

## 5. 风险与剩余

- 整轮 `npm test` 偶发挂起已修复：`src/exec/background.ts` 终态后释放子进程 stdout/stderr 读端（被终止的孙进程仍持有写端时句柄不收敛，`node --test` 子进程会一直等事件循环清空，实测卡住 12 分钟），新增 `src/exec/test/background.test.mjs` 的 `CE-07/R-05` 用例；修复后全量 `npm test` 为 `EXIT=0`。
- 压缩默认阈值按模型上下文上限的 85% 触发、60% 目标；模型上下文上限变化时需重新校准（由 `contextBudget.maxTokens` 注入）。
- 转录与记忆写入失败时回合结果仍留在内存，进程退出即丢失——这属于「明确报错」而非「静默成功」，错误码 `BUDINGX_STORAGE_005`。
- 工具空转熔断是启发式（精确签名 3 次 / 同工具同错误码 5 次）；若某工具在多参数下确实可恢复，可能被提前终止，阈值后续可依观测调整。
- 兼容接收端不是 Langfuse 本体：只有只读查看页，无 ClickHouse、无登录与项目管理，只能证明上报与查询链路正确，不替代真实栈验收（真实栈选项与阻塞条件见 §4 第二行）。

## 6. 授权与集成状态

- 启动与端到端测试授权：用户 2026-11-19「开始SP005，做完后跑端到端的测试……你在本地搭好langfuse的监测」。
- 合入约束：用户 2026-11-19「测试完成后待我决定后再合入master分支」→ 本分支仅本地提交，**未合入 master、未推送 master**。
- 交付记录：本报告、[细节报告](long-session-reliability/test-report.md)、[STATUS](long-session-reliability/STATUS.md) 与 [requirements-summary](requirements-summary.md) 同步维护。
