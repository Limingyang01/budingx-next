# SP010 · 中期编码效果检查验证报告

状态：**文档 v1.3 已修订，实施未开始**｜更新：2026-11-24｜输入基线 master `74c5156`（0.9.2 已发布）

配套：[迭代汇总](requirements-summary.md)｜[需求正本](coding-parity-checkpoint/requirements.md)、[core-reliability 需求](core-reliability/requirements.md)｜[设计 v1.3](design/design.zh.md)｜[计划 v1.3](design/plan.zh.md)

## 0. 本轮性质

本次按用户 2026-11-24 指令修订需求、设计、计划和验收记录。正式评测、修复、真实 Provider、SP010 候选制品验证均待实施，16 条 AC 保留 UNVERIFIED。既有测试复跑和脚本化复现作为文档修订依据，记录在 §3–§4。

## 1. AC 逐条结论

| AC ID | 结论 | 依据（文件 / 命令 / cwd / 数量） | 恢复条件 |
| --- | --- | --- | --- |
| AC-CP-01 任务集分母与快照 | UNVERIFIED | 未执行：任务集文件与校验器尚未建立（计划 T1） | 完成 T1 并使 `node scripts/eval/validate.mjs --set cp-v1` 退出码 0 |
| AC-CP-02 盲测纪律 | UNVERIFIED | 未执行：B1 十条盲测与 B2 预留尚未建立（计划 T1、T6） | 任务集落地后，核对报告脱敏结构与修复记录不含盲测失败信息 |
| AC-CP-03 预算与回合上限 | UNVERIFIED | 已复现 token 超限却通过的旧行为，T2 待实施 | 请求、轮数、token、墙钟的预算证据齐备，超限且其他断言成功时仍记 `BUDGET` |
| AC-CP-04 真实编码任务执行 | UNVERIFIED | 正式真实 Provider 运行待 T11 | 在最终候选运行真实编码闭环，关联初测失败、修复、复测通过的转录、目标 diff 与独立测试 |
| AC-CP-05 统计与报告 | UNVERIFIED | T4 任务级统计待实现 | 最终候选报告包含任务等权完成率、95% 区间、重复一致性、分组、延迟 p50/p95 与证据不足的原因 |
| AC-CP-06 保护用例全通过 | UNVERIFIED | T6 受控触发与 T11 最终候选核对待实施 | 12 条逐条登记实际触发、产品证据和判定，确定性用例全部通过 |
| AC-CP-07 长任务稳定性 | UNVERIFIED | T7 场景待建立 | T11 留存真实长会话压缩及恢复记录、CAN 两回合及唯一副作用。另附受控并发证据和下方 T7 表每一行的请求与终态记录 |
| AC-CP-08 npm 制品核对 | UNVERIFIED | T8 候选制品验证流程待落实 | 记录最终候选 SHA 和 tarball integrity，独立安装并完成只读定位题，核对路径和符号、Read 调用与成功结果、正常终态、入口、版本和数据路径 |
| AC-CP-09 仪器可信 | UNVERIFIED | SP007 既有套件复跑 22/22 通过，SP010 增量回归待实施 | 三类 runner 误判（文件、预算、auth + 退出 0）和保护题预期终态均有回归及红绿证据。CAN 两回合仅算一次题次，错终态、恢复失败或重放均须判整题失败，续跑身份、统计、脱敏和快照用例纳入 `npm test`，实际执行且零失败 |
| AC-CP-10 中期报告口径 | UNVERIFIED | 最终候选报告待 T11 | 检查报告口径、候选身份、受影响项复跑证据及未验证项恢复条件 |
| AC-CR-01 接入前置核查 | UNVERIFIED | 未执行：`readiness.md` 尚未建立（计划 T9） | 登记参考行为与启用条件、本仓契约和 PASS/GAP 证据；单列团队任务与调度器两种租约 |
| AC-CR-02 Core 缺陷修复 | UNVERIFIED | T10 缺陷修复尚未开始 | 逐项登记红绿证据，T11 最终候选复跑受影响项，定向套件与 `npm test` 零失败 |
| AC-CR-03 评估回合上限必修项 | UNVERIFIED | 与 AC-CP-03 同源，T2 待实施 | 正常任务可超过原固定 8 轮，预算终止后整题仍记 `BUDGET` |
| AC-CR-04 输出上限与媒体完整性 | UNVERIFIED | T10 消费端验证待执行 | 核对文本上限、标记、原错误码与熔断计数。引用解析取回后，比对截图尺寸及 RGBA 像素摘要，或完整二进制 SHA-256；同尺寸错图、等长错文件、失效引用与损坏载荷均拒绝。仅文本链路向 SP012/SP013 登记媒体 GAP |
| AC-CR-05 无人值守审批 | UNVERIFIED | T9 契约核查待执行 | 核对动作无副作用、当前运行自行结束、调度可取得原因并通知；分别记录证据、缺口与归属 |
| AC-CR-06 交接材料 | UNVERIFIED | T11 交接材料待汇总 | readiness、修复清单、未修项、盲测批次及最终候选证据齐备，供 SP011–SP014 引用 |

