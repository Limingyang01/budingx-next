# SP005 · 长会话与数据可靠性

状态：**VERIFYING（实施与测试完成，真实模型端到端两场景 PASS、监测平台就绪，合入 master 等用户决定）**｜功能分支 `feature/SP005/long-session-reliability`（已推送远端）｜实施基线 `17afe34`（master）｜轮次验收报告 [SP005/test-report.md](test-report.md)

## 本轮目标与边界

- 目标：让 budingx 在长会话与数据可靠性上达到可验收基线——① 会话可落盘并在新进程恢复且**不盲重放副作用**；② 上下文超限时按确定性规则压缩并**保留约束/计划/工具状态**；③ 长任务失败给出**可定位的失败原因**；④ 项目记忆按项目隔离、原子持久化；⑤ 本机可观察端到端回合以判读工具调用是否合适。
- 出口门槛（路线图 SP005，USER_CONFIRMED）：「压缩保留约束/计划/工具状态；跨进程恢复不盲重放副作用；项目记忆/会话隔离、原子持久化、升级/备份和共享写入约束有 fixture 与真实进程证据；明确长任务失败原因。」
- 功能目录（沿用路线图命名，本轮合为一个需求目录 [long-session-reliability](long-session-reliability/requirements.md) 的四个支柱）：context-budget、session-recovery、failure-recovery、project-memory。
- 清单对应：CAP-L2-04（终端及后台任务）、CAP-L2-07（指令与项目记忆）、CAP-L3-12（长上下文与恢复）、CAP-L3-14（会话管理）、CAP-L3-16（多端共享边界）。
- 不包含：完整斜杠命令面与系统提示词蒸馏（SP006）、子代理与后台任务六件套（SP007）、多端共享契约实现（SP008）、Desktop/VS Code/远程/IM（r8 范围外）。
- 输入基线：master `17afe34`（SP004 已随 0.4.0 发布）。
- 依赖与启动条件：
  - USER_CONFIRMED（2026-11-19）：「开始SP005，做完后跑端到端的测试，测试过程你可以使用langfuse去看看测试的效果以及工具的调用是否合适，你在本地搭好langfuse的监测」→ 授权启动本轮 + 端到端测试 + 本地观测。
  - USER_CONFIRMED（2026-11-19）：「测试完成后待我决定后再合入master分支」→ **合入 master 由用户决定**，与 2026-11-17 的一般委托冲突时以本条为准。
  - USER_CONFIRMED（2026-11-19）：「目前那个模型好像没有token了，你可以先搭建好监测平台，到时再跑真实模型测试」→ 本轮先把监测平台搭到可一键起/可回查（`npm run langfuse:receiver` 等三条命令），真实模型场景等额度恢复后补跑。
  - USER_CONFIRMED（2026-11-20）：「有token了，可以跑真实的测试了，测试的同时用langfuse去做监测遇到问题直接修复，完成后提交并推送远端」→ 真实模型端到端 + Langfuse 监测 + 发现问题即修 + 推送功能分支；未授权合入 master。
  - USER_CONFIRMED（2026-11-20，早前）：「半个小时后token就有了，到时你可以跑端到端的自测，并且使用langfuse监测问题，发现问题及时修复，完成后推送代码到远端，先不合入master,推送功能分支到远端即可」。
  - USER_CONFIRMED（2026-11-17）委托：设计文档为 Agent 自审对象；自审通过后自主推进计划/实施/测试/交付与各阶段本地提交（中文说明）。
  - 边界：真实模型端到端依赖用户 provider 凭据与额度；额度耗尽时如实记 UNVERIFIED 并用本地脚本化端点补可复现证据。

## 需求索引（迭代进度入口）

