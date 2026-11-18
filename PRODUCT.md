# budingx 产品说明书

> **npm 已发布版本**：0.3.0（`latest`）
> **当前发布候选**：0.3.1 · SP003 模型管理修复，已准备，等待手动发布。
> **说明书版本**：v1.5
> **更新日期**：2026-11-18
> **产品形态**：独立 MIT 许可的终端 Coding Agent（Node.js ≥ 22.18 + TypeScript，不依赖 Bun）

本文件是面向使用者的产品说明书，回答「这是什么、能做什么、怎么用、还差什么」。仓库协作约定见 [AGENTS.md](AGENTS.md)，开发命令见 [开发指南](docs/development.md)，迭代明细见 [SP 目录](SP/README.md)。

**维护约定**：任何改变用户可见行为、命令、配置、按键、数据路径、依赖或能力范围的产品变更（代码或文档），都必须在同一次变更中同步更新本文件的「版本与功能」「使用说明」「已知限制」「版本历史」对应章节，并在交付记录里写明本次更新点或「说明书无需更新」的理由。详见 [文档约定](docs/documentation.md#产品说明书同步)。

---

## 1. 这是什么

budingx 是一个**从零独立实现的终端 Coding Agent**，目标是在终端里完成定位问题、修改代码、运行测试、提交前审查的完整编码闭环。**当前路线专注 TUI 单端（r8）**。Desktop、VS Code、远程/H5 与 IM 已移出当前 SP 范围，SP008 保留通用宿主契约。

**0.2.0（SP002）**，支持 OpenAI 兼容配置和流式对话。SP002 在此基础上补齐了模型档案、会话状态机、工具回合契约、双中断与排队等核心机制，并已完成本轮发布。**SP003 已在仓库实现工作区文件工具与三档权限模式**（读取/搜索/编辑文件、改动预览与撤销、`@` 引用文件、权限规则），已随 0.3.0 发布。命令执行与完整编码任务循环属 SP004。

与被参考的旧实现的关系：本仓只参考公开机制与可观察行为，代码独立编写，不含旧产品源码、提示词或构建产物。详见 [独立实现与复用边界](docs/independent-development.md)。

---

## 2. 版本与功能（按迭代归类）

### 2.1 已交付

| 阶段 / 迭代 | 版本          | 功能目录                                                                  | 交付内容                                                                                                                                               | 状态                                  |
| ----------- | ------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------- |
| bootstrap   | 0.1.0 / 0.1.1 | 简易聊天 TUI                                                              | OpenAI 兼容端点配置、SSE 流式对话、内存会话、多行输入、斜杠命令族、npm Trusted Publishing 发布链路、tarball 隔离安装 smoke                             | 已发布（npm `budingx@0.1.1`）         |
| SP001       | —（规格轮）   | capability-baseline、evaluation-suite、core-boundaries、release-scope     | 能力清单 v1（85 项，验收时必交 53 项；2026-11-17 调整 v1.1：必交 47、r7 将六项记为范围外）、核心边界与不变量、评测集规格与任务清单、发布范围与待决项                                                             | 已验收，**不含产品代码**              |
| SP002       | 0.2.0         | provider-streaming、model-management、session-lifecycle、tui-conversation | OpenAI 兼容流解析与 tool_calls 装配、错误分类/有界重试/取消/限额、模型档案与凭据仓库、会话状态机与终态契约、工具回合、双中断与排队、Ink 8 多行对话界面 | **已发布**，真实终端人工验证边界见 §7 |
| SP003       | 0.3.1 | model-manager | 模型档案面板、供应商模板、自动拉取模型 ID、连接验证 | 已准备发布 |
| SP003       | 0.3.0         | workspace-tools、change-preview、permission-controls、file-context         | 工作区文件工具（读取/写入/精确编辑/文件匹配/内容检索，含越界防护与读后编辑门）、结构化 diff 预览与本会话改动撤销、三档权限模式与审批三档、权限规则与拒绝记录、`@` 引用与统一补全 | **已发布** |

### 2.2 后续交付规划（[路线图 r8](docs/iteration-plan.md)）

| 迭代  | 目标                    | 主要功能目录                                                                                               | 状态 |
| ----- | ----------------------- | ---------------------------------------------------------------------------------------------------------- | ---- |
| SP004 | 真实编码任务            | command-execution、coding-task-loop、git-worktree-safety、task-planning                                    | 规划中 |
| SP005 | 长会话与数据可靠性      | context-budget、session-recovery、failure-recovery、project-memory                                         | 规划中 |
| SP006 | 日常开发与 TUI 候选     | project-instructions、skills-and-mcp、hooks、web-retrieval、headless-cli、tui-usability、npm-packaging     | 规划中 |
| SP007 | Agent 质量与扩展        | evaluation-regression、runtime-diagnostics、provider-compatibility、subagent-execution、multimodal-context | 规划中 |
| SP008 | 多端架构入口与共享边界  | shared-models-and-history、session-ownership、transport-boundaries                                         | 规划中（契约轮，轻量测试客户端验证） |
| SP009 | TUI 独立交付与 npm 发布工程 | tui-distribution、upgrade-compatibility、npm-publish-pipeline                                              | 规划中 |
| SP010 | 中期编码效果检查        | coding-parity-checkpoint、core-reliability                                                                 | 规划中 |
| SP011 | 多代理团队              | team-lifecycle、task-coordination、team-messaging、worktree-isolation                                      | 规划中 |
| SP012 | 浏览器操作              | browser-session、page-actions、browser-artifacts                                                           | 规划中 |
| SP013 | Computer Use            | computer-permissions、screen-actions、desktop-control-recovery                                             | 规划中 |
| SP014 | 定时任务                | schedule-management、durable-scheduler、scheduled-agent-run                                                | 规划中 |
| SP015 | 当前范围全能力集成与交付 | tui-capability-integration、advanced-distribution、full-upgrade                                            | 规划中 |
| SP016 | 当前范围完整替代验收    | full-agent-parity、long-running-reliability、final-release-evidence                                        | 规划中 |

> 路线图 r8 现行编号为 SP001–SP016，九个后续轮次的旧编号见[映射表](docs/iteration-plan.md)。

---

## 3. 安装

需要 **Node.js ≥ 22.18** 与 npm。不需要 Bun，也不依赖任何常驻桌面服务。

```powershell
npm install -g budingx
budingx --version
```

升级 `npm install -g budingx@latest`，卸载 `npm uninstall -g budingx`。

---

## 4. 配置与运行

本地源码测试可直接运行 `npm run start`：仅仓库根目录的开发命令自动读取 `.env.e2e.local`，将地址、模型和密钥用于本次进程，不保存模型档案。文件不存在时继续按现有配置启动；显式进程环境变量优先于文件值，启动参数仍优先于环境变量。安装后的 `budingx`、构建和发布流程不会自动读取此文件，真实环境需自行配置。该文件保持 Git 忽略；其中 `BUDINGX_E2E_*` 预算和次数字段属于自动化测试脚本，不控制交互聊天的用量。

### 4.1 环境变量（也可在 TUI 隐藏录入密钥）

```powershell
$env:BUDINGX_BASE_URL = "https://api.openai.com/v1"
$env:BUDINGX_MODEL = "YOUR_MODEL_NAME"
$env:BUDINGX_API_KEY = "YOUR_API_KEY"
budingx
```

- Base URL 是服务商 API 前缀，客户端自行追加 `/chat/completions`；服务商必须返回 `text/event-stream` SSE 并以 `[DONE]` 结束。
- 仅读取 `BUDINGX_*` 变量，不会从其他工具发现密钥或配置。
- 请使用可信的 HTTPS 端点；HTTP 只允许显式的 localhost/loopback 开发端点。
- 真实密钥永远不要写进命令行参数或提交进仓库。

### 4.2 命令行参数

```powershell
budingx --model YOUR_MODEL_NAME --base-url https://YOUR_PROVIDER/v1
budingx --prompt "Hello" --timeout 120000
```

配置优先级：**命令行参数 > `BUDINGX_*` 环境变量 > 已存档案**。

### 4.3 配置入口

- 交互终端内使用 `/models` 管理本地模型档案，步骤见 [SP003 模型管理](#模型管理)。模型档案和密钥分别存放在 `~/.budingx/config.json` 和 `~/.budingx/credentials.json`。
- 自动化或临时运行使用启动参数或环境变量。例如 `budingx --prompt "总结本目录" --timeout 120000`。管道模式的 `/models` 只列出档案，`/model <名称或ID>` 可以切换。
- 公开的 0.3.0 使用旧版命令。本手册中的新面板和移除 `/provider` 的行为适用于 0.3.1。

## 5. 使用说明（按交付迭代）

### 5.1 Bootstrap · 启动和基础对话

| 入口 | 什么时候用 | 示例与结果 |
| --- | --- | --- |
| `budingx --help` | 查询本机可用参数 | `budingx --help` 输出启动参数和命令入口。 |
| `budingx --version` | 核对实际安装版本 | 升级后执行，输出安装包版本。 |
| `budingx [--model <模型ID>] [--base-url <端点>] [--timeout <毫秒>] [--prompt <文本>]` | 启动交互会话，或发起一次请求 | `budingx --timeout 120000` 启动终端；提供 `--prompt "你好"` 时输出本次回答后退出。超时允许 1–600000 毫秒。 |
| `/help` | 查会话命令 | 输入 `/help` 并回车，显示当前构建支持的命令。 |
| `/config` | 检查当前配置 | 显示端点、模型、超时、配置来源和掩码后的密钥。 |
| `/clear` | 开始一段新对话 | 清空对话上下文和可见回复，已存模型档案继续可用。输入历史和待发送队列仍在。 |
| `/exit` 或 `/quit` | 退出 | 结束当前进程。当前版本的会话内容只保存在内存中。 |

### 5.2 SP002 · 模型切换、输入与会话

| 入口 | 操作与结果 |
| --- | --- |
| `/model` | 查看当前模型。 |
| `/model <档案名称或ID>` | 例 `/model 工作模型`。选择已保存档案，下一个回合生效，保留对话；启动默认由模型面板单独设置。 |
| Enter / Shift+Enter | Enter 提交；Shift+Enter 插入换行。回合执行中提交的普通输入进入队列。 |
| Esc / Ctrl+C | 关闭当前界面或取消当前动作。回合执行时可中断；空闲时 Ctrl+C 连按两次退出。 |
| ↑ / ↓ | 单行输入时查看输入历史，多行输入时移动光标。 |

### 5.3 SP003 · 模型管理、工作区和权限

#### 模型管理

本节适用于已准备的 0.3.1。

1. 启动 `budingx`，输入 `/models`，按 `N` 新建。
2. 选择 DeepSeek、Qwen / 阿里云百炼、Kimi / 月之暗面、GLM / 智谱、火山方舟 / 豆包、硅基流动、OpenAI 或 OpenRouter。面板预填端点并定位到隐藏的 API Key 字段。粘贴后按 Enter 拉取模型，输入关键字可筛选列表。
3. 选定模型 ID，按 Enter 返回表单。用「测试连接」检查该端点、密钥和模型，用「保存」保留档案，或用「保存并使用」立即选择它供下一回合使用。
4. 自建服务或不同地域、工作空间、套餐的端点选 **Custom**，输入端点和模型 ID。也可在表单里触发「拉取模型列表」。如果服务不提供列表或未授权读取，仍可手动输入。显示「建议 ID」时应以连接测试结果确认可用性。

| 面板按键 | 用法 |
| --- | --- |
| ↑ / ↓、Enter | 在列表选中档案并使用；在表单选中当前动作并执行。 |
| N / E | 新建或编辑。编辑自动带入原值，Tab 切换字段。修改端点主机后，需要给新主机录入密钥。 |
| D | 打开删除确认页。删除当前或启动默认档案时，可选择替代档案或明确留空；确认后删除档案和对应的存储凭据。 |
| T / S | 测试选中档案，或设置为启动默认。鉴权失败时检查 Key、地区和端点。 |
| O | 查看孤儿凭据的清理页面，确认后才删除。 |
| Esc | 取消待完成的网络请求，或返回上一层。 |

表单的「工具调用」决定该配置是否给模型提供工具。聊天测试通过时，工具调用仍有单独的验证结果。管道里的 `/models` 输出档案名称、模型与端点，不显示密钥。`/provider` 在本次修复中移除。

#### 5.3.2 权限与规则

| 命令 | 示例与结果 |
| --- | --- |
| `/permission` | 查看当前权限模式。 |
| `/permission <read\|workspace\|full>` | `/permission workspace` 开启工作区内修改。默认 `read` 只读，`full` 自动执行可获准的写入。Shift+Tab 循环切换。 |
| `/rules` 或 `/rules list` | 列出持久化规则及规则 ID。被拒绝规则盖住的允许规则会显示遮蔽提示。 |
| `/rules add <allow\|deny> <工具或*> [路径-glob]` | `/rules add deny Read private/**` 拒绝读取指定目录里的文件。路径省略时匹配该工具的所有目标；当前命令的 glob 参数不含空格。 |
| `/rules rm <规则ID>` | 先用 `/rules list` 查看实际 ID，再执行如 `/rules rm r-1`。 |
| `/denials` | 查看本会话的权限拒绝及原因。 |

规则顺序为拒绝、允许、模式默认。工作区和凭据保护底线在所有模式生效。需要审批时可用 ↑↓ 浏览拟写入的差异，`1` 允许一次，`2` 在本会话记住该目标，`3` 拒绝并可输入反馈，Esc 直接拒绝。

#### 5.3.3 文件引用、差异与撤销

| 入口 | 示例与结果 |
| --- | --- |
| `@路径`、`@路径#L起止` | `解释 @src/config.ts#L10-20` 把第 10–20 行带入模型请求。含空格用 `@"docs/My Notes.md"`。用 Tab 补全，忽略规则及读权限依旧生效。 |
| `/diff [路径]` | `/diff` 打开列表，`/diff src/config.ts` 打开指定文件。用 Enter 进入明细，←→ 切换当前会话、回合记录及可用的 Git 工作区差异。 |
| `/undo [路径]` | `/undo` 撤销最近一组；`/undo src/config.ts` 撤销指定文件最近一次改动。检测到外部改动时保留磁盘内容并说明冲突。 |

模型可通过 `Read`、`Glob`、`Grep`、`Write` 和 `Edit` 处理工作区文件。例如输入“搜索 `src/` 中调用 `loadConfig` 的位置”。覆盖既有文件前需要先读取；生成修改计划后文件发生变化时需重新读取。大文件检索遇到扫描上限会标注结果不完整。

## 6. 数据与隐私

- 产品数据统一落在 `~/.budingx`；不读取、不回退、不写入 `~/.claude`。
- 配置文件与凭据文件分离；密钥不作为普通共享明文配置保存，也不出现在日志与 UI 回显中。
- 仓库与文档不包含真实密钥、真实会话与用户身份信息。

---

## 7. 已知限制与未验证项

| 项                             | 现状                                                                            | 计划                  |
| ------------------------------ | ------------------------------------------------------------------------------- | --------------------- |
| 命令执行与编码任务循环         | 未实现；文件读写工具已在 SP003 落地，终端命令、计划与测试循环仍缺                | SP004                 |
| 密钥存储                       | TUI 可隐藏录入；配置与凭据分文件，凭据文件未加密，不应共享                      | 静态加密另行设计      |
| 会话持久化与恢复               | 未实现，退出即丢失                                                              | SP005                 |
| 权限规则与沙箱                 | 三档权限模式、规则匹配、拒绝记录与撤销已实现（SP003）；**无操作系统级沙箱**，执行隔离能力仍为空白 | SP004 补命令执行边界 |
| 撤销粒度                       | 仅本会话内可撤销（SP003）；跨会话快照与 rewind 未实现                          | SP005                 |
| 图片与多模态                   | 读取图片只返回尺寸摘要，不发送图像内容                                          | SP007                 |
| Desktop / VS Code / 移动端 / 远程/H5 / IM | 当前 SP 范围外，保留通用宿主接口 | 后续如需纳入，另行决定范围和排期 |
| 真实服务 live 证据             | 已验证一个用户提供的服务：流式、工具审批回合、取消、鉴权错误；见 SP002 报告 §16 | 其他型号/服务仍未测   |
| 真终端 CJK/IME 与 resize 体验  | 未验证（需 Windows Terminal + ConHost 人工 smoke）                              | 验收时补              |
| macOS / Linux                  | 仅声明 Windows 已验证                                                           | SP009 后逐个平台验证  |

---

## 8. 版本历史

| 版本  | 日期       | 变化                                                     | 状态             |
| ----- | ---------- | -------------------------------------------------------- | ---------------- |
| 0.1.0 | 2026-11-16 | 首个发布版：OpenAI 兼容流式聊天 TUI                      | 已发布           |
| 0.1.1 | 2026-11-16 | 发布链路修复与维护版（OIDC Trusted Publishing 实测）     | 历史已发布       |
| 0.2.0 | 2026-11-17 | SP002 模型与会话闭环；升级说明见 release-notes/v0.2.0.md | 历史已发布 |
| 0.3.0 | 2026-11-18 | SP003 工作区与安全修改；升级说明见 release-notes/v0.3.0.md | 已发布，`latest` |
| 0.3.1 | 2026-11-18 | SP003 模型管理修复，见 [发行说明](release-notes/v0.3.1.md) | 已准备发布 |
| —（规划调整，无产品行为变化） | 2026-11-17 | 路线图 r6：TUI 单端优先；SP008/SP009/SP016–SP018 暂缓、多端架构入口保留；TUI 三权限模式固定；能力清单分母 53→47；说明书 v1.3 | 规划文档调整 |
| —（规划调整） | 2026-11-18 | 路线图 r7：移出五个原暂缓 SP，保留通用宿主契约，必交能力仍为 47 | 规划文档调整 |
| —（规划调整） | 2026-11-18 | 路线图 r8：现行 SP001–SP016 连续编号，能力与产品版本不变 | 规划文档调整 |

发布台账以 [release-ledger.json](release-ledger.json) 为准，发行说明见 `release-notes/`。

---

## 9. 仓库与开发入口

- 协作约定：[AGENTS.md](AGENTS.md)｜文档导航：[docs/index.md](docs/index.md)
- 当前状态：[docs/current-status.md](docs/current-status.md)｜迭代路线图：[docs/iteration-plan.md](docs/iteration-plan.md)
- 开发指南：[docs/development.md](docs/development.md)｜架构：[docs/architecture.md](docs/architecture.md)
- 产品端使用说明（英文，随包发布）：[src/tui/README.md](src/tui/README.md)
- 第三方声明：[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)
