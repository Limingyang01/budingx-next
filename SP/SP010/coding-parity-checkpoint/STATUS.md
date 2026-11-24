# coding-parity-checkpoint 状态

生命周期：ACTIVE（文档阶段完成，待实施）｜更新：2026-11-24｜负责人：lead

## 当前范围与依据

- 需求/AC：[中期编码效果检查需求](requirements.md) v1.4（2026-11-24），AC-CP-01…AC-CP-10。
- 设计/计划：[设计 v1.4](../design/design.zh.md)（自审通过）｜[实施计划 v1.4](../design/plan.zh.md)。
- 输入基线：master `74c5156`，含 SP009 Windows 短路径修复 `50e558f`／`03ad128`。0.9.2 已用该提交发布，npm `latest` 为 0.9.2，见[发布回执](../../../release-notes/v0.9.2.md)。
- 当前批准范围：用户要求按两处复审意见修订文档至 v1.4，并登记截图反馈。实施待另行指示。

## 进度（断线续接入口）

每阶段完成或停等时更新本节，并同步[迭代汇总的需求索引](../requirements-summary.md#需求索引迭代进度入口)；续接的 Agent 先读本节再对照 `git log` 恢复。

- 阶段清单：[x] 需求 → [x] 设计 → [x] 计划 → [ ] 实施 → [ ] 测试 → [ ] 交付；**当前停点：文档阶段完成，按用户指令暂停在实施之前。**
- 已完成：
  - v1.2 将鉴权失败误判、保护题预期终态、主循环恢复与并发、真实编码闭环及安装 CLI 的答案和读取事件纳入验收。
  - v1.3 固定 CAN 两回合的预期终态与整题评分，T7 各恢复及 hook 分支分别核对触发、请求与终态。
  - v1.4 增加 CAN 恢复入口回执、首回合历史匹配及 T7 两种缺证续跑轨迹。0.9.2 TUI 截图观察见[验证报告](../test-report.md#092-tui-正文连续性)。
- 待做（最小下一步）：T0 确认实施起点。随后 T1–T5 准备测量工具，T6–T8 准备验证并做必要非盲预跑，T9–T10 定位及修复，T11 在最终候选上正式验收。
- 历史文档首版提交：`160607f`。v1.1 修订见 master 提交记录。
- 阻塞/恢复条件：无阻塞。恢复条件：用户指示进入实施即从 T0 续接；若真实 Provider 凭据或请求/费用上限耗尽，相关项标 UNVERIFIED 并写明恢复条件，不以重试提高通过率。

## 验证与验收

状态：**UNVERIFIED**。文档审阅定向复跑既有评估器套件，并使用脚本化 Provider 复现文件断言、预算终止、鉴权失败三类 runner 误判。SP010 产品验收、真实 Provider 评测与候选制品核对待实施，见[验证报告](../test-report.md)。

证据分层：题库校验、评估器回归、逐条确定性保护、真实 Provider 能力及长任务、候选独立安装与集成门禁。正式证据关联 T11 的候选身份。

## 集成与发布

v1.3 已进入 master（`46b9183`）。以下为首版文档的历史集成回执。

- 源：`feature/SP010/mid-term-coding-checkpoint`（`7e8948c`）→ 目标 `master`（`74c5156`）；merge-base `50e558f`；合并提交 `d09445a`（`--no-ff`，保留历史）；ancestry 证明源提交为 master 祖先。
- 门禁：合入前 GREEN（`artifacts/merge-gate/feature-SP010-mid-term-coding-checkpoint-2026-11-24T07-10-50-700Z.md`，outgoing 3 commits / 10 files，禁带路径违规 0，报告失败行 0、UNVERIFIED 行 20、恢复条件节「有」）；合入后 master 复核 GREEN（`artifacts/merge-gate/master-2026-11-24T07-17-04-811Z.md`）。六项检查退出码均为 0。
- 引入差异：10 个文件、673 行新增，全部为 Markdown，无产品代码、依赖、产物或凭据。
- npm 发布、打标签、远端设置、分支/worktree 删除：**未执行**（不在本轮授权内）。

## 交接与历史

- 下一位 Agent 应读：本文、[迭代汇总](../requirements-summary.md)、[需求正本](requirements.md)、[设计 v1.4](../design/design.zh.md)和[计划 v1.4](../design/plan.zh.md)，并核对实时 refs。
- 最早未完成步骤：**T0 基线与分支确认**。
- 剩余风险：评估器误判、真实运行的时间与成本、盲测信息回流。SP009 短路径修复已纳入输入基线。
- 批准变更历史：无替代或撤回记录。
