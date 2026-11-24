# SP010 · 中期编码效果检查实施计划

版本 v1.0｜2026-11-24｜基线 master `74c5156`｜分支 `feature/SP010/mid-term-coding-checkpoint`

目标：交付[需求正本](../coding-parity-checkpoint/requirements.md)的 CP-01…CP-10 与[core-reliability 需求](../core-reliability/requirements.md)的 CR-01…CR-06。设计依据为[设计 v1.0](design.zh.md)；进度记录在[迭代汇总](../requirements-summary.md)与两项 STATUS。本计划直接沿用设计自审结论，不另行请求批准。

## 架构与全局约束

沿用现有 Core、工具、Storage 与宿主边界：TypeScript + Node test runner + Node 22.18+，不引入 Bun，不新增运行时依赖。评估资产仍放 `scripts/eval/`（不进 `src/` 包，不进 npm 制品）。每项改动先写有意义的失败用例（RED），再做最小实现，复跑到 GREEN，再跑定向套件与 `npm test`。命令 cwd 为仓库根；临时工作区与用户数据根隔离；不读写真实 `~/.budingx`，不触碰 `~/.claude`。不改产品的用户可见行为；测量口径的改动不得顺带改产品语义。盲测失败细节不落盘、不进文档、不进修复依据。无本仓 formatter 配置时沿用既有文件风格（2 空格、ESM、无分号）。

预算档、任务集与快照均版本化：变更只能整体调整一次并记录版本；同一快照版本重跑必须得到相同起点。

| 任务 | 改动路径与责任 | Consumes → Produces | 单元 RED → GREEN | 功能 RED → GREEN |
| --- | --- | --- | --- | --- |
| T0 基线与分支冻结（前置，无 AC） | Git 与文档；`SP/SP010/requirements-summary.md` | master `74c5156`（已含 SP009 短路径兼容修复 `50e558f`／`03ad128`）→ 冻结的 SP010 基线 SHA | — | `git log`/`git status` 核对基线与工作区干净；复核实时 refs（并发会话可能再次推进 master）；`.env.e2e.local` 存在且不入库 |
| T1 任务集 v1 与快照（AC-CP-01、AC-CP-02） | `scripts/eval/tasks/set-cp-v1.json`（拟新增）、`scripts/eval/fixtures/CP-*/`（拟新增）、`scripts/eval/validate.mjs`（拟新增）、`scripts/eval/lib/tasks.mjs` | SP001 题库规格 → 30 条可执行任务（18 基本 + 12 保护）、B1 十条盲测、版本化快照与 SHA-256 登记 | 校验器用例：字段缺失、类别分布不符、盲测数量不足、保护用例缺失、快照哈希不符 → 逐条失败；修复后全通过 | `node scripts/eval/validate.mjs --set cp-v1` 退出码 0；报告条目中盲测无失败细节；B1/B2 登记写入 STATUS |
| T2 预算与回合上限对齐（AC-CP-03、AC-CR-03） | `scripts/eval/lib/tasks.mjs`、`scripts/eval/lib/runner-core.mjs` | SP001 §7 预算档 + 产品无固定上限 → 版本化预算档、评估预算标注、终止分类 `BUDGET` | 预算用例：超请求/超 token/超时分别以 `BUDGET` 终止；预算档取值与 SP001 §7 一致；不再注入固定 8 轮 | 构造 30 轮档任务与超限任务各跑一次，报告分别显示通过与 `BUDGET` 失败并标注「评估预算」 |
| T3 真实执行、权限与审批路径（AC-CP-04、AC-CR-05） | `scripts/eval/lib/runner-core.mjs`（live 装配）、`src/exec/*` 复用 | 任务声明（权限档、审批策略）→ 真实执行工具装配、隔离 cwd、按声明注入的审批网关 | 装配用例：read_only 下写入被拒、workspace_edit 下允许、越界改动被 `scope` 断言判失败；执行工具受只读与破坏性命令规则约束 | 真实 Provider 跑「跑测试→读失败→修复→重跑」任务，断言为测试通过 + 差异比对；审批「先拒绝后允许」场景证明拒绝后会话继续 |
| T4 统计与报告（AC-CP-05、AC-CP-10） | `scripts/eval/lib/report.mjs`、`scripts/eval/runner.mjs`、`scripts/eval/live.mjs` | 运行结果 → 类别分组、重复一致性、p50/p95、失败分类、token/费用、预算失败数、参数化目录与标题 | 统计用例：构造 3 次重复结果，聚合出独立任务数、一致性比例、p50/p95 与失败分类；盲测条目只含状态与计数 | 一次完整运行后核对报告结构与目录（`artifacts/quality-runs/SP010/...`），措辞检查无「已对齐」「完整替代」 |
| T5 评估器自测纳入 `npm test`（AC-CP-09） | `scripts/eval/*.test.mjs`（拟新增）、`package.json` | 评估器内部契约 → 可执行回归 | 覆盖清单校验、预算执行、断言求值、统计聚合、盲测脱敏 | `npm test` 输出中评估器用例实际执行且零失败；用例数为 0 时本任务不成立 |
| T6 真实模型运行：固定、盲测与保护用例（AC-CP-04、AC-CP-06） | `scripts/eval/live.mjs`、`.env.e2e.local`（不入库） | CP-SET-v1 → 真实 Provider 运行结果（每题 ≥3 次） | — | 保护用例 12 条全部 PASS（任一失败即本轮不达标）；盲测只出聚合；分批续跑记录与成本闸生效；触顶项标 UNVERIFIED 并写恢复条件 |
| T7 长任务场景（AC-CP-07） | `scripts/eval/tasks/set-cp-v1.json`（长任务条目）、`scripts/eval/fixtures/CP-CTX-*/` | 多步修改 + 压缩 + 恢复 + 取消 → 稳定性结论 | — | 真实 Provider 运行：约束在压缩后保留、恢复不静默丢历史、取消后不重放副作用且终态明确；耗时与 token 在预算内并记录 |
| T8 npm 制品核对（AC-CP-08） | `scripts/release/lifecycle.mjs` 复用、发布脚本 | 当前 tarball → 隔离安装后的行为证据 | — | 仓库外隔离安装后用安装入口完成一次最小真实编码任务；入口、版本、数据路径与源码一致或差异被逐条记录；安装与运行退出码 0 |
| T9 接入前置核查（AC-CR-01） | `SP/SP010/core-reliability/readiness.md`（拟新增） | SP011–SP014 的能力矩阵与路线图行 → 契约项 × PASS/GAP × 证据 × 归属 | — | 每个 PASS 至少指向一处真实实现或测试；每个 GAP 标注缺陷/新能力/测量口径；抽样复核无「大概没问题」式结论 |
| T10 Core 缺陷修复（AC-CR-02、AC-CR-04） | `src/core/*`（仅按 T9 与 T6 结论确定） | 缺陷清单 → 修复后的 Core 行为 | 每项先写失败用例（RED）→ 实现 → 复测（GREEN）；D2 覆盖截图/二进制/大文本三类输入的截断与错误码语义 | 定向套件 + `npm test` 零失败；TUI、无头、serve 三入口行为未变；失败归入 SP001 §6 分类并登记 |
| T11 中期报告、交接、版本准备与集成（AC-CP-10、AC-CR-06） | `SP/SP010/test-report.md`（拟新增）、两项 STATUS、`SP/SP010/requirements-summary.md`、`docs/current-status.md`、`PRODUCT.md`、版本脚本管理的版本清单与发行说明 | T1–T10 的证据 → 中期报告与交接基线 | — | 报告标注「中期结果」并列出未验证项与恢复条件；readiness 与修复清单可被 SP011–SP014 引用；`npm run merge:gate` GREEN 后按 buding-merge 规程合入 master 并推送；版本按 minor 准备，实际 npm 发布由维护者触发 |

