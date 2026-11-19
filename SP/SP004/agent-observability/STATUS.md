# agent-observability · STATUS

## 当前状态

| 项 | 值 |
| --- | --- |
| 需求 slug | `agent-observability` |
| 所属 SP | SP004（优化需求，2026-11-19 追加） |
| 需求版本 | v0.3（含验收回填） |
| 设计版本 | v1.2 |
| 实施计划版本 | v1.2 |
| 生命周期 | **VERIFYING**（实施完成，代码验证全绿；真实部署/live 三场景 UNVERIFIED） |
| 阶段 | 需求 ✅ → 设计 ✅ → 计划 ✅ → 文档自审 ✅ → 实施 ✅ → 测试 ✅（代码层）→ 交付 ⏳ |
| 功能分支 | `feature/SP004/real-coding-task`（沿用 SP004 分支，未新建） |
| 设计文档 | [design/design.zh.md](./design/design.zh.md)（本需求自有设计，独立于 SP004 主设计） |
| 实施计划 | [design/plan.zh.md](./design/plan.zh.md) |
| AC 总数 | 28 条（OB-01 … OB-28）；代码/结构/判定逻辑 26 条 PASS，OB-04/OB-24 UNVERIFIED |
| Git 范围 | T26–T33 多个中文提交于 SP004 功能分支；**未合入 master、未推送**（待用户验收与门禁） |

## 授权与来源

| 来源 | 原话 / 精确出处 | 覆盖范围 |
| --- | --- | --- |
| USER_CONFIRMED（2026-11-19 用户会话） | 「SP004中需要加一项优化需求，参照D:\extra_project\buding-worker-space里搭建Langfuse的监控体系，直接照搬这套监控即可，你先不要实现，先产出文档，走SDD流程，算SP004的优化需求」 | 需求立项、参考对象、文档优先、不实施 |
| USER_CONFIRMED（2026-11-17 委托） | 设计文档为 Agent 自审对象；自审通过即含从 master 建分支、计划/实施/测试/交付自主推进、各阶段本地提交（中文说明）、交叉验证门禁 GREEN 后合入 master 并自主推送 | 后续阶段（**本轮用户明确「先不要实现」，故未启动**） |
| USER_CONFIRMED（2026-11-19 用户会话） | 「你先不要实现，先产出文档」 | **实施暂停**：本轮仅产出需求 + 设计 + 计划文档，不写产品代码、不创建分支、不提交 |
| 路线图 | `docs/iteration-plan.md` SP004 行 — USER_CONFIRMED | 本需求作为 SP004 的**追加优化需求**，不新增 SP 编号、不改变 SP004 出口门槛 |
| 参考仓只读审计 | `ops/langfuse/`、`scripts/langfuse/`、`vscode_plugin/src/host/observability/`、`src/server/services/langfuseRuntime.ts`、`SP/SP01/agent-observability/STATUS.md` | 行为锚点 A-01…A-15；**只读参考，不复制源码** |

本轮授权（2026-11-19 用户会话）：按四个 P1 与两处口径问题修订并自审需求、设计、实施计划、STATUS 和 SP004 汇总。沿用本机 Langfuse 与直接 OTLP/HTTP，暂不接 LangChain，实施继续暂停。

## 文档产出清单

| 文件 | 状态 | 说明 |
| --- | --- | --- |
| [requirements.md](requirements.md) | ✅ v0.2 | 目标、参考对照与 28 条 AC |
| [STATUS.md](STATUS.md) | ✅ | 本文件 |
| [design/design.zh.md](./design/design.zh.md) | ✅ v1.2 | 正式设计 |
| [design/plan.zh.md](./design/plan.zh.md) | ✅ v1.2 | T25–T33 实施计划 |
| `../requirements-summary.md` | ✅ | 需求索引新增本需求行 + 变更记录 |

## 阶段勾选

- [x] 需求整理（目标/边界/AC/参考对照）
- [x] 正式设计（design.zh.md）
- [x] 实施计划（plan.zh.md）
- [x] 文档自审（核对四项 P1、后台上报口径与版本状态）
- [x] 实施（T25–T32：Core 端口/Session 接线、脱敏、运行时/OTLP 导出器、宿主装配、部署资产、验收脚本）
- [x] 测试收口（代码层）：全量 `npm test` 775 项 773 通过 0 失败；AST 复核命中 0
- [ ] 交付与合入（待用户验收 + 交叉验证门禁 GREEN；真实部署/live 三场景 UNVERIFIED）

