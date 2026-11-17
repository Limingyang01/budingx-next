# 权限模式与审批控制 状态

生命周期：DELIVERED（已合入 master，待用户验收）｜更新：2026-11-17｜负责人：Agent 执行 SDD（2026-11-17 委托自审），用户验收 master 结果

## 当前范围与依据

- 需求/AC：[requirements.md](requirements.md) v0.2（PC-01…PC-13）
- 设计/计划：[设计 v1.1](../design/design.zh.md)（§3.3 模式与底线、§10 A6/A10 修订）/ [计划](../design/plan.zh.md)（T9–T12、T18c/T18g）
- 基线：`master` = `b0ffc9e`；SP002 审批闭环（`ApprovalGateway` + 审批事件）为本轮扩展基座
- 当前批准范围：同迭代汇总；push/发布不在授权内

## 进度（断线续接入口）

- 阶段清单：[x] 需求 → [x] 设计 → [x] 计划 → [x] 实施 → [x] 测试 → [ ] 交付；当前停点：交付记录与门禁收口
- 已完成：三模式判定矩阵（仅可查看/工作区内修改/完全权限）、底线规则 B-1…B-5（用户数据目录、凭据特征文件、工作区外、junction）、规则匹配与遮蔽检测、规则持久化（`~/.budingx/permissions.json`，schemaVersion 1）、审批三档与拒绝反馈、`.git` 强制询问、拒绝记录与 `/denials`
- 待做（最小下一步）：出 test-report → 门禁 → 合入 master
- 最新本地提交：`10518f7`（本功能分支）；已合入 master 提交 `3e796be`
- 阻塞/恢复条件：无阻塞

## 验证与验收

状态：PASS（自动化层）｜详见 [验证报告](../test-report.md)。

- L0 纯函数：策略判定 10 项（矩阵、底线、规则优先级、会话记忆、遮蔽、`.git` 询问）、规则持久化 7 项（损坏备份、schema 越界、contentPrefix 拒绝）
- L1 真实文件进程：三种模式下写入行为、拒绝后磁盘不变、凭据文件在任何模式拒绝
- L2 伪 TTY e2e：审批三档 6 项（含拒绝反馈回传模型）、模式徽标与 Shift+Tab 轮播
- L3 真终端人工：UNVERIFIED

## 集成与发布

合并：**已合入 master**（合并提交 3e796be，ancestry 已证明，合入后 master 复跑 npm test 全绿）；推送与 npm 发布：未执行，不在授权内。

## 交接与历史

下一位 Agent 先读 [迭代汇总](../requirements-summary.md) 与本文件；本轮最早未完成步骤为「交付记录与门禁收口」。三模式语义为 USER_CONFIRMED 不可变更；规则语法按行为事实自写解析器。
