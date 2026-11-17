# 当前状态

日期：2026-11-17。阶段：简易聊天 TUI 已发布（npm `budingx@0.1.1`），OIDC 发布链路已实测；**SP002「模型与会话闭环」已实现并完成本地验证，等待用户验收**；其余 19 轮完整 Agent 迭代仍未启动。

## 已有

- 用户创建的 Git 仓库，主线 master；首个提交 f3c4675 已推送，GitHub API 已核对远端 SHA。
- 项目协作约定、产品目标、独立开发边界和架构方向草案。
- 5 个适配本仓的项目流程技能，以及 MIT 许可的 15 个 Superpowers 开发技能。
- 面向 `.agents`、`.claude`、`.budingx` 的发现入口和维护脚本。
- 用于维护的私有 package.json；其 `0.0.0` 不是产品发布版本。
- `src/tui` 下独立编写的 MIT 聊天 TUI，已发布版本 0.1.1；配置/流式对话/内存会话，无运行时第三方依赖。
- 实际 Node/TypeScript 构建、测试、版本准备与发布编排，实际 tarball 隔离安装 smoke 已通过。
- **SP002 新增**：`src/core`（事件契约、会话/回合状态机、工具回合、输入队列、消息规范化）、`src/provider`（OpenAI 兼容流解析、tool_calls 碎片、错误分类、有界重试、取消、连通探测）、`src/storage`（`~/.budingx` 配置与凭据仓库、模型档案 CRUD、三源合并）、`src/tui` 的 Ink 8 对话界面（渲染 reducer、多行编辑器、审批卡、双中断与排队）。

## 未实现

完整编码 Agent 的**工具**（文件/终端读写、权限规则）、转录持久化与恢复、Desktop/VSIX、Computer Use、团队、远程/H5、IM 和调度均未实现。SP002 只交付契约面：工具以注册接口 + 测试桩验证，真实工具由 SP003/SP004 实现。

首发使用 Node.js >=22.18、TypeScript 和 Node test runner，当前真实命令见 package.json 与 [开发指南](development.md)。禁止引入 Bun；不能把旧项目版本 0.5.0、旧测试成绩或 Git 发布状态当作本仓事实。

用户 2026-11-16 确认参考实现定位：本仓设计与主要核心逻辑必须严格参考本地 `budingWorkerSpace` 参考项目（文档不写死绝对路径，位置以用户环境为准），重点参考其 TUI 命令设计、Agent 主循环与核心工具；设计文档、计划文档和真实开发全程对照该参考，不允许脱离参考开发，允许优化但核心逻辑不得背离、使用体验不得下降；按「读机制、不抄代码」独立编写实现并对齐效果。该参考仓无 LICENSE 声明，本仓制品保持自有 MIT 独立可发布、不嵌入参考代码；细则见 [独立实现与复用边界](independent-development.md)。

用户已授权简易 TUI 验证后发布 npm，并确认 MIT；0.1.0、0.1.1 已公开发布，latest 指向 0.1.1，发布状态及 integrity 见 release-ledger.json。没有读取旧用户配置或凭据。用户数据统一通过当前用户 home 解析为 ~/.budingx，禁止使用 ~/.claude。

## SP002 交付现状（等待验收）

