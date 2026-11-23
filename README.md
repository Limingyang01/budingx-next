# budingx-next

独立开发 Coding Agent 的仓库。**当前 npm `latest` 为 0.9.0**（SP009 TUI 独立交付和 npm 发布工程）：触发技能不再把提示词打进会话、`/export` 可选择导出哪个会话、全自动档位不再被工作区边界拦截，并交付干净安装/升级/卸载/回退门禁与发布判定工具链。SP008 能力包括 `budingx serve` 宿主入口（进程内/stdio/WebSocket）、版本化 NDJSON 宿主契约、活动会话归属与崩溃接管、共享配置/历史并发安全，owner 进程与交互 TUI 共用同一份 MCP/hooks 配置。SP007 能力包括：子代理执行（Agent/TaskOutput/TaskStop、`/agents` 面板与代理卡片）、多模态上下文（图片粘贴、`/image` 附件入口、PNG 缩放）、Anthropic 协议适配、ToolSearch 延迟加载、运行时诊断（`/status` `/stats` `/doctor`）与评估回归 runner；并延续 SP006 的四区终端骨架与帧级刷新、上下文键位、状态栏外部命令、项目指令、技能发现、MCP 客户端、受控 hooks、WebFetch、无头 stream-json 与命令注册表三型。**0.9.0 已由 [GitHub Actions 运行 #45100998785](https://github.com/Limingyang01/budingx-next/actions/runs/45100998785) 发布至 npm `latest`**（此前 0.8.0 由 [运行 #45010118350](https://github.com/Limingyang01/budingx-next/actions/runs/45010118350) 发布，0.7.0 由 [运行 #27](https://github.com/Limingyang01/budingx-next/actions/runs/44921288352) 发布）。 产品全貌见 [产品说明书](PRODUCT.md)，使用说明见 [TUI README](src/tui/README.md)。

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

npm 已发布 [0.9.0](https://www.npmjs.com/package/budingx/v/0.9.0)（SP009 TUI 独立交付和 npm 发布工程，由 [GitHub Actions 运行 #45100998785](https://github.com/Limingyang01/budingx-next/actions/runs/45100998785) 从源码 `aecd8b7` 发布，publishedAt=2026-11-23T02:43:37.613Z），可用 `npm install -g budingx@latest` 安装或升级。此前 [0.8.0](https://www.npmjs.com/package/budingx/v/0.8.0)（SP008，由 [运行 #45010118350](https://github.com/Limingyang01/budingx-next/actions/runs/45010118350) 从源码 `b71b3f5` 发布）、[0.7.0](https://www.npmjs.com/package/budingx/v/0.7.0)（SP007，由 [运行 #27](https://github.com/Limingyang01/budingx-next/actions/runs/44921288352) 从源码 `a8628b5` 发布）；详见 [0.9.0 发行说明与发布回执](release-notes/v0.9.0.md)、[0.8.0 发行说明与发布回执](release-notes/v0.8.0.md)、[0.7.0 发行说明与发布回执](release-notes/v0.7.0.md)、[0.6.0 发行说明](release-notes/v0.6.0.md)及 [0.5.4 发行说明](release-notes/v0.5.4.md)。
