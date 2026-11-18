# 当前状态

日期：2026-11-19。**0.3.6 已通过 OIDC 发布，npm latest 已核对。** Windows 和 Linux 的 CI 验证、官方源隔离安装及本地 HTTP 冒烟均通过。**SP004「真实编码任务」已实施、验证（`npm test` 607 项通过）并合入 master，源码版本已准备为 0.4.0，待维护者触发发布工作流。**

## 已有

- 用户创建的 Git 仓库，主线 master；首个提交 f3c4675 已推送，GitHub API 已核对远端 SHA。
- 项目协作约定、产品目标、独立开发边界和架构方向草案。
- 6 个适配本仓的项目流程技能（含版本准备），以及 MIT 许可的 15 个 Superpowers 开发技能；第三方开发技能单独登记。
- 面向 `.agents`、`.claude`、`.budingx` 的发现入口和维护脚本。
- 用于维护的私有 package.json；其 `0.0.0` 不是产品发布版本。
- TUI 0.3.6 台账为 published，覆盖 SP002／SP003 的长会话滚动、工具状态、转录搜索与审批记忆。详见 [0.3.6 发行说明](../release-notes/v0.3.6.md)。
- 实际 Node/TypeScript 构建、测试、版本准备与发布编排，实际 tarball 隔离安装 smoke 已通过。
- **SP002 新增**：`src/core`（事件契约、会话/回合状态机、工具回合、输入队列、消息规范化）、`src/provider`（OpenAI 兼容流解析、tool_calls 碎片、错误分类、有界重试、取消、连通探测）、`src/storage`（`~/.budingx` 配置与凭据仓库、模型档案 CRUD、三源合并）、`src/tui` 的 Ink 8 对话界面（渲染 reducer、多行编辑器、审批卡、双中断与排队）。
- **SP003 新增（已合入 master `598fb89`）**：`src/workspace`（路径边界与忽略规则、Read/Write/Edit/Glob/Grep、行级 diff、检查点撤销、三模式策略与规则、`@` 上下文）、`src/core` 的权限端口与策略判定接线、`src/storage/permissions.ts`（`~/.budingx/permissions.json`）、TUI 侧审批三档与拒绝反馈、模式徽标与 Shift+Tab 轮播、diff 两级对话框与多源切换、`@`/`/` 统一补全。
- **SP004 实施产物（已实现，待发布）**：`SP/SP004/` 迭代汇总与四份需求（command-execution / coding-task-loop / git-worktree-safety / task-planning，共 48 条 AC）、[设计 v1.3](../SP/SP004/design/design.zh.md)、[计划 v1.3](../SP/SP004/design/plan.zh.md)（T1–T24 全部完成事实）与[验收报告](../SP/SP004/test-report.md)（48 条 AC 逐条证据、45 PASS + 4 项环境相关 UNVERIFIED）。已新增 `src/exec`（命令执行/后台任务/沙箱声明层）、`src/git`（Git 状态/worktree/受控提交）、`src/plan`（计划、持久化与审批）；`core` 只新增纯端口与状态机。代码已合入 master，待随下一版本发布。

## 未实现

**SP004 真实编码任务已在仓库实现并完成验证**（命令执行、后台任务、受控 Git 提交、计划与待办、四类 TUI 卡片；`npm test` 607 项通过），但**尚无已验证的执行隔离后端**，普通命令在启动前被拒绝，完成证据闸门未接入生产 runtime，且待随下一版本发布。仍全部未实现的有：转录持久化与恢复（SP005）、Computer Use、团队、浏览器和调度；Desktop、VS Code、远程/H5 和 IM 已移出当前 SP。

首发使用 Node.js >=22.18、TypeScript 和 Node test runner，当前真实命令见 package.json 与 [开发指南](development.md)。禁止引入 Bun；不能把旧项目版本 0.5.0、旧测试成绩或 Git 发布状态当作本仓事实。

用户 2026-11-16 确认参考实现定位：本仓设计与主要核心逻辑必须严格参考本地 `budingWorkerSpace` 参考项目（文档不写死绝对路径，位置以用户环境为准），重点参考其 TUI 命令设计、Agent 主循环与核心工具；设计文档、计划文档和真实开发全程对照该参考，不允许脱离参考开发，允许优化但核心逻辑不得背离、使用体验不得下降；按「读机制、不抄代码」独立编写实现并对齐效果。该参考仓无 LICENSE 声明，本仓制品保持自有 MIT 独立可发布、不嵌入参考代码；细则见 [独立实现与复用边界](independent-development.md)。

