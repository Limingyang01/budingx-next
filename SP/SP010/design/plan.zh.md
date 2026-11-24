# SP010 · 中期编码效果检查实施计划

版本 v1.3｜2026-11-24｜输入基线 master `74c5156`｜实施分支在 T0 确认

目标：交付[需求正本](../coding-parity-checkpoint/requirements.md)的 CP-01…CP-10 与[core-reliability 需求](../core-reliability/requirements.md)的 CR-01…CR-06。设计依据为[设计 v1.3](design.zh.md)；进度见[迭代汇总](../requirements-summary.md)和两项 STATUS。本次修订停在文档阶段。

## 架构与全局约束

沿用现有 Core、工具、Storage 与宿主边界：TypeScript + Node test runner + Node 22.18+，不引入 Bun，不新增运行时依赖。评估资产仍放 `scripts/eval/`（不进 `src/` 包，不进 npm 制品）。每项改动先写有意义的失败用例（RED），再做最小实现，复跑到 GREEN，再跑定向套件与 `npm test`。命令 cwd 为仓库根；临时工作区与用户数据根隔离；不读写真实 `~/.budingx`，不触碰 `~/.claude`。不改产品的用户可见行为；测量口径的改动不得顺带改产品语义。盲测失败细节不落盘、不进文档、不进修复依据。无本仓 formatter 配置时沿用既有文件风格（2 空格、ESM、无分号）。

预算档、任务集与快照均版本化。T0 确认实施起点。T6–T8 准备验证并可做非盲预跑，T9–T10 定位和修复，T11 冻结最终候选后执行正式验收和交接。预跑与正式验收各有运行 ID。

