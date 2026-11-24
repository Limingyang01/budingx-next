# SP010 · 中期编码效果检查验证报告

状态：**v1.4 实施已启动，正式验收待执行**｜更新：2026-11-24｜输入基线 master `74c5156`（0.9.2 已发布）

配套：[迭代汇总](requirements-summary.md)｜[需求正本](coding-parity-checkpoint/requirements.md)、[core-reliability 需求](core-reliability/requirements.md)｜[设计 v1.4](design/design.zh.md)｜[计划 v1.4](design/plan.zh.md)

## 0. 本轮性质

本次按用户 2026-11-24 指令修订需求、设计、计划和验收记录。已完成 T0、TUI 正文连续性及手动压缩修复的定向回归。正式评测、真实 Provider、SP010 候选制品验证待执行，16 条 AC 保留 UNVERIFIED。既有测试复跑和脚本化复现作为文档修订依据，记录在 §3–§4。

## 1. AC 逐条结论

| AC ID | 结论 | 依据（文件 / 命令 / cwd / 数量） | 恢复条件 |
| --- | --- | --- | --- |
| AC-CP-01 任务集分母与快照 | UNVERIFIED | T1 校验器通过合成题集回归；正式 30 题及快照未齐备 | 完成 T1 并使 `node scripts/eval/validate.mjs --set cp-v1` 退出码 0 |
| AC-CP-02 盲测纪律 | UNVERIFIED | 未执行：B1 十条盲测与 B2 预留尚未建立（计划 T1、T6） | 任务集落地后，核对报告脱敏结构与修复记录不含盲测失败信息 |
| AC-CP-03 预算与回合上限 | UNVERIFIED | 已复现 token 超限却通过的旧行为，T2 待实施 | 请求、轮数、token、墙钟的预算证据齐备，超限且其他断言成功时仍记 `BUDGET` |
| AC-CP-04 真实编码任务执行 | UNVERIFIED | 正式真实 Provider 运行待 T11 | 在最终候选运行真实编码闭环，关联初测失败、修复、复测通过的转录、目标 diff 与独立测试 |
| AC-CP-05 统计与报告 | UNVERIFIED | T4 任务级统计待实现 | 最终候选报告包含任务等权完成率、95% 区间、重复一致性、分组、延迟 p50/p95 与证据不足的原因 |
| AC-CP-06 保护用例全通过 | UNVERIFIED | T6 受控触发与 T11 最终候选核对待实施 | 12 条逐条登记实际触发、产品证据和判定，确定性用例全部通过 |
| AC-CP-07 长任务稳定性 | UNVERIFIED | v1.4 复审已实测 CAN 恢复与直接续聊、T7 两条缺证路径；T11 正式长任务待执行 | T11 留存真实长会话压缩及恢复记录、CAN 恢复成功回执、回执历史中的首回合消息匹配、两个回合及唯一副作用。另附受控并发证据和下方 T7 表每一行的请求与终态记录 |
| AC-CP-08 npm 制品核对 | UNVERIFIED | T8 候选制品验证流程待落实 | 记录最终候选 SHA 和 tarball integrity，独立安装并完成只读定位题，核对路径和符号、Read 调用与成功结果、正常终态、入口、版本和数据路径 |
| AC-CP-09 仪器可信 | UNVERIFIED | SP007 既有套件 22/22；本次探针已区分恢复与直接续聊。SP010 评分器及正式整题验收待实施 | 三类 runner 误判（文件、预算、auth + 退出 0）和保护题预期终态均有回归及红绿证据。CAN 两回合仅算一次题次，错终态、跳过恢复入口、回执失败或错会话、返回历史无法关联首回合或重放均须判整题失败，续跑身份、统计、脱敏和快照用例纳入 `npm test`，实际执行且零失败 |
| AC-CP-10 中期报告口径 | UNVERIFIED | 最终候选报告待 T11 | 检查报告口径、候选身份、受影响项复跑证据及未验证项恢复条件 |
| AC-CR-01 接入前置核查 | UNVERIFIED | 未执行：`readiness.md` 尚未建立（计划 T9） | 登记参考行为与启用条件、本仓契约和 PASS/GAP 证据；单列团队任务与调度器两种租约 |
| AC-CR-02 Core 缺陷修复 | UNVERIFIED | T10 缺陷修复尚未开始 | 逐项登记红绿证据，T11 最终候选复跑受影响项，定向套件与 `npm test` 零失败 |
| AC-CR-03 评估回合上限必修项 | UNVERIFIED | 与 AC-CP-03 同源，T2 待实施 | 正常任务可超过原固定 8 轮，预算终止后整题仍记 `BUDGET` |
| AC-CR-04 输出上限与媒体完整性 | UNVERIFIED | T10 消费端验证待执行 | 核对文本上限、标记、原错误码与熔断计数。引用解析取回后，比对截图尺寸及 RGBA 像素摘要，或完整二进制 SHA-256；同尺寸错图、等长错文件、失效引用与损坏载荷均拒绝。仅文本链路向 SP012/SP013 登记媒体 GAP |
| AC-CR-05 无人值守审批 | UNVERIFIED | T9 契约核查待执行 | 核对动作无副作用、当前运行自行结束、调度可取得原因并通知；分别记录证据、缺口与归属 |
| AC-CR-06 交接材料 | UNVERIFIED | T11 交接材料待汇总 | readiness、修复清单、未修项、盲测批次及最终候选证据齐备，供 SP011–SP014 引用 |