用户已授权简易 TUI 验证后发布 npm，并确认 MIT；0.1.0、0.1.1 是历史已发布版本；0.2.0、0.3.0、0.3.1、0.3.2、0.3.4 和 0.3.5 为历史已发布版本，0.3.6 为当前 latest，发布状态及 integrity 见 release-ledger.json。没有读取旧用户配置或凭据。用户数据统一通过当前用户 home 解析为 ~/.budingx，禁止使用 ~/.claude。

## SP002 交付现状（等待验收）

- 设计 [v0.3 approved](../SP/SP002/design/design.zh.md)（用户 2026-11-16「我批准了设计」），批准覆盖计划/实现/测试/交付与各阶段本地提交，**不含**验收、推送、npm 发布与远端操作。
- 实施计划 [plan.zh.md](../SP/SP002/design/plan.zh.md)；逐条 AC 证据见 [验证报告](../SP/SP002/test-report.md)。
- 本地门禁：技能 9、规格 7、产品单元 118、发布 16，合计 150 项全部通过；模块边界检查通过；`npm pack` 33 文件、仓库外隔离安装与真实 HTTP 流式请求冒烟通过。
- 2026-11-17 交付后补充：首屏对照参考仓 LogoV2 布局机制独立重绘（紫 `#af87ff` 圆角双栏欢迎框、<70 列紧凑、配置后精简横幅、老终端纯 ASCII 兜底），交互面文案中文化（ASCII 兜底与管道机器面保持英文）；证据见 [SP002 验证报告 §10–§11](../SP/SP002/test-report.md)。
- 2026-11-17 启动**剩余 SP 参考复刻全面排查**（用户指示）：[排查文档 r1 draft](reference-tui-replication-audit.md) 已建立 CAP→SP 基线映射、12 条独立实现周旋总则与 4 项 manifest v2 缺口提议；4 路只读盘点回填中，待用户审阅后并入路线图 r5。不授权开发。
- 2026-11-17 交付后复验修正一处真实缺陷：队列自动起新回合的定时器曾被 `unref()`，导致排队输入在空闲时不自动起新回合（SL-05）。已修复并复测，详见 [SP002 验证报告 §7](../SP/SP002/test-report.md)。
- 面向使用者的产品事实入口为根目录 [产品说明书](../PRODUCT.md)：产品版本号、按迭代归类的功能表、使用说明、已知限制与版本历史；产品变更须同步更新它。
- **验证边界**：PS-08 已在一个用户授权服务验证五项；其他型号/服务未测。Windows Terminal/ConHost 的真实 IME、鼠标及观感仍为 UNVERIFIED，恢复条件为执行报告 §5 的人工清单。
- 产品版本 **0.2.0 已发布**，当时 npm latest=0.2.0。维护者触发运行 #7 后完成 Windows/Linux 验证和 OIDC 上传；公开 provenance 与官方安装/签名均核验通过，见 [发行说明](../release-notes/v0.2.0.md)。


## 2026-11-18 TUI 还原度对齐（规划变更，非产品代码）

用户指示：已做 3 个 SP，功能还原不理想，要针对旧仓 buding-worker-space 还原功能——除部分特色化功能调整外，**能力要相同，TUI 的布局、UI、交互都要还原**。

**结论：SP 驱动开发的路线、编号、依赖与各轮出口门槛均不变**；还原度作为 SP001–SP016 的**横向约束**落地，本次只改规划与文档，不含产品代码。

本次变更：

- 新增 [TUI 还原度差距基线](tui-fidelity-gap-baseline.md)：只读盘点出参考仓约 16.7 万行 / 2360 个源文件 vs 本仓约 9 千行 / 130 个源文件的规模差（约 18×），判定差距在**缺一层结构**而非缺功能点；给出分层差距、四条落地机制（渲染层受控扩展 / 键位系统自写 / 命令注册表三型契约 / 工具与主循环自写）、P0–P3 优先级与还原度可比口径。
- [路线图](iteration-plan.md) 升 **r9**：新增「TUI 还原度要求」节；SP006 加 **P0 骨架**出口、SP015 加 **P1 命令与工具面**出口、SP016 加**覆盖率公布**出口；明确 P0 未过不进入 P1。
- [能力矩阵](agent-capability-matrix.md)：原「TUI 交互」行拆为「TUI 交互（可用性）」与新增「TUI 还原度（结构等价）」两行——**功能 smoke 通过不等于还原度达标**，二者不可互相顶替。
- [能力清单 v1.4](../SP/SP001/capability-baseline/capability-manifest.md)：新增 6 个 CAP ID（必交 +2：CAP-L1-30 消息折叠汇总、CAP-L4-26 结构还原度基线与覆盖率判定；建议 +4：CAP-L1-28 设置面板、CAP-L1-29 转录模式、CAP-L4-24 无头审批桥、CAP-L4-25 OSC52 复制），**不改 v1 已发布行语义**；覆盖度分母 47 → **49**。
- SP004 文档全套对齐（需求汇总 / 设计 v1.2 §9.7 / 计划 v1.2 / 四份需求 / 四份 STATUS）：明确本轮在还原度上只负责 **L3 能力面与卡片表现**，卡片须随能力同步交付；**不得预支 SP006 P0**（不改四区骨架、不在 src/tui/render 引入虚拟列表/冻结缓存/帧缓冲差分/上下文键位）；权限模式仍三档、不复制参考仓源码。

