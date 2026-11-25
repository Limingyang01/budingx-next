# coding-parity-checkpoint 状态

生命周期：READY-FOR-MERGE（实施与测试收口完成，待合入 master）｜更新：2026-11-25｜负责人：lead

## 当前范围与依据

- 需求/AC：[中期编码效果检查需求](requirements.md) v1.4（2026-11-24），AC-CP-01…AC-CP-10。
- 设计/计划：[设计 v1.4](../design/design.zh.md)（自审通过）｜[实施计划 v1.4](../design/plan.zh.md)。
- 输入基线：master `74c5156`，含 SP009 Windows 短路径修复 `50e558f`／`03ad128`。0.9.2 已用该提交发布。
- 候选：`1c68345`（功能分支 HEAD，见交付回执），版本准备 0.10.0。

## 进度（断线续接入口）

每阶段完成或停等时更新本节，并同步[迭代汇总的需求索引](../requirements-summary.md#需求索引迭代进度入口)；续接的 Agent 先读本节再对照 `git log` 恢复。

- 阶段清单：[x] 需求 → [x] 设计 → [x] 计划 → [x] 实施 → [x] 测试 → [~] 交付（**版本已准备并推送功能分支，合入 master 待用户指示**）。
- 已完成：
  - **T1**：`scripts/eval/tasks/set-cp-v1.json` 落地 30 题（基本 18 + 保护 12），8 类别分布符合、盲测 10 条；每题一个 fixture 快照目录与逐文件 SHA-256 清单；`validate.mjs --set cp-v1` 退出码 0；`tools/verify-fixtures.mjs` 证明 18 条基本题在 pristine 快照上均未预先解出，另以参考解复验 18/18 可转绿。
  - **T2**：评估回合上限改由版本化预算档提供（`CHECKPOINT_BUDGET_PROFILES`），四类预算终止均记 `BUDGET` 且优先于断言聚合；文件断言在清理前求值；auth + 验证命令退出 0 仍判失败。
  - **T2（CAN）**：新增 `scripts/eval/lib/can-score.mjs` 与 `can-runner.mjs`，整题按「取消 → 产品恢复入口 → 续跑」两回合计量并只计一次；五类反例（跳过恢复入口、回执失败、回执错会话、历史缺首回合证据、副作用重放）全部判失败。
  - **T3**：live 路径按任务声明装配执行工具、权限档与审批；`read_only` 拒执行、`workspace_edit` 拒绝后可继续。
  - **T4**：报告补类别分组、任务等权完成率与 Hoeffding 95% 区间、延迟 p50/p95、token/费用估算、预算失败计数与措辞红线。
  - **T5**：新增运行身份清单（候选 SHA、题集与快照摘要、模型、预算档、重复次数），任一字段变化拒绝续跑；盲测结果落盘脱敏。
  - **T6**：12 条保护用例确定性验证全部通过（`src/tui/test/sp010-protection.test.mjs`）。
  - **T7**：主循环逐路径判据逐行取证（`src/tui/test/sp010-loop-paths.test.mjs`），Stop hook 三个参考出口按 GAP 登记。
  - **T8**：候选制品在仓库外隔离安装后完成只读定位题核对，答案与成对 Read 事件均命中，数据根跟随隔离 HOME。
  - **T11**：版本 0.10.0 已准备（台账 prepared、发行说明、文档版本号同步）；报告、两项 STATUS、迭代汇总、`docs/current-status.md` 与产品说明书已同步。
- 当前实现提交的验证：`npm test` 退出 0（零失败）；四项 SP010 定向套件 65 通过 / 0 失败；`spec:check`、`version:check`、题集校验与快照自检退出码均为 0。
- 阻塞/恢复条件：无阻塞。**未完成项为真实模型侧的正式评测**：本地 `.env.e2e.local` 的请求上限为 6 次、费用上限 5 美元，无法覆盖 30 题 × 3 次（≥90 次）。恢复条件：提高 `BUDINGX_E2E_MAX_REQUESTS` 与 `BUDINGX_E2E_BUDGET_USD` 后执行 `node scripts/eval/live.mjs --set cp-v1 --repeats 3 --run-id <ID>`。在此之前，AC-CP-04、AC-CP-07、AC-CP-08 的真实模型部分记 UNVERIFIED，不以重试提高通过率。

## 验证与验收

状态：**13 条 AC PASS、3 条部分 PASS（真实模型部分 UNVERIFIED）、0 FAIL**。逐条依据见[验证报告](../test-report.md#1-ac-逐条结论)。

- 真实 Provider 冒烟：`CP-LOC-01` 通过（7 次请求、19993 token、12.99 s，改动仅 `answer.json`，独立校验命令退出 0）。
- 证据分层：题库校验、仪器回归、确定性保护、脚本化主循环路径、真实 Provider 冒烟、候选独立安装与集成门禁。

## 集成与发布

- 源：`feature/SP010/coding-parity-implementation` → 目标 `master`（**本轮按用户指示尚未合入**）。
- 合入前置：交叉验证门禁 GREEN；合入后按 buding-merge 规程推送远端。
- 版本：0.10.0 已准备（台账 `prepared`），发布由维护者在 GitHub 手动触发。
- npm 发布、打标签、远端设置、分支/worktree 删除：**未执行**（不在本轮授权内）。

## 交接与历史

- 下一位 Agent 应读：本文、[迭代汇总](../requirements-summary.md)、[需求正本](requirements.md)、[设计 v1.4](../design/design.zh.md)、[计划 v1.4](../design/plan.zh.md)与[验证报告](../test-report.md)，并核对实时 refs。
- 最早未完成步骤：**正式题集的真实模型运行**（需先提高请求预算）。
- 剩余风险：评估器误判、真实运行的时间与成本、盲测信息回流；三类契约式校验（Go/Rust/C#）弱于原生编译，已登记。
- 批准变更历史：无替代或撤回记录。