## 实施与验证证据（T33，2026-11-19）

| 任务 | 产物 | 验证 |
| --- | --- | --- |
| T26 | `src/core/observability.ts` 纯端口 + Session 回合/模型/工具埋点、根正文 | `src/core/test/observability.test.mjs` 15/15 |
| T27 | `src/observability/redact.ts` 先脱敏后裁剪 | `src/observability/test/redact.test.mjs` 13/13 |
| T28 | config/context/exporter/runtime/index | `src/observability/test/exporter.test.mjs` 24/24 |
| T29 | `setupTracing` 宿主装配 + cli 限时 flush + 边界规则 | `src/tui/test/observability-wiring.test.mjs` 8/8；TUI 全套 206 无回归 |
| T30 | `ops/langfuse/compose.yaml`、`init-local.mjs`、`control.ps1`、README | `scripts/langfuse/init-local.test.mjs` + `compose.test.mjs` 18/18（含 Windows 真实 DACL） |
| T31 | 本机隔离部署尝试 | **UNVERIFIED**：ClickHouse fresh-migration 脏失败；已清理，未伤参考栈 |
| T32 | `verify-agent.mjs` + 判定纯函数 | `scripts/langfuse/verify-agent.test.mjs` 20/20（替身）；live UNVERIFIED |
| T33 | 全量回归 + AST 复核 + 回填 | `npm test` 775/773/0/2skip；AST 命中 0 PASS |

**全量复测**（用户要求「确保交付完整产品」）：`npm test` = skills 10 + spec 11 + unit 694 + langfuse 38 + release 17 + merge 5 = **775 项，773 通过，0 失败，2 既有 skip**；`npm run test:checks` 模块边界通过。新增观测相关用例 98 项（core 15 + redact 13 + exporter 24 + wiring 8 + langfuse 38）全部通过。

**AST 独立来源复核**：首轮命中 2（config 加载器/exporter 发送），按设计 §9.3 从行为规格独立重构后复跑 **命中 0，PASS**（21389 组函数对）。详见 [../ast-review.md](../ast-review.md)。

## 独立实现与复用边界

- 参考仓为**未开源**（无 LICENSE、`package.json` 无 license 字段），本仓制品保持自有 MIT 独立可发布。
- 本轮**只读审计行为事实**，未复制、未改名改写参考仓任何源码；实现须独立编写。
- 参考仓依赖 `@langfuse/otel`、`@opentelemetry/api`、`@opentelemetry/sdk-trace-base`；本轮**改用自建 OTLP 导出器**（设计 §4.3 偏离说明 R-01），不引入这三项依赖，避免改变 npm 制品构成。
- **R-01 已核验（2026-11-19）**：不引入 OTel SDK **对监控效果无实质影响** —— ① 参考仓 OTel 版全仓搜 `registerInstrumentations`/`NodeSDK`/`setGlobalTracerProvider`/baggage **零命中**，只用 `BasicTracerProvider` + `LangfuseSpanProcessor`，即 OTel 的真正价值（自动插桩、跨进程上下文传播）**参考仓自己也没用**；② Langfuse 的**属性映射在服务端完成**，客户端按 OTLP JSON 发对字段即可，本轮全部属性已逐条核对官方映射表；③ 唯一损失的后台定时批量，由「回合结束交给有界后台一次性投递」覆盖。重新评估触发条件见[设计 §9.2](./design/design.zh.md)。
- 复用本仓 Session、Provider 与只读工具生产契约。追踪脱敏在 observability 内独立实现。
- AST 独立来源复核：本轮**尚未执行**（无代码产出）；实施阶段须按 SP004 §9.8 同口径执行并计入合并门禁。

## 未验证项与风险

| 项 | 状态 | 恢复条件 |
| --- | --- | --- |
| 本机 Docker/WSL 可用性 | **已实测可用** | WSL Ubuntu Docker 29.1.3 + Compose 2.40.3；镜像已缓存（mirror.gcr.io） |
| Langfuse 真实部署健康（OB-04） | **UNVERIFIED** | 隔离实例 ClickHouse fresh-migration 在 version 40 反复脏失败、Web 重启循环；需在无竞争实例且迁移可正常完成的环境重跑 `control.ps1 -Action start`。非观测代码缺陷 |
| 真实模型三场景（OB-24） | **UNVERIFIED** | 需部署成功 + 用户提供 `BUDINGX_SMOKE_MODEL_KEY`/`_BASE_URL`/`_MODEL`；当前环境变量未设置，未读取真实密钥 |
| Langfuse 平台侧观测可查询（OB-25/26/27 live） | **UNVERIFIED** | 依赖部署成功 + 平台 API 可达；判定逻辑已经 20 项替身测试 |
| 真实平台/生产高可用部署 | **NOT_APPLICABLE** | 本轮定位为本机开发期监控 |

