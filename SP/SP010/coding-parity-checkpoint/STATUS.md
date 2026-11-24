# coding-parity-checkpoint 状态

生命周期：ACTIVE（文档阶段完成，待实施）｜更新：2026-11-24｜负责人：lead

## 当前范围与依据

- 需求/AC：[中期编码效果检查需求](requirements.md) v1（2026-11-24），AC-CP-01…AC-CP-10。
- 设计/计划：[设计 v1.0](../design/design.zh.md)（自审通过）｜[实施计划 v1.0](../design/plan.zh.md)。
- 基线：master `74c5156`（SP009 0.9.2 优化已合入 `4252808`；Windows 发布断言修复已合入 `9be7753`；Windows 短路径兼容修复 `50e558f`／`03ad128` 已合入并推送 `74c5156`）；TUI 源码版本 0.9.2（台账 prepared，npm `latest` 仍为 0.9.1）。文档阶段曾以 `9be7753` 起草，基线前进后已按实况更新。
- 当前批准范围：用户 2026-11-24「/buding-sdd 开始SP010，先做文档，先不要直接开发」+ AGENTS.md 2026-11-17 审查与集成委托。允许：建立本轮目录、编写需求/设计/计划、本地中文提交；设计批准后覆盖计划、实施、测试、交付与各阶段本地提交，以及门禁 GREEN 后的合入 master 与推送。**不含**打标签、npm 发布、远端设置、分支/worktree 删除；本轮**不进入实施**。

## 进度（断线续接入口）

每阶段完成或停等时更新本节，并同步[迭代汇总的需求索引](../requirements-summary.md#需求索引迭代进度入口)；续接的 Agent 先读本节再对照 `git log` 恢复。

- 阶段清单：[x] 需求 → [x] 设计 → [x] 计划 → [ ] 实施 → [ ] 测试 → [ ] 交付；**当前停点：文档阶段完成，按用户指令暂停在实施之前。**
- 已完成：
  - 核对真实仓库事实：`scripts/eval` 现状（17 条任务、真实模型任务 3 条、盲测 4 条、`maxIterations: 8` 硬截断、预算档与 SP001 §7 不一致、live 路径无执行工具、报告硬编码 SP007 且统计维度不足、评估器无单测）；`src/core` 现状（无固定回合上限、`TOOL_OUTPUT_CAP` 32768、审批网关三值、无团队/租约/调度原语）；发布台账与 0.9.2 prepared 状态。
  - 需求正本、设计 v1.0（自审通过）与计划 v1.0 落盘；AC 编号 CP-01…CP-10 稳定。
  - 事实核对中确认的两处硬缺陷已写进需求与计划：评估回合上限与产品不一致（必修 D1）、工具输出上限语义需按三类输入核对（必修 D2）。
- 待做（最小下一步）：T0 冻结基线（复核实时 refs）→ T1 任务集与快照 → T2 预算与回合对齐 → T3 真实执行与权限 → T4 统计报告 → T5 评估器自测 → T6–T8 真实运行、长任务与制品核对 → T11 报告与集成。
- 最新本地提交：`160607f`（docs(SP010): 建立中期编码效果检查需求、设计与计划；分支 `feature/SP010/mid-term-coding-checkpoint`，基线 master `74c5156`，与 master 的 merge-base 为 `50e558f`）。
- 阻塞/恢复条件：无阻塞。恢复条件：用户指示进入实施即从 T0 续接；若真实 Provider 凭据或请求/费用上限耗尽，相关项标 UNVERIFIED 并写明恢复条件，不以重试提高通过率。

## 验证与验收

状态：**UNVERIFIED**。本轮尚未执行任何测试、真实 Provider 运行或制品核对。文档阶段仅完成事实核对（读取源码与配置、统计既有任务清单），未产生产品行为证据。

计划的证据分层（不得互相冒充）：题库校验退出码 → 评估器单元测试 → 真实 Provider 运行（能力、保护用例、长任务）→ 真实 npm 打包与隔离安装（制品）→ `npm test` 与 `npm run merge:gate`（回归与集成）。

## 集成与发布

合并、推送、产品发布：文档阶段**已合入 master**，推送见本轮提交记录。

- 源：`feature/SP010/mid-term-coding-checkpoint`（`7e8948c`）→ 目标 `master`（`74c5156`）；merge-base `50e558f`；合并提交 `d09445a`（`--no-ff`，保留历史）；ancestry 证明源提交为 master 祖先。
- 门禁：合入前 GREEN（`artifacts/merge-gate/feature-SP010-mid-term-coding-checkpoint-2026-11-24T07-10-50-700Z.md`，outgoing 3 commits / 10 files，禁带路径违规 0，报告失败行 0、UNVERIFIED 行 20、恢复条件节「有」）；合入后 master 复核 GREEN（`artifacts/merge-gate/master-2026-11-24T07-17-04-811Z.md`）。六项检查退出码均为 0。
- 引入差异：10 个文件、673 行新增，全部为 Markdown，无产品代码、依赖、产物或凭据。
- npm 发布、打标签、远端设置、分支/worktree 删除：**未执行**（不在本轮授权内）。

## 交接与历史

- 下一位 Agent 应读：本文、[迭代汇总](../requirements-summary.md)、[需求正本](requirements.md)、[设计 v1.0](../design/design.zh.md)、[计划 v1.0](../design/plan.zh.md)；再对照 `git log` 与实时 refs 核对。
- 最早未完成步骤：**T0 基线与分支冻结**。
- 剩余风险：测量口径与产品行为耦合；真实运行的时长与成本；盲测纪律被误用；SP009 短路径补丁未合入。
- 批准变更历史：无替代或撤回记录。
