# SP004 独立来源 AST 复核（T24）

- 复核日期：2026-11-19
- 参考仓提交：`b5c9be8d15e5dab153fe1607c0d653d464bdb3e5`（从 Git 对象只读取证）
- 本仓功能基线：`e808679`（SP004 起点，`git merge-base master HEAD`）
- 解析器：本仓 `typescript` 5.9.3 Compiler API（本地只读，不引入新依赖）
- 脚本：`scripts/review/sp004-ast.mjs`（`node scripts/review/sp004-ast.mjs --reference <参考仓> --reference-revision b5c9be8 --base master`）
- 判定阈值（设计 §9.8）：连续相同归一化子树 ≥30 节点；或双方均 ≥60 节点且归一化节点序列相似度 ≥0.80

## 方法

1. 默认从本仓已提交的 HEAD 比较到功能基线，指定 `--worktree` 时读取工作树变更（含未跟踪的生产 TS/TSX）。变更文件逐个映射到 `REFERENCE_ALLOWLIST`，未映射路径判失败。
2. 参考文件通过固定提交的树和 blob 获取。默认也从本仓 HEAD 的树和 blob 获取源码。解析双方 TS/TSX 并提取函数或组件单元。归一化忽略 trivia、统一局部标识符并保留操作符、控制流及 JSX 结构。映射目标缺失、语法错误或零比较均判失败。
3. 用结构化子树签名比较「连续相同归一化子树」，用三元组序列 Dice 系数比较整体相似度。
4. 命中项必须给出处置（`DISPOSITIONS`）。未处置命中或任一合成自检失败均阻断通过。四项自检覆盖相似片段、无关实现、短样板和无效 TypeScript。
5. 报告只保留路径、行范围、节点数、指标与处置，不保留参考源码片段。

## 结果

审查起点 `868eae6` 按修订脚本复跑，39 个文件、18,949 对，零命中。下表为本次修复工作树的 `--worktree` 复跑证据。

| 项 | 值 |
| --- | --- |
| 改动文件 | 40（全部映射，未覆盖路径 0） |
| 无对应参考模块（已审查） | 9（纯常量表 1、barrel 导出面 3、会话输出落盘 1、Git 模块 4——参考仓无 Git 工具实现） |
| 有比较对象的本仓模块 | 31 |
| 本仓函数/组件单元 | 156 |
| 参考函数/组件单元 | 5583 |
| 比较函数对 | 19359 |
| 命中（≥30 节点相同子树或 ≥0.80 序列相似度） | **0** |
| 未处理命中 | 0 |
| 自检 | 4/4 PASS |

临时 Git 仓库探针 3/3 通过。无 checkout 时可审查指定提交。缺少单个目标路径时退出码为 1，即使同一规则的其他路径存在。固定提交含无效 TypeScript 时退出码为 1。

无对应参考模块的路径与理由：

- `src/core/constants.ts`：纯常量/错误码表，参考仓无同名协议模块。
- `src/exec/index.ts`、`src/git/index.ts`、`src/plan/index.ts`：模块导出面，仅 re-export。
- `src/exec/persist.ts`：本仓会话输出落盘（设计 §4.4 规定路径），参考仓使用不同机制。
- `src/git/attribution.ts`、`src/git/commit.ts`、`src/git/porcelain.ts`、`src/git/status.ts`：参考仓未实现 Git 工具层（Git 由用户 shell 直接执行），无比较对象。

## 结论

**PASS**：在本轮固定 revision、固定工具版本与固定映射范围内，未发现达到阈值（≥30 节点连续相同归一化子树，或双方 ≥60 节点且序列相似度 ≥0.80）的函数对，无未处理命中。

来源分类与边界：

- 公共协议字段（命令/计划/待办/追问的卡片状态、Git 只读状态字段、事件名）来自 SP004 需求与设计规定，属必要重合，不构成代码复制。
- 参考提交包含 `ExitPlanModePermissionRequest` 及多题 `AskUserQuestionPermissionRequest`。卡片的参考范围同时纳入 `BashModeProgress` 和 `TaskListV2`。对照范围以 `REFERENCE_ALLOWLIST` 为准。
- 未验证边界：AST 分值不证明来源，只作为人工复核触发线；本复核不代表法律洁净室认证。真实终端下的视觉位图/双尺寸单元格差分仍为 UNVERIFIED（需两侧真实交互终端截屏，本环境无头）。
