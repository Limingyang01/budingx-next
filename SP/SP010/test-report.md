# SP010 · 中期编码效果检查验证报告

状态：**文档 v1.1 已修订，实施未开始**｜更新：2026-11-24｜输入基线 master `74c5156`（0.9.2 已发布）

配套：[迭代汇总](requirements-summary.md)｜[需求正本](coding-parity-checkpoint/requirements.md)、[core-reliability 需求](core-reliability/requirements.md)｜[设计 v1.1](design/design.zh.md)｜[计划 v1.1](design/plan.zh.md)

## 0. 本轮性质

本次按用户 2026-11-24 指令修订需求、设计、计划和验收记录。正式评测、修复、真实 Provider、SP010 候选制品验证均待实施，16 条 AC 保留 UNVERIFIED。既有测试复跑和脚本化复现作为文档修订依据，记录在 §3–§4。

## 1. AC 逐条结论

| AC ID | 结论 | 依据（文件 / 命令 / cwd / 数量） | 恢复条件 |
| --- | --- | --- | --- |
| AC-CP-01 任务集分母与快照 | UNVERIFIED | 未执行：任务集文件与校验器尚未建立（计划 T1） | 完成 T1 并使 `node scripts/eval/validate.mjs --set cp-v1` 退出码 0 |
| AC-CP-02 盲测纪律 | UNVERIFIED | 未执行：B1 十条盲测与 B2 预留尚未建立（计划 T1、T6） | 任务集落地后，核对报告脱敏结构与修复记录不含盲测失败信息 |
| AC-CP-03 预算与回合上限 | UNVERIFIED | 已复现 token 超限却通过的旧行为，T2 待实施 | 请求、轮数、token、墙钟的预算证据齐备，超限且其他断言成功时仍记 `BUDGET` |
| AC-CP-04 真实编码任务执行 | UNVERIFIED | 正式真实 Provider 运行待 T11 | 在最终候选运行真实编码闭环并留存脱敏证据 |
| AC-CP-05 统计与报告 | UNVERIFIED | T4 任务级统计待实现 | 最终候选报告包含任务等权完成率、95% 区间、重复一致性、分组、延迟 p50/p95 与证据不足的原因 |
| AC-CP-06 保护用例全通过 | UNVERIFIED | T6 受控触发与 T11 最终候选核对待实施 | 12 条逐条登记实际触发、产品证据和判定，确定性用例全部通过 |
| AC-CP-07 长任务稳定性 | UNVERIFIED | T7 场景待建立 | T11 在最终候选真实运行压缩、恢复、取消并留存证据 |
| AC-CP-08 npm 制品核对 | UNVERIFIED | T8 候选制品验证流程待落实 | 记录最终候选 SHA 和 tarball integrity，独立安装并完成最小真实编码任务，核对入口、版本与数据路径 |
| AC-CP-09 仪器可信 | UNVERIFIED | SP007 既有套件复跑 22/22 通过，SP010 增量回归待实施 | 两例 runner 误判均有回归及红绿证据，续跑身份、统计、脱敏和快照用例纳入 `npm test`，实际执行且零失败 |
| AC-CP-10 中期报告口径 | UNVERIFIED | 最终候选报告待 T11 | 检查报告口径、候选身份、受影响项复跑证据及未验证项恢复条件 |
| AC-CR-01 接入前置核查 | UNVERIFIED | 未执行：`readiness.md` 尚未建立（计划 T9） | 产出四方向契约项 × PASS/GAP × 证据 × 归属，并抽样复核 |
| AC-CR-02 Core 缺陷修复 | UNVERIFIED | T10 缺陷修复尚未开始 | 逐项登记红绿证据，T11 最终候选复跑受影响项，定向套件与 `npm test` 零失败 |
| AC-CR-03 评估回合上限必修项 | UNVERIFIED | 与 AC-CP-03 同源，T2 待实施 | 正常任务可超过原固定 8 轮，预算终止后整题仍记 `BUDGET` |
| AC-CR-04 输出上限语义核对 | UNVERIFIED | 未执行：三类输入的截断与错误码行为未核对（计划 T10） | 截图/二进制/大文本各有用例，且给出对 SP012/SP013 的影响结论 |
| AC-CR-05 审批语义归类 | UNVERIFIED | 未执行：结论尚未产出（计划 T9、T10） | 产出「允许/拒绝/无人值守挂起」可表达性结论并交 SP014 |
| AC-CR-06 交接材料 | UNVERIFIED | T11 交接材料待汇总 | readiness、修复清单、未修项、盲测批次及最终候选证据齐备，供 SP011–SP014 引用 |

