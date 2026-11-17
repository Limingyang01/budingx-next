# budingx-next 协作约定

本仓库用于独立实现新的 Coding Agent。当前已有 src/tui 下的简易聊天 TUI，完整编码 Agent、Desktop、VS Code 和高级能力尚未实现。先读 [文档导航](docs/index.md) 和 [当前状态](docs/current-status.md)。

## 工作边界

- 每次编辑前检查 `git status --short`。保留用户已有文件和改动；只处理明确授权范围。
- 参考实现定位（用户 2026-11-16 确认）：本仓设计与主要核心逻辑必须严格参考本地 `budingWorkerSpace` 参考项目，重点参考其 TUI 命令设计、Agent 主循环与核心工具；文档不写死绝对路径，知道存在该参考即可，位置以用户当前环境为准。设计文档、计划文档与真实开发全程对照该参考，不允许脱离参考开发；允许优化，但核心逻辑不得背离，使用体验不得下降。复刻按 SP001 决定 3「读机制、不抄代码」：实现须独立编写、可改动实现方式，不逐字照抄，效果一致即可。
- 旧项目仓库只读，且其仓内无 LICENSE 文件、package.json 无 license 字段（视为未开源）。复刻的合规前提：本仓制品保持自有 MIT 独立可发布，只参考机制与行为事实，不嵌入旧代码；若日后确认参考材料带 MIT 许可，按其规则保留版权声明与许可文本并登记台账。不得直接复制旧 Agent 源码、系统提示词、内部 SDK 类型、全局状态、生成 bundle、配置或历史记录到新仓库，也不要通过改名/AI 逐文件改写来宣称独立来源。边界细则见 [独立实现与复用边界](docs/independent-development.md)。
- 可独立迁移的模块需记录来源、许可、依赖和处理决定；独立开发流程不等于法律洁净室认证。许可状态见 [第三方声明](THIRD-PARTY-NOTICES.md)。
- 不读取或迁移真实 API Key、OAuth、聊天历史、用户技能/MCP/插件配置。旧数据导入需另行设计、明确授权、备份和旧 fixture 验证。
- 保留用户确认的需求；技术建议必须标为提议。三端独立运行、共享模型/历史及未来移动接入是产品方向，文件存在不证明这些能力已经实现。
- 明确、可逆的授权工作自主完成。新功能先明确行为和最小验证，使用原生能力和既有工具；不引入只有猜测调用者的框架。

## 技能入口

共享正文只维护在 `skills/`；`.agents/skills/`、`.claude/skills/`、`.budingx/skills/` 是生成的发现入口。它们是开发助手技能，不是新产品已实现的运行时功能。

| 工作 | 规范 |
| --- | --- |
| 需求、设计、实施计划和证据 | [buding-sdd](skills/buding-sdd/SKILL.md) |
| 未来 UI/状态/API 客户端验证 | [buding-frontend-testing](skills/buding-frontend-testing/SKILL.md) |
| 未来 Core/Provider/工具/存储/进程验证 | [buding-runtime-testing](skills/buding-runtime-testing/SKILL.md) |
| TUI 构建、版本准备、Actions/OIDC npm 发布与回执 | [buding-npm-release](skills/buding-npm-release/SKILL.md) |
| 集成安全规程（含 SDD 收口合入）与授权动作边界 | [buding-merge](skills/buding-merge/SKILL.md) |

开发流程按需读取 [项目 Superpowers](skills/superpowers/using-superpowers/SKILL.md) 及相关阶段。用户既有授权优先，不重复请求同一范围的许可；上游技能中的自动提交、清理、发布建议不能扩大当前授权。普通文档迁移不自动开启产品架构实施。

## 定位、开发与验证

- 查询代码或调用链优先使用本仓可用的 Graphify 图谱；图谱不存在/不适用时说明限制并用 `rg` 与实际源码定位。不得复制旧仓图谱充当新仓事实。
- 当前构建、启动、测试及发布命令以真实 `package.json` 和 [开发指南](docs/development.md)为准；不照用旧仓命令，不将聊天预览称为完整 Agent。
- 未来各包独立声明技术栈、版本和验证；Node.js + TypeScript 已由用户确认；产品和项目维护命令统一使用 Node，不引入 Bun。UI 框架和产品目录仍待设计，不沿用旧仓 React/Vitest 版本假设。
- 行为变更先用有意义的失败用例证明问题，再实现和复测。纯逻辑、请求/事件形状、真实进程、UI、实际 Provider 和制品安装分别记录证据，互不冒充。
- 本地迭代先最近的回归；PR/合并/发布前执行届时已配置的适用门禁。不能降低阈值掩盖失败，也不能因为尚无产品测试框架宣称所有功能已验证。
- 交付记录改动、实际检查数量/结果、未验证项和风险；没有执行的检查标为 UNVERIFIED。不得将旧项目测试成绩或提交状态迁移为新项目通过证明。
- 维护文件采用 UTF-8、Markdown；JS/TS 使用 2 空格、ESM、无分号，匹配已有文件。未来加入 formatter 后按所属包执行，避免重排无关文件。

