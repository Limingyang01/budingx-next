# SP010 · 中期编码效果检查验证报告

状态：**文档阶段完成，实施未开始**｜更新：2026-11-24｜基线 master `74c5156`｜分支 `feature/SP010/mid-term-coding-checkpoint`

配套：[迭代汇总](requirements-summary.md)｜[需求正本](coding-parity-checkpoint/requirements.md)、[core-reliability 需求](core-reliability/requirements.md)｜[设计 v1.0](design/design.zh.md)｜[计划 v1.0](design/plan.zh.md)

## 0. 本轮性质

本轮按用户 2026-11-24 指令「/buding-sdd 开始SP010，先做文档，先不要直接开发」只完成**需求、设计与计划**三阶段，**未进入实施**：没有编写产品代码，没有运行真实 Provider，没有安装制品。因此本报告的全部 AC 结论为「未执行 → UNVERIFIED」，并逐条写明恢复条件。本报告不含任何通过结论。

## 1. AC 逐条结论

| AC ID | 结论 | 依据（文件 / 命令 / cwd / 数量） | 恢复条件 |
| --- | --- | --- | --- |
| AC-CP-01 任务集分母与快照 | UNVERIFIED | 未执行：任务集文件与校验器尚未建立（计划 T1） | 完成 T1 并使 `node scripts/eval/validate.mjs --set cp-v1` 退出码 0 |
| AC-CP-02 盲测纪律 | UNVERIFIED | 未执行：B1 十条盲测与 B2 预留尚未建立（计划 T1、T6） | 任务集落地后，核对报告脱敏结构与修复记录不含盲测失败信息 |
| AC-CP-03 预算与回合上限 | UNVERIFIED | 未执行：预算档与回合上限尚未改动（计划 T2） | T2 完成并有预算触发与「评估预算」标注的定向运行记录 |
| AC-CP-04 真实编码任务执行 | UNVERIFIED | 未执行：无真实 Provider 运行（计划 T3、T6） | 真实凭据可用时按批次运行并留存脱敏证据 |
| AC-CP-05 统计与报告 | UNVERIFIED | 未执行：报告统计维度尚未补齐（计划 T4） | T4 完成后核对报告含类别分组、一致性、p50/p95 与失败分类 |
| AC-CP-06 保护用例全通过 | UNVERIFIED | 未执行：保护用例任务尚未可执行（计划 T1、T6） | 12 条保护用例全部可执行并真实运行，逐条登记结果 |
| AC-CP-07 长任务稳定性 | UNVERIFIED | 未执行：长任务场景尚未建立（计划 T7） | 长会话任务（压缩/恢复/取消）真实运行并留存证据 |
| AC-CP-08 npm 制品核对 | UNVERIFIED | 未执行：本轮未打包、未安装（计划 T8） | 隔离安装后完成最小真实编码任务并记录入口/版本/数据路径一致性 |
| AC-CP-09 仪器可信 | UNVERIFIED | 未执行：评估器单元测试尚未建立（计划 T5） | `npm test` 中评估器用例实际执行且零失败 |
| AC-CP-10 中期报告口径 | UNVERIFIED | 未执行：中期报告尚未产出（计划 T11） | 报告产出后核对措辞与未验证项清单 |
| AC-CR-01 接入前置核查 | UNVERIFIED | 未执行：`readiness.md` 尚未建立（计划 T9） | 产出四方向契约项 × PASS/GAP × 证据 × 归属，并抽样复核 |
| AC-CR-02 Core 缺陷修复 | UNVERIFIED | 未执行：缺陷修复尚未开始（计划 T10） | 每项缺陷先有失败用例，修复后定向套件与 `npm test` 零失败 |
| AC-CR-03 评估回合上限必修项 | UNVERIFIED | 未执行（与 AC-CP-03 同源，计划 T2） | 评估不再注入低于产品的回合硬上限，超限仍可终止 |
| AC-CR-04 输出上限语义核对 | UNVERIFIED | 未执行：三类输入的截断与错误码行为未核对（计划 T10） | 截图/二进制/大文本各有用例，且给出对 SP012/SP013 的影响结论 |
| AC-CR-05 审批语义归类 | UNVERIFIED | 未执行：结论尚未产出（计划 T9、T10） | 产出「允许/拒绝/无人值守挂起」可表达性结论并交 SP014 |
| AC-CR-06 交接材料 | UNVERIFIED | 未执行：交接材料尚未汇总（计划 T11） | readiness、修复清单、未修项与盲测批次登记齐备并被 SP011–SP014 引用 |

本报告无失败行：以上 16 条均为「未执行」，没有任何一条被判定为失败或部分通过。

## 2. scoped diff 复核（merge-base..HEAD）

源 `feature/SP010/mid-term-coding-checkpoint`，基线 master `74c5156`（本分支与 master 的 merge-base 为 `50e558f`，该提交已由 master 收录，故本轮引入差异只有本分支自身的文档提交）。引入差异共 10 个文件，全部为 Markdown：

