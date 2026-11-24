# SP009 · TUI 差距优化需求（0.9.2）

状态：实施已合入，0.9.2 已发布｜更新：2026-11-24｜输入基线：master 4f3fb55，TUI 0.9.1。本文是 0.9.2 的需求正本。

- USER_CONFIRMED（2026-11-24）。先落正式路线图和需求文档。0.9.2 处理盘点中未排期的缺口和已实现功能的待优化项，后续 SP 自有需求进入各轮。
- MODEL_PROPOSED。下列可观察边界和验收条件为本次拆分结果。设计阶段沿用现有入口、状态模型和权限边界，并核定链接中的参考行为。命令参数未在本需求固定时由设计定稿。
- 来源为 2026-11-24 的 TUI 差距盘点（参考仓 master_node b5c9be8）。#05 等是原盘点序号；已确认的 13 项与逐项处置见[盘点固化记录](../../../docs/requirements/tui-gap-inventory-2026-11-24/requirements.md)。现行归属见[正式路线图](../../../docs/iteration-plan.md#tui-差距补排2026-11-24)。
- 版本口径：**USER_CONFIRMED（2026-11-24 用户决定）保持 0.9.2**，不按 minor 处理。本轮承载 11 项新增能力与 1 项缺陷修复，与[版本规范](../../../docs/versioning.md)「同一 SP 的修复增加 patch」存在语义张力；按用户决定仍以 0.9.2 记录，该张力的取舍理由记入[路线图版本记录](../../../docs/iteration-plan.md#版本记录)。

## 0.9.2 交付范围

本补丁含 12 项：11 项 TUI 差距优化（#05、#06、#24、#26、#33、#34、#41、#16、#20、#36、#39）与 1 项缺陷修复（#42，用户 2026-11-24 现场报告的子代理失败）。团队任务协调及成员隔离由 [SP011](../../SP011/requirements-summary.md) 实施。直接 Shell 输入和统一设置面板由 [SP015](../../SP015/tui-capability-integration/requirements.md) 实施。SP015 复验组合后的命令和 TUI 行为，SP016 汇总正式验收证据。

## 参考对照与偏离声明

参考仓只提供**行为事实**，不提供实现路径；下列对照用于防止实施时按目录名臆测能力。每项标注本轮性质：**还原**＝参考具备且本仓缺；**新增**＝参考运行期也不具备、属本仓自研扩展；**收紧**＝有意偏离参考的语义。

参考仓运行状态提醒：其 `feature()` 恒返回 false（`src/utils/featureGates.ts`），被 gate 的分支与生成的空 stub（如 `src/commands/fork/index.ts`、`src/skills/mcpSkills.ts`）在运行期不生效。引用参考事实时必须区分运行期生效路径与死代码。

| 项 | 参考事实（只读对照） | 本仓现状 | 本轮性质 |
| --- | --- | --- | --- |
| #05 会话分支 | `/branch`（别名 `/fork`；`src/commands/branch/index.ts:4-12`）；`createSessionBranch()` 复制活跃消息链、`randomUUID()` 新 ID、写入 `forkedFrom{sessionId,messageUuid}`、标题加 "(Branch)" 去重（`src/utils/sessionBranching.ts:253,368,462-533`）；CLI `--fork-session` 恢复时新建 ID 且不接管原会话 worktree 绑定（`src/main.tsx:998`、`src/utils/sessionRestore.ts:435-471`） | 无 fork/分支 API，无 `/branch` 命令 | 还原 + 新增（历史会话派生入口、两进程并发派生冲突处理） |
| #06 会话命名 | `/rename [name]`（`src/commands/rename/index.ts:3-10`）；标题以 `custom-title` entry 追加落盘，与 `ai-title` entry 分离且用户标题优先、AI 标题不覆盖（`src/utils/sessionStorage.ts:2660-2719`）；`/resume` 选择器内可改名（`src/components/LogSelector.tsx:750`） | 标题取首条用户消息（`src/storage/session-store.ts:336-341,475`），截断 80 字（`:99-103`）；无标题 setter | 还原（仅用户自定义标题；自动命名不在本轮） |
| #24 会话恢复搜索 | 运行期只做标题/分支/标签/PR 子串匹配（`src/components/LogSelector.tsx:419-437`）；全文（Fuse）与语义（agentic）搜索代码存在但被 `isDeepSearchEnabled=false`、`isAgenticSearchEnabled=false` 与恒真短路硬关闭（`:172,192,467,799`） | `/resume` 只有上下键选择（`src/tui/panels.tsx:18-44`）；Ctrl+R 是输入历史搜索 | **新增**（正文检索参考运行期不具备） |
| #26 Markdown 导出 | `/export` 只输出 .txt 纯文本，无 JSONL/Markdown、无 diff、无目标路径覆盖保护（`src/commands/export/export.tsx:58-75`、`src/components/ExportDialog.tsx:56-72`） | 已支持 jsonl/text、选会话面板、`wx` 独占创建防覆盖、路径限 `~/.budingx`（`src/tui/export.ts:52-76`） | 新增格式（本仓导出已强于参考，不回退既有保护） |
| #33 MCP | 传输 stdio/SSE/Streamable HTTP/WS（+ 变体）（`src/services/mcp/client.ts:615-672,704-779,780-861`）；资源 list/read；交互请求**仅 elicitation**、**无 sampling**（客户端只声明 roots+elicitation，`client.ts:986-995`）；重连指数退避最多 5 次且**仅远程传输自动重连**（`src/services/mcp/useManageMCPConnections.ts:87-90,354-359`）；失败调用**默认不重放**，唯一例外是 URL elicitation 未完成时最多重试 3 次（`client.ts:2805-2900`）；OAuth 完整实现（`src/services/mcp/auth.ts`） | 仅 stdio（`src/tui/mcp/types.ts:3-10`、`client.ts:93-95`）；无资源、无交互请求、无启停/重连动作；`/mcp` 只读状态列表 | 还原（WS 纳入本轮，依据 CAP-L2-12 必交口径；sampling 明确不支持） |
| #34 Skills | 优先级 managed→user→project→plugin 且同名先命中者生效；命令聚合把 bundled 排最前，故**内置压过同名项目技能**（`src/commands.ts:447-465,687-697`）；`allowed-tools` 是**预授权**（注入 `alwaysAllowRules`，只免弹窗、不限制其它工具，`src/tools/SkillTool/SkillTool.ts:779-806`、`src/utils/processUserInput/processSlashCommand.tsx:863`）；无禁用开关，只有 `disable-model-invocation` 与 `user-invocable: false` 两个正交开关（`src/skills/loadSkillsDir.ts:214-220`）；技能正文不进可见转录 | 用户级→项目级（近→远）→内置级，同名首胜且**磁盘技能优先于内置**（`src/tui/skills.ts:195-226`）；`allowed-tools` 只解析不执行（`:138-139`）；技能不进模型 system prompt；无禁用开关 | 还原 + **收紧**（allowed-tools 改限制语义，理由见 #34）+ 优先级明确不采用参考的「内置压过项目」 |
| #41 项目指令 | **只读 CLAUDE.md，完全不读 AGENTS.md**；导入语法为 `@path`/`@./path`/`@~/path`/`@/path`（**非 `@import path` 指令式**），只识别 markdown 叶子文本节点；递归导入 + 文件级 `processedPaths` 与目录级 `visitedDirs` 双重防环；`MAX_INCLUDE_DEPTH = 5`；顶层文件不截断、仅嵌套 memory 附件截断；越界外部路径默认不加载、需用户批准；**无文件监听**，靠压缩/恢复/切换 worktree 等事件触发缓存失效；仓内指令不能放宽权限 | 4 级（用户→父目录→工作区→子目录，默认关闭、深度 ≤3）、单文件 64 KiB/总计 128 KiB 上限并产出 warning、每回合前重取、**无导入机制** | 新增导入机制 + 启用局部规则（本仓已支持 AGENTS.md 与 CLAUDE.md，本轮不改变发现范围） |
| #16 输入编辑 | ctrl+s stash（存文本/光标/粘贴引用，提交后自动恢复，`src/components/PromptInput/PromptInput.tsx:1353-1380`）；粘贴 >10000 字符自动折叠为占位（`src/components/PromptInput/inputPaste.ts:4,20-55`）；**无粘贴二次确认、无输入长度上限**；ctrl+r 历史搜索存在 | Ctrl+R 输入历史搜索、bracketed paste、图片粘贴已实现（`src/tui/app.tsx:398-409,953-971,1153-1160`）；草稿 stash、粘贴折叠、输入上限均未实现；`EditorBuffer.draft` 只是历史召回草稿（`src/tui/editor/buffer.ts:16,174-199`）；**无外部编辑器** | 新增 stash 与粘贴反馈；输入上限为**自研**（参考没有），上限值设计期定；外部编辑器不在本轮范围 |
| #20 消息卡片与转录 | Ctrl+O 转录双向切换、Ctrl+E 转录内 show-all（`src/hooks/useGlobalKeybindings.tsx:90-132`、`src/screens/REPL.tsx:333-334`）；折叠汇总（`src/utils/collapseReadSearch.ts`）；thinking 默认折叠为单行摘要 + 全局开关 meta+t，**不是逐条可折叠**（`src/components/messages/AssistantThinkingMessage.tsx:39-78`）；子代理通知按用户消息 role 渲染但被排除出模型输入（`src/utils/collapseBackgroundBashNotifications.ts:66-74`） | Ctrl+O 转录已实现；Ctrl+E 是命令/待办卡片展开（`src/tui/app.tsx:1358-1366`）；折叠汇总**只覆盖 Read/Glob/Grep 且需同回合连续 ≥2 次成功**（`src/tui/render/history-window.tsx:30-58`）；**思考内容从不显示**（`render/reducer.ts:158-161`、`render/restored-transcript.ts:65`）；子代理通知按**系统消息**渲染（0.9.1 已确认） | 还原（思考段形态）+ **新增**（逐条展开/收起）+ 保持本仓已确认偏离（通知不回退为用户消息 role） |
| #36 通用后台任务 | `/tasks`（别名 `/bashes`）完整面板，列表+详情双视图、按类型分组、详情可 tail 输出文件、列表与详情均可停止（`src/components/tasks/BackgroundTasksDialog.tsx:271-286`、`src/components/tasks/ShellDetailDialog.tsx:24,34-48`）；**任务注册表只在内存 store，进程退出后运行中任务不可见、不可接管**，仅输出落盘（`src/state/AppStateStore.ts:161,469`、`src/utils/task/diskOutput.ts:49-55`） | `/tasks` **只读**（`src/tui/tasks.ts:1-2`），登记表内存 Map（`:32-56`），输出落盘 `~/.budingx/sessions/<id>/tasks/*.out`（`src/exec/persist.ts:10`）；终止能力在 exec 层 `background.cancel()`（`src/exec/background.ts:60,222`）与子代理 TaskStop 工具 | 还原（命令面接管 exec 层）；登记表跨进程可见性不在本轮范围 |
| #42 子代理失败兜底 | 参考仓使用不同的抓取实现与工具结果模型，**无同一熔断模型可对照**；本项为本仓缺陷修复 | 本仓 WebFetch 只按字节截断（512 KiB，`src/provider/web-fetch.ts:21`），不与 core 输出上限对齐（`:292-340`）；core 每次工具结果强制 `TOOL_OUTPUT_CAP = 32768`（`src/core/constants.ts:5`），超出即 `isError=true` + `BUDINGX_CORE_003`（`src/core/session.ts:2327-2336`）；同一工具同一错误码连续 `MAX_TOOL_FAILURE_STREAK = 5`（`src/core/constants.ts:28`）触发熔断 `BUDINGX_CORE_010`（`src/core/session.ts:2349-2374`）；子代理 loop 退出后生成 `AGENT_FAILED`，父 agent 只拿到 `Subagent failed: <message>` 与 usage（`src/core/agent-runtime.ts:363`） | **缺陷修复**（非新增能力）：抓长页面必然失败、子代理无降级、失败信息不足 |
| #39 通用 Worktree | **无 `/worktree` 斜杠命令**（走 `EnterWorktreeTool`/`ExitWorktreeTool` + `--worktree` flag + 退出弹窗）；**无 merge 能力**（`src/utils/worktree.ts` 只有 keep/remove）；绑定持久化 `saveWorktreeState`（`src/utils/sessionStorage.ts:2936`）与恢复 `restoreWorktreeForResume`（`src/utils/sessionRestore.ts:332-366`，目录丢失即清空）；删除需显式 `discard_changes` 授权，有未提交改动或未合并提交时拒绝（`src/tools/ExitWorktreeTool/ExitWorktreeTool.ts:190-222`） | `/worktree` 仅 list/create/remove（`src/tui/worktree.ts:86-172`）；`src/git/worktree.ts` 有 enter/exit 与删除单次授权；**无会话绑定、无持久化** | 还原（命令面闭环、绑定持久化与恢复）+ **新增**（合并能力） |

### 有意偏离与新增能力的边界

- **收紧（#34 allowed-tools）**：参考语义是给技能**追加**免弹窗权限，本轮改为**限制**语义——技能声明允许的工具才能使用，其余被拒绝。理由：参考语义会让仓内技能扩大权限，与本仓三档权限和「仓内指令不得放宽权限」的口径冲突（与 [能力矩阵](../../../docs/agent-capability-matrix.md) 的权限行一致）。本仓主会话权限仍然优先于技能声明。
- **保持已有偏离（#20 子代理通知）**：0.9.1 已确认按系统消息渲染、不把 XML 当用户输入，本轮不回退成参考的用户消息 role。
- **自研扩展无参考对照**：正文检索（#24）、allowed-tools 限制语义（#34）、思考段逐条展开（#20）、输入长度上限（#16）、worktree 合并（#39）、粘贴确认（#16）。这些只能靠自有用例验收，失败判据必须在设计阶段写死。
- **明确不支持**：MCP sampling（#33）不实现、不声明兼容；MCP OAuth 为条件式，接入前需单独设计与授权核对。
- **缺陷修复（#42）**：不改三档权限与审批语义，不放宽 WebFetch 的私网拦截、重定向上限与超时，不引入新的网络出口策略；也不承诺「任何失败都不出现」——网络不可达或页面持续不可达时仍会产生真实失败，但**不得再以子代理整体崩溃的形式出现**，必须给出可行动信息并让父 agent 能继续。

### #05 会话分支

从当前或选定的本地已保存会话派生独立会话，保留来源标识、分支点和可继续的对话。在新分支重新核对活动会话归属、权限及未完成工具状态，待核对的副作用保持待核对。派生过程不执行历史工具调用；派生出的分支**不继承原会话的 worktree 绑定**，绑定由 #39 单独管理。

- **AC-FORK-01**：从当前会话和已保存会话各分出一次，得到不同的新 ID。向分支发送消息后重启，两边均可恢复，分支的新消息仅在分支中出现，原会话历史与权限记录完整。
- **AC-FORK-02**：在两个真实进程操作同一来源时生成不同分支或收到明确的冲突或持锁结果。源历史损坏、权限不足或创建中途失败时，用户能继续使用原会话，列表没有可误恢复的半成品。派生过程不会执行历史工具调用。

### #06 会话命名

提供本地 `/rename` 或等价的正式命名入口，支持当前会话改名，并让会话列表、恢复和搜索统一显示已保存标题。用户自定义标题与派生标题分离保存，派生标题不得覆盖用户标题。自动命名与启动命名作为独立增强，不在本轮。

- **AC-NAME-01**：给当前会话改中文标题后重启，可按新标题找回原会话。会话 ID、所属工作区、转录和相关导出引用保持可用。
- **AC-NAME-02**：空白、超长标题及并发保存有确定结果。重命名和会话追加交错时，文件不丢消息或有效标题。旧记录缺标题时仍可正常显示和恢复。

### #24 会话恢复搜索

在 `/resume` 选择器中搜索当前工作区本地会话的标题与已保存正文，键盘选择后恢复原会话。**正文检索为本仓新增能力，参考运行期不具备**；须在设计阶段固定索引范围（仅当前工作区、标题与正文）、索引建立时机、索引上限与失效策略。跨工作区全局索引、PR 筛选和跨设备恢复超出本补丁的搜索范围。

- **AC-RESUME-01**：隔离工作区内造三份会话，用中文标题和仅出现在正文里的词分别筛选，显示可识别命中且能键盘选中。清空搜索、无结果和 Esc 退出各有正确反馈。
- **AC-RESUME-02**：另一工作区和不可读记录不进入结果。恢复选中项后续问落到正确 ID，已存在的按 ID 恢复与 `/continue` 路径通过回归。

### #26 Markdown 导出和代码改动记录

扩展已有 `/export`。当前或选定历史会话可输出 Markdown，区分会话正文、可归属到该会话且仍有证据的代码修改、无法取得的改动记录。沿用现有 JSONL/文本格式、写入权限、独占创建防覆盖与路径沙箱，不回退既有保护。

- **AC-EXPORT-01**：在隔离 Git 仓中通过 Agent 修改文件，分别从 TUI 和支持的非交互入口导出同一会话。Markdown 保留中文和代码块，改动段落只包含本会话对应的文件、摘要或可验证 diff，工作区其他改动不混入。
- **AC-EXPORT-02**：选择旧会话且无快照时清楚标注资料缺失。已存在目标拒绝覆盖，写入失败不损坏现有文件。原有 JSONL/文本结果向后兼容，导出文本不包含凭据与内部技能指令。

### #33 MCP 传输、资源和连接管理

延续现有 stdio。补齐配置声明的 Streamable HTTP、SSE 与 WebSocket 兼容接入、资源发现/读取和可验证的交互请求。支持在 `/mcp` 启停与重连，统一 TUI、headless 和本地宿主的连接状态和调用授权。凭据使用现有安全配置边界，服务器凭据按来源隔离。通用远程宿主、IDE 专用传输及厂商私有接入单独评估。

本轮**不实现 MCP sampling**（参考运行期同样不具备），不声明兼容。自动重连仅对远程传输生效，stdio 不自动重连；已在飞行且结果未知的副作用调用不静默重放。OAuth 或其他授权流程仅在目标服务器需要时进入兼容设计与验收，支持矩阵注明实际验证范围。

- **AC-MCP-01**：使用隔离的真实 stdio 进程和本机 HTTP/SSE/WS 测试服务器，分别完成握手、工具发现与调用、资源列出与读取。旧 stdio 配置无需迁移，三个产品入口装配同一套已支持协议。
- **AC-MCP-02**：模拟断线、超时、启停和重连。状态与工具/资源可见性实时更新；可安全重试的握手可恢复，已在飞行且结果未知的副作用调用不会静默重放；其他服务器继续工作。
- **AC-MCP-03**：使用受控交互请求验证同意、拒绝、取消及超时。无交互入口按权限策略终止或回报需要确认。未授权服务器和工具不会越权，日志及状态面板不会打印认证信息。若声明支持 OAuth，另用隔离授权端点核对成功、过期和拒绝。

### #34 Skills 运行时

在用户、项目、内置技能和手动 `/<技能>` 的基础上，补齐可控资源引用、禁用及受控的模型自动调用，并执行每技能 `allowed-tools` 限制。本仓现行优先级为「用户级→项目级（近→远）→内置级」，同名首胜且磁盘技能优先于内置；**明确不采用参考仓「内置技能压过同名项目技能」的顺序**，理由是内置技能为兜底，不应覆盖用户在项目内的显式技能。

禁用以两个正交开关表达：禁止模型自动调用、禁止用户手动调用（对应参考的 `disable-model-invocation` 与 `user-invocable: false`），不引入单一 enabled/disabled 开关。插件、managed、MCP 作为技能来源由各自体系另行定义。

**偏离声明**：参考的 `allowed-tools` 是预授权（只免弹窗、不限制其它工具），本轮采用限制语义——技能声明允许的工具才能使用，其余被拒绝；理由与边界见「有意偏离与新增能力的边界」。本仓主会话权限始终优先。

- **AC-SKILL-01**：用三个来源、同名和禁用 fixture 验证发现优先级与两个正交开关。`/skills`、补全、显式调用及模型可见目录一致；被禁止模型调用或被禁止手动调用的技能不能以对应方式触发，`/reload-skills` 后立即生效。
- **AC-SKILL-02**：手动和模型触发同一技能，解析合法的相对资源并可定位失败。越出技能根、循环引用、路径穿越或符号链接跨界均受控；无效资源不授予额外权限，技能正文不进入可见转录。
- **AC-SKILL-03**：模型调用限制技能时，允许工具仍受主会话权限约束，未允许工具被拒绝。同一会话结束技能作用域后普通工具恢复；取消或异常不会留下限制泄漏或权限提升。

### #41 项目指令的导入与作用域

在既有用户级、上级与项目级指令上补齐递归导入、与实际操作目录对应的局部规则、去重和可预测优先级。导入语法采用参考的 `@path` 形态（`@path`、`@./path`、`@~/path`、`@/absolute/path`），**不引入 `@import path` 指令式语法**；只识别 markdown 叶子文本节点，代码块与行内代码内的引用不解析。局部规则本仓已有实现但默认关闭，本轮明确其启用条件与作用域。项目内容通过已有可信根与权限校验，兼容当前 `AGENTS.md`/ `CLAUDE.md` 发现（**项目内文件，不涉及 `~/.claude`**）。自动记忆蒸馏与团队记忆独立于本项。

- **AC-RULES-01**：用隔离 Git 工作区验证根规则、嵌套目录规则、同名冲突和递归导入；不同目录命中各自适用规则，同一局部规则不能蔓延到兄弟目录。修改规则后下一次相关回合按定义刷新，压缩/恢复后仍保留适用约束。
- **AC-RULES-02**：循环、重复、深度/大小超限、无效路径或越出可信根时有可定位反馈与明确错误类别。用户配置和安全规则有效，仓内指令不能自行放宽权限，旧项目在无导入时继续工作。

### #16 输入编辑与历史

优化已有编辑缓冲、历史搜索与粘贴。支持将未发送草稿 stash/取回，并让长文本粘贴的显示可控、可提示与可查看，保持明确的发送语义。**输入长度上限为本仓新增**（参考没有该机制），上限值与超限行为在设计阶段确定并写入说明书；**外部编辑器不在本轮范围**。更广的 readline 键族为后续可选体验。

- **AC-INPUT-01**：在 TUI 帧级测多行中文草稿 stash、切换到已发送历史、再取回。草稿与历史各自保留，取消或切会话的行为明确，取回不会自动发送。
- **AC-INPUT-02**：粘贴超过显示阈值的文本，终端保持可编辑并提示内容被折叠或受限。提交前可确认发送内容；允许提交的全文完整送达模型，超过已公布上限时按已定义行为报错。普通粘贴与撤销、历史搜索通过回归。

### #20 消息卡片与转录

在现有卡片、折叠和转录上补齐全量展开、思考段独立展开/收起、工具运行态/完成态与通知呈现。思考段形态对齐参考（默认折叠为单行摘要、可展开），**逐条展开/收起为本仓新增**；转录内的「全量展开」与当前 Ctrl+E（命令/待办卡片展开）的键位关系由设计阶段固定，避免冲突。沿用现有转录消息数据和权限面板，扩展的组合卡片由 SP015 统一验收。子代理通知继续按系统消息渲染，不回退为用户消息 role。

- **AC-TRANSCRIPT-01**：真实 Ink 帧中复现流式回答、思考、工具启动/成功/失败和子代理通知。折叠汇总按运行状态更新，正文与工具结果各显示一次，通知不冒充用户消息。
- **AC-TRANSCRIPT-02**：`Ctrl+O`、全量展开和思考独立显示在长会话与恢复转录均有可验证结果。切换或返回时保留可预期的查看位置，窄屏下审批和输入仍可操作。

### #36 通用后台任务操作

让已有 `/tasks` 支持键盘查看任务详情、受控读取日志和终止当前可管理的后台 Shell 与子代理。本轮由命令面**接管 exec 层的终止与日志读取**（`src/exec/background.ts`、`src/exec/persist.ts`）；任务登记表跨进程可见性不在本轮范围，与参考运行期一致。团队共享任务、负责人、依赖和租约归 [SP011 任务协调](../../SP011/task-coordination/requirements.md)。

- **AC-TASKS-01**：启动真实长命令与可取消子代理，从 TUI 选择对应条目进入详情。显示类型、状态、日志或明确的无日志原因、退出信息。查看长输出时有界，不混入其他会话任务。
- **AC-TASKS-02**：用户发出终止后，匹配的任务及其受控进程树停止，面板更新终态。退出与终止竞态、进程重启后无法接管、已完成任务分别给出真实反馈，其他任务与主会话可继续。

### #39 通用 Worktree

补齐单会话的 `/worktree` 创建、进入/切换、退出、合并和受控清理闭环。生产会话的文件、Shell、引用、diff 和审批使用同一活动工作目录，持久化可恢复的会话绑定。明确显示来源分支和目标分支，合并与删除分别取得用户授权。团队成员隔离由 [SP011 worktree-isolation](../../SP011/worktree-isolation/requirements.md) 复用这条路径。

**合并能力为本仓新增**（参考无合并逻辑）：设计阶段必须固定默认目标分支、授权点、冲突停止条件与脏工作区/暂存区保护，且不引入自动 stash/reset 与未授权推送。

- **AC-WORKTREE-01**：从主工作区创建独立 worktree 并进入，在真实 TUI 里验证读写、`@`、diff、Shell cwd 与权限一致。退出并切回后，文件和命令指向原目录，历史保留所属工作树。
- **AC-WORKTREE-02**：重启恢复到有效工作树；遇到目录丢失、分支被占、切换失败或活动任务仍使用旧工作树时，显示原因并保护原绑定，不把待执行操作投递到错误路径。审批拒绝不会改变目标目录和分支。
- **AC-WORKTREE-03**：在隔离 Git 仓验证显式授权的成功合并、冲突、脏工作区、未合并提交及拒绝清理。合并前可确认源/目标，冲突能安全停下并给出状态。原工作区无关改动和暂存内容受保护，删除只影响授权资源；禁止自动 stash/reset 与未授权推送。

### #42 子代理失败兜底与工具输出上限对齐

现象（用户 2026-11-24 现场报告）：真实使用中子代理因 WebFetch 连续失败而整体失败，转录出现 `AGENT_FAILED: Subagent failed: Tool "WebFetch" failed 5 times in a row with the same error (BUDINGX_CORE_003) (BUDINGX_CORE_010)`，主 agent 只能重新派发；同批另两个子代理因此中断。

根因（已核实，四层链路）：

1. **工具自身截断与 core 输出上限不匹配**：WebFetch 只按字节截断（`WEB_FETCH_DEFAULT_MAX_BYTES = 512 KiB`，`src/provider/web-fetch.ts:21`），返回完整可读文本（`:292-340`），从不按 core 的字符上限裁剪。
2. **长页面必然触发截断错误**：core 对每次工具结果强制 `TOOL_OUTPUT_CAP = 32768`（`src/core/constants.ts:5`），超出即截断并置 `isError = true`、`errorCode = BUDINGX_CORE_003`（`coreToolOutputTooLong`，`src/core/session.ts:2327-2336`）。截断内容其实已带标记交给模型，却以「失败」呈现。
3. **二级熔断把可换策略的错误判为不可自愈**：同一工具 + 同一错误码连续失败达 `MAX_TOOL_FAILURE_STREAK = 5`（`src/core/constants.ts:28`）即熔断并抛 `BUDINGX_CORE_010`（`coreToolLoopDetected`，`src/core/session.ts:2349-2374`）。现场消息与该分支逐字对应。
4. **子代理失败信息不足且直接终止**：子代理 loop 以该错误退出后生成 `AGENT_FAILED`（`src/core/agent-runtime.ts:363`），父 agent 只拿到 `Subagent failed: <message>` 与 usage，拿不到失败工具、已完成调用与部分结果，无法据此降级。

补充事实：子代理工具从父会话裁剪（`trimTools`，`src/core/agent-runtime.ts:146-158`），后台代理白名单含 `WebFetch`（`:29`），因此后台子代理命中同一条链路；`ALWAYS_DENY` 不含 WebFetch。

进一步核实（2026-11-24 只读复核）：子代理是同进程内独立 `Session`，工具失败本就以 `tool_result(isError=true)` 交回子代理模型、不终止回合，**只有熔断会终止子代理回合**；单个子代理失败本就以工具结果交回父模型，主回合不整体崩溃（除非父模型自身以相同参数/相同错误码重试 `Agent` 达阈值而触发父侧熔断）。因此「主回合不崩」是**须保留的既有行为（回归项）**，本轮新增工作是失败信息结构化与熔断语义分离。两处信息缺口须分别修：同步路径 `formatSpawnResult` 只透传文本（`src/core/agent-tools.ts:34-35`）；后台路径通知的 `<result>` 取 `record.result` 而非 `record.error`，**失败原因丢失**（`src/core/agent-runtime.ts:377-384`）。终止原因仅 failed/cancelled/budget 三类（`:72`），**无超时类**（超时属 `TaskOutput` 读取侧，不终止子代理）。

交付范围：

- **输出上限对齐**：WebFetch 按字符上限产出可读结果（超限即给截断标记与可继续获取的提示），使长页面不再必然触发 core 截断错误；抓取预算、字符上限与超时沿用现有配置并可在结果中标明。
- **语义分离**：「输出过长被截断」不与「工具执行失败」同义；截断不按不可自愈错误计入二级熔断；熔断提示须区分「同参数重试无益」与「应换策略」。
- **子代理失败兜底**：同步路径失败必须以结构化信息回到父 agent（失败工具与参数、错误码、已完成工具调用与部分结果、可执行建议）；后台路径失败通知必须携带失败原因（`record.error`），不再只给最后文本；「单个子代理失败不使主回合整体失败」列为回归项保留，父侧同参数/同错误码熔断保护不削弱；父 agent 可据结构化信息重派或改用其它手段。
- **端到端验证**：用真实 Provider 跑通需要抓取长网页的子代理任务，全程不出现 `AGENT_FAILED`。

- **AC-SUBAGENT-01**：在真实网络下抓取可读文本远超 32 KiB 的长页面（Hacker News 首页、GitHub API 列表页等），WebFetch 不再触发 `BUDINGX_CORE_003`；结果标明实际字符上限与是否截断。短页面与普通页面行为不回退。抓取失败（网络不可达、HTTP 4xx/5xx、私网地址、超时）各有明确错误码与可区分文案，不与「输出过长」混同。
- **AC-SUBAGENT-02**：同一工具同一错误码连续失败达阈值时，熔断提示区分「同参数重试无益」与「应换策略」两类，「输出过长」类不再按不可自愈错误计入。熔断或子代理终止后，父 agent 收到结构化失败说明（失败工具与参数、错误码、已完成工具调用与部分结果、可执行建议）；后台子代理失败通知携带失败原因。「单个子代理失败不使主回合整体失败」与父侧熔断保护作为回归项验证（既有行为，不削弱）。
- **AC-SUBAGENT-03**：用**真实大模型与真实 Provider**（不 mock、不以脚本冒充）跑至少 3 次需要抓取长网页的子代理任务，全程不出现 `AGENT_FAILED`，子代理返回可用结论；失败时保留真实错误码、命令、环境与日志位置，证据写入本轮验收报告。

## 依赖、风险与开放问题

### 依赖

- 会话存储与写锁：`src/storage/session-store.ts`（`~/.budingx/sessions/<id>/`、transcript.jsonl、meta.json、writer.lock）、`src/storage/session-transcript.ts`。
- 后台任务：exec 层 `src/exec/background.ts`（终止、终态落盘）、`src/exec/persist.ts`（输出路径）、子代理 TaskStop 工具。
- Git 安全边界：`src/git/worktree.ts`（enter/exit、slug 校验、删除单次授权）与 SP004 的 GW-01…09。
- core：会话编排、权限三档与安全底线、压缩与恢复（`src/core/session.ts`、`src/storage/permissions.ts`）。
- TUI 既有入口：`src/tui/mcp/`、`src/tui/skills.ts`、`src/tui/project-instructions.ts`、`src/tui/tasks.ts`、`src/tui/worktree.ts`、`src/tui/editor/`、`src/tui/render/`。
- 数据根固定为 `~/.budingx`；不读取、不回退、不写入 `~/.claude`。

### 风险

- **R1 单轮规模**：11 项分属会话、协议、交互、工程四个族，建议按族分批实施并各自留回归，避免一次性交付面过大。
- **R2 自研扩展无参考对照**：正文检索、allowed-tools 限制语义、思考逐条展开、输入上限、worktree 合并、粘贴确认的失败判据只能在设计阶段自定，设计须先于实现定稿这些判据。
- **R3 远程传输与授权**：MCP 远程传输与 OAuth 涉及本机监听端口与凭据，必须遵守凭据作用域（CAP-L4-19），凭据不得写入普通共享 JSON，也不得进入日志或状态面板。
- **R4 隐私边界**：会话正文索引与 Markdown 导出涉及会话内容，索引只落 `~/.budingx`，导出文本不含凭据与内部技能指令。
- **R5 跨轮复用**：#36 与 #39 会被 SP011 团队能力复用，本轮接口需先冻结再交给 SP011，避免并行返工。
- **R6 熔断语义调整的影响面**：修改「输出过长」的熔断计入会同时影响一级（同参数）与二级（同错误码）熔断，可能放宽对真正空转的拦截。改动必须保留原有熔断对「同参数重复失败」的拦截，并以负向用例证明空转仍会被拦住。

### 开放问题（OPEN）

- **O1** 输入长度上限的具体数值与超限行为（截断、拒绝或提示后拒绝）。
- **O2** 长粘贴是自动折叠，还是折叠并允许提交前确认（参考只有自动折叠）。
- **O3** 任务登记表是否需要跨进程可见（与能力矩阵「后台状态/重连」口径的衔接）。
- **O4** worktree 合并的默认目标分支，以及是否支持快进与 squash。
- **O5** MCP OAuth 是否本轮接入（条件式，需单独授权与隔离端点验证）。
- **O6** 技能禁用的最终形态（本轮按两个正交开关，若要求单一开关需重新确认 AC-SKILL-01）。
- **O7** WebFetch 超长结果的呈现形态（单次截断 + 续取提示，还是分页/摘要），以及字符上限取值。
- **O8** 子代理失败后父 agent 的重试预算与「同一失败连续两次即改用其它手段」的判定规则。

## 验收与恢复

- 以隔离用户目录、测试仓与本机 fixture 执行。前向兼容覆盖至少 0.9.1 会话文件、技能、项目指令、MCP 和 worktree 配置；迁移失败保存原数据。产品继续以 `~/.budingx` 为数据根。
- 每条 AC 对应可复现功能证据。涉及状态机或解析的场景补定向回归，TUI 交互用真实 Ink 帧，跨进程恢复/MCP/Git/取消用真实隔离进程。既有命令、三档权限、工作区边界和制品入口列为回归项。
- 自研扩展项（无参考对照）在交付记录中单独列出，说明其自有判据与实测结果。
- 12 项产品验收状态见 [验证记录](test-report.md)，阶段与基线见 [STATUS](STATUS.md)。
- #42 属缺陷修复：其端到端证据必须来自真实 Provider 的至少三次真实子代理任务，不得用 mock、脚本回放或历史成绩替代。
