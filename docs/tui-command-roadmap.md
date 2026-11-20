# TUI 命令路线图（对照参考仓 buding-worker-space）

状态：规划修订 2026-11-20（r8 命令面补排）。命令清单来自用户 2026-11-20 明确列出；机制对照为只读盘点，实现独立编写。本文是 [迭代路线图](iteration-plan.md) 与 [TUI 还原度差距基线](tui-fidelity-gap-baseline.md) 的组成部分，不授权实施。

## 1. 目的与边界

- 把用户列出的全部命令安排进 SP：已实现的归还原迭代（SP002–SP005），缺口排入 SP006/SP007/SP011，不回收已用编号。
- 「像素级参考」指用户可见行为、别名、快捷键、面板结构对照参考仓；实现遵守 SP001 决定 3「读机制、不抄代码」与 [独立实现边界](independent-development.md)：不复制源码、提示词、内部 SDK 类型或 bundle，注册表与面板自写。
- 命令注册表三型契约（local / local-jsx / prompt）与模态槽是 SP006 P1 前置（还原度基线 M3）；下表面板类命令统一依赖该机制，不再新增内联 if-else。

## 2. 命令总表

| 命令（别名/快捷键） | 用户可见行为 | 参考机制事实（只读对照） | 本仓现状 | 目标迭代 |
| --- | --- | --- | --- | --- |
| /new（/clear） | 全新会话，清空对话历史，保留项目规则 | clear 为 local 型，aliases 含 new/reset | /clear 已实现（SP002/SP005）；/new 别名缺 | SP006 tui-usability |
| /resume（/continue） | 恢复历史会话，严格按当前 cwd 过滤 | resume 为 local-jsx 选择器，aliases 含 continue，带搜索参数 | /resume 已实现（SP005，0.5.3 起工作区隔离）；/continue 别名与选择面板缺 | SP006 tui-usability |
| /rewind（/undo，Esc+Esc） | 回滚对话与文件修改到指定检查点 | rewind 为 local 型 + 消息选择器对话框（独立键位上下文） | /undo 文件回滚已实现（SP003）；对话回滚与 Esc+Esc 缺 | SP006 tui-usability |
| /plan（Shift+Tab） | 只读规划模式，审批通过后再执行修改 | plan 为 local-jsx；shift+tab 为模式轮播键（Windows 非 VT 回退 meta+m） | 缺；现 Shift+Tab 为三档权限轮播（USER_CONFIRMED） | SP006 task-planning/tui-usability（决策 D1） |
| /context | System/Tools/History 各模块 Token 占用网格图 | context 交互为 local-jsx 彩色网格，非交互为 local 文本 | 文本版已实现（SP005）；网格图缺 | SP006 tui-usability |
| /compact [指令] | 手动把冗长历史压缩为摘要释放 Token | compact 为 local 型，可选自定义摘要指令 | 自动压缩已实现（SP005）；手动命令缺 | SP006 tui-usability（复用 SP005 压缩核心） |
| /init | 扫描代码库自动生成项目级 AGENTS.md | init 为 prompt 型，多阶段扫描与偏好队列 | 缺 | SP006 project-instructions |
| /diff | 当前工作区所有未提交变更对比 | diff 为 local-jsx，未提交变更 + 逐回合 diff | 已实现（SP003，含 Git 工作区差异） | SP006 面板化收口 |
| /btw <问题> | 旁路临时提问，不打断主任务、不写入主历史 | btw 为 local-jsx，独立侧会话 | 缺 | SP006 tui-usability（侧会话核心，边界复用 SP007） |
| /cost（/usage） | 会话累计 Token 与预估费用 | cost 为 local 型，会话总成本与时长 | 用量上报已实现（0.5.2/0.5.4）；累计与费用缺 | SP006 tui-usability（决策 D2） |
| /help | 内置命令 + 已加载自定义 Skill 命令 | help 为 local-jsx，聚合技能/插件命令 | 基础版已实现；技能清单缺 | SP006 skills-and-mcp |
| /worktree | 创建/切换/合并/清理隔离 Git Worktree | 参考以 EnterWorktree/ExitWorktree 工具与团队隔离实现，无独立 slash 目录 | SP004 git-worktree-safety 已规划安全边界；命令面缺 | SP006 命令面；SP011 团队隔离复用（决策 D3） |
| /tasks | 后台任务查看/日志/终止 | tasks 为 local-jsx，aliases 含 bashes | 后台执行已实现（SP004）；管理面板缺 | SP006 tui-usability |
| /agents | 查看/调用 .budingx/agents/*.md 子智能体 | agents 为 local-jsx 管理面板 | 缺 | SP007 subagent-execution |
| /mcp | MCP 连接状态/工具数量/重载 | mcp 为 local-jsx，enable/disable 参数 | 缺 | SP006 skills-and-mcp |
| /skills | 列出 SKILL.md 技能包并快捷触发 | skills 为 local-jsx | 缺（skills/ 现为开发助手入口，非运行时） | SP006 skills-and-mcp |
| /permissions | 工具与终端命令自动放行白名单 | permissions 为 local-jsx，aliases 含 allowed-tools | /permission + /rules 已实现（SP003，0.5.4 规则面板）；别名与统一面板缺 | SP006 permission-controls 延伸 |
| /export | 会话与代码修改记录导出 Markdown | export 为 local-jsx，可选文件名 | 缺 | SP006 tui-usability |
| /models | 模型档案管理面板 | model 为 local-jsx 面板 | 已实现（SP002） | 维持；SP006 模态槽统一 |

既有命令归属：/effort（0.5.2）、/memory、/sessions、/context 文本版（SP005）、/permission、/rules、/undo、/diff（SP003）、/clear、/exit、/models（SP002）。0.5.4 起 /config 与 /model 移出 /help 与补全展示（保留可用），不计入用户清单分母。

## 3. 迭代归属与依赖

- SP005（已收口）提供 /rewind、/compact、/cost、/resume 的地基：转录检查点、确定性压缩、真实用量上报、会话 cwd 隔离。
- **0.5.4 提前交付（既有命令改造）**：/new /reset /continue /rewind(Esc+Esc) /plan(Shift+Tab) /context 网格 /compact [指令] /cost(/usage) /permissions(/allowed-tools) /help 技能清单 已随 0.5.4 落地（对照参考行为、独立实现）；SP006 仍负责 /init /btw /worktree /tasks /mcp /skills /export 与注册表三型收口。
- SP006 出口门槛补充：命令注册表三型 + 模态槽；上表除 /agents 外的缺口全部在本轮落地；/init、/skills、/mcp、/help 技能清单随 project-instructions 与 skills-and-mcp。
- SP007：/agents 的定义加载、权限/预算/取消传播与真实子代理链路。
- SP011：worktree 团队隔离复用 /worktree 命令面与 SP004 安全边界。
- SP015/SP016：命令面以本表为分母（用户清单 18 项 + /models）公布 PASS/PARTIAL/MISS。

## 4. 设计决策（提议，实施前需确认）

- D1 /plan 与 Shift+Tab：用户要求 Shift+Tab 进规划模式；现行 Shift+Tab 为三档权限轮播（r6 USER_CONFIRMED）。提议保留三档权限语义，把「规划」作为独立覆盖态加入轮播（只读 + 计划审批后执行），或 /plan 命令配独立快捷键；不静默改动已确认的三模式决定。
- D2 /usage 别名语义：参考 /usage 为订阅配额；本仓按用户清单作 /cost 别名（累计消耗），不引入订阅配额语义。
- D3 /worktree 命令面：参考无 slash 目录、以工具实现；本仓按用户清单补面板，核心复用 SP004 worktree 安全边界，不复制工具源码。
- D4 /rewind 回滚边界：只回滚转录与文件检查点，不回滚已发生的外部副作用（网络/已执行命令），与 SP005「不盲重放副作用」一致。

## 5. 验收与证据

- 每个命令落地随行为回归（真实 Ink 帧或管道输出）与别名/快捷键矩阵；面板类命令以模态槽 P1 门禁为前置。
- 机制对照只登记行为事实（类型/别名/参数提示/面板结构/键位），来源为参考仓只读盘点；不把参考测试成绩当作本仓证据。

## 6. MIT/AST 边界

- 注册表、三型契约、模态槽、各面板与键位分发均独立编写；参考仓无 LICENSE，视为未开源，仅参考机制与行为事实。许可与来源台账见 [第三方声明](../THIRD-PARTY-NOTICES.md)。
