# 工作区文件工具 状态

生命周期：DELIVERED（已合入 master，待用户验收）｜更新：2026-11-17｜负责人：Agent 执行 SDD（2026-11-17 委托自审），用户验收 master 结果

## 当前范围与依据

- 需求/AC：[requirements.md](requirements.md) v0.2（WT-01…WT-21）
- 设计/计划：[设计 v1.1](../design/design.zh.md)（§10 为 T18 能力对齐修订）/ [计划](../design/plan.zh.md)（T1–T18）
- 基线：`master` = `b0ffc9e`；环境 Windows 10 + Node.js >=22.18 + TypeScript
- 当前批准范围：设计 v1.1 自审通过，覆盖计划/实施/测试/交付与各阶段本地提交；交叉验证门禁 GREEN 后按 buding-merge 合入 master（2026-11-17 委托）。push/npm 发布/打标签/远端设置不在授权内

## 进度（断线续接入口）

- 阶段清单：[x] 需求 → [x] 设计 → [x] 计划 → [x] 实施 → [x] 测试 → [ ] 交付；当前停点：交付记录与门禁收口
- 已完成：`src/workspace/` 十一模块（paths/ignore/read/write/edit/search/diff/checkpoint/policy/context/tools）；读后编辑门、Write 自动建父目录与 LF、Grep 参数族、弯引号容错、`.git` 底线、搜索遵守 Read deny
- 待做（最小下一步）：出 `SP/SP003/test-report.md` → 交叉验证门禁 → 合入 master
- 最新本地提交：`10518f7`（本功能分支）；已合入 master 提交 `3e796be`（T18 能力对齐批次）；T1–T16 见 `3e74c90`…`e0a7e80`
- 阻塞/恢复条件：无阻塞；live Provider 端到端沿用 SP002 凭据状态，无凭据则记 UNVERIFIED

## 验证与验收

状态：PASS（自动化层）｜详见 [验证报告](../test-report.md)。

- L0 纯函数：路径边界 7、忽略规则 9、diff 6、检查点 7、策略 10、上下文 8、工具装配 12 项
- L1 真实文件进程：读写编辑搜索用例覆盖目录穿越/junction 越界、原子写、指纹冲突、CRLF、编码、超限、参数族
- L2 伪 TTY e2e：审批三档 6 项、diff 对话框 7 项、补全 overlay 6 项（随 T18 更新）
- L3 真终端人工：UNVERIFIED（需 Windows Terminal/ConHost 人工 smoke）

## 集成与发布

合并：**已合入 master**（源 910e282 → 目标 master，合并提交 3e796be，ancestry 已证明，合入后 master 复跑 npm test 全绿）；推送与 npm 发布：未执行，不在授权内。门禁报告 artifacts/merge-gate/feature-SP003-workspace-tools-2026-11-17T13-39-37-977Z.md（GREEN）。

## 交接与历史

下一位 Agent 先读 [迭代汇总](../requirements-summary.md) 与本文件，再对照 `git log`；本轮最早未完成步骤为「交付记录与门禁收口」。参考仓行为事实仅用于能力对照，实现独立编写，未迁入源码、提示词或内部类型。

## 验收修复分支

`fix/SP003/workspace-tui`。已修复单文件检索、文件体积跳过提示、多行空行匹配、glob 备选和忽略字符类、范围读取、合法 UTF-8、CRLF，以及缺失父目录的边界判定。详见 [验证报告 §8](../test-report.md#8-验收修复分支)。

修复已由 `598fb89` 合入 master。0.3.0（SP003）已发布。见 [发行说明](../../../release-notes/v0.3.0.md)。

SP003 已发布至 0.3.5，详见 [0.3.5 发行说明](../../../release-notes/v0.3.5.md)。