以上 16 条产品 AC 均为 UNVERIFIED。旧评估器的复现结果见 §4。

## 2. 文档变更范围

v1.2 从 master `3b58c3c` 修订 SP010 的 8 份文档，并同步项目当前状态入口。产品行为与版本均无变化，说明书无需更新。v1.1 修订始于 `901e850`，以下保留首版合入范围。 v1.3 以 master `fd38b52` 为文档修订起点，补齐 CAN、媒体内容和 T7 逐路径判据，产品说明书无需更新。

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

v1.2 文档检查在仓库根执行。`npm run spec:check` 通过；两份需求、实施计划和本报告的 16 个 AC 编号逐一匹配，七条意见均有任务与验收落点。9 份修改文档中的 146 个相对链接目标文件均存在，`git diff --check` 通过。

v1.3 仅执行文档检查。需求、计划与本报告的 16 个 AC 编号一致，两张 T7 表的 8 个路径逐行匹配；9 份修改文档的 150 个相对链接目标文件均存在。仓库未配置 Markdown formatter，已检查表格列数与空白。`npm run spec:check` 和 `git diff --check` 均通过。

## 4. Bug 闭环与本轮核对发现

以下为文档阶段核对的既有缺陷，修复安排在实施阶段：

1. 评估器向会话注入 `maxIterations: 8`（`scripts/eval/lib/runner-core.mjs:163`），而产品主循环自 0.9.1 起默认无上限（`src/core/session.ts:1662`）——当前测量对象是被截断的产品。修复任务：计划 T2（AC-CP-03、AC-CR-03）。
2. 评估预算档与 SP001 §7 不一致（`scripts/eval/lib/tasks.mjs:48-52` 的 B 档为 8 次请求 / 20000 token / 60000 ms，规格为 30 轮 / 10 分钟）。修复任务：计划 T2（AC-CP-03）。

