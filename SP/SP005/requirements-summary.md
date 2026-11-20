# SP005 · 长会话与数据可靠性

状态：**DELIVERED（实施与测试完成，真实模型端到端两场景 PASS、监测平台就绪，已合入 master `293a337` 并推送；0.5.0 已通过 OIDC 发布，npm `latest` 已核对；0.5.0 发布后的独立复审修复已完成，版本准备为 0.5.1，尚未上传 npm）**｜功能分支 `feature/SP005/fix-0.5.1`（修复轮）｜实施基线 `17afe34`（master）｜轮次验收报告 [SP005/test-report.md](test-report.md)（复审修复见 §9）

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
  - USER_CONFIRMED（2026-11-20）：「合入master，并且停止容器」→ **合入 master**（合并提交 `293a337`）并停止本地 Langfuse 容器。
  - USER_CONFIRMED（2026-11-20）：「合完推送远端，完成发布前的准备工作，到时我直接点发布即可」→ 合入后推送远端 + 完成 0.5.0 发布准备；npm 上传由用户在 Actions 手动触发。
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
- 自动化计数（0.5.1）：`node --test src/*/test/*.test.mjs` **732 项 / 731 通过 / 0 失败 / 1 跳过**（跳过项为只在 POSIX 生效的文件权限断言）；`npm test` 全链路 **856 项 / 855 通过 / 0 失败 / 1 跳过**（skills 10、spec 11、unit 732、checks 通过、langfuse 81、release 17、merge 5）；`npm run test:checks`（core 不依赖 storage）通过；AC 共 **42 条**（7+11+9+8+4+3）全部回填，其中 PM-06 与 SR-10 的补证见 [验收报告 §9](test-report.md#9-051-复审修复2026-11-20)。0.5.0 时的历史计数为 716/838，保留作对照。
- 监测平台就绪：`npm run langfuse:init` / `npm run langfuse:receiver` / `npm run langfuse:observe`；健康检查 200、未鉴权 401、观测落盘 `.runtime/langfuse/local-receiver/`；边界与端点见 `ops/langfuse/README.md` 第 8 节。
- 真实模型端到端（2026-11-20）：`npm run langfuse:observe` 对真实 Langfuse 4.78.0 跑两场景并回查 —— tool-success（1 次 Read、参数 `facts.txt`、usage 1228）与 tool-error（5 次变路径 Read → `BUDINGX_CORE_010` 熔断停机、usage 1362）均 PASS。该过程由 Langfuse 数据暴露并修复了两个产品缺陷：provider 不索要/不解析流式 usage；工具观测不写 input/output。
- 未完成/延期项（UNVERIFIED，非本轮 FAIL）：真实模型长会话压缩（需真实模型填满预算）、TUI 长会话像素级观感（归 SP006）。恢复条件见 [STATUS](long-session-reliability/STATUS.md) 与[验收报告](long-session-reliability/test-report.md) §5。
- 0.5.1 复审后已知限制（非缺陷）：预算过紧且历史已裁到只剩当前消息时强制压缩无法再生效，会明确报错终止；恢复后的「需核对」只是提示，模型自行重发同一操作不会被二次拦截。
- 下一轮输入（供 SP006）：压缩与恢复的 UI 呈现（`/context` 网格、恢复会话选择器可视化）、系统提示词与指令文件（`@import`）接入项目记忆、完成证据闸门与压缩的交互。
- 风险/回退：
  - 压缩后仍超限 ⇒ 熔断打开并以 `BUDINGX_CORE_007/008` 终止回合（不静默截断）。
  - 转录写入失败 ⇒ 回合结果保留在内存并随 `turn_finalized.persistenceError` 报出（`BUDINGX_STORAGE_005`）。
  - 并发写同一会话 ⇒ 明确拒绝（`BUDINGX_STORAGE_006`），陈旧锁需显式解锁，不静默删除。
  - 工具空转 ⇒ 两级熔断终止回合（`BUDINGX_CORE_010`），避免把迭代预算耗在无进展重试。
- 本轮**已合入 master**（用户 2026-11-20「合入master，并且停止容器」授权，合并提交 `293a337`）并推送远端；**0.5.0 已通过 OIDC 发布**，源码为 `751ba3b`，Windows 与 Ubuntu 验证均通过，npm `latest` 指向 0.5.0。见[发行说明](../../release-notes/v0.5.0.md)。

## 变更记录

| 日期 | 变更 | 原因 |
| --- | --- | --- |
| 2026-11-19 | 立项、需求/设计/计划 v1.0、T0–T14 实施与测试 | 用户要求启动 SP005 并跑端到端测试 |
| 2026-11-19 | 新增 FR-09 与 CB-04 配对要求（需求 v0.2 / 设计 v1.1） | 真实模型观测暴露「换参数空转」与「占位被 normalize 丢弃」两处真实缺陷 |
| 2026-11-19 | 交付记录落盘，合入 master 待用户决定 | 用户明确「测试完成后待我决定后再合入master分支」 |
| 2026-11-19 | 监测平台搭到就绪态（三条 npm 命令 + 接收端文档），真实模型三场景保持 UNVERIFIED | 用户说明模型额度用尽，要求先搭好监测、到时再跑真实模型 |
| 2026-11-20 | 真实模型端到端两场景在 Langfuse 4.78.0 回查 PASS，修复模型用量/工具观测载荷与熔断判定 | 用户说明额度恢复，要求用 Langfuse 监测并即时修复 |
| 2026-11-20 | 合入 master（`293a337`）并推送远端；停止本地 Langfuse 容器 | 用户指令「合入master，并且停止容器」 |
| 2026-11-20 | 0.5.0 版本准备、发行说明与版本文档同步完成，状态 **prepared** | 用户指令「完成发布前的准备工作，到时我直接点发布即可」 |
| 2026-11-20 | 0.5.0 正式发布，npm `latest` 与官方包独立安装已核对 | [运行 #20](https://github.com/Limingyang01/budingx-next/actions/runs/44654008000) ／ [发布台账](../../release-ledger.json) ／ [验收报告 §8](test-report.md#8-050-正式发布回执2026-11-20) |
| 2026-11-19 | 真实栈登录取 `.env.e2e.local`：`langfuse:init` 复用该文件四个凭据、新增 `langfuse:login` 自检，重建数据卷后 UI 登录与项目 Key 双检通过 | 用户「用 .env.e2e.local 文件无法进入langfuse里面」→「按照这个账号密码去改，不要改账号密码」 |
| 2026-11-19 | 真实档补强：接收端加只读查看页；WSL2 内 Docker 起真实 Langfuse 4.78.0 栈 + `langfuse:smoke` 接入链路验收（需求 v0.3）；顺手修后台任务句柄泄漏与子进程测试超时；全量 825 通过 | 用户「环境限制你帮我安装好就行了」→「不要桌面端 docker，装在 WSL 里」→「部署完成后检查 SP005 查漏补缺」；真实模型额度仍 402 |
| 2026-11-20 | 真实模型端到端复跑（tool-success/tool-error）在 Langfuse 4.78.0 回查 PASS；修复 provider 流式 usage 与工具 input/output 观测；判读上限改读 `MAX_TOOL_FAILURE_STREAK`；全量 838 通过 | 用户「有token了，可以跑真实的测试了…发现问题直接修复，完成后提交并推送远端」 |
| 2026-11-20 | 0.5.0 发布后独立复审：修复写入锁互斥与释放归属、记忆往返与真实损坏备份、凭据误判、压缩保留项裁剪与压缩转录重放、预算阈值统一、熔断按回合重置、恢复权限不升权、`/memory` 用法；新增 17 条回归，全量 856 项通过；版本准备为 0.5.1（待发布） | 用户「复审一下SP005的代码」→「master有新的提交，你按照最新的master拉出分支处理优化和修复」 |
