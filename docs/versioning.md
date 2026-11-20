# 产品版本与 SP 管理

用户已确认：每个迭代交付更新产品版本。采用 SemVer，产品版本与 SP 编号分别管理，不修改已发布版本、不以目录创建触发发包。

复用入口：[buding-version-prepare](../skills/buding-version-prepare/SKILL.md)，用于版本升级、文档同步、预演及维护者手动发布交接，不自动触发 npm 发布。

- 首个启动版本为 0.1.0（bootstrap），只含 OpenAI 兼容流式聊天 TUI，不表示任何 SP 已验收。
- 每个新 SP 完成并交付时至少增加 minor，本仓 SP002 首次产品交付为已发布的 0.2.0；同一 SP 的修复增加 patch。实际版本以发布台账为准，SP 编号与 SemVer 独立。
- 兼容破坏增加 major（在 0.x 开发阶段也可按 minor 体现，必须显式记录迁移）；1.0.0 仅可在 SP016 完整替代验收达标时准备，仍须有实际验收证据。
- prepare 只准备版本、台账和发行说明，不提交、不打 tag、不上传。发布命令不自行 bump，版本重复拒绝，预发布用明确 tag。
- 同一 SP 可多次发布，SP 状态、产品版本、发布状态分开记录；发布失败不把已占用版本重新使用。
- src/tui/package.json 的 version 是产品版本源；release-ledger.json 记录迭代及发布状态（prepared、published、superseded）；release-notes/v<version>.md 记录用户变化、限制和验收。根维护包版本不是产品版本。

未来暂缓各端（Desktop/VSIX 等，r6）恢复加入时，从已准备 release manifest 同步公共兼容版本；各端制品/发布通道和是否交付分别记录，不因 TUI 发包宣称 Desktop/VSIX 已发布。协议/存储 schema 版本独立演进并提供迁移，不能用 npm 版本代替数据版本。

后续 Agent：完成当轮验收后准备新版本，更新 SP 汇总/STATUS 与发行说明；执行用户授权的发布，再保存 registry 版本/integrity/tag 回执。只有已核实结果才记 published，上传状态不确定先查询，不盲重试。

规范依据：[npm SemVer 说明](https://docs.npmjs.com/about-semantic-versioning/)。

准备工具入口为 `npm run version:prepare -- kind --iteration SPnnn`，替换为已确定的类型/迭代；SP005 的 0.5.0 已发布，npm `latest` 和[发布回执](../release-notes/v0.5.0.md)均已核对；同轮复审修复按 patch 准备为 0.5.1（[发行说明](../release-notes/v0.5.1.md)，待发布）。同轮修复使用 patch，新 SP 首次交付使用 minor。要求当前版本有 published 回执且无未处理 prepared 版本；保留台账未知字段。命令不修改根维护包版本或执行 Git 写操作。

## Actions 发布回执

推荐的远端发布入口及首次授信见 [Actions 指南](github-actions-npm.md)。CI 只有 GitHub 内容只读权限，更新的台账作为 artifact 交付。下载正确运行的 report.json，用 `npm run release:sync -- --receipt <path>` 核对公共 npm 版本/integrity 后导入；审阅提交后才能 version:prepare。CI 不为 publish 自动 bump、提交或创建 tag。导入信任维护者选择的 artifact，不是独立 GitHub attestation 验证。

bootstrap 阶段的维护修复使用 `npm run version:prepare -- patch --iteration bootstrap`，例如 0.1.0 → 0.1.1；这不代表新 SP 已开始。正式迭代仍使用已确认的 SP 编号，新 SP 不允许只增加 patch。