未变动的边界：权限模式固定三档（不还原参考仓七模式）；SP001 决定 3「读机制、不抄代码」；O5=B 效果口径（自有测量 + 能力清单覆盖度，禁用「已对齐/同等效果」措辞）；Vim / 鼠标选区 / 备用屏为可选预算项，不进 P0/P1 门槛。

本次变更**不授权任何开发**；SP004 实施已于 2026-11-18 获用户放行。

## 验证范围

历史迁移验证见 [迁移记录](migration/README.md)。0.2.0 延续 CLI 子进程及制品隔离安装验证；一个真实外部服务已有五项回执，见 SP002 报告 §16。历史版本的 UNVERIFIED 不作为当前结论。

当前有效规划为 [路线图 r8](iteration-plan.md)（SP001–SP016，TUI 单端及通用宿主契约），配套 [能力矩阵](agent-capability-matrix.md)、[高级功能计划](advanced-capabilities-plan.md)、[npm 发布方案](npm-release-plan.md)与 [版本规范](versioning.md)。bootstrap 是单独授权的简易首发。

SP001 **仅限规格且已验收**（用户 2026-11-16 验收通过，设计 v1 批准）：已产出 [能力基线、核心边界与发布范围](../SP/SP001/requirements-summary.md)（能力清单 v1 共 85 项、必交 53 项；核心边界与不变量；评测集规格与任务清单；发布范围与待决项）。本轮**不含产品代码**；47 条 AC 已逐条走查：46 PASS / 1 NOT_APPLICABLE。用户同日拍板：**O1=A** 完整 Agent 制品沿用 npm `budingx` 同名（发布轮须提供破坏性升级/迁移说明）；**O2=A** 只声明 Windows 已验证，macOS/Linux 于 SP009 后逐个验证；**O5=B** 不采集原产品效果基线——对照基线只做**静态盘点**、不运行原 Agent，效果对比永久采用「自有能力测量 + 能力清单覆盖度」口径，5 个百分点非劣门槛废除，「已对齐」措辞永久禁止。

## 发布方式调整

已新增 [publish-tui 工作流](../.github/workflows/publish-tui.yml)及[账号/操作指南](github-actions-npm.md)：Windows/Linux dry-run 门禁、master 手动触发、npm OIDC、只读 GitHub 内容权限、artifact 回执和 release:sync。0.1.0 首发与官方源隔离安装、Windows/Linux 的 GitHub 运行 #3 及 npm Trusted Publisher 均已核实；0.1.0 台账为 published。[运行 #6](https://github.com/Limingyang01/budingx-next/actions/runs/43826550093) 从 49857ad 完成 Windows/Linux 验证及 0.1.1 真实 OIDC 发布；npm 公开元数据标记 GitHub Trusted Publisher，provenance 对应同一源码与运行。官方包本机隔离安装、npm shim、HTTP 流式 smoke 及 registry signature/attestation 验证通过。GitHub environment 已限制 master 分支。首发不再要求在非个人电脑上绑定本机凭据。

SP002 的制品布局已变更（bin 由 `dist/cli.js` 改为 `dist/tui/cli.js`，新增四个编译模块），发布轮须按 O1=A 提供破坏性升级/迁移说明。

## 2026-11-17 e2e 与真实 Provider 补证据