以上 16 条产品 AC 均为 UNVERIFIED。旧评估器的复现结果见 §4。

## 2. 文档变更范围

v1.1 从 master `901e850` 修订 SP010 的需求汇总、两项需求和状态记录、设计、计划及本报告。均为 Markdown，说明书无需更新，理由是这次仅澄清设计与验收证据。首版合入范围保留如下。

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

上述是首版文档的检查。v1.1 审阅以仓库根为 cwd，执行 `node --test src/tui/test/sp007-eval.test.mjs`，既有评估器用例 22 通过、0 失败、0 跳过。另用脚本化 Provider 执行两次现有 `runLiveTask`，测试输入为隔离 fixture，结果见 §4。正式真实 Provider 和最终候选安装验收待 T11。

## 4. Bug 闭环与本轮核对发现

以下为文档阶段核对的既有缺陷，修复安排在实施阶段：

1. 评估器向会话注入 `maxIterations: 8`（`scripts/eval/lib/runner-core.mjs:163`），而产品主循环自 0.9.1 起默认无上限（`src/core/session.ts:1662`）——当前测量对象是被截断的产品。修复任务：计划 T2（AC-CP-03、AC-CR-03）。
2. 评估预算档与 SP001 §7 不一致（`scripts/eval/lib/tasks.mjs:48-52` 的 B 档为 8 次请求 / 20000 token / 60000 ms，规格为 30 轮 / 10 分钟）。修复任务：计划 T2（AC-CP-03）。

3. 已存在的 `task-b07` fixture 文件 `src/calc.js` 被 `file_exists` 错判缺失（清理先于断言，[runner](../../scripts/eval/lib/runner-core.mjs#L500)）。T2/T5 在同一套件补存在、缺失、内容及清理顺序回归。
4. 脚本化响应使用 33 token，将上限设为 1，并令 `scope` 断言成功。现有 runner 同时返回 `budgetExceeded: tokens` 与 `status: passed`（[runner](../../scripts/eval/lib/runner-core.mjs#L505)）。T2/T5 回归要求整次运行失败且归类 `BUDGET`。

| 审阅发现 | 修订落点与恢复证据 |
| --- | --- |
| runner 两处误判 | 设计 §3.2，计划 T2/T5。逐项保留失效场景和修复后的定向证据 |
| 最终候选证据归属 | 设计 §3.5，计划 T11。登记候选 SHA、tarball integrity、运行身份与复跑记录 |
| 保护用例可能未触发 | 设计 §3.8，计划 T6/T11。按 12 个用例记录触发、产品事件与实际结果 |
| 完成率区间缺失 | 设计 §3.4，计划 T4。验证任务级分母、缺测、区间及门槛判定 |
| 测试与发布现状 | 既有套件 22/22。SP009 0.9.2 已由 `74c5156` 发布并完成官方源独立安装，见[发布回执](../../release-notes/v0.9.2.md) |

## 5. 交叉验证门禁

门禁命令 `npm run merge:gate`，两次执行均为 **GREEN**：

| 执行 | 范围 | merge-base / HEAD | outgoing | 结论 | 报告 |
| --- | --- | --- | --- | --- | --- |
| 合入前 | `feature/SP010/mid-term-coding-checkpoint` → master | `50e558f` / `7e8948c` | 3 commits / 10 files | GREEN | `artifacts/merge-gate/feature-SP010-mid-term-coding-checkpoint-2026-11-24T07-10-50-700Z.md` |
| 合入后 | master → master | `d09445a` / `d09445a` | 0 commits / 0 files | GREEN | `artifacts/merge-gate/master-2026-11-24T07-17-04-811Z.md` |

两次门禁的六项检查（`npm test`、`spec:check`、`skills:check`、`version:check`、`pack-smoke`、`test:upgrade`）退出码均为 0；禁带路径违规 0；报告 FAIL 行 0、UNVERIFIED 行 20、恢复条件节「有」。合并预演 `git merge-tree --write-tree 74c5156 7e8948c` 退出码 0、无冲突。合并提交 `d09445a`，ancestry 证明源 `7e8948c` 为 master 祖先。

门禁报告落在本地忽略目录，仓库只保留本节结论与路径。

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
- 恢复条件（统一）：进入实施后执行 T0–T11，按 §1 回填命令、cwd、数量和证据位置。T11 冻结身份并在最终候选上完成保护、真实 Provider、长任务和制品验收，复跑受 Core 修复影响的必验项。证据未齐的条目保留 UNVERIFIED，并注明缺项及恢复前提。
- 中期报告口径：本轮**只产出中期结果**，不得表述为完整替代，也不得使用「已对齐」「同等效果」类措辞。