以上 16 条产品 AC 均为 UNVERIFIED。旧评估器的复现结果见 §4。

## 2. 文档变更范围

v1.2 从 master `3b58c3c` 修订 SP010 的 8 份文档，并同步项目当前状态入口。产品行为与版本均无变化，说明书无需更新。v1.1 修订始于 `901e850`，以下保留首版合入范围。 v1.3 以 master `fd38b52` 为文档修订起点，补齐 CAN、媒体内容和 T7 逐路径判据，产品说明书无需更新。 v1.4 从 master `46b9183` 修订取证规则并登记截图反馈。此次为纯文档修订，产品说明书无需更新。

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

v1.4 文档检查通过。需求、计划和报告的 16 条 AC 编号一致，设计与报告逐行对应 9 条 T7 验收记录（含两种缺证续跑）；已核对各自的请求次数。9 份文档的 155 个本地链接目标均存在，表格列数和修订章节链接已核对。规格检查及 Git 空白检查均通过。

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

v1.3 的两回合评分、媒体内容与 hook 判据在 v1.4 继续适用。本次补充的取证字段与反例列于下节。

### v1.4 验收取证

- **CAN（AC-CP-07、AC-CP-09）**：非盲回归登记同一题次的会话、两个回合及各自终态。留存取消后、再次提交前的产品恢复入口回执（ok、sessionId），从其返回历史提取与取消前登记的首回合消息 ID 和内容标记相匹配的条目。另登记取消前及恢复后同一副作用的次数、剩余任务断言、整题结论。正例应为 `cancelled → completed`、`1 → 1`、整题一次 PASS。分别注入错终态、直接续聊、回执失败或来自其他会话、历史条目缺失或标记错配、重复副作用，整题均须 FAIL。正式盲题依 §1 的脱敏口径汇总。
- **媒体（AC-CR-04）**：登记 fixture 的预期值、解析状态、从消费端取得的实际尺寸和像素摘要或完整字节摘要，以及逐例判定；不可解析或无法解码时记录失败阶段。正例与指错内容的可读引用须给出相反判定。
- **T7（AC-CP-07）**：按[设计 T7 路径判据](design/design.zh.md#t7-路径判据)逐行记录同一候选的转录、触发后请求增量、相关请求内容和实际终态。GAP 须附参考分支、本仓候选源码和实际轨迹；本表的受控观察独立于正式长任务测量。

**2026-11-24 复审实测**。本仓 `master@bc00d2f`，参考仓 TUI `master_node@b5c9be8`。CAN 使用临时数据根、真实会话存储和本地 HTTP 流式 fixture；T7 使用脚本化 Provider、真实 Session 和隔离工作区。以下结果属于复审探针，T11 最终候选的正式 AC 仍为 UNVERIFIED。

| CAN 对照 | 两回合终态与身份 | 取消后、下一次提交前的恢复证据 | 判定 |
| --- | --- | --- | --- |
| 正例：调用 `runtime.sessions.resume(sessionId)` | `cancelled → completed`，两个不同回合 ID | 回执 `ok: true` 且 sessionId 匹配，返回的同一条历史消息同时匹配预先记录的首回合消息 ID 和内容标记；观察到 1 次 `conversation_restored` | 恢复证据齐备 |
| 反例：在原 Session 直接再次 submit | 同样为 `cancelled → completed`，两个不同回合 ID | 无恢复入口回执，无来自回执的历史匹配，恢复事件 0 次 | 成功排除直接续聊；按 CAN 判据该轨迹应失败 |

此探针验证了恢复动作的鉴别能力。目标副作用次数、剩余任务断言、共用预算及最终的整题评分留待候选验收。复审时另运行 `node --test src/tui/test/sp006-resume-history.test.mjs src/tui/test/coding-loop.test.mjs`，8/8 通过；`npm run spec:check` 通过。

| 路径 | 预期核对点 | 实际结果 |
| --- | --- | --- |
| 无工具正常结束（对照） | 后续 0 次，completed 一次 | UNVERIFIED |
| 工具回填续跑 | 后续 1 次，指定调用的结果回填一次，completed | UNVERIFIED |
| 上下文溢出恢复 | 压缩后重试 1 次；成功为 completed，再溢出为 error，无第三次主请求 | UNVERIFIED |
| 输出达限 | 本仓后续 0 次、length_capped；登记与参考恢复路径的差异 | UNVERIFIED |
| 缺完成证据续跑（受控状态注入） | 缺证通知后 1 次主请求；记录请求中的原因、夹具注入时点、无工具调用、命令执行 0 次、唯一 completed | 探针实测通过。通知后 1 次主请求，含缺证原因；夹具在响应结束前注入成功测试状态，命令启动 0 次，唯一终态 `completed` |
| 缺完成证据续跑（真实命令取证） | 缺证通知后 2 次主请求；第 1 次含缺证原因并调用测试工具，实际命令退出 0、产生成功测试证据；第 2 次带相同调用 ID 的成功结果后无工具收尾，唯一 completed。记录命令、退出码、调用 ID、两次请求和终态 | 探针实测通过。通知后 2 次主请求；第 1 次含缺证原因，通过 Bash 启动 1 次 `node --test proof.test.mjs`，测试 1/1、退出码 0；第 2 次请求携带 `v14-real-command` 对应的成功工具结果，唯一终态 `completed` |
| stop_hook_blocking | 参考端阻塞后继续 1 次；核对本仓阻塞原因消费与终态或单列 GAP | UNVERIFIED |
| stop_hook_prevented | 参考端后续 0 次，在 Stop 阶段阻止继续；核对对应终态或单列 GAP | UNVERIFIED |
| hook_stopped | 参考端后续 0 次，在工具阶段停止；核对工具结果、停止信号与终态或单列 GAP | UNVERIFIED |

拒绝执行对照：宿主策略在启动命令前拒绝，实测命令启动 0 次、通知后主请求 5 次，最终仍产生一次 `completed`；因缺少成功测试证据，不满足真实命令路径的通过条件。两条正例分开评分；真实命令路径缺执行证据、结果错配、提前结束均判失败。

### 0.9.2 TUI 正文连续性

状态为 **实施分支已修复，定向回归通过**。第一张图中，正文“今天是 2”与“026-11-24（周二）”被思考行隔开；第二张中，“子”与“agent 已返回 9 条新闻”也被思考行隔开。未取得当次原始事件流。

在本地 0.9.2 产品代码上用 `mountTty` 挂载真实 Ink 界面。同一 messageId 依次发出 `text_delta → thinking_delta → text_delta`，正文输入无换行。112 列与 36 列均观察到以下行序，且流式帧与完成帧一致（2 个样例 × 2 种列宽 × 2 个阶段，共 8/8 个观察点复现）。

| 样例 | 第一行正文 | 中间行 | 随后正文 |
| --- | --- | --- | --- |
| 日期 | 今天是 2 | Thinking - TRACE_THINK | 026-11-24（周二）。 |
| 中英混排 | 子 | Thinking - TRACE_THINK | agent 已返回 9 条新闻。 |

自然折行对照中，同一段纯正文在 112 列占 1 行、36 列占 3 行，字符均完整。正文自带换行及下一回合消息也保持分段。受控流的触发位置在 [TUI 渲染 reducer](../../src/tui/render/reducer.ts#L183)：收到思考增量时将已有正文写入转录并追加思考条目，剩余正文随后单列。本次观察来自进程内伪终端，用户原始流仍未知。修复后按相同输入复验，正文应连续、思考内容保留，自然折行和显式换行仍须正确。

修复后的定向回归覆盖实时、完成及恢复转录。参考 TUI 将流式正文与思考分别累积和渲染，见参考仓 `src/utils/messages.ts:3167` 和 `src/components/Messages.tsx:703`（`b5c9be8`）。本仓独立保留同一助手消息的正文缓冲，在消息结束时提交，恢复旧历史时跨思考块拼接正文，工具和中断仍作为边界。

- RED：`node --test --test-name-pattern "同一助手消息" src/tui/test/sp009-transcript-render.test.mjs`，两个样例 × 两种列宽共 4 个子用例均因无法找到连续正文失败。
- GREEN：`npm run build` 通过。定向运行 `node --test src/tui/test/render.test.mjs src/tui/test/sp009-transcript-render.test.mjs src/tui/test/sp006-resume-history.test.mjs`，29/29 通过。两个样例 × 两种列宽的流式帧及完成帧共 8 个观察点均为连续正文，思考条目各出现一次。真实 Windows Terminal 和发布制品尚待验证。

### 0.9.2 手动压缩

用户截图在单轮完成后显示 `压缩失败：no_compactable_range`。手动命令原先沿用自动压缩的边界，把最后一条用户消息当作当前请求而排除。参考 TUI 在手动压缩时把已结束的历史交给模型摘要，见参考仓 `src/commands/compact/compact.ts:44`（`b5c9be8`）。

- RED：单轮实际 `/compact` 返回 `no_compactable_range`，模型请求数为 0。两个新增命令回归均失败。
- GREEN：手动模型摘要在空闲时纳入最后一轮。成功后通过既有转录接口写回摘要，下一回合携带摘要；流失败或摘要超预算保持原历史。如果摘要期间已有其他操作改变会话，命令返回可重试的信息。
- `npm run build` 通过。`node --test src/tui/test/sp0054-command-fidelity.test.mjs src/core/test/sp009-loop-context.test.mjs src/core/test/session-persistence.test.mjs src/core/test/sp005-review-compaction.test.mjs` 34/34 通过。

### 实施阶段的评估器回归

- T1 校验器新增配额、盲题数、必需字段、保护题来源、快照版本及逐文件 SHA-256 检查。合成题集可通过，配额、缺题、缺字段、篡改及未登记文件会被拒绝。正式 `set-cp-v1.json` 与快照待填写。
- T2 已复测旧版的文件断言清理顺序、token 超限被评分掩盖、验证命令退出 0 掩盖鉴权失败及固定 8 轮上限，修复前均失败。live 路径采用 cp-v1 的 B/A/P 预算，保留会话原始终态、独立验证退出码与任务判定。9 次工具调用加最后一次回复的任务能完成；请求、token、轮数及墙钟超限均判 BUDGET。
- `node --test src/tui/test/sp007-eval.test.mjs src/tui/test/sp010-eval.test.mjs` 共 29/29 通过。预期取消及 CAN 整题评分仍待接入，正式题集和正式 AC 保留 UNVERIFIED。

- T3 的 live 路径按任务显式声明的 `permissionMode` 装配产品执行工具，`approval` 支持 allow、deny、deny_then_allow。受控 Provider 证实只读拒绝，工作区内修改档在首次拒绝后继续请求并完成实际子进程命令。真实模型的编码闭环仍待验收。
- 首次全量运行的技能发现用例 SM-01 可单独复现。临时工作区没有项目边界，父目录中的技能进入精确数量断言。测试夹具加入仓库边界后，该文件 7/7 通过。

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
| 回退方式 | 如需回退 v1.4，仅还原本次文档修订，保留 v1.3 及历史记录 |

## 7. UNVERIFIED 汇总与恢复条件

- 16 条 AC 的最终候选验收均待执行（UNVERIFIED）。v1.4 复审探针与 0.9.2 缺陷复现的实测结果见 §4。
- 恢复条件（统一）：进入实施后执行 T0–T11，按 §1 回填命令、cwd、数量和证据位置。T11 冻结身份并在最终候选上完成保护、真实 Provider、长任务和制品验收，复跑受 Core 修复影响的必验项。证据未齐的条目保留 UNVERIFIED，并注明缺项及恢复前提。
- 中期报告口径：本轮**只产出中期结果**，不得表述为完整替代，也不得使用「已对齐」「同等效果」类措辞。