## 用户数据与版本

产品数据统一用 `~/.budingx`，通过 Node `os.homedir()` 解析当前用户 home；不硬编码用户名、电脑名称、盘符或 cwd。禁止读取、回退、写入或自动迁移 `~/.claude`。模型、历史、团队、IM、调度等在统一根下按身份与责任隔离并遵守迁移/备份规范；密钥不作为普通共享明文配置。bootstrap 只使用显式参数/BUDINGX_* 环境变量，不持久化用户数据。项目内的助手发现入口不属于产品用户存储。

用户已确认自有新产品采用 MIT，第三方许可独立保留。版本遵守 [版本规范](docs/versioning.md)：新 SP 完成交付至少 minor 更新，同轮修复 patch；产品版本以 src/tui/package.json 为准，发布台账必须有真实回执。

根目录 [产品说明书](PRODUCT.md) 是面向使用者的单份事实入口（产品版本号、按迭代归类的功能表、使用说明、限制、版本历史）。任何改变用户可见行为、命令、配置、按键、数据路径、依赖、版本或能力范围的产品变更（代码或文档，大小不论），都必须在同一次变更中同步更新该说明书的对应章节，并在交付记录里写明更新点或「说明书无需更新」的理由。细则见 [文档约定](docs/documentation.md#产品说明书同步)。

仓库布局按用户最新决定采用单仓：外层保留 docs/SP/Skills 和编排，所有产品模块统一在 src/ 下，TUI 为 src/tui；后续 Core、Desktop、VS Code、Mobile 按责任分目录。不得恢复 packages/、擅建独立子仓或 Git submodule。各模块独立构建/打包，共享契约和 Core 不按端复制。

## 迭代管理

后续迭代统一按 [SP 管理说明](SP/README.md) 和 [docs 迭代路线图](docs/iteration-plan.md)管理。本项目没有需求 ID，按 `SP/SPnnn/<功能或优化slug>/` 保存需求、状态和证据；每轮迭代在 `SP/SPnnn/requirements-summary.md` 维护进度入口，配合功能 STATUS 支持断线快速续接；AC 编号仅标记验收条件。当前规划 SP001–SP021，均未启动。路线图配套 [能力矩阵](docs/agent-capability-matrix.md)和 [npm 发布方案](docs/npm-release-plan.md)须一并阅读。bootstrap 已单独授权实现简易 TUI 和 npm 发布，npm run publish 为真实命令；SP006/SP011 继续扩展完整 Agent 发布能力，SP020/SP021 验收全能力制品及效果。路线图本身不授权开发，实际启动时才建当轮目录。

## Git 与授权

- 默认主分支为 `master`，没有历史提交；不创建或沿用 `main`。不要因为初始化迁移而自动提交、添加远端、推送或打标签。
- 新开发分支默认 `feature/<description>`；用户指定迭代后才使用 `feature/SP<三位编号>/<description>`，不得凭旧仓 SP 目录推定新仓迭代。
- 正式 SDD 中设计文档为 **Agent 自审对象**（2026-11-17 委托后不再设常规人工审阅点）；自审通过即包含：从 master 创建 feature 分支、计划/实施/测试/交付的自主推进、各阶段完成后的本地提交（提交说明使用中文）以及**交叉验证门禁 GREEN 后**按 buding-merge 规程合入 master；推送、npm 发布、远端设置、打标签、分支/worktree 删除仍分别绑定用户授权。其余场景的提交与合并单独绑定授权；同一动作的已有明确授权持续有效，不重复确认。
- **审查与集成委托（USER_CONFIRMED，2026-11-17）**：取消常规人工审查，由 Agent 自行审查并对功能分支的功能、需求与 bug 修复严格把控；用户只验收 master 结果。合入 master 前必须通过交叉验证门禁（`npm run merge:gate`，见 [集成门禁](docs/integration-gate.md)）并留存自审记录；门禁 RED 禁止合入。该委托长期有效、覆盖后续全部 SP；推送、npm 发布、远端设置、打标签、分支/worktree 删除**不在委托内**，仍单独授权。
- 集成前固定实际源/目标与 outgoing 范围，保护无关暂存和本地工作。禁止 force-push、自动 stash/reset、绕过服务端检查或批量删除未知路径。
- 不提交依赖、日志、凭据、缓存或产物。旧产品源码及历史数据迁移仍需独立审计和授权；新简易 TUI 的 MIT、npm 首发及本次 Git 提交/推送已获用户明确授权，不沿用历史暂停状态重复审批。
