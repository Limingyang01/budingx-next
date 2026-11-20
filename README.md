# budingx-next

独立开发 Coding Agent 的仓库。**当前 npm `latest` 为 0.5.3**，包含工作区会话隔离、TUI 工具修复和联网搜索。产品全貌见 [产品说明书](PRODUCT.md)，使用说明见 [TUI README](src/tui/README.md)。

默认主分支为 `master`；新项目统一使用 Node.js + TypeScript，不引入 Bun。

目标是从自己的需求与公开协议出发实现核心，**当前交付为 TUI 单端（路线图 r8）**。Desktop、VS Code、远程/H5 与 IM 已移出当前 SP，SP008 保留通用宿主边界。现有项目的界面、工具和模块必须经过来源/许可/依赖审计，不能直接视为可复用实现。

- [产品说明书](PRODUCT.md)
- [文档导航](docs/index.md)
- [产品目标与待确认项](docs/product-brief.md)
- [独立实现边界](docs/independent-development.md)
- [架构方向草案](docs/architecture.md)
- [开发与技能维护](docs/development.md)
- [迁移记录](docs/migration/README.md)
- [协作约定](AGENTS.md)
- [第三方声明](THIRD-PARTY-NOTICES.md)

本次不包含旧产品源码、构建产物、系统提示词、用户配置或聊天历史。新产品 MIT 及首发验证后 npm 发布已获用户授权，当前发布状态以 release-ledger.json 为准。已迁入的第三方开发技能按各自许可证保留声明。

迭代统一按 [SP 管理说明](SP/README.md)执行；[16 轮迭代路线图 r8](docs/iteration-plan.md)记录当前交付及依赖。SP001 已验收；SP002 已发布；SP003 已发布至 0.3.6；SP004 随 0.4.0 发布；SP005 随 0.5.0 发布，0.5.1 为同轮复审修复，0.5.2 为同轮长会话优化，均已发布。

当前单仓布局：外层管理文档/SP/Skills 和编排，产品统一放 src/，不建子仓或 packages/；见 [仓库布局](docs/repository-layout.md)。产品用户数据统一使用当前用户 home 下 ~/.budingx，不读取 ~/.claude。版本按 [SemVer/SP 规范](docs/versioning.md)管理。

推荐 TUI 发布方式现为 [GitHub Actions + npm Trusted Publishing](docs/github-actions-npm.md)：在 Actions 手动 Run workflow，无需 NPM_TOKEN secret。首次建包及账号授信仍需维护者在个人可信设备上验证，未配置前不宣称可发布。

npm 已发布 [0.5.3](https://www.npmjs.com/package/budingx/v/0.5.3)，可用 `npm install -g budingx@latest` 安装或升级。详见 [0.5.3 发行说明与发布回执](release-notes/v0.5.3.md)及 [0.5.2 发行说明](release-notes/v0.5.2.md)。