真实 Provider 的 PS-08 四场景已通过，累计 9 次请求（用户授权最多 12 次、5 美元）；已修复 clear 未清可见内容及工具 schema 遗失导致真实 HTTP 400。证据见 [SP002 验证报告 §16](../SP/SP002/test-report.md#16-真实模型与扩展端到端验证2026-11-17)。较早段落中的 live UNVERIFIED 保留历史身份，以本节最新回执为准。真实 Windows Terminal/ConHost IME/观感仍 UNVERIFIED；实际账单未读取。真实 .env.e2e.local 被忽略且不提交。

本地集成更新：e2e 修复及验证提交 `e06ddaf` 经交叉验证 GREEN 后已合入 `master`，合并提交 `ffdb7ba`。真实 Provider 5 项与 197 项自动化通过；未推送/发布，真终端 IME 人工仍待验证。更早的待合入记录为历史状态。

0.2.0 发布前补充：已修复伪 TTY 在 CI 中被 Ink 自动切为非交互的问题；CI=true 的完整发布预演 203 项通过，31 文件制品与此前 integrity 一致，已合入 master。版本为 prepared，维护者自行触发 master 的发布工作流，未上传 npm。

## 2026-11-17 规划调整（路线图 r6，历史记录）

用户决定：当前交付路线只做 TUI 单端；SP008（Desktop）、SP009（VS Code）、SP016（远程/H5）、SP017（IM 基础与 Telegram/飞书）、SP018（微信/钉钉）**暂缓（DEFERRED）**，编号保留不回收、移出当前依赖与验收分母，恢复须用户另行决定；**多端架构入口保留**（宿主契约/传输边界/共享模型与历史，SP010 改契约轮以轻量测试客户端验证）。TUI 权限模式固定三种：**仅可查看 / 工作区内修改 / 完全权限**（SP003 已发布，SP004 已实现待发布）。团队/浏览器/Computer Use/定时任务仍必交。

同步落地：[能力清单 v1.1](../SP/SP001/capability-baseline/capability-manifest.md) 6 项必交改暂缓、覆盖度分母 53→47；[任务清单](../SP/SP001/evaluation-suite/task-inventory.md) REM/IM 11 题批注暂缓（SP020 开轮前 inventory v2 补齐配额）；spec 门禁 MUST_KEEP/MUST_DEFER 双向保护；矩阵 r3、高级能力计划、npm 方案 r4、product-brief、architecture、repository-layout、SP/README、PRODUCT.md v1.3 与本文件同步。本次规划调整的提交、合入 master 与推送已获用户授权（推送遇网络波动可重试）；验证记录见 [规划变更验证报告](requirements/tui-first-planning/test-report.md)。不因此授权任何暂缓轮开发或发布。

集成回执：merge:gate 两次 GREEN 后合入 master（合并提交 99b50ee，ancestry 证明通过）；推送前两次网络波动失败、第 3 次成功，ls-remote 核对一致；合入后 master 复跑 npm test 206 项 0 失败＋spec:check＋skills:check＋pack-smoke PASS。回执收口提交见验证报告 §4 追加行。

## SP004 合入回执（2026-11-19）

源/目标固定：`feature/SP004/real-coding-task`（HEAD `868eae6`）→ `master`（原 `5b0e7cc`），merge-base `e808679`，`--no-ff` 合并提交 `fdfdae8`，ancestry 证明通过。前置门禁 `npm run merge:gate` GREEN（`artifacts/merge-gate/feature-SP004-real-coding-task-2026-11-18T16-16-59-047Z.md`：outgoing 31 提交 91 文件、禁带路径违规 0、FAIL 行 0、UNVERIFIED 9 行且恢复条件节存在；`npm test`/`spec:check`/`skills:check`/`pack-smoke` 退出码 0）。合并时 `PRODUCT.md` 与 `docs/current-status.md` 因 master 已发布 0.3.6 出现文本冲突，按「保留已发布事实 + SP004 现状」人工解决，无代码冲突。合入后复验：`npm test` 0 失败、`CI=true npm test` 0 失败、`spec:check`/`skills:check`/`release` 17 项通过。推送：`origin/master` `5b0e7cc..1460fa3`、`origin/feature/SP004/real-coding-task` `da5bed1..868eae6`，`git ls-remote` 核对与本地一致（master `1460fa325dfc03f3088b6c209879b9a2965eeaee`）。未执行：打 tag、npm 发布、分支删除。

## 0.2.0 正式发布完成（2026-11-17）

维护者触发运行 #7，Windows/Linux 验证及 npm OIDC 发布成功；publishedAt=2026-11-17T09:29:30.139Z，latest=0.2.0，source=6ed77d8a93335f8b261493e1fa4f0994ce4bc7bd。官方安装、shim 版本和 HTTP smoke 通过；46 registry signatures、5 attestations 核验通过；来源匹配本次 run/源码。原始 CI artifact 下载要求认证，未取得，使用公开 provenance 与独立安装证据；ledger 已 published。早前 prepared 状态为历史快照，真终端人工未验证保持不变。
