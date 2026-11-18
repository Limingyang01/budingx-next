# 当前状态

日期：2026-11-18。**SP003 模型管理修复 0.3.1 已通过 OIDC 发布，npm latest 已核对。** Windows 和 Linux 的 CI 验证、官方源隔离安装及本地 HTTP 冒烟均通过。

## 已有

- 用户创建的 Git 仓库，主线 master；首个提交 f3c4675 已推送，GitHub API 已核对远端 SHA。
- 项目协作约定、产品目标、独立开发边界和架构方向草案。
- 6 个适配本仓的项目流程技能（含版本准备），以及 MIT 许可的 15 个 Superpowers 开发技能；第三方开发技能单独登记。
- 面向 `.agents`、`.claude`、`.budingx` 的发现入口和维护脚本。
- 用于维护的私有 package.json；其 `0.0.0` 不是产品发布版本。
- master 的 TUI 发布候选为 0.3.2，台账为 prepared。本版支持供应商配置共享、MiniMax 中国站与百炼 Token Plan 模板，以及全屏会话和终端标签状态。公开版本为 0.3.1，发布候选详见 [0.3.2 发行说明](../release-notes/v0.3.2.md)。
- 实际 Node/TypeScript 构建、测试、版本准备与发布编排，实际 tarball 隔离安装 smoke 已通过。
- **SP002 新增**：`src/core`（事件契约、会话/回合状态机、工具回合、输入队列、消息规范化）、`src/provider`（OpenAI 兼容流解析、tool_calls 碎片、错误分类、有界重试、取消、连通探测）、`src/storage`（`~/.budingx` 配置与凭据仓库、模型档案 CRUD、三源合并）、`src/tui` 的 Ink 8 对话界面（渲染 reducer、多行编辑器、审批卡、双中断与排队）。
- **SP003 新增（已合入 master `598fb89`）**：`src/workspace`（路径边界与忽略规则、Read/Write/Edit/Glob/Grep、行级 diff、检查点撤销、三模式策略与规则、`@` 上下文）、`src/core` 的权限端口与策略判定接线、`src/storage/permissions.ts`（`~/.budingx/permissions.json`）、TUI 侧审批三档与拒绝反馈、模式徽标与 Shift+Tab 轮播、diff 两级对话框与多源切换、`@`/`/` 统一补全。

## 未实现

完整编码 Agent 的**命令执行与任务循环**、转录持久化与恢复、Computer Use、团队、浏览器和调度均未实现；Desktop、VS Code、远程/H5 和 IM 已移出当前 SP。SP003 交付的是**文件工具与权限控制**，不等于完整 Coding Agent：终端命令、计划与测试循环由 SP004 实现，跨会话快照由 SP005 实现。

首发使用 Node.js >=22.18、TypeScript 和 Node test runner，当前真实命令见 package.json 与 [开发指南](development.md)。禁止引入 Bun；不能把旧项目版本 0.5.0、旧测试成绩或 Git 发布状态当作本仓事实。

用户 2026-11-16 确认参考实现定位：本仓设计与主要核心逻辑必须严格参考本地 `budingWorkerSpace` 参考项目（文档不写死绝对路径，位置以用户环境为准），重点参考其 TUI 命令设计、Agent 主循环与核心工具；设计文档、计划文档和真实开发全程对照该参考，不允许脱离参考开发，允许优化但核心逻辑不得背离、使用体验不得下降；按「读机制、不抄代码」独立编写实现并对齐效果。该参考仓无 LICENSE 声明，本仓制品保持自有 MIT 独立可发布、不嵌入参考代码；细则见 [独立实现与复用边界](independent-development.md)。

用户已授权简易 TUI 验证后发布 npm，并确认 MIT；0.1.0、0.1.1 是历史已发布版本；0.2.0 和 0.3.0 为历史已发布版本，0.3.1 为当前 latest，发布状态及 integrity 见 release-ledger.json。没有读取旧用户配置或凭据。用户数据统一通过当前用户 home 解析为 ~/.budingx，禁止使用 ~/.claude。

## SP002 交付现状（等待验收）

