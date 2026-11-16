# 当前状态

日期：2026-11-16。阶段：简易聊天 TUI 首发准备；全部 21 轮完整 Agent 迭代仍未启动。

## 已有

- 用户创建的 Git 仓库，主线 master；首个提交 f3c4675 已推送，GitHub API 已核对远端 SHA。后续发布状态更新可能有独立文档提交。
- 项目协作约定、产品目标、独立开发边界和架构方向草案。
- 4 个适配本仓的项目流程技能，以及 MIT 许可的 15 个 Superpowers 开发技能。
- 面向 `.agents`、`.claude`、`.budingx` 的发现入口和维护脚本。
- 用于维护的私有 package.json；其 `0.0.0` 不是产品发布版本。
- `src/tui` 下独立编写的 MIT 聊天 TUI，产品版本 0.1.0；配置/流式对话/内存会话，无运行时第三方依赖。
- 实际 Node/TypeScript 构建、测试、版本准备与发布编排，实际 tarball 隔离安装 smoke 已通过。

## 未实现

完整编码 Agent、文件/终端工具、持久化与共享、Desktop/VSIX、Computer Use、团队、远程/H5、IM 和调度均未实现。聊天 TUI 的首发不代表这些能力已交付。

首发使用 Node.js >=22.18、TypeScript 和 Node test runner，当前真实命令见 package.json。禁止引入 Bun；不能把旧项目版本 0.5.0、旧测试成绩或 Git 发布状态当作本仓事实。

用户已授权简易 TUI 验证后发布 npm，并确认 MIT；正式发布状态以 release-ledger.json 和 registry 回执为准。没有读取旧用户配置或凭据。未来用户数据统一通过当前用户 home 解析为 ~/.budingx，禁止使用 ~/.claude；首发只用显式参数/环境变量，暂不写用户数据。

## 验证范围

历史迁移验证见 [迁移记录](migration/README.md)。首发新增配置/Provider、真实 CLI 子进程多轮对话和 tarball 安装 smoke；真实外部模型无测试凭据，仍为 UNVERIFIED。首发真实数量和发布回执见 [首发状态](requirements/tui-bootstrap/STATUS.md)。

规划已完善至 [路线图 r3](iteration-plan.md)，配套 [能力矩阵](agent-capability-matrix.md)、[高级功能计划](advanced-capabilities-plan.md)、[npm 发布方案](npm-release-plan.md)与 [版本规范](versioning.md)。21 轮均未启动；bootstrap 是单独授权的简易首发，不启动完整 SDD 开发。

## 发布方式调整

已新增 [publish-tui 工作流](../.github/workflows/publish-tui.yml)及 [账号/操作指南](github-actions-npm.md)：Windows/Linux dry-run 门禁、master 手动触发、npm OIDC、只读 GitHub 内容权限、artifact 回执和 release:sync。账号侧首次包/Trusted Publisher/environment 设置、GitHub-hosted 运行和真实 OIDC 上传仍为 UNVERIFIED，当前 0.1.0 仍 prepared。首发不再要求在非个人电脑上绑定本机凭据。