| 功能/优化目录 | 来源 / 身份 | 验收目标 | 责任范围 | 阶段 | 需求 / 设计 / 计划 / STATUS | 验证 | 集成状态 | 下一步 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [long-session-reliability](long-session-reliability/requirements.md) · context-budget | 路线图（USER_CONFIRMED 名称）；AC 切分 MODEL_PROPOSED | CB-01…07：预算核算、确定性压缩、约束/计划/工具状态保留、未完成调用占位、阈值公式、溢出链、幂等与熔断 | 新增 `src/core/context-budget.ts` + `context_compacted` 事件 | 需求/设计/计划 v1.1 · 实施 T1/T2/T6/T8 完成 | [需求 v0.2](long-session-reliability/requirements.md) ／ [设计 v1.1](long-session-reliability/design/design.zh.md) ／ [计划 v1.1](long-session-reliability/design/plan.zh.md) ／ [STATUS](long-session-reliability/STATUS.md) | CB-01…07 全部 PASS（含真实请求体 e2e） | 已推送功能分支，未合入 master | 等用户决定合入 |
| 同上 · session-recovery | 路线图；AC MODEL_PROPOSED | SR-01…11：JSONL 转录、会话索引与恢复、不盲重放、needs_review、损坏与版本、强杀一致性、权限不升权、并发写互斥 | 新增 `src/storage/session-transcript.ts`、`session-store.ts`、`private-file.ts`、`src/core/transcript.ts` | 需求/设计/计划 v1.1 · 实施 T3/T4/T6/T7 完成 | 同上 | SR-01…11 全部 PASS（含真实子进程） | 已推送功能分支，未合入 master | 等用户决定合入 |
| 同上 · failure-recovery | 路线图；AC MODEL_PROPOSED | FR-01…09：失败类别与稳定错误码、工具失败不伪装、截断、迭代上限、失败点定位、重试不重复副作用、写入失败兜底、溢出恢复链、**工具空转熔断** | `src/core/session-persistence.ts` + `Session` 接线 | 需求/设计/计划 v1.1 · 实施 T1/T6/T9 完成 | 同上 | FR-01…09 全部 PASS；真实模型 tool-error 触发 CORE_010 熔断停机 PASS | 已推送功能分支，未合入 master | 等用户决定合入 |
| 同上 · project-memory | 路线图；AC MODEL_PROPOSED | PM-01…08：项目隔离、跨进程可见、原子写、凭据拒写、损坏 `.bak`、会话级隔离、上限 | 新增 `src/storage/project-memory.ts` | 需求/设计/计划 v1.1 · 实施 T5/T8 完成 | 同上 | PM-01…08 全部 PASS | 已推送功能分支，未合入 master | 等用户决定合入 |
| 同上 · 观测 | USER_CONFIRMED（2026-11-19，用户要求用 Langfuse 看效果） | OB-01…04：本机可起、层级正确、工具名正确、失败可见 | 新增 `scripts/langfuse/local-receiver.mjs`（Langfuse 兼容接收端）+ `sp005-observation.mjs` + `package.json` 的 `langfuse:init`/`langfuse:receiver`/`langfuse:observe` | 需求/设计/计划 v1.1 · 实施 T10/T11 完成 · 平台就绪 | 同上 | OB-01…04 PASS；真实模型两场景 `npm run langfuse:observe` EXIT=0 | 已推送功能分支，未合入 master | 等用户决定合入 |

## 验收与交接