- 设计 [v0.3 approved](../SP/SP002/design/design.zh.md)（用户 2026-11-16「我批准了设计」），批准覆盖计划/实现/测试/交付与各阶段本地提交，**不含**验收、推送、npm 发布与远端操作。
- 实施计划 [plan.zh.md](../SP/SP002/design/plan.zh.md)；逐条 AC 证据见 [验证报告](../SP/SP002/test-report.md)。
- 本地门禁：技能 9、规格 7、产品单元 118、发布 16，合计 150 项全部通过；模块边界检查通过；`npm pack` 33 文件、仓库外隔离安装与真实 HTTP 流式请求冒烟通过。
- 2026-11-17 交付后补充：首屏对照参考仓 LogoV2 布局机制独立重绘（紫 `#af87ff` 圆角双栏欢迎框、<70 列紧凑、配置后精简横幅、老终端纯 ASCII 兜底），交互面文案中文化（ASCII 兜底与管道机器面保持英文）；证据见 [SP002 验证报告 §10–§11](../SP/SP002/test-report.md)。
- 2026-11-17 启动**剩余 SP 参考复刻全面排查**（用户指示）：[排查文档 r1 draft](reference-tui-replication-audit.md) 已建立 CAP→SP 基线映射、12 条独立实现周旋总则与 4 项 manifest v2 缺口提议；4 路只读盘点回填中，待用户审阅后并入路线图 r5。不授权开发。
- 2026-11-17 交付后复验修正一处真实缺陷：队列自动起新回合的定时器曾被 `unref()`，导致排队输入在空闲时不自动起新回合（SL-05）。已修复并复测，详见 [SP002 验证报告 §7](../SP/SP002/test-report.md)。
- 面向使用者的产品事实入口为根目录 [产品说明书](../PRODUCT.md)：产品版本号、按迭代归类的功能表、使用说明、已知限制与版本历史；产品变更须同步更新它。
- **验证边界**：PS-08 已在一个用户授权服务验证五项；其他型号/服务未测。Windows Terminal/ConHost 的真实 IME、鼠标及观感仍为 UNVERIFIED，恢复条件为执行报告 §5 的人工清单。
- 产品版本 **0.2.0 已发布**，npm latest=0.2.0。维护者触发运行 #7 后完成 Windows/Linux 验证和 OIDC 上传；公开 provenance 与官方安装/签名均核验通过，见 [发行说明](../release-notes/v0.2.0.md)。

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

用户决定：当前交付路线只做 TUI 单端；SP008（Desktop）、SP009（VS Code）、SP016（远程/H5）、SP017（IM 基础与 Telegram/飞书）、SP018（微信/钉钉）**暂缓（DEFERRED）**，编号保留不回收、移出当前依赖与验收分母，恢复须用户另行决定；**多端架构入口保留**（宿主契约/传输边界/共享模型与历史，SP010 改契约轮以轻量测试客户端验证）。TUI 权限模式固定三种：**仅可查看 / 工作区内修改 / 完全权限**（SP003/SP004 交付，当前未实现）。团队/浏览器/Computer Use/定时任务仍必交。

同步落地：[能力清单 v1.1](../SP/SP001/capability-baseline/capability-manifest.md) 6 项必交改暂缓、覆盖度分母 53→47；[任务清单](../SP/SP001/evaluation-suite/task-inventory.md) REM/IM 11 题批注暂缓（SP020 开轮前 inventory v2 补齐配额）；spec 门禁 MUST_KEEP/MUST_DEFER 双向保护；矩阵 r3、高级能力计划、npm 方案 r4、product-brief、architecture、repository-layout、SP/README、PRODUCT.md v1.3 与本文件同步。本次规划调整的提交、合入 master 与推送已获用户授权（推送遇网络波动可重试）；验证记录见 [规划变更验证报告](requirements/tui-first-planning/test-report.md)。不因此授权任何暂缓轮开发或发布。

集成回执：merge:gate 两次 GREEN 后合入 master（合并提交 99b50ee，ancestry 证明通过）；推送前两次网络波动失败、第 3 次成功，ls-remote 核对一致；合入后 master 复跑 npm test 206 项 0 失败＋spec:check＋skills:check＋pack-smoke PASS。回执收口提交见验证报告 §4 追加行。

## 0.2.0 正式发布完成（2026-11-17）

维护者触发运行 #7，Windows/Linux 验证及 npm OIDC 发布成功；publishedAt=2026-11-17T09:29:30.139Z，latest=0.2.0，source=6ed77d8a93335f8b261493e1fa4f0994ce4bc7bd。官方安装、shim 版本和 HTTP smoke 通过；46 registry signatures、5 attestations 核验通过；来源匹配本次 run/源码。原始 CI artifact 下载要求认证，未取得，使用公开 provenance 与独立安装证据；ledger 已 published。早前 prepared 状态为历史快照，真终端人工未验证保持不变。