- `SP/SP010/requirements-summary.md`（迭代汇总与进度入口）
- `SP/SP010/coding-parity-checkpoint/requirements.md`、`STATUS.md`
- `SP/SP010/core-reliability/requirements.md`、`STATUS.md`
- `SP/SP010/design/design.zh.md`、`plan.zh.md`
- `SP/SP010/test-report.md`（本文件）
- `docs/current-status.md`、`docs/iteration-plan.md`（同步 SP010 开轮状态）

复核结论：不含旧仓源码、提示词、内部 SDK 类型或 bundle；不含凭据、密钥、依赖、lockfile、dist 或 artifacts；不含产品代码与运行时行为改动（**本轮无用户可见行为变化，产品说明书 `PRODUCT.md` 无需更新——理由：无任何命令、按键、配置、数据路径、依赖或版本变化**）；第三方素材与许可无新增；所有新增相对链接经脚本校验指向存在的目标。

## 3. 分层证据

| 层 | 内容 | 结果 |
| --- | --- | --- |
| L0 纯函数 / 静态检查 | `npm run spec:check`（cwd 仓库根） | 退出码 0（能力清单 91 项、任务清单 基本 30 / 高级 30 / 保护 12、盲测 20，自洽） |
| L0 纯函数 / 静态检查 | 新增文档相对链接存在性脚本校验（9 个文件） | 全部指向存在的目标，0 处失效 |
| L0 纯函数 / 静态检查 | `git diff --check` | 无空白错误 |
| L1 伪 TTY e2e | — | 未执行（本轮无 UI 行为变更；相关证据属 SP009 既有报告） |
| L2 真实进程与制品 | — | 未执行（本轮无制品变更） |
| L3 真终端人工 | — | 未执行 |
| 门禁 | `npm run merge:gate` | 见 §5 |

本轮证据全部为 L0 静态层；没有任何 L1/L2/L3 证据，报告中不存在以静态检查冒充运行时验证的结论。

## 4. Bug 闭环与本轮核对发现

本轮未实施，因此没有「本轮引入的缺陷」。事实核对阶段发现两处**既有**缺陷，均已写进需求与计划，属后续任务的必修项，不是本轮引入：

1. 评估器向会话注入 `maxIterations: 8`（`scripts/eval/lib/runner-core.mjs:163`），而产品主循环自 0.9.1 起默认无上限（`src/core/session.ts:1662`）——当前测量对象是被截断的产品。修复任务：计划 T2（AC-CP-03、AC-CR-03）。
2. 评估预算档与 SP001 §7 不一致（`scripts/eval/lib/tasks.mjs:48-52` 的 B 档为 8 次请求 / 20000 token / 60000 ms，规格为 30 轮 / 10 分钟）。修复任务：计划 T2（AC-CP-03）。

两处均尚未修复，本报告不登记为已闭环。

## 5. 交叉验证门禁

门禁命令 `npm run merge:gate`，报告落在 `artifacts/merge-gate/feature-SP010-mid-term-coding-checkpoint-<timestamp>.md`（本地忽略）。本报告随分支提交后再执行门禁，结果在提交与合入记录中登记；门禁 RED 时禁止合入。

## 6. 风险与回退

| 风险 | 处理 |
| --- | --- |
| 测量口径与产品行为耦合，可能把产品缺陷误判为测量问题或反之 | 题目断言只用可自动判定事实；评估器改动必须带单元测试；缺陷修复另在 `src/core` 有独立用例 |
| 真实运行成本与时长（≥90 次真实运行，最坏约 15 小时墙钟与真实计费） | 按类别分批 + `--resume` 续跑 + 请求/费用总闸；触顶即停止并标 UNVERIFIED，不靠重试提高通过率 |
| 盲测纪律被误用（中期结果被当成调优目标） | B1 失败细节脱敏且不进修复依据；封版后另立 B2（≥20 条）供 SP016 |
| SP009 短路径补丁 `50e558f`／`03ad128` 的基线一致性 | **已解决**：已合入 master `74c5156` 并推送，本轮基线包含该修复；本分支 merge-base 为 `50e558f`，不重复引入也不丢失 |
| 回退方式 | 本轮只增文档；回退即删除 SP010 目录并还原两处 docs 改动，无产品行为与数据影响 |

## 7. UNVERIFIED 汇总与恢复条件

- 本报告共 16 条 AC，全部为未执行（UNVERIFIED），无失败项、无部分通过项。
- 恢复条件（统一）：执行计划 T0–T11 后，按 §1 表格逐条更新结论；每条结论须写明命令、cwd、实际数量与证据位置；真实 Provider、制品安装与长任务类结论必须来自真实运行，fixture 不冒充 live。
- 中期报告口径：本轮**只产出中期结果**，不得表述为完整替代，也不得使用「已对齐」「同等效果」类措辞。