风险：

- **R-01** 引入 OTel 依赖会改变 npm 制品构成 → 设计已改为自建导出器，不新增运行时依赖。
- **R-02** 追踪影响主循环 → 收尾只入有界队列，后台单请求和正常退出 flush 各有 3 秒上限。
- **R-03** 正文泄漏业务机密 → 默认关闭，开启时先脱敏再裁剪并校验最终 JSON。
- **R-04** 本机凭据误入 Git → 全部落在 `.runtime/langfuse/`（Git 忽略）；AC OB-28 专测。
- **R-05** 参考仓「照搬」诉求与「独立实现」约束冲突 → 以**行为等价**为目标，机制读、代码独立写；偏离逐条登记（设计 §9）。

## 文档自审 · 2026-11-19

| 审查项 | 自审结论及追溯 |
| --- | --- |
| 正文脱敏 | OB-17…OB-19、设计 §4.4 与 T27 一致。两个裁剪分支均只使用脱敏结果，超长含合成凭据场景已列入回归 |
| 平台回查 | OB-24…OB-27、设计 §4.8 与 T32 一致。按 v2 字段校验预期节点、级别、父子和会话，适用的正文校验纳入退出码 |
| Core 接线 | OB-11…OB-15、设计 §4.2 与 T26 一致。实际回合创建根，子观测显式传父句柄，覆盖排队、注入与取消 |
| 文件权限 | OB-01…OB-02、设计 §4.7 与 T30 一致。写入前建立权限并验证，覆盖 POSIX 模式和 Windows DACL |
| 上报生命周期 | OB-20、OB-22、OB-23、设计 §4.3/§4.10 与 T28/T29 一致。回合无需等待后台请求，正常退出总预算为 3 秒 |
| 版本与范围 | 需求 v0.2、设计 v1.2、计划 v1.2 和 SP004 汇总对齐。文档自审通过，实施、测试、交付均暂停 |

## 交付与恢复

实施与代码层测试已完成（T25–T33），全量复测全绿、AST 命中 0。**未合入 master、未推送**——待用户验收与交叉验证门禁 GREEN 后按 buding-merge 合入并推送（2026-11-17 委托范围内）。

真实部署（OB-04）与 live 三场景（OB-24）为 UNVERIFIED，恢复条件见上表。这两项不阻塞代码交付，但**完整产品验收**需用户在可正常部署 Langfuse 的环境提供模型凭据后补跑 `node scripts/langfuse/verify-agent.mjs`。

## 变更记录

| 日期 | 范围或状态变化 | 原因/来源 | 影响及处理 |
| --- | --- | --- | --- |
| 2026-11-19 | 建立 `agent-observability` 优化需求目录；产出 requirements v0.1 + STATUS；产出设计 v1.0 / 计划 v1.0（本需求自有文档） | 用户会话「SP004 中需要加一项优化需求……直接照搬这套监控即可，你先不要实现，先产出文档，走 SDD 流程」 | 仅文档产出；实施暂停待用户放行 |
| 2026-11-19 | R-01 可行性核验：不引入 OTel SDK 对监控效果无实质影响；设计升 v1.1 | 用户会话「不引入会对监控有影响吗」 | 仅文档补充；技术路线不变 |
| 2026-11-19 | 需求 v0.2、设计与计划 v1.2 文档自审通过 | 用户要求修正四个 P1 及上报、版本口径 | 实施暂停 |
| 2026-11-19 | **实施完成（T25–T33）**：Core 端口/Session 接线、脱敏、运行时/OTLP 导出器、宿主装配、部署资产、验收脚本；全量 `npm test` 775/773/0/2skip；AST 首轮命中 2 → 独立重构后命中 0 PASS | 用户会话「你先做SP004的优化需求吧……你做完后再全量复测一下，确保交付给我的是完整的产品」 | 代码层全绿；真实部署 ClickHouse fresh-migration 脏失败记 UNVERIFIED 并清理（未伤参考栈）；live 三场景需用户凭据记 UNVERIFIED；未合入 master/未推送 |