3. 已存在的 `task-b07` fixture 文件 `src/calc.js` 被 `file_exists` 错判缺失（清理先于断言，[runner](../../scripts/eval/lib/runner-core.mjs#L500)）。T2/T5 在同一套件补存在、缺失、内容及清理顺序回归。
4. 脚本化响应使用 33 token，将上限设为 1，并令 `scope` 断言成功。现有 runner 同时返回 `budgetExceeded: tokens` 与 `status: passed`（[runner](../../scripts/eval/lib/runner-core.mjs#L505)）。T2/T5 回归要求整次运行失败且归类 `BUDGET`。
5. 审核 v1.1 时，隔离工作区的脚本化 Provider 唯一一次请求返回 auth，独立验证命令退出 0，只断言会话 completed；现有 runner 返回 passed、completed，同时保留 auth 错误。原有套件当时 22/22 通过。此例是 T2/T5 的失败基线。

**v1.1 历史修订**

| 审阅发现 | 修订落点与恢复证据 |
| --- | --- |
| runner 两处误判 | 设计 §3.2，计划 T2/T5。逐项保留失效场景和修复后的定向证据 |
| 最终候选证据归属 | 设计 §3.5，计划 T11。登记候选 SHA、tarball integrity、运行身份与复跑记录 |
| 保护用例可能未触发 | 设计 §3.8，计划 T6/T11。按 12 个用例记录触发、产品事件与实际结果 |
| 完成率区间缺失 | 设计 §3.4，计划 T4。验证任务级分母、缺测、区间及门槛判定 |
| 测试与发布现状 | 既有套件 22/22。SP009 0.9.2 已由 `74c5156` 发布并完成官方源独立安装，见[发布回执](../../release-notes/v0.9.2.md) |

**v1.2 审核意见与验收追踪**

| 意见 | 验收条件 | 计划及应留证据 |
| --- | --- | --- |
| 1. 鉴权失败被验证命令覆盖 | AC-CP-09 | T2/T5 普通题与预期错误保护题分别核对原始终态、命令和最终判定 |
| 2. 团队、调度与租约 | AC-CR-01 | T9 对照启用条件，分别核查团队任务归属与调度器争用、接管 |
| 3. 截图与二进制完整性 | AC-CR-04 | T10 消费端解码或核对完整字节摘要，验证无效引用 |
| 4. 无人值守审批 | AC-CR-05 | T9 从动作副作用、退出到调度通知逐段定位缺口 |
| 5. 主循环恢复、终止与分派 | AC-CP-07 | T7/T11 核对事件映射、实际重叠、单点失败和结果归属 |
| 6. 编码基线的取证方法 | AC-CP-04、AC-CP-08 | T3/T8/T11 采用独立 fixture、工具转录与结果断言，区分 server/WebSocket 与安装 CLI 的证据 |
| 7. 已安装制品的任务结果 | AC-CP-08 | T8/T11 比对预期路径和符号，并核对目标文件的成功读取 |

### v1.3 验收取证

- **CAN（AC-CP-07、AC-CP-09）**：非盲回归登记同一题次的会话、两个回合、各自预期与实际终态、取消前及恢复后同一副作用的次数、剩余任务断言、整题结论。正例应为 `cancelled → completed`、`1 → 1`、整题一次 PASS。分别注入错终态、恢复失败和重复副作用，整题均须 FAIL。正式盲题依 §1 的脱敏口径汇总。
- **媒体（AC-CR-04）**：登记 fixture 的预期值、解析状态、从消费端取得的实际尺寸和像素摘要或完整字节摘要，以及逐例判定；不可解析或无法解码时记录失败阶段。正例与指错内容的可读引用须给出相反判定。
- **T7（AC-CP-07）**：按[设计 T7 路径判据](design/design.zh.md#t7-路径判据)逐行记录同一候选的转录、触发后请求增量、相关请求内容和实际终态。GAP 须附参考分支、本仓候选源码和实际轨迹；本表的受控观察独立于正式长任务测量。

| 路径 | 预期核对点 | 实际结果 |
| --- | --- | --- |
| 无工具正常结束（对照） | 后续 0 次，completed 一次 | UNVERIFIED |
| 工具回填续跑 | 后续 1 次，指定调用的结果回填一次，completed | UNVERIFIED |
| 上下文溢出恢复 | 压缩后重试 1 次；成功为 completed，再溢出为 error，无第三次主请求 | UNVERIFIED |
| 输出达限 | 本仓后续 0 次、length_capped；登记与参考恢复路径的差异 | UNVERIFIED |
| 缺完成证据续跑 | coding_task 通知后请求 1 次，补齐证据后 completed；持续缺证时核对重试上限与任务未验证状态 | UNVERIFIED |
| stop_hook_blocking | 参考端阻塞后继续 1 次；核对本仓阻塞原因消费与终态或单列 GAP | UNVERIFIED |
| stop_hook_prevented | 参考端后续 0 次，在 Stop 阶段阻止继续；核对对应终态或单列 GAP | UNVERIFIED |
| hook_stopped | 参考端后续 0 次，在工具阶段停止；核对工具结果、停止信号与终态或单列 GAP | UNVERIFIED |

## 5. 交叉验证门禁

首版集成的门禁命令 `npm run merge:gate`，两次执行均为 **GREEN**：

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
| 回退方式 | 如需回退 v1.3，只还原本次文档修订，保留 v1.2 及历史记录 |

## 7. UNVERIFIED 汇总与恢复条件

- 本报告共 16 条 AC，全部为未执行（UNVERIFIED），无失败项、无部分通过项。
- 恢复条件（统一）：进入实施后执行 T0–T11，按 §1 回填命令、cwd、数量和证据位置。T11 冻结身份并在最终候选上完成保护、真实 Provider、长任务和制品验收，复跑受 Core 修复影响的必验项。证据未齐的条目保留 UNVERIFIED，并注明缺项及恢复前提。
- 中期报告口径：本轮**只产出中期结果**，不得表述为完整替代，也不得使用「已对齐」「同等效果」类措辞。
