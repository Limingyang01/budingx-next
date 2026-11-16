# budingx-next

独立开发 Coding Agent 的新仓库。当前有 **MIT 简易聊天 TUI 0.1.0**：OpenAI 兼容配置/流式对话与内存会话，尚无编码工具和完整 Agent。使用说明见 [TUI README](src/tui/README.md)。

默认主分支为 `master`；新项目统一使用 Node.js + TypeScript，不引入 Bun。

目标是从自己的需求与公开协议出发实现核心，先完成 TUI 开发闭环，再逐步接入独立 Desktop、VS Code 及未来移动端。现有项目的界面、工具和模块必须经过来源/许可/依赖审计，不能直接视为可复用实现。

- [文档导航](docs/index.md)
- [产品目标与待确认项](docs/product-brief.md)
- [独立实现边界](docs/independent-development.md)
- [架构方向草案](docs/architecture.md)
- [开发与技能维护](docs/development.md)
- [迁移记录](docs/migration/README.md)
- [协作约定](AGENTS.md)
- [第三方声明](THIRD-PARTY-NOTICES.md)

本次不包含旧产品源码、构建产物、系统提示词、用户配置或聊天历史。新产品 MIT 及首发验证后 npm 发布已获用户授权，当前发布状态以 release-ledger.json 为准。已迁入的第三方开发技能按各自许可证保留声明。

迭代统一按 [SP 管理说明](SP/README.md)执行；[21 轮迭代路线图](docs/iteration-plan.md)供后续 Agent 读取，目前仅规划、未启动。

当前单仓布局：外层管理文档/SP/Skills 和编排，产品统一放 src/，不建子仓或 packages/；见 [仓库布局](docs/repository-layout.md)。产品用户数据统一使用当前用户 home 下 ~/.budingx，不读取 ~/.claude。版本按 [SemVer/SP 规范](docs/versioning.md)管理。

推荐 TUI 发布方式现为 [GitHub Actions + npm Trusted Publishing](docs/github-actions-npm.md)：在 Actions 手动 Run workflow，无需 NPM_TOKEN secret。首次建包及账号授信仍需维护者在个人可信设备上验证，未配置前不宣称可发布。

TUI 0.1.0 已发布到 [npm](https://www.npmjs.com/package/budingx/v/0.1.0)，可执行 `npm install -g budingx` 安装，再用 `budingx --version` 核对。当前仍是聊天预览，完整编码 Agent 按迭代规划实施。
