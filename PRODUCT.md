# budingx 产品说明书

> **产品版本**：0.2.0（已发布，npm `latest` 指向此版本）
> **仓库当前源码**：0.2.0 · SP002「模型与会话闭环」已发布；SP003「工作区与安全修改」已在仓库实现（尚未发布，npm 仍为 0.2.0）。
> **说明书版本**：v1.4
> **更新日期**：2026-11-17
> **产品形态**：独立 MIT 许可的终端 Coding Agent（Node.js ≥ 22.18 + TypeScript，不依赖 Bun）

本文件是面向使用者的产品说明书，回答「这是什么、能做什么、怎么用、还差什么」。仓库协作约定见 [AGENTS.md](AGENTS.md)，开发命令见 [开发指南](docs/development.md)，迭代明细见 [SP 目录](SP/README.md)。

**维护约定**：任何改变用户可见行为、命令、配置、按键、数据路径、依赖或能力范围的产品变更（代码或文档），都必须在同一次变更中同步更新本文件的「版本与功能」「使用说明」「已知限制」「版本历史」对应章节，并在交付记录里写明本次更新点或「说明书无需更新」的理由。详见 [文档约定](docs/documentation.md#产品说明书同步)。

---

## 1. 这是什么

budingx 是一个**从零独立实现的终端 Coding Agent**，目标是在终端里完成定位问题、修改代码、运行测试、提交前审查的完整编码闭环。**当前路线专注 TUI 单端（2026-11-17 用户决定）**：Desktop、VS Code、远程/H5 与 IM 接入暂缓，架构保留多端接入入口，未来可按入口恢复接入。

当前已发布 **0.2.0（SP002）**，支持 OpenAI 兼容配置和流式对话。SP002 在此基础上补齐了模型档案、会话状态机、工具回合契约、双中断与排队等核心机制，并已完成本轮发布。**SP003 已在仓库实现工作区文件工具与三档权限模式**（读取/搜索/编辑文件、改动预览与撤销、`@` 引用文件、权限规则），随下一版本发布；命令执行与完整编码任务循环仍属 SP004。

与被参考的旧实现的关系：本仓只参考公开机制与可观察行为，代码独立编写，不含旧产品源码、提示词或构建产物。详见 [独立实现与复用边界](docs/independent-development.md)。

---

## 2. 版本与功能（按迭代归类）

### 2.1 已交付

| 阶段 / 迭代 | 版本          | 功能目录                                                                  | 交付内容                                                                                                                                               | 状态                                  |
| ----------- | ------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------- |
| bootstrap   | 0.1.0 / 0.1.1 | 简易聊天 TUI                                                              | OpenAI 兼容端点配置、SSE 流式对话、内存会话、多行输入、斜杠命令族、npm Trusted Publishing 发布链路、tarball 隔离安装 smoke                             | 已发布（npm `budingx@0.1.1`）         |
| SP001       | —（规格轮）   | capability-baseline、evaluation-suite、core-boundaries、release-scope     | 能力清单 v1（85 项，验收时必交 53 项；2026-11-17 调整 v1.1：必交 47、暂缓 6）、核心边界与不变量、评测集规格与任务清单、发布范围与待决项                                                             | 已验收，**不含产品代码**              |
| SP002       | 0.2.0         | provider-streaming、model-management、session-lifecycle、tui-conversation | OpenAI 兼容流解析与 tool_calls 装配、错误分类/有界重试/取消/限额、模型档案与凭据仓库、会话状态机与终态契约、工具回合、双中断与排队、Ink 8 多行对话界面 | **已发布**，真实终端人工验证边界见 §7 |
| SP003       | —（待发布）   | workspace-tools、change-preview、permission-controls、file-context         | 工作区文件工具（读取/写入/精确编辑/文件匹配/内容检索，含越界防护与读后编辑门）、结构化 diff 预览与本会话改动撤销、三档权限模式与审批三档、权限规则与拒绝记录、`@` 引用与统一补全 | **已实现**，未发布（版本号仍为 0.2.0） |

### 2.2 规划中与暂缓（尚未启动，路线图 r6 见 [迭代计划](docs/iteration-plan.md)）

| 迭代  | 目标                    | 主要功能目录                                                                                               | 状态 |
| ----- | ----------------------- | ---------------------------------------------------------------------------------------------------------- | ---- |
| SP003 | 工作区与安全修改 · 三权限模式 | workspace-tools、change-preview、permission-controls、file-context                                         | **已实现（见 §2.1），待发布** |
| SP004 | 真实编码任务            | command-execution、coding-task-loop、git-worktree-safety、task-planning                                    | 规划中 |
| SP005 | 长会话与数据可靠性      | context-budget、session-recovery、failure-recovery、project-memory                                         | 规划中 |
| SP006 | 日常开发与 TUI 候选     | project-instructions、skills-and-mcp、hooks、web-retrieval、headless-cli、tui-usability、npm-packaging     | 规划中 |
| SP007 | Agent 质量与扩展        | evaluation-regression、runtime-diagnostics、provider-compatibility、subagent-execution、multimodal-context | 规划中 |
| SP008 | Desktop 独立工作台      | desktop-host、desktop-coding-workflow、multi-project-sessions                                              | **暂缓（DEFERRED）** |
| SP009 | VS Code 独立端          | vscode-host、workspace-integration                                                                         | **暂缓（DEFERRED）** |
| SP010 | 多端架构入口与共享边界  | shared-models-and-history、session-ownership、transport-boundaries                                         | 规划中（契约轮，轻量测试客户端验证） |
| SP011 | TUI 独立交付与 npm 发布工程 | tui-distribution、upgrade-compatibility、npm-publish-pipeline                                              | 规划中 |
| SP012 | 中期编码效果检查        | coding-parity-checkpoint、core-reliability                                                                 | 规划中 |
| SP013 | 多代理团队              | team-lifecycle、task-coordination、team-messaging、worktree-isolation                                      | 规划中 |
| SP014 | 浏览器操作              | browser-session、page-actions、browser-artifacts                                                           | 规划中 |
| SP015 | Computer Use            | computer-permissions、screen-actions、desktop-control-recovery                                             | 规划中 |
| SP016 | 远程访问与 H5           | gateway-auth、remote-session、h5-client、remote-recovery                                                   | **暂缓（DEFERRED）** |
| SP017 | IM 基础与 Telegram/飞书 | im-adapter-contract、identity-binding、telegram、feishu                                                    | **暂缓（DEFERRED）** |
| SP018 | 微信/钉钉与 IM 完整性   | wechat、dingtalk、im-cross-channel                                                                         | **暂缓（DEFERRED）** |
| SP019 | 定时任务                | schedule-management、durable-scheduler、scheduled-agent-run                                                | 规划中 |
| SP020 | 当前范围全能力集成与交付 | tui-capability-integration、advanced-distribution、full-upgrade                                            | 规划中 |
| SP021 | 当前范围完整替代验收    | full-agent-parity、long-running-reliability、final-release-evidence                                        | 规划中 |

> 上表阶段安排为 MODEL_PROPOSED；**TUI 单端优先、SP008/SP009/SP016–SP018 暂缓、多端架构入口保留、TUI 三权限模式（仅可查看/工作区内修改/完全权限）为 2026-11-17 用户决定（USER_CONFIRMED，路线图 r6）**。暂缓轮编号保留不回收，恢复须用户另行决定；每轮的实际需求与设计在启动时才细化。

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

### 4.3 模型档案

档案存放在 `~/.budingx`（由当前用户 home 解析，绝不使用 `~/.claude`）：配置在 `~/.budingx/config.json`，密钥单独存于 `~/.budingx/credentials.json`，导出或分享配置不会带上密钥。

```powershell
budingx
/provider add work https://api.example.com/v1 my-model
/provider key work
# 按提示隐藏输入密钥，Enter 保存（不要把 Key 写在命令参数里）
/provider check work
/provider default work
/models
/model work
/provider rm work
```

编辑语法：`/provider edit NAME NEW_LABEL BASE_URL MODEL`，四项均需提供；名称不能含空格。编辑当前档案会刷新活动配置，换主机清空活动密钥；删除当前档案后需重新选择模型。`tools` 标记由用户显式设置，`check` 的工具探测要求服务返回指定 echo 工具调用，不能仅凭 HTTP 200 认定支持。

每个档案的密钥同时绑定**档案 id 与 Base URL 主机**：换主机即解除绑定，密钥不会被转发到另一台服务器。`/config` 只回显密钥末四位。

---

## 5. 使用说明

### 5.1 斜杠命令

| 命令                             | 作用                                                     |
| -------------------------------- | -------------------------------------------------------- |
| `/help`                          | 帮助                                                     |
| `/config`                        | 显示端点、模型、密钥状态（掩码）与配置来源               |
| `/models`                        | 列出已存模型档案                                         |
| `/model NAME`                    | 切换模型；**保留会话历史**，自**下一回合**起生效         |
| `/provider add\|edit\|rm\|check` | 添加、编辑、删除及验证模型档案                           |
| `/provider key NAME`             | 隐藏录入或更新密钥；Enter 保存，Esc 取消；仅交互终端可用 |
| `/provider default NAME`         | 设置下次启动使用的默认档案                               |
| `/provider tools NAME on\|off`   | 设置档案工具能力标记；不代表已有真实工具                 |
| `/provider orphans [clean]`      | 查看孤儿凭据数量；显式加 `clean` 才清理                  |
| `/permission [read\|workspace\|full]` | 查看或切换权限模式（仅可查看 / 工作区内修改 / 完全权限） |
| `/rules [list\|add\|rm]`         | 查看、添加、删除权限规则（按工具与路径 glob 生效并持久化） |
| `/diff [路径]`                   | 查看工作区改动；交互模式可切换会话、回合和 Git 差异          |
| `/undo [路径]`                   | 撤销最近一组改动或指定文件；文件被外部改动时停止并说明原因  |
| `/denials`                       | 查看拒绝历史（工具、目标与原因）                        |
| `/clear`                         | 清空内存上下文及界面中已显示的回答、工具卡和错误         |
| `/exit` / `/quit`                | 退出                                                     |

### 5.2 按键

| 按键        | 行为                                                                             |
| ----------- | -------------------------------------------------------------------------------- |
| Enter       | 提交；回合进行中时输入进入队列，在下一个安全边界注入                             |
| Shift+Enter | 插入换行                                                                         |
| Esc         | 审批卡上拒绝当前请求并继续；其他执行阶段打断；空闲时回收排队内容；密钥录入时取消 |
| Ctrl+C      | 回合执行中为打断；在输入框连按两次退出                                           |
| ↑ / ↓       | 多行输入内移动；单行输入召回历史；移动补全选项，或滚动审批与差异内容                     |
| y / n       | 允许或拒绝待审批的工具调用（`n` 后可输入拒绝反馈，回传给模型）                   |
| 1 / 2 / 3   | 审批三档：允许一次 / 本会话记住该目标 / 拒绝（拒绝可附反馈文字）                 |
| Shift+Tab   | 轮换权限模式（仅可查看 → 工作区内修改 → 完全权限）                                |
| Tab         | 在 `@`/`/` 补全列表中插入候选（先补最长公共前缀）                                |
| ← / →       | 切换「当前差异」、Git 工作区差异和各回合差异                                     |

### 5.3 首屏信息

交互模式首屏对照参考产品的欢迎屏布局，独立实现：

- **未配置时**：紫色（`#af87ff`）圆角框，顶边框嵌入 `budingx v<版本>`（版本 dim）。≥70 列时左栏为加粗欢迎语、吉祥物、dim 的模型行（模型 · 端点主机）与 cwd 行，右栏以 dim 竖线分隔，显示「Tips for getting started」（`/provider add …`、`BUDINGX_API_KEY`、`/help`）与「What's new」；<70 列自动改居中紧凑框。
- **配置完成后**：切换为无边框精简横幅——吉祥物 + `budingx v<版本>` + dim 模型行 + dim cwd。
- **老终端兜底**：Windows 上无现代终端环境（cmd/老 conhost）时整屏走纯 ASCII（框线 `+-|`、ASCII 吉祥物）；`BUDINGX_FORCE_ASCII_LOGO=1` / `BUDINGX_FORCE_PIXEL_LOGO=1` 可强制覆盖。
- 密钥只以「是否已配置」参与首屏判定，任何形态都不显示密钥内容；未配置时输入区下方持续给出 `/provider add <label> <base-url> <model>` 引导。`/model` 切换后首屏即时更新。
- **文案语言**：现代终端的交互面（首屏、状态行、提示、审批卡、排队指示、斜杠命令回显与 `/help`）为中文；ASCII 兜底屏与非 TTY/管道输出保持英文（老控制台代码页与机器可读性）；命令语法、环境变量名、档案/模型标识符、路径与错误码始终英文。

### 5.4 工作区工具与权限（SP003）

- **工具面**：模型可调用 `Read` / `Write` / `Edit` / `Glob` / `Grep`。读取带行号，可分段读取大文件；写入为整文件替换并自动创建缺失的父目录，行尾统一 LF；编辑要求**唯一字面匹配**（多处匹配须显式 `replace_all` 或更长上下文），并保留原有行尾风格。Grep 支持单文件与目录，达到扫描上限时标注结果不完整。
- **安全门**：覆盖既有文件前必须先 `Read` 过该文件；若文件在读取后被外部改动，写入被拒绝并提示重新读取。需要确认的 Write/Edit 会先显示可滚动的差异，批准后重新核对目标与内容。
- **边界**：工作区之外的路径、目录穿越、符号链接/junction 越界一律拒绝；凭据特征文件（`.env`、`*.pem`、`*.key`、`id_rsa*` 等）与 `~/.budingx` 用户数据目录在任何模式下都不可读写；`.git` 内写入在完全权限下仍需确认。
- **权限模式**：默认「仅可查看」且不跨会话继承；「工作区内修改」对工作区内写入逐次确认（可选「本会话记住该目标」）；「完全权限」自动执行，但**不越过** deny 规则与凭据保护。`/rules` 的持久化规则可按工具与路径 glob 收紧或放宽模式默认，被 deny 覆盖的 allow 规则会被标注。
- **改动可见与可撤销**：`/diff` 打开两级对话框（文件列表 → hunk 明细），可切换会话基线对当前磁盘、单回合累计差异和 Git 工作区对 HEAD 的差异。单独输入 `/undo` 撤销最近的未撤销改动组，`/undo <路径>` 撤销该文件最近一次修改。存在外部改动时会停止并保留用户内容。
- **文件引用**：输入 `@路径` 或 `@"含空格的路径"`，可加 `#L10-20` 限定行范围。文件内容在该提示词实际发给模型时读取，补全支持目录续补、文件名模糊查找和自动引号。忽略规则及读权限适用于候选与提交。

### 5.5 会话语义

- 被取消的回合**保留已产出的文本**；在任何输出前取消则把原始请求还原回输入框。
- 失败的回合**不写入历史**，模型不会看到它答不了的提示；原始输入仍可用 ↑ 召回。
- 回合进行中切换模型不影响本回合，下一回合才使用新模型、端点和凭据。斜杠命令只在回合边界执行；异步命令和密钥录入完成前暂停排队回合自动启动。
- 基本 resize 会按原始文本重排历史；尚未实现全屏虚拟滚动。`--timeout` 设置连接和流读取空闲超时（毫秒），重试仍受次数上限约束。
- 会话只存在内存中，退出即丢失（持久化与恢复属 SP005）。
- `/clear` 同步清空模型上下文和可见会话内容；输入历史及尚未执行的排队输入仍保留。
- 工具参数 schema 会从 Core 传到 Provider；无参数工具发送显式空 object schema，以兼容拒绝缺失 schema 的服务。

---

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
| Desktop / VS Code / 移动端 / 远程/H5 / IM | 未实现且**暂缓**（2026-11-17 用户决定）；多端架构入口保留                | 暂缓（原 SP008 / SP009 / SP016–SP018），恢复须用户另行决定 |
| 真实服务 live 证据             | 已验证一个用户提供的服务：流式、工具审批回合、取消、鉴权错误；见 SP002 报告 §16 | 其他型号/服务仍未测   |
| 真终端 CJK/IME 与 resize 体验  | 未验证（需 Windows Terminal + ConHost 人工 smoke）                              | 验收时补              |
| macOS / Linux                  | 仅声明 Windows 已验证                                                           | SP011 后逐个平台验证  |

---

## 8. 版本历史

| 版本  | 日期       | 变化                                                     | 状态             |
| ----- | ---------- | -------------------------------------------------------- | ---------------- |
| 0.1.0 | 2026-11-16 | 首个发布版：OpenAI 兼容流式聊天 TUI                      | 已发布           |
| 0.1.1 | 2026-11-16 | 发布链路修复与维护版（OIDC Trusted Publishing 实测）     | 历史已发布       |
| 0.2.0 | 2026-11-17 | SP002 模型与会话闭环；升级说明见 release-notes/v0.2.0.md | 已发布，`latest` |
| —（未发布，源码） | 2026-11-17 | SP003 工作区与安全修改：文件工具、三档权限模式、改动预览与撤销、`@` 引用补全；说明书 v1.4 | 已实现，待版本准备与发布 |
| —（规划调整，无产品行为变化） | 2026-11-17 | 路线图 r6：TUI 单端优先；SP008/SP009/SP016–SP018 暂缓、多端架构入口保留；TUI 三权限模式固定；能力清单分母 53→47；说明书 v1.3 | 规划文档调整 |

发布台账以 [release-ledger.json](release-ledger.json) 为准，发行说明见 `release-notes/`。

---

## 9. 仓库与开发入口

- 协作约定：[AGENTS.md](AGENTS.md)｜文档导航：[docs/index.md](docs/index.md)
- 当前状态：[docs/current-status.md](docs/current-status.md)｜迭代路线图：[docs/iteration-plan.md](docs/iteration-plan.md)
- 开发指南：[docs/development.md](docs/development.md)｜架构：[docs/architecture.md](docs/architecture.md)
- 产品端使用说明（英文，随包发布）：[src/tui/README.md](src/tui/README.md)
- 第三方声明：[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)