- 设计 [v0.3 approved](../SP/SP002/design/design.zh.md)（用户 2026-11-16「我批准了设计」），批准覆盖计划/实现/测试/交付与各阶段本地提交，**不含**验收、推送、npm 发布与远端操作。
- 实施计划 [plan.zh.md](../SP/SP002/design/plan.zh.md)；逐条 AC 证据见 [验证报告](../SP/SP002/test-report.md)。
- 本地门禁：技能 9、规格 7、产品单元 118、发布 16，合计 150 项全部通过；模块边界检查通过；`npm pack` 33 文件、仓库外隔离安装与真实 HTTP 流式请求冒烟通过。
- 2026-11-17 交付后补充：首屏对照参考仓 LogoV2 布局机制独立重绘（紫 `#af87ff` 圆角双栏欢迎框、<70 列紧凑、配置后精简横幅、老终端纯 ASCII 兜底），交互面文案中文化（ASCII 兜底与管道机器面保持英文）；证据见 [SP002 验证报告 §10–§11](../SP/SP002/test-report.md)。
- 2026-11-17 启动**剩余 SP 参考复刻全面排查**（用户指示）：[排查文档 r1 draft](reference-tui-replication-audit.md) 已建立 CAP→SP 基线映射、12 条独立实现周旋总则与 4 项 manifest v2 缺口提议；4 路只读盘点回填中，待用户审阅后并入路线图 r5。不授权开发。
- 2026-11-17 交付后复验修正一处真实缺陷：队列自动起新回合的定时器曾被 `unref()`，导致排队输入在空闲时不自动起新回合（SL-05）。已修复并复测，详见 [SP002 验证报告 §7](../SP/SP002/test-report.md)。
- 面向使用者的产品事实入口为根目录 [产品说明书](../PRODUCT.md)：产品版本号、按迭代归类的功能表、使用说明、已知限制与版本历史；产品变更须同步更新它。
- **未验证项**：PS-08 live Provider（缺真实凭据与预算）记 UNVERIFIED；TC-02/03/04/07 的 Windows Terminal + ConHost 真终端人工 smoke 记 UNVERIFIED，需用户验收时补证据（CJK/IME 打字体验为 R1 门槛，不达标回退自研输入层）。
- 产品版本仍是 0.1.1：按 [版本规范](versioning.md)，版本准备在当轮验收后执行，本轮未擅自 bump、未发布、未推送。

## 验证范围

历史迁移验证见 [迁移记录](migration/README.md)。首发新增配置/Provider、真实 CLI 子进程多轮对话和 tarball 安装 smoke；真实外部模型无测试凭据，仍为 UNVERIFIED。

规划已完善至 [路线图 r3](iteration-plan.md)，配套 [能力矩阵](agent-capability-matrix.md)、[高级功能计划](advanced-capabilities-plan.md)、[npm 发布方案](npm-release-plan.md)与 [版本规范](versioning.md)。bootstrap 是单独授权的简易首发。

SP001 **仅限规格且已验收**（用户 2026-11-16 验收通过，设计 v1 批准）：已产出 [能力基线、核心边界与发布范围](../SP/SP001/requirements-summary.md)（能力清单 v1 共 85 项、必交 53 项；核心边界与不变量；评测集规格与任务清单；发布范围与待决项）。本轮**不含产品代码**；47 条 AC 已逐条走查：46 PASS / 1 NOT_APPLICABLE。用户同日拍板：**O1=A** 完整 Agent 制品沿用 npm `budingx` 同名（发布轮须提供破坏性升级/迁移说明）；**O2=A** 只声明 Windows 已验证，macOS/Linux 于 SP011 后逐个验证；**O5=B** 不采集原产品效果基线——对照基线只做**静态盘点**、不运行原 Agent，效果对比永久采用「自有能力测量 + 能力清单覆盖度」口径，5 个百分点非劣门槛废除，「已对齐」措辞永久禁止。

## 发布方式调整

已新增 [publish-tui 工作流](../.github/workflows/publish-tui.yml)及[账号/操作指南](github-actions-npm.md)：Windows/Linux dry-run 门禁、master 手动触发、npm OIDC、只读 GitHub 内容权限、artifact 回执和 release:sync。0.1.0 首发与官方源隔离安装、Windows/Linux 的 GitHub 运行 #3 及 npm Trusted Publisher 均已核实；0.1.0 台账为 published。[运行 #6](https://github.com/Limingyang01/budingx-next/actions/runs/43826550093) 从 49857ad 完成 Windows/Linux 验证及 0.1.1 真实 OIDC 发布；npm 公开元数据标记 GitHub Trusted Publisher，provenance 对应同一源码与运行。官方包本机隔离安装、npm shim、HTTP 流式 smoke 及 registry signature/attestation 验证通过。GitHub environment 已限制 master 分支。首发不再要求在非个人电脑上绑定本机凭据。

SP002 的制品布局已变更（bin 由 `dist/cli.js` 改为 `dist/tui/cli.js`，新增四个编译模块），发布轮须按 O1=A 提供破坏性升级/迁移说明。