- 出口门槛对照：① 压缩保留约束/计划/工具状态 → CB-01…CB-04（单元 + 真实 HTTP 请求体）PASS；② 跨进程恢复不盲重放副作用 → SR-02…SR-04、FR-06 真实子进程 PASS；③ 项目记忆/会话隔离、原子持久化、共享写入约束 → PM-01…PM-08 + SR-11 两进程互斥 PASS；④ 明确长任务失败原因 → FR-01…FR-09 PASS。
- 自动化计数：`node --test src/*/test/*.test.mjs` **716/716**；`npm test` 全链路 **838 通过 / 0 失败**（langfuse 79，含真实栈冒烟 5 例、登录自检 3 例、工具调用质量判读 4 例、场景收尾判读 2 例）；`npm run test:checks`（core 不依赖 storage）通过；`npm run merge:gate` GREEN；AC 共 **42 条**（7+11+9+8+4+3）全部回填。
- 监测平台就绪：`npm run langfuse:init` / `npm run langfuse:receiver` / `npm run langfuse:observe`；健康检查 200、未鉴权 401、观测落盘 `.runtime/langfuse/local-receiver/`；边界与端点见 `ops/langfuse/README.md` 第 8 节。
- 真实模型端到端（2026-11-20）：`npm run langfuse:observe` 对真实 Langfuse 4.78.0 跑两场景并回查 —— tool-success（1 次 Read、参数 `facts.txt`、usage 1228）与 tool-error（5 次变路径 Read → `BUDINGX_CORE_010` 熔断停机、usage 1362）均 PASS。该过程由 Langfuse 数据暴露并修复了两个产品缺陷：provider 不索要/不解析流式 usage；工具观测不写 input/output。
- 未完成/延期项（UNVERIFIED，非本轮 FAIL）：真实模型长会话压缩（需真实模型填满预算）、TUI 长会话像素级观感（归 SP006）。恢复条件见 [STATUS](long-session-reliability/STATUS.md) 与[验收报告](long-session-reliability/test-report.md) §5。
- 下一轮输入（供 SP006）：压缩与恢复的 UI 呈现（`/context` 网格、恢复会话选择器可视化）、系统提示词与指令文件（`@import`）接入项目记忆、完成证据闸门与压缩的交互。
- 风险/回退：
  - 压缩后仍超限 ⇒ 熔断打开并以 `BUDINGX_CORE_007/008` 终止回合（不静默截断）。
  - 转录写入失败 ⇒ 回合结果保留在内存并随 `turn_finalized.persistenceError` 报出（`BUDINGX_STORAGE_005`）。
  - 并发写同一会话 ⇒ 明确拒绝（`BUDINGX_STORAGE_006`），陈旧锁需显式解锁，不静默删除。
  - 工具空转 ⇒ 两级熔断终止回合（`BUDINGX_CORE_010`），避免把迭代预算耗在无进展重试。
- 本轮**推送功能分支到远端**（用户 2026-11-20 授权），**不合入 master、不发布**；合入等用户决定。

## 变更记录

| 日期 | 变更 | 原因 |
| --- | --- | --- |
| 2026-11-19 | 立项、需求/设计/计划 v1.0、T0–T14 实施与测试 | 用户要求启动 SP005 并跑端到端测试 |
| 2026-11-19 | 新增 FR-09 与 CB-04 配对要求（需求 v0.2 / 设计 v1.1） | 真实模型观测暴露「换参数空转」与「占位被 normalize 丢弃」两处真实缺陷 |
| 2026-11-19 | 交付记录落盘，合入 master 待用户决定 | 用户明确「测试完成后待我决定后再合入master分支」 |
| 2026-11-19 | 监测平台搭到就绪态（三条 npm 命令 + 接收端文档），真实模型三场景保持 UNVERIFIED | 用户说明模型额度用尽，要求先搭好监测、到时再跑真实模型 |
| 2026-11-19 | 真实栈登录取 `.env.e2e.local`：`langfuse:init` 复用该文件四个凭据、新增 `langfuse:login` 自检，重建数据卷后 UI 登录与项目 Key 双检通过 | 用户「用 .env.e2e.local 文件无法进入langfuse里面」→「按照这个账号密码去改，不要改账号密码」 |
| 2026-11-19 | 真实档补强：接收端加只读查看页；WSL2 内 Docker 起真实 Langfuse 4.78.0 栈 + `langfuse:smoke` 接入链路验收（需求 v0.3）；顺手修后台任务句柄泄漏与子进程测试超时；全量 825 通过 | 用户「环境限制你帮我安装好就行了」→「不要桌面端 docker，装在 WSL 里」→「部署完成后检查 SP005 查漏补缺」；真实模型额度仍 402 |
| 2026-11-20 | 真实模型端到端复跑（tool-success/tool-error）在 Langfuse 4.78.0 回查 PASS；修复 provider 流式 usage 与工具 input/output 观测；判读上限改读 `MAX_TOOL_FAILURE_STREAK`；全量 838 通过 | 用户「有token了，可以跑真实的测试了…发现问题直接修复，完成后提交并推送远端」 |
