# core-reliability 状态

生命周期：ACTIVE（文档阶段完成，待实施）｜更新：2026-11-24｜负责人：lead

## 当前范围与依据

- 需求/AC：[Core 可靠性与高级能力接入前置需求](requirements.md) v1（2026-11-24），AC-CR-01…AC-CR-06。
- 设计/计划：[设计 v1.0](../design/design.zh.md)（自审通过）｜[实施计划 v1.0](../design/plan.zh.md)。
- 基线：master `74c5156`（含 SP009 Windows 短路径兼容修复 `50e558f`／`03ad128`）；TUI 源码版本 0.9.2（prepared）。
- 当前批准范围：用户 2026-11-24「/buding-sdd 开始SP010，先做文档，先不要直接开发」+ AGENTS.md 2026-11-17 审查与集成委托。允许：建立本轮目录、编写需求/设计/计划、本地中文提交；设计批准后覆盖计划、实施、测试、交付与各阶段本地提交，以及门禁 GREEN 后的合入 master 与推送。**不含**打标签、npm 发布、远端设置、分支/worktree 删除；本轮**不进入实施**。

## 进度（断线续接入口）

- 阶段清单：[x] 需求 → [x] 设计 → [x] 计划 → [ ] 实施 → [ ] 测试 → [ ] 交付；**当前停点：文档阶段完成，按用户指令暂停在实施之前。**
- 已完成：
  - 核对 Core 现状：无固定回合上限（`MAX_ITERATIONS = 32` 仅保留导出兼容）、`TOOL_OUTPUT_CAP = 32768`、审批网关三值（allow/ask/deny）、无头入口审批恒为 `deny` 且权限档固定 `read_only`、**无**团队/租约/调度原语；SP008 已交付跨进程写锁与活动会话归属。
  - 需求正本、设计 v1.0（自审通过）与计划 v1.0 落盘；确立 **归属三分法**（缺陷 / 新能力 / 测量口径）作为本轮硬边界。
  - 必修项定稿：D1 评估回合上限与产品一致（与 CP-03 同源）、D2 输出上限语义按截图/二进制/大文本三类输入核对、D3 审批「无人值守挂起」缺口只出结论交 SP014。
- 待做（最小下一步）：T9 接入前置核查（产出 `readiness.md`）→ T10 Core 缺陷修复（按 T9 与 T6 结论，逐项红绿）→ 与 coding-parity-checkpoint 合并进入 T11 报告与集成。
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

- 下一位 Agent 应读：本文、[迭代汇总](../requirements-summary.md)、[需求正本](requirements.md)、[设计 v1.0](../design/design.zh.md)、[计划 v1.0](../design/plan.zh.md)；再对照 `git log` 与实时 refs 核对。
- 最早未完成步骤：**T9 接入前置核查**。
- 剩余风险：核查易滑向「顺手实现新能力」；Core 改动影响 TUI/无头/serve 三个入口；评估回合上限不修会让中期结果失真；SP009 短路径补丁未合入影响基线一致性。
- 批准变更历史：无替代或撤回记录。
