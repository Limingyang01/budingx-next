# 当前状态

日期：2026-11-16。阶段：简易聊天 TUI 已发布，OIDC 发布链路已实测；SP001 已验收（规格轮，用户 2026-11-16 验收通过），未启动任何产品实现；其余 20 轮完整 Agent 迭代仍未启动。

## 已有

- 用户创建的 Git 仓库，主线 master；首个提交 f3c4675 已推送，GitHub API 已核对远端 SHA。后续发布状态更新可能有独立文档提交。
- 项目协作约定、产品目标、独立开发边界和架构方向草案。
- 5 个适配本仓的项目流程技能，以及 MIT 许可的 15 个 Superpowers 开发技能。
- 面向 `.agents`、`.claude`、`.budingx` 的发现入口和维护脚本。
- 用于维护的私有 package.json；其 `0.0.0` 不是产品发布版本。
- `src/tui` 下独立编写的 MIT 聊天 TUI，产品版本 0.1.1；配置/流式对话/内存会话，无运行时第三方依赖。
- 实际 Node/TypeScript 构建、测试、版本准备与发布编排，实际 tarball 隔离安装 smoke 已通过。

## 未实现

完整编码 Agent、文件/终端工具、持久化与共享、Desktop/VSIX、Computer Use、团队、远程/H5、IM 和调度均未实现。聊天 TUI 的首发不代表这些能力已交付。

首发使用 Node.js >=22.18、TypeScript 和 Node test runner，当前真实命令见 package.json。禁止引入 Bun；不能把旧项目版本 0.5.0、旧测试成绩或 Git 发布状态当作本仓事实。

用户 2026-11-16 补充确认参考实现定位：本仓设计与主要核心逻辑必须严格参考本地 `budingWorkerSpace` 项目（现路径 `D:\my_project\budingWorkerSpace`，SP001 早期文档所写 `D:\extra_project\buding-worker-space` 已失效），重点参考其 TUI 命令设计、Agent 主循环与核心工具，按「读机制、不抄代码」独立编写实现并对齐行为与效果。该仓无 LICENSE 声明，本仓制品保持自有 MIT 独立可发布、不嵌入旧代码；细则见 [独立实现与复用边界](independent-development.md)。此条不改变各 SP 的启动授权状态。

用户已授权简易 TUI 验证后发布 npm，并确认 MIT；0.1.0、0.1.1 已公开发布，latest 指向 0.1.1，发布状态及 integrity 见 release-ledger.json。没有读取旧用户配置或凭据。未来用户数据统一通过当前用户 home 解析为 ~/.budingx，禁止使用 ~/.claude；首发只用显式参数/环境变量，暂不写用户数据。

## 验证范围

历史迁移验证见 [迁移记录](migration/README.md)。首发新增配置/Provider、真实 CLI 子进程多轮对话和 tarball 安装 smoke；真实外部模型无测试凭据，仍为 UNVERIFIED。首发真实数量和发布回执见 [首发状态](requirements/tui-bootstrap/STATUS.md)。

规划已完善至 [路线图 r3](iteration-plan.md)，配套 [能力矩阵](agent-capability-matrix.md)、[高级功能计划](advanced-capabilities-plan.md)、[npm 发布方案](npm-release-plan.md)与 [版本规范](versioning.md)。bootstrap 是单独授权的简易首发。

SP001 **仅限规格且已验收**（用户 2026-11-16 验收通过，设计 v1 批准）：已产出 [能力基线、核心边界与发布范围](../SP/SP001/requirements-summary.md)（[能力清单 v1](../SP/SP001/capability-baseline/capability-manifest.md) 共 85 项、必交 53 项；核心边界与不变量；评测集规格与[任务清单](../SP/SP001/evaluation-suite/task-inventory.md)；发布范围与待决项）。本轮**不含产品代码**；47 条 AC 已逐条走查：46 PASS / 1 NOT_APPLICABLE（指规格条款被满足，不代表任何产品能力已实现），逐条依据见[验证报告](../SP/SP001/test-report.md)。用户同日拍板：**O1=A** 完整 Agent 制品沿用 npm `budingx` 同名（发布轮须提供破坏性升级/迁移说明）；**O2=A** 只声明 Windows 已验证，macOS/Linux 于 SP011 后逐个验证；**O5=B** 不采集原产品效果基线——对照基线只做**静态盘点**、不运行原 Agent，效果对比永久采用「自有能力测量 + 能力清单覆盖度」口径，5 个百分点非劣门槛废除，「已对齐」措辞永久禁止。其余 20 轮仍为 PLANNED，SP002 待用户授权启动。

## 发布方式调整

已新增 [publish-tui 工作流](../.github/workflows/publish-tui.yml)及 [账号/操作指南](github-actions-npm.md)：Windows/Linux dry-run 门禁、master 手动触发、npm OIDC、只读 GitHub 内容权限、artifact 回执和 release:sync。0.1.0 首发与官方源隔离安装、Windows/Linux 的 GitHub 运行 #3 及 npm Trusted Publisher 均已核实；0.1.0 台账为 published。[运行 #6](https://github.com/Limingyang01/budingx-next/actions/runs/43826550093) 从 49857ad 完成 Windows/Linux 验证及 0.1.1 真实 OIDC 发布；npm 公开元数据标记 GitHub Trusted Publisher，provenance 对应同一源码与运行。官方包本机隔离安装、npm shim、HTTP 流式 smoke 及 registry signature/attestation 验证通过。GitHub environment 已限制 master 分支。首发不再要求在非个人电脑上绑定本机凭据。
