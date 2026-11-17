# budingx 产品说明书

> **产品版本**：0.2.0（已发布，npm `latest` 指向此版本）
> **仓库当前源码**：0.2.0 · SP002「模型与会话闭环」；GitHub Actions Windows/Linux 验证与 OIDC 发布均成功，发布源码为 6ed77d8。
> **说明书版本**：v1.2
> **更新日期**：2026-11-17
> **产品形态**：独立 MIT 许可的终端 Coding Agent（Node.js ≥ 22.18 + TypeScript，不依赖 Bun）

本文件是面向使用者的产品说明书，回答「这是什么、能做什么、怎么用、还差什么」。仓库协作约定见 [AGENTS.md](AGENTS.md)，开发命令见 [开发指南](docs/development.md)，迭代明细见 [SP 目录](SP/README.md)。

**维护约定**：任何改变用户可见行为、命令、配置、按键、数据路径、依赖或能力范围的产品变更（代码或文档），都必须在同一次变更中同步更新本文件的「版本与功能」「使用说明」「已知限制」「版本历史」对应章节，并在交付记录里写明本次更新点或「说明书无需更新」的理由。详见 [文档约定](docs/documentation.md#产品说明书同步)。

---

## 1. 这是什么

budingx 是一个**从零独立实现的终端 Coding Agent**，目标是在终端里完成定位问题、修改代码、运行测试、提交前审查的完整编码闭环，并逐步提供独立的 Desktop、VS Code 与未来移动端接入。

当前已发布 **0.2.0（SP002）**，支持 OpenAI 兼容配置和流式对话。SP002 在此基础上补齐了模型档案、会话状态机、工具回合契约、双中断与排队等核心机制，并已完成本轮发布；完整的编码工具（读写文件、执行命令）在 SP003/SP004 才落地。

与被参考的旧实现的关系：本仓只参考公开机制与可观察行为，代码独立编写，不含旧产品源码、提示词或构建产物。详见 [独立实现与复用边界](docs/independent-development.md)。

---

## 2. 版本与功能（按迭代归类）

### 2.1 已交付

| 阶段 / 迭代 | 版本          | 功能目录                                                                  | 交付内容                                                                                                                                               | 状态                                  |
| ----------- | ------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------- |
| bootstrap   | 0.1.0 / 0.1.1 | 简易聊天 TUI                                                              | OpenAI 兼容端点配置、SSE 流式对话、内存会话、多行输入、斜杠命令族、npm Trusted Publishing 发布链路、tarball 隔离安装 smoke                             | 已发布（npm `budingx@0.1.1`）         |
| SP001       | —（规格轮）   | capability-baseline、evaluation-suite、core-boundaries、release-scope     | 能力清单 v1（85 项，必交 53 项）、核心边界与不变量、评测集规格与任务清单、发布范围与待决项                                                             | 已验收，**不含产品代码**              |
| SP002       | 0.2.0         | provider-streaming、model-management、session-lifecycle、tui-conversation | OpenAI 兼容流解析与 tool_calls 装配、错误分类/有界重试/取消/限额、模型档案与凭据仓库、会话状态机与终态契约、工具回合、双中断与排队、Ink 8 多行对话界面 | **已发布**，真实终端人工验证边界见 §7 |

### 2.2 规划中（尚未启动，路线图见 [迭代计划](docs/iteration-plan.md)）

| 迭代  | 目标                    | 主要功能目录                                                                                               |
| ----- | ----------------------- | ---------------------------------------------------------------------------------------------------------- |
| SP003 | 工作区与安全修改        | workspace-tools、change-preview、permission-controls、file-context                                         |
| SP004 | 真实编码任务            | command-execution、coding-task-loop、git-worktree-safety、task-planning                                    |
| SP005 | 长会话与数据可靠性      | context-budget、session-recovery、failure-recovery、project-memory                                         |
| SP006 | 日常开发与 TUI 候选     | project-instructions、skills-and-mcp、hooks、web-retrieval、headless-cli、tui-usability、npm-packaging     |
| SP007 | Agent 质量与扩展        | evaluation-regression、runtime-diagnostics、provider-compatibility、subagent-execution、multimodal-context |
| SP008 | Desktop 独立工作台      | desktop-host、desktop-coding-workflow、multi-project-sessions                                              |
| SP009 | VS Code 独立端          | vscode-host、workspace-integration                                                                         |
| SP010 | 跨端共享与接入          | shared-models-and-history、session-ownership、transport-boundaries                                         |
| SP011 | 独立交付与 npm 发布工程 | tui-distribution、desktop-distribution、vscode-distribution、upgrade-compatibility、npm-publish-pipeline   |
| SP012 | 中期编码效果检查        | coding-parity-checkpoint、core-reliability                                                                 |
| SP013 | 多代理团队              | team-lifecycle、task-coordination、team-messaging、worktree-isolation                                      |
| SP014 | 浏览器操作              | browser-session、page-actions、browser-artifacts                                                           |
| SP015 | Computer Use            | computer-permissions、screen-actions、desktop-control-recovery                                             |
| SP016 | 远程访问与 H5           | gateway-auth、remote-session、h5-client、remote-recovery                                                   |
| SP017 | IM 基础与 Telegram/飞书 | im-adapter-contract、identity-binding、telegram、feishu                                                    |
| SP018 | 微信/钉钉与 IM 完整性   | wechat、dingtalk、im-cross-channel                                                                         |
| SP019 | 定时任务                | schedule-management、durable-scheduler、scheduled-agent-run                                                |
| SP020 | 全能力集成与交付        | cross-surface-integration、advanced-distribution、full-upgrade                                             |
| SP021 | 完整替代验收            | full-agent-parity、long-running-reliability、final-release-evidence                                        |

> 上表为 MODEL_PROPOSED 的阶段安排，功能范围本身已由用户确认纳入；每轮的实际需求与设计在启动时才细化。

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
| `/clear`                         | 清空内存上下文及界面中已显示的回答、工具卡和错误         |
| `/exit` / `/quit`                | 退出                                                     |

### 5.2 按键

| 按键        | 行为                                                                             |
| ----------- | -------------------------------------------------------------------------------- |
| Enter       | 提交；回合进行中时输入进入队列，在下一个安全边界注入                             |
| Shift+Enter | 插入换行                                                                         |
| Esc         | 审批卡上拒绝当前请求并继续；其他执行阶段打断；空闲时回收排队内容；密钥录入时取消 |
| Ctrl+C      | 回合执行中为打断；在输入框连按两次退出                                           |
| ↑ / ↓       | 多行输入内移动；单行输入召回历史                                                 |
| y / n       | 允许或拒绝待审批的工具调用                                                       |

### 5.3 首屏信息

交互模式首屏对照参考产品的欢迎屏布局，独立实现：

- **未配置时**：紫色（`#af87ff`）圆角框，顶边框嵌入 `budingx v<版本>`（版本 dim）。≥70 列时左栏为加粗欢迎语、吉祥物、dim 的模型行（模型 · 端点主机）与 cwd 行，右栏以 dim 竖线分隔，显示「Tips for getting started」（`/provider add …`、`BUDINGX_API_KEY`、`/help`）与「What's new」；<70 列自动改居中紧凑框。
- **配置完成后**：切换为无边框精简横幅——吉祥物 + `budingx v<版本>` + dim 模型行 + dim cwd。
- **老终端兜底**：Windows 上无现代终端环境（cmd/老 conhost）时整屏走纯 ASCII（框线 `+-|`、ASCII 吉祥物）；`BUDINGX_FORCE_ASCII_LOGO=1` / `BUDINGX_FORCE_PIXEL_LOGO=1` 可强制覆盖。
- 密钥只以「是否已配置」参与首屏判定，任何形态都不显示密钥内容；未配置时输入区下方持续给出 `/provider add <label> <base-url> <model>` 引导。`/model` 切换后首屏即时更新。
- **文案语言**：现代终端的交互面（首屏、状态行、提示、审批卡、排队指示、斜杠命令回显与 `/help`）为中文；ASCII 兜底屏与非 TTY/管道输出保持英文（老控制台代码页与机器可读性）；命令语法、环境变量名、档案/模型标识符、路径与错误码始终英文。

### 5.4 会话语义

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
| 编码工具（文件读写、终端命令） | 未实现，仅有注册接口与测试桩                                                    | SP003 / SP004         |
| 密钥存储                       | TUI 可隐藏录入；配置与凭据分文件，凭据文件未加密，不应共享                      | 静态加密另行设计      |
| 会话持久化与恢复               | 未实现，退出即丢失                                                              | SP005                 |
| 权限规则与沙箱                 | 未实现                                                                          | SP003 / SP004         |
| Desktop / VS Code / 移动端     | 未实现                                                                          | SP008 / SP009 / SP016 |
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

发布台账以 [release-ledger.json](release-ledger.json) 为准，发行说明见 `release-notes/`。

---

## 9. 仓库与开发入口

- 协作约定：[AGENTS.md](AGENTS.md)｜文档导航：[docs/index.md](docs/index.md)
- 当前状态：[docs/current-status.md](docs/current-status.md)｜迭代路线图：[docs/iteration-plan.md](docs/iteration-plan.md)
- 开发指南：[docs/development.md](docs/development.md)｜架构：[docs/architecture.md](docs/architecture.md)
- 产品端使用说明（英文，随包发布）：[src/tui/README.md](src/tui/README.md)
- 第三方声明：[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)