## 定向命令

现有命令（cwd 为仓库根）：

```bash
npm run build
npm test
npm run merge:gate
```

T1–T5 交付后新增/可用：

```bash
node scripts/eval/validate.mjs --set cp-v1          # 题库与快照校验
node --test scripts/eval/*.test.mjs                  # 评估器单元测试
node scripts/eval/runner.mjs --set cp-v1 --repeats 3 # 离线回归集
```

T6–T8 交付后可用（真实 Provider，需 `.env.e2e.local`；不入 `npm test`）：

```bash
node scripts/eval/live.mjs --set cp-v1 --repeats 3 --run-id sp010-cp-v1
node scripts/eval/live.mjs --set cp-v1 --batch ctx --resume sp010-cp-v1
```

制品核对沿用发布生命周期脚本（仓库外隔离工作区）：

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
| AC-CP-03 | T2 | 预算触发与档位取值 | 超限任务以 `BUDGET` 终止并标注 |
| AC-CP-04 | T3 | 权限档、审批策略、`scope` 断言 | 真实 Provider「跑测试→修复」任务 |
| AC-CP-05 | T4 | 统计聚合 | 完整运行后的报告结构核对 |
| AC-CP-06 | T6 | — | 12 条保护用例逐条真实运行，全 PASS |
| AC-CP-07 | T7 | — | 长会话真实运行（压缩/恢复/取消） |
| AC-CP-08 | T8 | — | 隔离安装后最小真实编码任务 |
| AC-CP-09 | T5 | 评估器五类契约 | `npm test` 中的评估器用例计数与退出码 |
| AC-CP-10 | T4、T11 | — | 报告措辞与结构核对 |
| AC-CR-01 | T9 | — | readiness 抽样复核 |
| AC-CR-02 | T10 | 每项缺陷的 RED→GREEN | 定向套件 + `npm test` |
| AC-CR-03 | T2 | 回合上限与预算终止 | 超限任务终止记录 |
| AC-CR-04 | T10 | 三类输入的截断与错误码 | 定向运行记录 |
| AC-CR-05 | T9、T10 | 审批结果类型的契约核对 | 文档与代码事实核对 |
| AC-CR-06 | T11 | — | 交接材料与文档同步核对 |

每条 AC 至少各有一例单元与一例功能用例；一次即绿的用例须核对确实能捕获该行为。零测试、全部跳过与基础设施报错不构成 RED 或 PASS。

## 完成事实

实施阶段逐项回填：实际变更文件、执行命令与 cwd、实际数量与结果、证据位置、缺口。当前全部为「未执行」。

## 复审重点

需要主动注入失败的路径：预算触顶与超时竞态、快照被改动而哈希未更新、盲测失败信息经报告泄漏、评估器截断掩盖真实收敛、审批拒绝后回合不再继续、执行工具越过工作区边界、真实安装后数据写到用户真实目录、readiness 把新能力误当缺陷修掉、Core 修复只在 TUI 生效而无头与 serve 行为漂移、报告用总体平均掩盖关键分组。

计划与设计同版；任一 AC 或范围变化须先更新需求正本并重新自审，格式修改不使批准失效。
