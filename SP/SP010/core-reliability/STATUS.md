# core-reliability 状态

生命周期：ACTIVE（文档阶段完成，待实施）｜更新：2026-11-24｜负责人：lead

## 当前范围与依据

- 需求/AC：[Core 可靠性与高级能力接入前置需求](requirements.md) v1（2026-11-24），AC-CR-01…AC-CR-06。
- 设计/计划：[设计 v1.1](../design/design.zh.md)（自审通过）｜[实施计划 v1.1](../design/plan.zh.md)。
- 输入基线：master `74c5156`（含 SP009 Windows 短路径修复 `50e558f`／`03ad128`）。该提交已用于发布 0.9.2，见[回执](../../../release-notes/v0.9.2.md)。
- 当前批准范围：用户 2026-11-24「/buding-sdd 开始SP010，先做文档，先不要直接开发」+ AGENTS.md 2026-11-17 审查与集成委托。允许：建立本轮目录、编写需求/设计/计划、本地中文提交；设计批准后覆盖计划、实施、测试、交付与各阶段本地提交，以及门禁 GREEN 后的合入 master 与推送。**不含**打标签、npm 发布、远端设置、分支/worktree 删除；本轮**不进入实施**。

## 进度（断线续接入口）

- 阶段清单：[x] 需求 → [x] 设计 → [x] 计划 → [ ] 实施 → [ ] 测试 → [ ] 交付；**当前停点：文档阶段完成，按用户指令暂停在实施之前。**
- 已完成：
  - 核对 Core 现状：无固定回合上限（`MAX_ITERATIONS = 32` 仅保留导出兼容）、`TOOL_OUTPUT_CAP = 32768`、审批网关三值（allow/ask/deny）、无头入口审批恒为 `deny` 且权限档固定 `read_only`、**无**团队/租约/调度原语；SP008 已交付跨进程写锁与活动会话归属。
  - 设计与计划修订为 v1.1，明确区分缺陷、新能力与测量口径，补充最终候选复跑和交接证据。实施仍待用户指示。
  - 必修项定稿：D1 评估回合上限与产品一致（与 CP-03 同源）、D2 输出上限语义按截图/二进制/大文本三类输入核对、D3 审批「无人值守挂起」缺口只出结论交 SP014。
- 待做（最小下一步）：T9 接入前置核查 → T10 按非盲预跑与 readiness 归因逐项红绿 → T11 冻结最终候选、复跑受影响项并交接。
- 最新本地提交：`160607f`（docs(SP010): 建立中期编码效果检查需求、设计与计划；分支 `feature/SP010/mid-term-coding-checkpoint`，基线 master `74c5156`，与 master 的 merge-base 为 `50e558f`）。
- 阻塞/恢复条件：无阻塞。恢复条件：用户指示进入实施即从 T9 续接；缺陷入口依赖中期检查的失败归因，若 T6 未完成，T10 只处理 T9 结论中的必修项 D1/D2/D3，并登记其余待中期结果。

## 验证与验收

状态：**UNVERIFIED**。尚未执行核查、修复、回归或集成验证。文档阶段仅完成源码级事实核对（读取 `src/core`、`src/exec`、`src/storage`、`src/host` 与 `src/tui/headless.ts` 的真实实现），未产生行为证据。

计划的证据分层：readiness 的每条 PASS 必须指向真实实现或测试；每项缺陷修复先有失败用例（RED）再实现复测（GREEN）；修复后定向套件与 `npm test` 零失败；TUI、无头、serve 三入口行为不得漂移。

## 集成与发布

合并、推送、产品发布：文档阶段**已合入 master**，推送见本轮提交记录。

- 源：`feature/SP010/mid-term-coding-checkpoint`（`7e8948c`）→ 目标 `master`（`74c5156`）；merge-base `50e558f`；合并提交 `d09445a`（`--no-ff`）；ancestry 证明源提交为 master 祖先。
- 门禁：合入前 GREEN（`artifacts/merge-gate/feature-SP010-mid-term-coding-checkpoint-2026-11-24T07-10-50-700Z.md`），合入后 master 复核 GREEN（`artifacts/merge-gate/master-2026-11-24T07-17-04-811Z.md`）。
- npm 发布、打标签、远端设置、分支/worktree 删除：**未执行**（不在本轮授权内）。

## 交接与历史

- 下一位 Agent 应读：本文、[迭代汇总](../requirements-summary.md)、[需求正本](requirements.md)、[设计 v1.1](../design/design.zh.md)和[计划 v1.1](../design/plan.zh.md)，并核对实时 refs。
- 最早未完成步骤：**T9 接入前置核查**。
- 剩余风险：Core 修复可能影响 TUI、无头与 serve 三个入口，须在最终候选复验。SP009 短路径修复已纳入输入基线。
- 批准变更历史：无替代或撤回记录。
