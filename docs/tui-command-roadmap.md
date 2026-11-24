# TUI 命令路线图（对照参考仓 buding-worker-space）

状态：规划修订 2026-11-24（r8 命令面补排 + 差距补排复核）。命令清单来自用户 2026-11-20 明确列出；机制对照为只读盘点，实现独立编写。本文是 [迭代路线图](iteration-plan.md) 与 [TUI 还原度差距基线](tui-fidelity-gap-baseline.md) 的组成部分，不授权实施。

## 1. 目的与边界

- 把用户列出的全部命令安排进 SP：已实现的归还原迭代（SP002–SP005），缺口排入 SP006/SP007/SP011，不回收已用编号。
- 「像素级参考」指用户可见行为、别名、快捷键、面板结构对照参考仓；实现遵守 SP001 决定 3「读机制、不抄代码」与 [独立实现边界](independent-development.md)：不复制源码、提示词、内部 SDK 类型或 bundle，注册表与面板自写。
- 命令注册表三型契约（local / local-jsx / prompt）与模态槽是 SP006 P1 前置（还原度基线 M3）；下表面板类命令统一依赖该机制，不再新增内联 if-else。

## 2. 命令总表

| 命令（别名/快捷键） | 用户可见行为 | 参考机制事实（只读对照） | 本仓现状 | 目标迭代 |
| --- | --- | --- | --- | --- |
| /new（/clear） | 全新会话，清空对话历史，保留项目规则 | clear 为 local 型，aliases 含 new/reset | /clear 已实现，别名 /new /reset 已提供（SP002/SP005） | 维持 |
| /resume（/continue） | 恢复历史会话，严格按当前 cwd 过滤 | resume 为 local-jsx 选择器，aliases 含 continue，带搜索参数 | /resume 已实现（SP005，0.5.3 起工作区隔离，交互开选择面板）；/continue 已实现为独立命令（取当前工作区最近会话，非别名）；标题/正文搜索未实现 | SP009 0.9.2 补搜索 |
| /rewind（/undo，Esc+Esc） | 回滚对话与文件修改到指定检查点 | rewind 为 local 型 + 消息选择器对话框（独立键位上下文） | /undo 已实现（SP003）；/rewind 已实现为 local-jsx（交互开检查点选择面板）；Esc+Esc 键位与对话回滚边界待设计期核对 | 维持 |
| /plan（Shift+Tab） | 只读规划模式，审批通过后再执行修改 | plan 为 local-jsx；shift+tab 为模式轮播键（Windows 非 VT 回退 meta+m） | /plan 已注册（进入或退出规划模式）；Shift+Tab 仍为三档权限轮播（USER_CONFIRMED），规划的键位未定 | SP006 task-planning（决策 D1） |
| /context | System/Tools/History 各模块 Token 占用网格图 | context 交互为 local-jsx 彩色网格，非交互为 local 文本 | 已实现为上下文占用网格（SP005/SP006） | 维持 |
| /compact [指令] | 手动把冗长历史压缩为摘要释放 Token | compact 为 local 型，可选自定义摘要指令 | 自动压缩已实现（SP005）；/compact 手动命令已注册 | 维持 |
| /init | 扫描代码库自动生成项目级 AGENTS.md | init 为 prompt 型，多阶段扫描与偏好队列 | 已实现：生成 AGENTS.md 骨架，写文件仍需审批 | 维持 |
| /diff | 当前工作区所有未提交变更对比 | diff 为 local-jsx，未提交变更 + 逐回合 diff | 已实现（SP003，含 Git 工作区差异，交互开对话框） | 维持 |
| /btw <问题> | 旁路临时提问，不打断主任务、不写入主历史 | btw 为 local-jsx，独立侧会话 | 已实现：旁路提问，不写入主会话上下文 | 维持 |
| /cost（/usage） | 会话累计 Token 与预估费用 | cost 为 local 型，会话总成本与时长 | 已实现累计 token 与预估费用，别名 /usage 已提供 | 维持（决策 D2） |
| /help | 内置命令 + 已加载自定义 Skill 命令 | help 为 local-jsx，聚合技能/插件命令 | 已实现并列出已发现技能（0.9.1 起） | 维持 |
| /worktree | 创建/切换/合并/清理隔离 Git Worktree | 参考以 EnterWorktree/ExitWorktree 工具与团队隔离实现，无独立 slash 目录 | 已实现 list/create/remove（删除需确认）；进入/切出/合并与会话绑定未实现 | SP009 0.9.2 补闭环；SP011 团队隔离复用（决策 D3） |
| /tasks | 后台任务查看/日志/终止 | tasks 为 local-jsx，aliases 含 bashes | 已实现只读列表（后台 Shell 分组 + 子代理分组）；详情、日志读取与终止未实现 | SP009 0.9.2 补详情/日志/终止 |
| /agents | 查看/调用 .budingx/agents/*.md 子智能体 | agents 为 local-jsx 管理面板 | 已实现：子代理管理面板（查看、创建、编辑、删除 .budingx/agents/*.md） | 维持 |
| /mcp | MCP 连接状态/工具数量/重载 | mcp 为 local-jsx，enable/disable 参数 | 已实现只读状态列表（stdio）；资源、交互请求与启停/重连未实现 | SP009 0.9.2 补协议与连接管理 |
| /skills | 列出 SKILL.md 技能包并快捷触发 | skills 为 local-jsx | 已实现技能发现列表（用户/项目/内置三级，/reload-skills 刷新）；资源引用、禁用、自动调用与 allowed-tools 限制未实现 | SP009 0.9.2 补运行时 |
| /permissions | 工具与终端命令自动放行白名单 | permissions 为 local-jsx，aliases 含 allowed-tools | /permission、/rules 与别名 /allowed-tools 均已实现（SP003、0.5.4）；/config 仍为回显，统一设置面板未实现 | SP015 统一设置面板 |
| /export | 会话与代码修改记录导出 Markdown | export 为 local-jsx，可选文件名 | 已实现：JSONL/文本导出、可选会话、独占创建防覆盖、路径沙箱；Markdown 与可归属改动记录未实现 | SP009 0.9.2 补 Markdown 与改动记录 |
| /models | 模型档案管理面板 | model 为 local-jsx 面板 | 已实现（SP002），面板可用 | 维持；SP006 模态槽统一 |

既有命令归属：/effort（0.5.2）、/memory、/sessions、/context 文本版（SP005）、/permission、/rules、/undo、/diff（SP003）、/clear、/exit、/models（SP002）。0.5.4 起 /config 与 /model 移出 /help 与补全展示（保留可用），不计入用户清单分母。

## 3. 迭代归属与依赖

- SP005（已收口）提供 /rewind、/compact、/cost、/resume 的地基：转录检查点、确定性压缩、真实用量上报、会话 cwd 隔离。
- **0.5.4 提前交付（既有命令改造）**：/new /reset /continue /rewind(Esc+Esc) /plan(Shift+Tab) /context 网格 /compact [指令] /cost(/usage) /permissions(/allowed-tools) /help 技能清单 已随 0.5.4 落地（对照参考行为、独立实现）；SP006 仍负责 /init /btw /worktree /tasks /mcp /skills /export 与注册表三型收口。
- SP006 出口门槛补充：命令注册表三型 + 模态槽；上表除 /agents 外的缺口全部在本轮落地；/init、/skills、/mcp、/help 技能清单随 project-instructions 与 skills-and-mcp。
- SP007：/agents 的定义加载、权限/预算/取消传播与真实子代理链路。
- SP011：worktree 团队隔离复用 /worktree 命令面与 SP004 安全边界。
- SP015/SP016：命令面以本表为分母（用户清单 18 项 + /models）公布 PASS/PARTIAL/MISS。

### 2026-11-24 差距补排

§2 的现状列已按 2026-11-24 复核更新到 master 4f3fb55 / TUI 0.9.1（命令注册表见 `src/tui/commands/`）。实施归属、范围和 AC 以[现行差距补排](iteration-plan.md#tui-差距补排2026-11-24)为准；逐项参考事实与本仓现状见 [0.9.2 需求正本](../SP/SP009/tui-gap-optimizations/requirements.md)与[盘点固化记录](requirements/tui-gap-inventory-2026-11-24/requirements.md)。

| 入口 | 后续交付 |
| --- | --- |
| `/resume`、会话分支与改名 | SP009 0.9.2 交付当前工作区搜索、分支隔离和命名持久化。 |
| `/export` | SP009 0.9.2 补 Markdown、可归属改动记录和旧会话无快照反馈。 |
| `/mcp`、`/skills` | SP009 0.9.2 补 MCP 协议、资源和启停/重连，以及技能资源、禁用和触发约束。 |
| `/tasks`、`/worktree` | SP009 0.9.2 补通用任务详情/日志/终止与单会话 worktree；SP011 承接团队调度和成员隔离。 |
| `!`、`/config` | SP015 实施 Shell 输入模式与统一设置面板，并回归 0.9.2 的交互。 |

SP015/SP016 继续按既有命令验收清单和 TUI 结构口径登记证据。

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