| 任务 | 改动路径与责任 | Consumes → Produces | 单元 RED → GREEN | 功能 RED → GREEN |
| --- | --- | --- | --- | --- |
| T0 基线与分支确认（前置，无 AC） | Git 与文档；`SP/SP010/requirements-summary.md` | 0.9.2 发布源码 `74c5156` → 单独记录评估输入基线与经复核的实施起点 | — | `git log`、`git status` 与实时 refs 核对祖先关系、工作区和实际分支；确认真实 Provider 运行前提 |
| T1 任务集 v1 与快照（AC-CP-01、AC-CP-02） | `scripts/eval/tasks/set-cp-v1.json`（拟新增）、`scripts/eval/fixtures/CP-*/`（拟新增）、`scripts/eval/validate.mjs`（拟新增）、`scripts/eval/lib/tasks.mjs` | SP001 题库规格 → 30 条可执行任务（18 基本 + 12 保护）、B1 十条盲测、版本化快照与 SHA-256 登记 | 校验器用例：字段缺失、类别分布不符、盲测数量不足、保护用例缺失、快照哈希不符 → 逐条失败；修复后全通过 | `node scripts/eval/validate.mjs --set cp-v1` 退出码 0；报告条目中盲测无失败细节；B1/B2 登记写入 STATUS |
| T2 预算与文件断言修正（AC-CP-03、AC-CP-09、AC-CR-03） | `scripts/eval/lib/tasks.mjs`、`scripts/eval/lib/runner-core.mjs`、`src/tui/test/sp007-eval.test.mjs` | SP001 §7、三类已复现误判 → 版本化预算档、优先预算终态、清理前文件断言 | 先复现误判。分别覆盖请求数、轮数、token、墙钟终止，其他断言成功时仍记 `BUDGET`。分别记录会话终态、命令退出码及任务判定；覆盖 auth + 退出 0、预期取消/错误、存在/内容/缺失断言及异常清理 | 脚本化 Provider 驱动真实 runner：已有文件检查通过，错误的缺失断言失败；超限任务状态为失败且分类为 `BUDGET`；普通题 auth 保留错误且失败，保护题按声明及副作用评分；CAN 用同一题次的取消、恢复两回合核验唯一副作用和整题结论；正常任务可超过原固定 8 轮 |
| T3 真实执行、权限与审批路径（AC-CP-04） | `scripts/eval/lib/runner-core.mjs`（live 装配）、`src/exec/*` 复用 | 任务声明（权限档、审批策略）→ 真实执行工具装配、隔离 cwd、按声明注入的审批网关 | 装配用例：read_only 下写入被拒、workspace_edit 下允许、越界改动被 `scope` 断言判失败；执行工具受只读与破坏性命令规则约束 | 真实 Provider 跑「跑测试→读失败→修复→重跑」任务，核对初测失败、修复、复测通过的工具转录，再比对 diff 与独立测试；审批「先拒绝后允许」场景证明拒绝后会话继续 |
| T4 任务级统计与报告（AC-CP-05、AC-CP-10） | `scripts/eval/lib/report.mjs`、`scripts/eval/runner.mjs`、`scripts/eval/live.mjs` | 运行记录 → 类别分组、重复一致性、任务等权完成率及 95% 区间、延迟 p50/p95 和成本 | 覆盖结果组、缺重复、全通过区间、门槛跨界、预算失败计入分母和盲测脱敏。两题各三次（3/3、1/3）时独立任务数为 2、完成率为 2/3 | 用完整固定数据核对报告结构、目录、指标口径与未验证原因 |
| T5 扩展既有评估器回归与续跑校验（AC-CP-09） | `src/tui/test/sp007-eval.test.mjs`、`scripts/eval/live.mjs`、`scripts/eval/runner.mjs` | SP007 既有测试 + 设计 §3.5 → 续跑身份校验与新增回归 | CAN 计分回归覆盖两回合分别为 cancelled/completed 且副作用恰好一次、错误终态、恢复失败以及重复副作用；覆盖快照校验、预算终态、清理顺序、统计、落盘脱敏；分别测试身份相同可续跑和源码、评估器、题集、模型或预算变化时拒绝 | 续跑只跳过当前身份的完成项，累计预算延续；盲测临时结果与报告均无失败原文；`npm test` 执行既有和新增用例且零失败 |
| T6 固定／盲测运行准备与确定性保护（AC-CP-04、AC-CP-06） | `scripts/eval/live.mjs`、CP-SET-v1 任务与 fixture | 保护设计 §3.8 → 12 个受控触发与证据检查、非盲预跑和修复输入 | 对「已触发且结果正确」「已触发但结果错误」「无触发」分别断言 PASS、FAIL、UNVERIFIED | 执行真实产品路径并核对逐条触发。用非盲预跑定位缺陷；正式真实 Provider 结果和最终候选的 12/12 保护结果在 T11 登记 |
| T7 长任务验证准备（AC-CP-07） | CP-SET-v1 长任务、受控工具及隔离 fixture | 设计 §3.6、§8 → 长会话断言与本仓事件映射 | 缺压缩、静默丢历史、重放副作用均须失败；用屏障证明安全调用重叠、非安全调用独占，核对单点失败及同批结果各按 ID 回填一次、顺序正确 | T11 以真实 Provider 验证约束、历史、取消与预算；另留受控分派证据，逐行执行[设计 T7 路径判据](design.zh.md#t7-路径判据)，核对触发、后续请求增量、内容与终态。三个 hook 分支各留一份行为记录或附候选源码的 GAP，缺证记 UNVERIFIED |
| T8 制品验证准备（AC-CP-08） | 复用生命周期安装脚本、非盲只读定位 fixture | 冻结候选、题目和预期路径/符号 → 安装入口、摘要与答案核对 | 候选或摘要不符、错答、无 Read、读取失败或 ID 不配对均不能通过 | T11 在隔离 home 与仓库外安装同一 tarball，以真实 Provider 驱动安装 CLI；核对退出码、终态、答案、成对读取事件和隔离数据路径 |
| T9 接入前置核查（AC-CR-01、AC-CR-05） | 拟建 readiness.md；核对 Core、headless、宿主及调度边界 | 四方向与设计 §8 → 参考行为、启用条件、本仓证据、PASS/GAP、差异归属 | — | 分列团队创建/消息、团队任务租约、调度开关及调度器锁接管；追踪审批动作副作用、当前运行退出、原因传递与通知，逐项给证据或 GAP |
| T10 Core 缺陷修复（AC-CR-02、AC-CR-04） | `src/core/*`（仅按 T9 与 T6 结论确定） | 缺陷清单 → 修复后的 Core 行为 | 每项先写失败用例（RED）→ 实现 → 复测（GREEN）；D2 验证文本上限、错误码与熔断计数，先解析引用并读取内容，再比对截图尺寸及 RGBA 像素摘要或完整二进制 SHA-256。正确引用可通过；可读错图、等长错文件、失效引用及损坏载荷均须失败；仅文本通道时登记 SP012/SP013 缺口 | 定向套件 + `npm test` 零失败；TUI、无头、serve 三入口行为未变；失败归入 SP001 §6 分类并登记 |
| T11 最终候选验收、交接与集成（AC-CP-04…08、AC-CP-10、AC-CR-02、AC-CR-06） | `SP/SP010/test-report.md`、两项 STATUS、迭代汇总、`docs/current-status.md`、`PRODUCT.md`、版本清单与发行说明 | T10 修复 + T6–T8 验证流程 → 绑定同一候选的验收与交接 | 校验报告的候选身份和证据对应关系，拒绝并入旧 run 或其他 tarball 的记录 | 版本按 minor 准备后冻结候选与 tarball。完成正式题集每题 ≥3 次、12 条确定性保护、长任务与制品验证、受影响项定向复跑，并登记缺证项和恢复条件；门禁 GREEN 后合入、推送 |

T11 顺序为「版本准备 → 冻结候选与运行身份 → 执行正式核对与受影响项复跑 → 报告与集成」。若候选身份变化，使用新 run，旧候选只保留诊断证据。汇总同时记录最终候选 SHA、tarball integrity 和实际各层证据的归属。集成后若构建或运行输入发生变化，重新冻结并验证受影响项。

## 定向命令

现有命令（cwd 为仓库根）：

```bash
npm run build
node --test src/tui/test/sp007-eval.test.mjs
npm test
npm run merge:gate
```

T1–T5 交付后新增/可用：

```bash
node scripts/eval/validate.mjs --set cp-v1          # 题库与快照校验
node scripts/eval/runner.mjs --set cp-v1 --repeats 3 # 离线回归集
```

T6–T8 准备后供 T11 使用（真实 Provider，需 `.env.e2e.local`；不入 `npm test`）：

```bash
node scripts/eval/live.mjs --set cp-v1 --repeats 3 --run-id sp010-cp-v1
node scripts/eval/live.mjs --set cp-v1 --batch ctx --resume sp010-cp-v1
```

制品核对从最终候选提交构建 tarball。现有生命周期脚本提供仓库外隔离安装 smoke，AC-CP-08 还须使用同一 tarball 的安装入口运行非盲只读定位题，保留预期答案比对及 Read 调用/结果。下列两条命令只提供安装和发布预演证据：

```bash
npm run test:install
npm run publish -- --dry-run --expected-version <版本> --tag latest
```

实际 npm 发布由维护者在 GitHub 手动触发；打标签、远端设置与分支清理不在本轮授权内。

## 测试收口映射

| AC | 覆盖任务 | 单元用例 | 功能/端到端用例 |
| --- | --- | --- | --- |
| AC-CP-01 | T1 | 校验器各项失败与通过 | `validate.mjs --set cp-v1` 退出码 0 |
| AC-CP-02 | T1 | 盲测脱敏与 B1/B2 登记 | 报告结构核对 + 修复记录无盲测失败信息 |
| AC-CP-03 | T2 | 四种预算终止、档位取值及终态优先级 | 超限且其余断言成功仍以 `BUDGET` 失败 |
| AC-CP-04 | T3、T6、T11 | 权限、审批路径与 scope | 核对初测失败→修复→复测通过的工具转录、目标 diff 与独立测试 |
| AC-CP-05 | T4、T11 | 任务级统计、区间及缺测 | 最终候选报告结构与数据核对 |
| AC-CP-06 | T6、T11 | 保护结果分类和触发证据判定 | 12 条确定性保护逐条有触发证据且均 PASS |
| AC-CP-07 | T7、T11 | T7 路径表逐行核对触发、后续请求及终态，分别记录三个 hook 出口；并发按调用 ID 验证 | 最终候选真实长会话按预算核对压缩、约束与 CAN 取消/恢复两回合，受控路径逐条附证据 |
| AC-CP-08 | T8、T11 | 候选、错答、缺读、错误或错配结果 | 已安装 CLI 的正常终态、预期路径与符号、配对的成功 Read 事件 |
| AC-CP-09 | T2、T5 | 文件、预算、auth + 退出 0、保护题预期终态；CAN 共用预算，错终态、恢复失败或重放时整题失败 | 真实 runner 记录两回合及副作用次数，按一次题次评分；核对 npm test 计数与退出码 |
| AC-CP-10 | T4、T11 | 报告与候选身份校验 | 报告措辞、结构和证据来源核对 |
| AC-CR-01 | T9 | — | 抽查四方向参考行为、开关、本仓证据与差异归属，分别核实两种租约 |
| AC-CR-02 | T10、T11 | 每项缺陷的 RED→GREEN | 最终候选受影响项定向复跑 + `npm test` |
| AC-CR-03 | T2 | 回合上限与预算终止 | 超限任务终止记录 |
| AC-CR-04 | T10 | 文本上限与原错误，正确、指错、失效引用及损坏载荷 | 消费端解析后比对截图尺寸与 RGBA 像素摘要或完整字节 SHA-256；仅文本链路记录媒体 GAP |
| AC-CR-05 | T9 | — | 静态追踪无副作用、当前运行结束、原因及通知可达性，记录分层归属 |
| AC-CR-06 | T11 | — | 交接材料与文档同步核对 |

行为 AC 须有单元及功能证据。接入核查与文档交接按各自的静态验收条件执行；一次即绿的用例须核对能捕获对应行为。零测试、全部跳过与基础设施报错不构成 RED 或 PASS。

## 完成事实

实施阶段逐项回填：实际变更文件、执行命令与 cwd、实际数量与结果、证据位置、缺口。当前全部为「未执行」。

## 复审重点

需要主动注入失败的路径：预算触顶与超时竞态、快照被改动而哈希未更新、盲测失败信息经报告泄漏、评估器截断掩盖真实收敛、审批拒绝后回合不再继续、执行工具越过工作区边界、真实安装后数据写到用户真实目录、readiness 把新能力误当缺陷修掉、Core 修复只在 TUI 生效而无头与 serve 行为漂移、报告用总体平均掩盖关键分组。

计划与设计同版；任一 AC 或范围变化须先更新需求正本并重新自审，格式修改不使批准失效。
