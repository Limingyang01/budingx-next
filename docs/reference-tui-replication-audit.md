# 剩余 SP 参考复刻全面排查（SP003–SP021）

状态：AGENT_REVIEWED / 已采纳（2026-11-17 委托自审；manifest v2 提议仍待各轮开轮拍板）｜版本：r1｜更新：2026-11-17｜配套：[路线图](iteration-plan.md)、[能力矩阵](agent-capability-matrix.md)、[SP001 能力清单 v1](../SP/SP001/capability-baseline/capability-manifest.md)

**r7 范围批注（2026-11-18）**：TUI 单端交付。Desktop、VS Code、远程/H5 与 IM 已移出当前 SP；历史参考点见附录。三权限模式仍为仅可查看、工作区内修改和完全权限，参考的七模式属于历史事实。

## 1. 目的与边界

用户 2026-11-17 指示：SP002 完成后全面排查剩余 SP 任务，以参考仓 `buding-worker-space` 的 TUI 为还原目标；**UI、交互、功能点直接参考；实现逻辑独立编写**——参考仓无 LICENSE、package.json 无 license 字段（视为未开源），不得复制代码，「周旋」换方式实现相同效果。

本文件是排查结论与逐 SP 补充任务建议，**不授权开发**；被采纳后并入路线图 r5 与各轮开轮设计。边界沿用 [独立实现与复用边界](independent-development.md) 与 SP001 决定 3（读机制、不抄代码）：

- 可参考：用户可见行为、UI 结构、交互流程、命令/工具/事件清单、配置表面字段语义、规模事实。
- 不可复制：源码、系统提示词、内部 SDK 类型、全局状态、生成 bundle、配置与历史数据；不以改名/逐文件改写冒充独立来源。
- 效果口径沿用 O5=B：自有测量 + 能力清单覆盖度，不对照原产品运行，「已对齐/同等效果」措辞禁用。

## 2. 方法与来源

1. 基线映射：SP001 清单 v1（85 项 / 必交 53）× 路线图 r4 × 矩阵 r2 × 高级能力计划，建立 CAP→SP 对照（§4）。
2. 参考面只读盘点：4 路侦察（输入与渲染交互 / 斜杠命令 / 工具·权限·Hook / 会话·持久化·无头·扩展），只记录行为事实与路径，不贴代码；盘点结果回填 §3 与 §4「参考事实/补充任务」。
3. 缺口判定：参考具备而清单未覆盖者进入 §5，按清单变更规则以 **manifest v2 新增 ID** 提议（不改动 v1 已发布行），必需性默认 MODEL_PROPOSED 待用户拍板。
4. 每 SP 给出「独立实现周旋点」：参考依赖自研/私有组件处，给出换方式达同效的路径（§6 总则 + §4 逐轮）。

## 3. 参考面总览（盘点回填）

### 3.1 输入与渲染交互面（已回填，来源：只读盘点 audit-input-ui3）

**输入编辑**：readline 键族（ctrl+a/e/k/u/w/y、meta+b/f/d、跳词）+ kill-ring 累积/yank-pop；shift/meta+Enter 换行；历史按模式过滤（prompt/bash，`!` 前缀）、多行时方向键先移行、ctrl+r 增量搜索（内联 dim 标签 `search prompts:` / 失配提示，esc/tab 接受、enter 执行）；undo 防抖快照（ctrl+_ 与 kitty ctrl+shift+- 双绑定）；bracketed paste（DEC 2004），>10000 字符截断为首尾各 500 + 占位符 `[...Truncated text #id +N lines...]`、全文按 id 存 pastedContents；图片粘贴（Win alt+v / 其他 ctrl+v，剪贴板/临时截图回退）；外部编辑器 ctrl+g / ctrl+x ctrl+e（$VISUAL/$EDITOR，+N 跳行，ENOENT 容错）；ctrl+s stash 输入（StashNotice）；shift+tab 循环权限模式（Win 无 VT 降级 meta+m）；ghost text 补全预览。

**Vim**：仅 INSERT/NORMAL 两模式（无 visual）；11 态命令状态机；motion h l j k w b e W B E 0 ^ $ f/F/t/T g/gg；operator d/c/y + 文本对象 i/a（w W 引号括号等）；count≤10000；x r ~ J > < p/P o/O、dot-repeat、linewise 寄存器、u；escape 切模式刻意不走键位系统；footer dim `-- INSERT --`。

**补全**：统一 typeahead（command/file/directory/agent/MCP resource/自定义标题）；候选 overlay 最多 5 条、图标区分、选中色/未选 dim、路径中间截断；tab 接受、esc 关闭、方向导航；文件补全求最长公共前缀、目录补 `/` 续补；`settings.fileSuggestion.type='command'` 可接外部命令源。

**键位**：18 个上下文块（Global/Chat/Autocomplete/Confirmation/Help/Transcript/HistorySearch/Task/ThemePicker/Settings/Tabs/Attachments/Footer/MessageSelector/DiffDialog/ModelPicker/Select/Plugin）+ Scroll；约 90 个 action；`keybindings.json` 表面＝`bindings[]`{context, bindings: 键→action | `command:<slash>` | null 解绑}，支持 chord；保留键 ctrl+c/d/m 不可重绑、ctrl+z warn、平台 cmd 族 error；UI 快捷键提示随重绑动态变化；Windows 无 VT 与 kitty 协议降级矩阵。

**渲染**：spinner 动词挂载时随机采样一次（非逐帧轮播）、todo.activeForm 覆盖、stalled 渐变转 error 色、50ms 动画钟隔离；statusline＝`settings.statusLine={type:'command',command}`，stdin JSON 含 model/workspace/version/output_style/context 百分比/rate_limits/session_name/vim 模式，输出按 ANSI 渲染；ctrl+o 转录模式（ctrl+e 全展开、q/esc 退出）、思考块 meta+t 开关、showThinkingSummaries 默认 false；消息折叠流水线（Read N files / Searched N patterns 汇总行、进行时/完成时动词变化、verbose 覆盖）；diff＝结构化 hunk + gutter 行号 + 语法着色（参考用 NAPI Rust，**需换 JS 高亮 + Fallback**）、窄屏放弃分栏；diff 对话框两级 list/detail、源切换 current(git)/各 turn；todo 卡片 ✔/■/□ + blocked by #id + 行数自适应 + 完成项 30s TTL + ctrl+t 展开；权限弹窗队列逐个、选项 Yes / Yes+会话记忆 / No、可切输入态附反馈、bash 可编辑前缀规则（`npm run:*`）与 classifier 建议项、y/n/enter/esc/tab/space/ctrl+e；主题 6+auto、ThemePicker 实时预览；备用屏 + SGR 鼠标（1002/1003 滚轮/拖拽选区、词/行模式、ctrl+shift+c 复制、esc 清选区、退出关鼠标 + drain stdin 防泄漏 shell、BUDINGX_DISABLE_MOUSE 可关）；fullscreen 虚拟列表 vs 普通模式 OffscreenFreeze 缓存（**复刻建议先单一普通滚动模式**）。

**开关**：output styles（default/Explanatory/Learning+自定义）、verbose、思考开关、spinnerVerbs{append/replace}/tips/reducedMotion、editorMode、syntaxHighlightingDisabled、effortLevel、terminalTitleFromRename。

**复刻难点 Top5**：① 自研渲染管线（reconciler+NAPI Yoga+log-update 差分+冻结缓存）→ 上游 Ink + 自有帧缓冲扩展，接受性能差异；② IME 物理光标/kitty 协议/鼠标选区 → 自补 stdin 解析层或明确降级；③ diff NAPI 着色 → JS 高亮 + Fallback；④ vim/kill-ring 键位耦合与平台可达性矩阵 → 纯逻辑独立重写 + 逐平台验证；⑤ 折叠/虚拟化/transcript 三态一致性 → 先定单一渲染模式。

### 3.2 斜杠命令面（已回填，来源：audit-commands）

**命令契约**：三型——`local`（内联文本结果）/ `local-jsx`（REPL 模态槽对话框/面板）/ `prompt`（展开为模型提示，带 progressMessage）；另有 immediate 标记（不进模型回合）。注册表驱动；feature 门控恒 false 的命令外部构建不注册；INTERNAL_ONLY 仅内部用户类型启用。**复刻采用等价三型契约 + 注册表**（CAP-L1-07 目标状态落实）。

**核心会话**（建议 SP005 为主）：/clear、/compact（可附自定义摘要指令）、/resume（参数直恢/无参选择器：搜索框+同仓/全项目切换）、/rewind（消息/检查点选择器恢复代码和/或对话）、/branch(fork)、/rename、/tag、/export（文件/剪贴板）、/copy（最新或第 N 响应、可选代码块、OSC 剪贴板）、/exit、/help（列表对话框）、/add-dir、/goal（完成条件）、/btw（旁支提问、immediate、旁支子代理）、/plan、/tasks（后台任务列表管理）。

**状态诊断**（SP005/SP007）：/context（彩色网格占用可视化 + 非交互内联变体）、/files、/diff（未提交+逐轮 diff 对话框）、/status（版本/模型/账户/连通/工具面板）、/stats、/cost、/doctor（诊断 screen，警告带 Fix）、/feedback（多步：输入→consent→提交→done→GitHub 预填页）、/release-notes（拉取 500ms 超时→缓存→链接）、/insights、/heapdump。

**模型推理**（SP002 已有 /model 直设；选择器 UI 补 SP006/SP007）：/model（ModelPicker：左右循环 effort、Enter 应用持久化、Esc 保持）、/effort、/fast、/advisor。

**设置输入外观**（SP006）：/config（分页面板 Status/Config/Usage：可搜索设置列表、左右改值、Enter 子对话隐藏 tab、Esc 汇总变更）、/permissions（分页 recent/allow/ask/deny/workspace；加规则校验、删除确认、denial 可重试）、/hooks（event→matcher→hook 三级列表 CRUD）、/sandbox、/privacy-settings、/output-style（**已废弃**，指引 /config → 复刻可直接做设置面板，跳过废弃命令）、/statusline（prompt 展开派子代理从 shell PS1 推导写 settings）、/keybindings（打开/创建配置文件+外部编辑器）、/vim、/theme（即时预览 Esc 取消）、/color、/terminal-setup（按终端给键位指引）。

**记忆初始化**（SP005/SP006）：/memory（MemoryFileSelector→缺省自动建→外部 $EDITOR）、/init（prompt 展开生成项目文档）。

**扩展 MCP**（SP006/SP007）：/agents（source→列表→查看/编辑/删除确认/新建 wizard）、/agent、/skills、/plugin（marketplace 分页面板）、/reload-plugins、/mcp（enable|disable|reconnect 子命令）。

**账户计费**（自有产品无订阅业务 → §5.3 范围外提议）：/usage、/extra-usage、/rate-limit-options（限流可选项 → 折叠进 Provider 429 UX，SP002/SP007）、/passes、/upgrade。

**Git 审查**（SP004，写操作须单独授权）：/commit、/commit-push-pr、/review、/security-review（分支变更安全审查、子任务兜底）、/pr-comments、/install-github-app、/install-slack-app；云审查 /ultrareview、/ultraplan → 范围外提议。

**跨端远程**（当前 SP 范围外）：/ide、/desktop（会话交接对话框）、/mobile（QR，原生 App 已范围外）、/session（远程 URL+QR）、/chrome、/remote-env（teleport 已移除）、/web-setup、/voice（门控不注册，范围外）、/bridge（门控不注册）。

**趣味/内部/stub**：/buddy、/think-back、/stickers 等 → 范围外提议；16 个禁用 stub + 8 个 Proxy 占位 + ant 内部命令不复刻。

**优先级三档**（盘点建议，采纳为开轮排序参考）：核心必需 24 命令（clear/compact/resume/rewind/exit/help/model/config/permissions/memory/init/add-dir/context/files/diff/cost/status/plan/tasks/export/copy/rename/branch/goal）；体验增强约 30；可延后＝计费/跨端/云审查/趣味/内部。

### 3.3 工具·权限·Hook 面（权限/Hook 已回填；工具待回填）

**权限模式（来源：audit-perm-hooks4）**：外部 5 模式 `default / acceptEdits / plan / dontAsk / bypassPermissions` + 运行时可寻址 `auto / fullAuto`（共 7，与 SP001「7 模式」吻合）。语义要点：acceptEdits 自动接受编辑类；bypass 仍有安全底线（deny 规则、.git/配置目录、交互工具仍提示）；auto＝无分类器全批准但保留同级底线、对外映射 default；fullAuto＝静态高危 bash denylist 回落弹窗、其余全自动、纯运行时切换；plan 暂停图标/专属配色。行为枚举 allow/deny/ask。**r6：新仓目标固定三模式（仅可查看/工作区内修改/完全权限，用户 2026-11-17），参考 7 模式仅作基线事实；安全底线语义（deny 规则/凭据保护）保留。**

**审批弹窗**：文件类三档 accept-once / accept-session / reject；cwd 外按目录名限定会话记忆；配置目录写操作有专属会话级选项；bash 选项含可编辑前缀规则（`npm run:*`，前缀建议取命令+子命令两词、VAR= 赋值回落精确、危险包装命令禁裸前缀）；Yes/No 可展开反馈输入（「告诉我接下来/换种做法做什么」，空提交=取消）；记忆落点 destination＝userSettings/projectSettings/localSettings/session/cliArg（bash 前缀编辑落 localSettings）；管控开关开启时隐藏 always-allow 持久化选项。

**规则表面**：`permissions.{allow,deny,ask}` 字符串数组 + defaultMode/disableBypassPermissionsMode/additionalDirectories；语法 `ToolName` 或 `ToolName(content)`（空/`*`＝整工具；括号转义；旧工具名别名归一）；bash＝精确+前缀 `cmd:*`+通配（大小写敏感）；路径＝gitignore 风格（ignore 语义、强制 `/`、拒 glob 元字符注入）；更新操作 addRules/replaceRules/setMode/addDirectories 均带 destination；企业管控 policySettings 只认 managed 规则。

**Hooks**：**27 个可持久化事件**（PreToolUse/PostToolUse/PostToolUseFailure/Notification/UserPromptSubmit/SessionStart/SessionEnd/Stop/StopFailure/SubagentStart/SubagentStop/PreCompact/PostCompact/PermissionRequest/PermissionDenied/Setup/TeammateIdle/TaskCreated/TaskCompleted/Elicitation/ElicitationResult/ConfigChange/WorktreeCreate/WorktreeRemove/InstructionsLoaded/CwdChanged/FileChanged）+ 不可持久化 function hook（SP001「28 事件」口径据此修正为 27+1）。处理器 4 类：command（shell 可选 bash/powershell）/ prompt（LLM 评估、$ARGUMENTS）/ agent（verifier、timeout 默认 60s）/ http（POST、headers $VAR 插值须白名单）。配置＝`hooks:{事件:[{matcher,hooks:[…]}]}`；单 hook 字段 type/command|prompt|url/`if`（复用权限规则语法预过滤）/timeout/statusMessage/once/async/asyncRewake/shell/model/headers/allowedEnvVars。输出契约：continue/suppressOutput/stopReason/decision approve|block/reason/systemMessage/hookSpecificOutput；PreToolUse 专属 permissionDecision allow|deny|ask + updatedInput（改写入参）+ additionalContext；**exit 2＝blocking error**，asyncRewake 后台 exit 2 唤醒模型；Stop 阻断错误回流主循环（防重入标志）；**无头无法弹窗时先跑 PermissionRequest hooks，无裁决才 auto-deny**。

**复刻难点**：弹窗选项/反馈输入/前缀编辑的交互态机；规则解析器语义等价（别名归一、危险包装、glob 注入防护）；hook 输出对循环的六种影响路径；管控表面。均可自写，语义以本节行为清单为对照测试依据。

#### 3.3.1 工具清单（已回填，来源：audit-tools4）

**重要前提**：参考副本为 local recovery build，约 17 个工具目录是生成 no-op stub（`__stubMissing`），无真实实现；下表只列真实实现者。

真实工具（34 族）：Agent（旧 Task，子代理派发，卡片进度≤3 行 + ctrl+o 展开全文 + 耗时/token）、AskUserQuestion（选择题卡片）、Bash（后台/超时/沙箱表面，只读命令豁免审批）、SendUserMessage（旧 Brief，主动消息+附件）、Config（读/写配置，写需审批）、EnterPlanMode / ExitPlanMode（计划审批卡片）、EnterWorktree / ExitWorktree、Edit（字面串替换 + diff/拒绝 diff/新建预览）、Read（行范围/图片/notebook）、Write（高亮预览）、Glob、Grep（content/files/count 三模式 + 计数摘要）、LSP、ListMcpResources / ReadMcpResource / mcp 动态工具 / mcp authenticate（OAuth）、NotebookEdit、PowerShell、RemoteTrigger、CronCreate/Update/Delete/List、SendMessage（代理间消息，需批准）、Skill、StructuredOutput、TaskCreate/Get/List/Update/Output/Stop（后台任务六件套，**非子代理**）、TeamCreate/TeamDelete、TodoWrite、ToolSearch、WebFetch（预批准域名白名单）、WebSearch。

**Stub（本副本无实现）**：WebBrowser、Monitor、TerminalCapture、REPL、Workflow、PushNotification、SendUserFile、SubscribePR、SuggestBackgroundPR、ReviewArtifact、VerifyPlanExecution、CtxInspect、ListPeers、Sleep、Snip、OverflowTest、tungsten（显式 deny）、DiscoverSkills（仅 prompt stub）。**无 computer-use 工具目录**。

**注记**：① Edit＝old_string 字面且唯一；多匹配报错提示加上下文或 replace_all；有容错回退；空 old_string 仅创建语义合法；old==new 拒绝。② Bash＝timeout 上限 + run_in_background；阻塞超预算自动转后台；用户 Ctrl+B 手动转后台；后台输出写任务文件 + 完成通知；sleep 类阻塞命令被拦截并引导后台。③ 子代理 UI 与后台任务六件套是两套表面。④ browser/CU 在本副本为 stub/缺失 → SP014/SP015 无本地实现可参考（见 §5.2）。⑤ ToolSearch＝关键词或 `select:<名>` 取回完整 schema；延迟工具仅暴露名字、取回前不可调用；MCP 工具默认全部延迟（alwaysLoad 例外）。

### 3.4 会话·持久化·无头面（已回填，来源：audit-session5）

**JSONL 存储**：主会话 `<projectDir>/<sessionId>.jsonl`（UUID 校验）+ 子代理 `agent-<id>.jsonl` + `.meta.json`；user/assistant 以 parentUuid 建链；字段 uuid/parentUuid/isSidechain/isMeta/isCompactSummary/isVisibleInTranscriptOnly/toolUseResult + progress 记录；元数据追加 type 枚举（last-prompt/custom-title/ai-title/tag/task-summary/agent-name/agent-color/agent-setting/mode/worktree-state/pr-link/file-history-snapshot/content-replacement 等）；增量 append 0o600、整体重写 0o600；**会话文件本身无 .bak**（备份在配置侧：tmp+rename、迁移前 bak-before-migration-<ts>、坏文件 .invalid-* 隔离、升级锁文件）；用户 rename 优先于 AI 标题。

**resume/fork/rewind**：-c 取 cwd 最近；-r [id|搜索词] 无参开 LogSelector（sidechain 过滤、PR 过滤、跨项目开关、分页、agentic 搜索、resume 时可 rename）；--fork-session 换新 ID（--session-id 与 resume 合用必须 fork）；--resume-session-at 截断、--rewind-files 恢复文件即退（需 --resume）；rewind＝FileHistorySnapshot{messageId, trackedFileBackups} 按 user message id 定位 + checkpoint diff 预览 + 「No code changes」态；无头 rewind 失败写 stderr 退出。

**compact**：顺序 snip→microcompact→autocompact；手动 /compact 先微压缩再摘要、可附自定义指令；阈值公式 effectiveWindow=窗口−min(maxOutput,20000)，auto=−13000、warning/error 再−20000、手动阻断=−3000（env 可覆盖）；开关 autoCompactEnabled + DISABLE_*；**连续失败≥3 熔断**；微压缩三型（计数/时间型按末条 assistant 超时/cached 按 tool_use_id）；压缩后 preserved 尾部逐字保留 + plan 保留 + 文件重注入跳过已有 Read + preserved usage 清零 + 早前 prompt cache 保留；边界事件 compact_boundary/microcompact_boundary 渲染且引擎必 ack。

**/context 与成本**：交互彩色网格 / 非交互内联镜像；构成字段 totalTokens/rawMaxTokens/percentage + 分类表（Free space、Autocompact buffer、MCP Tools、Memory Files、skills、agents、Top Tools、attachments）；result 事件携带 total_cost_usd/usage/modelUsage/duration_ms/duration_api_ms/num_turns（TUI /cost 面板字段未证实）。

**无头**：-p/--print；--output-format text|json|stream-json（后者需 --verbose）；--input-format stream-json；--include-partial-messages/--include-hook-events/--replay-user-messages；--json-schema；--max-turns；--max-budget-usd；--task-budget；--no-session-persistence；--fallback-model；**permission-prompt-tool＝MCP 工具名**（从可用工具列表移除、输出经 schema 转权限决定；--sdk-url 强制 stdio can_use_tool 回调）；result subtype＝success|error_during_execution|error_max_turns（**终止原因即此三值，退出码仅 0/1**）；事件 subtype：init/status/hook_started|progress|response/compact_boundary/elicitation_complete/files_persisted + SDK-only 族；stream-json 输入 control_request＝interrupt|set_permission_mode|can_use_tool + control_response + replay ack；stdout JSON 守卫；**重启自动续跑被中断 turn（interrupted_prompt 去 sentinel 重入队保证恰好一次）**。

**迁移口径修正**：SP001「11 项迁移」实见＝8 个命名配置迁移 + 5 条存储侧条目（目录改名/providers 拆分/settings 合并/providers schemaVersion=2/env 规范化），以本版清单为准。

### 3.5 记忆·扩展·多端·远程·调度面（已回填，来源：audit-ext5）

**记忆**：三级文件 User/Project/Local（Local 建议 gitignore）；@import 递归限深 + 去重（符号链接/盘符归一）+ 外部路径需显式 include + excludes；/memory 选择器按级分类 + 嵌套标记 + auto-memory 开关 + 「打开记忆目录」入口；auto-memory＝memdir 入口 MEMORY.md（行/字节上限）+ append-only 日期日志 + 夜间蒸馏 + 检索最多 5 主题文件注入 + 「忽略记忆」语义；开关链 env→policy→local→user，目录防敏感校验；团队记忆同步服务。**复刻落点：唯一根 `~/.budingx`，文件名自有（开轮定，如 BUDINGX.md），语义等价**。

**Skills**：来源枚举（项目/用户/plugin/managed/bundled/mcp）；SKILL.md frontmatter＝user-invocable/effort/allowed-tools/argument-hint/disable-model-invocation；$ARGUMENTS 替换 + shell 内嵌执行（安全门）；disable-model-invocation 仅用户可触发；MCP skill 命名 `<server>:<skill>`。

**Plugins**（v1 可选）：manifest `.claude-plugin/plugin.json` 字段 hooks/commands/agents/skills/outputStyles/mcpServers/lspServers；marketplace add 支持 owner/repo、https、本地路径、--sparse；信任警告/校验/错误 UI 组件族。

**MCP**：`.mcp.json` + `--mcp-config`；stdio=command/args/env，sse/http=url/headers；OAuth 含 step-up scope；传输 stdio/sse/http/ws-ide/sse-ide；命名 `mcp__<server>__<tool>`；IDE 白名单仅 executeCode/getDiagnostics；**项目 MCP 服务器信任审批对话框**（单批/全批/拒绝 → enabled/disabledMcpjsonServers/enableAllProjectMcpServers）+ 批量管理 + 迁移。

**Custom agents**：.md frontmatter＝name/description(whenToUse 10–5000 校验)/tools(省略=全部)/model/effort/color/memory(scope)；正文=systemPrompt；位置 user/project/managed/local；/agents wizard 生成+校验。

**Teams**：TeamCreate(team_name,description)→members(agentId/name/color)；SendMessage recipient=成员名或 `*` 广播（线性成本警告）+ shutdown request/response(request_id,feedback)；swarm 自动投递无 inbox；tmux/iTerm2 外部成员与 in-process teammate 并存；会话级 EnterWorktree/ExitWorktree（可配 hooks、chdir、状态持久化）；teammate spinner tree/pills/swarm banner。**注：teammate 级自动 worktree 隔离在参考未证实（仅会话级）→ 我们 SP013 的 worktree-isolation 要求更强，保持用户确认门槛**。

**IDE**：openDiff/close_tab RPC 回传 diff；selection_changed 订阅注入；at_mentioned→附件；getDiagnostics 工具。

**Remote/teleport**：RemoteSessionManager + SessionsWebSocket + remotePermissionBridge + SSHSessionManager；teleport 会话迁移（--teleport、切分支前自动 stash、repo mismatch 对话框）；**TeleportProgress/TeleportError 本 build 为 stub**（证据修正见 §5.2）。

**调度**：CronCreate `cron` 字段 + `durable:false` 会话级任务；cronScheduler+jitter；持久 JSON 加载；任务类型族（LocalAgent/RemoteAgent/LocalWorkflow/MonitorMcp/Dream）+ pillLabel；jobs classifier 存在。

**Voice**：push-to-talk 按住录音 + STT 服务 + 门控；维持 v1 范围外（CAP-L1-20）。

## 4. 逐 SP 排查

r7 当前实施范围按 [迭代路线图](iteration-plan.md) 的 16 个 SP 执行。已移出范围的参考点见文末历史附录。

列含义：**现定义**＝路线图 r4 功能目录；**清单对应**＝CAP ID；**参考事实/补充任务**＝盘点回填；**周旋点**＝独立实现策略。

### SP003 工作区与安全修改
- 现定义：workspace-tools、change-preview、permission-controls、file-context。
- 清单对应：CAP-L1-06、L1-11、L2-01/02/03/07、L3-06/07/08/10。
- 参考事实/补充任务（已回填）：@/命令统一 typeahead（5 条 overlay、图标、LCP、目录续补）；diff＝hunk+gutter 行号+高亮（换 JS 高亮+Fallback）、窄屏放弃分栏、diff 对话框 list/detail 两级 + current(git)/turn 源切换；权限弹窗三档 + 会话记忆按目录限定 + bash 可编辑前缀规则 + Yes/No 反馈输入态；规则语法 `Tool(content)`/bash 前缀/路径 gitignore 语义 + 别名归一 + 注入防护；记忆 destination 五落点；Edit 语义（唯一字面串/replace_all/空串创建/old==new 拒绝/容错回退）；Read 行范围与图片尺寸摘要；Glob/Grep 截断与计数摘要。
- 周旋点：diff 用公开算法（Myers）自实现或 MIT 库并登记台账，不搬参考 diff 组件代码；忽略规则用 MIT `ignore` 类库或自实现 gitignore 语义；权限规则语法按行为事实自写解析器；弹窗 UI 用 Ink 组件自绘（选项/快捷键/「不再询问」层级语义等价）。

### SP004 真实编码任务
- 现定义：command-execution、coding-task-loop、git-worktree-safety、task-planning。
- 清单对应：CAP-L2-04/05/06/08、L3-09/15。
- 参考事实/补充任务（已回填）：计划模式 Enter/Exit 工具 + 计划审批卡片（建议≠批准）；todo 卡片 ✔/■/□ + blocked by + 行数自适应 + 30s TTL + ctrl+t；Bash timeout 上限/run_in_background/超预算自动转后台/Ctrl+B 手动转后台/后台输出文件+完成通知/sleep 拦截引导；PowerShell 与 Bash 同安全判定；EnterWorktree/ExitWorktree 工具表面；AskUserQuestion 选择题卡片承接追问；shift+tab 权限模式轮播（**r6：新仓三模式语义——仅可查看/工作区内修改/完全权限**；参考 auto/fullAuto 安全底线语义保留）。
- 周旋点：计划模式＝自有状态机 + 执行前校验（建议≠批准）；todo UI 自绘卡片；后台进程监控用 Node child_process 自有管理，不搬参考终端捕获实现；沙箱仅声明能力边界（可选 CAP-L3-09）。

### SP005 长会话与数据可靠性
- 现定义：context-budget、session-recovery、failure-recovery、project-memory。
- 清单对应：CAP-L2-19、L3-03/04/05/18、L4-01/02/03/04/07/19。
- 参考事实/补充任务（已回填）：JSONL 布局/parentUuid 链/元数据追加枚举/0o600/配置侧原子+备份+坏文件隔离+升级锁；resume 选择器（搜索/同仓切换/分页/agentic 搜索/rename）与 CLI 旗标族（-c/-r/--fork-session/--session-id fork 规则/--resume-session-at/--rewind-files）；rewind 快照{messageId,trackedFileBackups}+diff 预览+无代码变化态；compact 阈值公式/三型微压缩/熔断≥3/preserved 尾部与 plan 保留/边界事件必 ack；/context 网格+构成字段；cost result 字段；记忆三级+@import 限深去重+/memory 选择器+外部编辑器；auto-memory 蒸馏链（CAP-L3-20 提议）；/tag /rename /branch /export /copy 会话管理命令族。
- 周旋点：JSONL schema 字段自定（行为等价：恢复不盲重放、压缩保留约束/计划/工具状态）；迁移框架自写（版本 + 备份 + 未知字段保留）；rewind 用自有文件快照目录，不搬参考快照实现。

### SP006 日常开发与 TUI 候选
- 现定义：project-instructions、skills-and-mcp、hooks、web-retrieval、headless-cli、tui-usability、npm-packaging。
- 清单对应：CAP-L1-03/08/09/12/13/14/16/17/18、L2-12/13/14、L3-11/12/13、L4-05/06。
- 参考事实/补充任务（已回填）：键位 keybindings.json（18 上下文块、约 90 action、chord、`command:`/null、保留键校验、提示随重绑变化、Win 无 VT/kitty 降级）；vim INSERT/NORMAL + motion/operator/文本对象/dot-repeat/寄存器 + footer `-- INSERT --`；readline kill-ring/yank-pop、ctrl+r 历史搜索内联 UI、undo 防抖双绑定、bracketed paste + 万字截断占位符 + pastedContents id、图片粘贴 alt+v、外部编辑器 ctrl+g、ctrl+s stash、ghost text；主题 6+auto 实时预览 picker；output styles 三内置+自定义；statusline command 表面（stdin JSON 字段契约）；spinner 动词采样/stalled 变色/tips/reducedMotion；ctrl+o 转录 + ctrl+e 全展开 + meta+t 思考开关；折叠流水线汇总行（Read N files…）；通知场景清单；模糊选择器；**渲染模式决策：先单一普通滚动 + OffscreenFreeze 等价缓存，fullscreen 虚拟列表/鼠标/备用屏列受控扩展预算（R-A）**；hooks 27+1 事件/4 处理器/`if` 预过滤/exit 2 blocking/asyncRewake/无头 auto-deny 兜底；Skill/Config/SendUserMessage/StructuredOutput 工具表面；MCP 默认延迟加载 + ToolSearch 取回语义。
- 参考事实/补充任务（无头，已回填）：旗标族（--output-format 三态/--input-format stream-json/--include-partial-messages/--include-hook-events/--replay-user-messages/--json-schema/--max-turns/--max-budget-usd/--task-budget/--no-session-persistence/--fallback-model）；permission-prompt-tool＝MCP 工具名语义（移除出工具列表+schema 转裁决，CAP-L4-24）；result subtype 三值即终止原因、退出码 0/1；事件 subtype 全清单；stream-json control_request（interrupt/set_permission_mode/can_use_tool）+ control_response + replay ack；stdout JSON 守卫；中断 turn 重启恰好一次续跑。
- 参考事实/补充任务（扩展命令，已回填）：/hooks 三级列表 CRUD、/mcp enable|disable|reconnect + 项目 MCP 信任审批对话框、/skills 列表、/plugin marketplace 面板+信任警告（可选）、/agents wizard、/memory、/init、/keybindings、/vim、/theme、/color、/terminal-setup、/statusline（子代理推导 PS1 → 可换 wizard 达同效）、设置面板骨架（CAP-L1-28）、/release-notes 缓存链（欢迎屏 gate 参考）。
- 周旋点：本轮是「体验还原」主战场。Ink 8 缺口（虚拟滚动/备用屏/鼠标/焦点事件）以**受控自研扩展**落在 src/tui（MIT 自有），不 fork Ink；键位系统自写上下文分发 + 保留键校验；vim 为可选增强独立模块；MCP 按公开规范自写客户端；hooks 事件集按行为事实自写分发器；无头事件 schema 自定但 stdout 机器可解析；命令注册表采用三型契约（local/local-jsx/prompt+progressMessage）。

### SP007 Agent 质量与扩展
- 现定义：evaluation-regression、runtime-diagnostics、provider-compatibility、subagent-execution、multimodal-context。
- 清单对应：CAP-L1-19、L2-09/10/20/24、L3-14/17、L4-21/22。
- 参考事实/补充任务（已回填）：子代理卡片（进度≤3 行 + ctrl+o 全文 + 专属配色 + 耗时/token）与后台任务六件套分离；ToolSearch 延迟加载（名字暴露→取回 schema→可调用；MCP 默认延迟）；LSP 只读卡片；doctor 诊断 screen（警告带 Fix）；/status 面板、/stats、/insights、/heapdump（可选）；/cost TUI 面板字段参考未证实 → 自有设计；effortLevel 参数面；/btw 旁支子代理；/security-review 子任务兜底（可选）；第二供应商公开协议适配。
- 周旋点：子代理＝自有运行时（独立上下文/权限≤父/取消传播/预算），不搬参考 mailbox 实现；doctor 自写本地诊断（不上传）；第二供应商按公开协议适配。

### SP010 多端架构入口与共享边界（r6 改名，原「跨端共享与接入」）
- 现定义：shared-models-and-history、session-ownership、transport-boundaries；r6 起以轻量测试客户端验证契约，不交付真实其他端。
- 清单对应：CAP-L4-08/09/10/18/19。
- 参考事实/补充任务（已回填）：参考本地服务行为面＝会话编排 + 存储事务锁（withFileTransaction）+ 迁移门控 + rename 竞态 guard + remotePermissionBridge + SessionsWebSocket 事件恢复；28 组接口不搬，按行为事实自定最小契约 + 符合性测试。
- 周旋点：参考本地服务约 6.3 万行 28 组接口不可搬；按行为事实自定最小 WS/stdio 契约 + 符合性测试；单写者所有权自写。

### SP011 独立交付和 npm 发布工程（r6 收窄 TUI）
- 现定义：tui-distribution、upgrade-compatibility、npm-publish-pipeline。
- 清单对应：CAP-L4-20。
- 参考事实/补充任务：待回填（参考打包/升级行为面）。
- 周旋点：沿用 bootstrap 已验证的 OIDC 发布链扩展；不搬参考打包脚本。

### SP012 中期编码效果检查
- 现定义：coding-parity-checkpoint、core-reliability。
- 清单对应：矩阵「基线与任务集」「诊断与性能」行；无新增 CAP。
- 参考事实/补充任务：以 SP001 评测集自有测量为准（O5=B），不对照参考运行。
- 周旋点：无（检查轮）。

### SP013 多代理团队
- 现定义：team-lifecycle、task-coordination、team-messaging、worktree-isolation。
- 清单对应：CAP-L2-11、L4-17。
- 参考事实/补充任务（已回填）：TeamCreate/TeamDelete + SendMessage（recipient/`*` 广播线性成本警告/shutdown request_id+feedback）；swarm 自动投递无 inbox；tmux/iTerm2 外部成员 + in-process teammate；teammate spinner tree/pills/swarm banner；团队记忆同步；TeammateIdle/TaskCreated/TaskCompleted hook 事件；**teammate 级自动 worktree 隔离参考未证实 → 保持我们更强的 SP013 门槛**。
- 周旋点：协调器/租约/去重自写；worktree 用 Git 公开命令；UI 自绘。

### SP014 浏览器操作
- 现定义：browser-session、page-actions、browser-artifacts。
- 清单对应：CAP-L2-15。
- 参考事实/补充任务（已回填，**证据修正**）：参考副本 WebBrowserTool 为生成 stub，无导航/点击/截图实现 → 本轮**无本地实现可参考**；行为规格改以公开描述 + 用户实际使用记忆为准，实现全自写（Playwright/CDP 公开来源）。验收门槛不降（高级能力计划 SP014 表）。
- 周旋点：用公开可重现来源（Playwright/CDP，MIT/Apache 登记台账），不搬参考原生宿主代码。

### SP015 Computer Use
- 现定义：computer-permissions、screen-actions、desktop-control-recovery。
- 清单对应：CAP-L2-16。
- 参考事实/补充任务（已回填，**证据修正**）：参考副本**无 computer-use 工具目录** → 无本地实现可参考；授权门/急停/多屏 DPI 行为规格以公开描述 + 高级能力计划为准，Windows 公开 API 自写辅助进程。验收门槛不降。
- 周旋点：Windows 公开 API（UIAutomation/ SendInput 类）自写辅助进程；急停 SLO 自测。

### SP019 定时任务
- 现定义：schedule-management、durable-scheduler、scheduled-agent-run。
- 清单对应：CAP-L2-17、L4-16。
- 参考事实/补充任务（已回填）：CronCreate/Update/Delete/List 四工具共用卡片；`cron` 字段 + `durable:false` 会话级 vs 持久 JSON 双档；cronScheduler+jitter；任务类型族（LocalAgent/RemoteAgent/LocalWorkflow/MonitorMcp/Dream）+ pillLabel；jobs classifier 存在（细节未读）→ 自有分类设计。
- 周旋点：cron 解析用 MIT 库或自写；租约/错过触发策略自写；管理入口为 TUI/headless，通用宿主契约保留。

### SP020–SP021 组合、交付与最终验收（r6 当前范围）
- 现定义：tui-capability-integration、advanced-distribution、full-upgrade；full-agent-parity、long-running-reliability、final-release-evidence。
- 清单对应：CAP-L4-20 及全清单当前必交项（47）收口，范围外基线见清单 v1.2。
- 参考事实/补充任务：组合实战清单沿用高级能力计划；参考面仅用于补漏检查。
- 周旋点：验收以自有测量 + 覆盖度 + 保护用例 + 用户试用（O5=B）。

## 5. 缺口清单与 manifest v2 提议（盘点回填）

判定规则：参考具备、清单 v1 未覆盖、且属用户可见能力者 → 提议新增 CAP ID（v2），必需性 MODEL_PROPOSED 待用户拍板；v1 已发布行不改语义。以下 4 项已用只读 grep 证实存在（路径为证），行为细节待 §3 盘点回填：

| 提议 ID | 能力 | 参考存在证据（路径） | 归属 SP | 必需性提议 | 理由 |
| --- | --- | --- | --- | --- | --- |
| CAP-L4-24 | 无头审批桥（外部 permission-prompt-tool 语义：非交互运行时把审批委托给外部工具/进程） | `src/cli/print.ts`、`src/cli/structuredIO.ts` | SP006 | 建议 | 矩阵「无头/脚本调用」已含非交互权限策略，但外部审批委托是独立可观察能力 |
| CAP-L4-25 | IDE selection/诊断上下文注入（编辑器选区与诊断作为会话上下文） | `src/hooks/useIdeSelection.ts`、`src/commands/ide/ide.tsx` | — | 范围外 | IDE 独立能力的历史提议，未进入现有能力清单和排期 |
| CAP-L1-21 | 转录模式与思考展开（ctrl-o 类展开/收起、转录浏览） | `src/components/CtrlOToExpand.tsx`、`src/components/Messages.tsx` | SP006 | 建议 | CAP-L1-05 含转录搜索、L1-10 含思考渲染，但「转录模式」作为独立交互面未单列 |
| CAP-L1-22 | 鼠标选择复制（终端鼠标选区→剪贴板） | `src/hooks/useCopyOnSelect.ts` | SP006 | 可选 | 体验增强；Ink 缺口扩展预算内才做（R-A） |
| CAP-L1-23 | 输入 stash（ctrl+s 暂存当前输入、稍后恢复） | `src/components/PromptInput/PromptInputStashNotice.tsx` | SP006 | 可选 | 独立于排队/回收的第三种输入暂存语义 |
| CAP-L1-24 | 外部编辑器编辑输入（ctrl+g / ctrl+x ctrl+e，$VISUAL/$EDITOR） | `src/utils/editor.ts` | SP006 | 可选 | 长提示词编辑体验 |
| CAP-L1-25 | bash 输入模式（`!` 前缀直接 shell + shell 补全 + 历史分模式） | `src/components/PromptInput/inputModes.ts`、`useTypeahead.tsx` | SP006 | 建议 | 与聊天模式并列的一等输入模式 |
| CAP-L2-26 | Config 工具（Agent 读/写产品配置，写需审批） | `src/tools/ConfigTool` | SP006 | 建议 | 自配置能力，权限门独立 |
| CAP-L2-27 | 用户消息工具（Agent 主动发消息/附件，旧名 Brief） | `src/tools/BriefTool` | SP006 | 建议 | 主动行为的消息表面（L3-15 的工具化出口） |
| CAP-L3-20 | 自动记忆蒸馏（append-only 日志→周期蒸馏→主题检索注入，可开关/可忽略） | `src/memdir/memdir.ts`、`findRelevantMemories.ts` | SP005 | 建议 | 区别于 L3-18 静态记忆目录的主动沉淀能力 |
| CAP-L4-26 | 会话迁移 teleport（跨主机续会话、切分支前自动 stash、repo mismatch 提示） | `src/bootstrap/state.ts`、`components/Teleport*.tsx`（部分 stub） | — | 范围外 | 远程会话迁移的历史提议，参考实现部分为 stub |
| CAP-L1-26 | 报障/反馈流（输入→consent→提交→预填 issue，多步对话框） | `commands/feedback/` | SP007 | 可选 | 自有产品改为本地诊断+用户授权后预填 issue，不接厂商 API |
| CAP-L1-27 | OSC52 剪贴板复制（/copy 响应/代码块） | `commands/copy/` | SP006 | 建议 | 与 L1-22 鼠标选区复制互补的命令式出口 |
| CAP-L1-28 | 设置面板（分页 tab、可搜索列表、左右改值、子对话、Esc 汇总变更） | `components/Settings/`、`commands/config/` | SP006 | 建议 | /config /permissions /hooks /theme 等共用的面板骨架 |
| CAP-L3-19 | 企业管控表面（managed 规则/hooks 白名单、HTTP hook URL 白名单、隐藏 always-allow） | `permissionsLoader.ts`、`settings/types.ts` | SP006 | 可选 | 消费级产品可延后；语义先留接口不实现 |

其余参考能力经核对均已被 v1 覆盖（含 vim/键位/主题/statusline/通知/模糊选择器/doctor/rewind//context/成本/记忆/工具检索/LSP/Notebook/PR/插件/语音范围外）。若 §3 盘点发现新缺口，按同规则追加本表。

### 5.2 基线证据修正（manifest v2 变更提议，不改 v1 已发布行语义）

参考副本为 local recovery build，部分「目录存在」不等于「实现存在」。以下修正随 v2 登记：

| v1 行 | 修正 | 影响 |
| --- | --- | --- |
| CAP-L2-15 浏览器操作 | 基线证据改为「公开描述 + stub 目录名（WebBrowserTool 为 no-op）」 | SP014 无本地实现可参考；全自写 + 公开来源；门槛不降 |
| CAP-L2-16 Computer Use | 基线证据改为「公开描述；本副本无工具目录」 | SP015 同上 |
| CAP-L2-06 长任务/后台监控 | 证据修正为 Bash run_in_background + TaskOutput/TaskStop（真实）；Monitor/TerminalCapture 为 stub | SP004 以真实表面为准 |
| CAP-L2-22 PR 集成 / CAP-L2-23 系统集成 | SubscribePR/SuggestBackgroundPR/PushNotification/SendUserFile 均为 stub → 证据降为「公开描述」 | 维持可选；开轮如升格需重新取证 |
| CAP-L3-11 Hook 体系 | 「28 事件」修正为 27 可持久化事件 + 1 不可持久化 function hook | 事件清单以 §3.3 为准 |
| CAP-L4-03 数据迁移 | 「11 项迁移」修正为 8 命名配置迁移 + 5 存储侧条目 | 清单以 §3.4 为准 |
| CAP-L4-06 退出码 | 证实仅 0/1 两档；终止原因＝result.subtype 三值（success/error_during_execution/error_max_turns） | 与 v1 目标状态一致，无需改语义 |
| CAP-L3-05 成本追踪 | result 事件字段证实；TUI /cost 面板字段参考未证实 | 面板自有设计，事件字段对照 |
| CAP-L1-01 渲染引擎 | 补充：参考含 NAPI Yoga 布局与 NAPI diff 着色两个原生模块 | 周旋总则 #1/#5 已覆盖换方式路径 |
| CAP-L4-11/12 远程 | teleport 的 TeleportProgress/TeleportError 本 build 为 stub；ListPeers/DiscoverSkills 亦 stub | 远程仅保留参考事实和基线编号，无当前 SP 归属；团队 peers UI 证据降为组件名 |

### 5.3 范围外提议（自有产品形态决定，需用户拍板登记）

| 参考能力 | 提议 | 理由 |
| --- | --- | --- |
| 计费/upsell 族（/upgrade /passes /extra-usage /usage 计划限额） | 范围外 | 自有产品无订阅计费业务；用量/限流信息折叠进 L3-05 成本与 Provider 429 UX |
| 营销/趣味（/stickers /buddy /think-back /thinkback-play） | 范围外 | 非编码能力，与完整替代目标无关 |
| 云审查/云计划（/ultrareview /ultraplan /web-setup） | 范围外 | 依赖厂商云服务；本地 /review /security-review 保留（SP004/SP007，可选） |
| 内部 ant 命令与 16 禁用 stub + 8 Proxy 占位 | 不复刻 | 参考内部/占位，无用户可见行为 |
| /voice、/mobile QR | 维持范围外 | v1 CAP-L1-20 与路线图已定（原生 App 不在范围） |
| /install-slack-app | 范围外 | 所有 IM 已移出当前交付；如有新需求另行确认 |

## 6. 独立实现策略总则（周旋点）

| # | 参考依赖 | 换方式达同效 | 登记要求 |
| --- | --- | --- | --- |
| 1 | 自研 ink fork（reconciler/布局/ANSI/备用屏，约 2.0 万行） | 上游 Ink 8 + 纯函数 span 渲染 + 受控自研扩展（SP002 已验证 borderText 等价、ASCII 兜底、宽度模型）；缺口扩展限 src/tui 内自有 MIT 代码 | 扩展清单逐轮登记 |
| 2 | React compiler runtime（_c memo 缓存） | 普通 React hooks/useMemo；不引入 compiler 依赖 | 无 |
| 3 | 构建期宏（MACRO.VERSION 等） | 运行时读 package.json（SP002 已实现） | 无 |
| 4 | 私有主题色名（claude/clawd_body…） | 自有 token 表 + Ink hex（SP002 ACCENT 先例） | 无 |
| 5 | 自研 diff/匹配算法 | 公开算法自实现或 MIT/BSD 库 | THIRD-PARTY-NOTICES |
| 6 | 内置 ripgrep 二进制 | 外部 rg 探测 + 纯 JS 兜底（忽略规则语义等价） | 可选资源声明 |
| 7 | 系统提示词 | 自写提示词；工具契约行为等价 | 不迁原文 |
| 8 | 内部 SDK 类型 | 公开协议形状（OpenAI/Anthropic/MCP 规范） | 协议来源登记 |
| 9 | JSONL/配置 schema | 字段自定、行为等价 + 自有迁移框架 | schema 版本化 |
| 10 | 权限规则解析器/hook 分发器/键位系统 | 按行为事实自写；语义等价测试对照行为清单 | 行为清单入 SP 附件 |
| 11 | 吉祥物/美术资产 | 自有绘制（SP002 先例） | 无 |
| 12 | 桌面/扩展/服务/适配器实现 | 公开 API + 自有实现；UI 结构参考、代码自写 | 逐轮来源台账 |

## 7. 风险与待决

- R-A：Ink 8 能力缺口（虚拟滚动/鼠标/备用屏/焦点）可能需超预算扩展 → SP006 开轮先做缺口实测，超预算则拆轮，不 fork Ink。
- R-B：参考行为以 0.5.0 快照为准；参考仓后续变动不自动追平，追平需用户决定。
- R-C：非 MIT 边界逐轮审计：开轮设计附「参考材料处理决定表」，交付时复核无代码/提示词/类型迁入。
- R-D：建议/可选项不得静默升必交；manifest v2 必需性由用户拍板。
- R-E：盘点代理失败时由主代理自盘（grep + 受限读取），结论标注来源与置信度。

## 8. 验证与出口（每 SP 附加）

1. 参考行为对照清单：开轮时把 §4 该轮「参考事实」落成可勾选 UI/交互清单（行为级，不含代码），交付时逐条 smoke/帧断言。
2. 独立实现自查：scoped diff 复核 + 来源台账 + 禁用措辞门禁（spec:check）。
3. 既有门禁不回归：npm test 全段 + 边界检查 + 隔离安装 smoke（适用轮）。

## 9. 变更记录

| 日期 | 变化 | 身份 |
| --- | --- | --- |
| 2026-11-17 | r1：建立 CAP→SP 基线映射与周旋总则；6 路只读盘点（输入渲染/命令/工具/权限Hook/会话无头/记忆扩展）全部回填；§5 提出 15 项 manifest v2 新增 ID、10 项基线证据修正、6 组范围外提议；逐 SP 补充任务齐备 | MODEL_PROPOSED；用户指示排查，未授权开发；待用户审阅后并入路线图 r5 与各轮开轮设计 |

## 附录：已移出范围的参考盘点

以下为历史参考事实，当前路线图没有安排这些能力。

### SP008 Desktop 独立工作台（原规划）
- 状态：用户 2026-11-17 决定暂缓；编号保留，以下保留作恢复储备。
- 现定义：desktop-host、desktop-coding-workflow、multi-project-sessions。
- 清单对应：CAP-L4-13。
- 参考事实/补充任务：待回填（参考桌面端 UI 结构：会话列表/diff/审批/后台状态）。
- 周旋点：参考桌面端约 11.9 万行不可搬；自有宿主 + 自有 UI 框架（开轮选型，MIT），复用 SP010 宿主契约；崩溃不重复执行靠自有会话所有权协议。

### SP009 VS Code 独立端（原规划）
- 状态：用户 2026-11-17 决定暂缓；编号保留，以下保留作恢复储备。
- 现定义：vscode-host、workspace-integration。
- 清单对应：CAP-L4-09/14。
- 参考事实/补充任务（已回填）：IDE RPC openDiff/close_tab 回传 diff；selection_changed 订阅 + at_mentioned 附件 + getDiagnostics 工具（CAP-L4-25）；ws-ide/sse-ide 传输按 URL 协议选型；IDE 工具白名单仅 executeCode/getDiagnostics；/ide 管理对话框；未保存编辑冲突 UI 参考未证实 → 自有设计 + 必测回归（路线图门槛）。
- 周旋点：VS Code API 为公开接口可直接用；扩展 UI 自写 webview/原生视图；stdio 宿主契约自有。

### SP016 远程访问与 H5（原规划）
- 状态：用户 2026-11-17 决定暂缓；编号保留，以下保留作恢复储备。
- 现定义：gateway-auth、remote-session、h5-client、remote-recovery。
- 清单对应：CAP-L2-18、L4-11/12。
- 参考事实/补充任务（已回填）：/session 远程 URL+QR 对话框；RemoteSessionManager + SessionsWebSocket + remotePermissionBridge + SSHSessionManager；teleport（--teleport、切分支前自动 stash、repo mismatch 对话框；Progress/Error 为 stub → CAP-L4-26 可选提议）；/desktop 会话交接对话框（SP008/SP010 衔接）；H5 UI 参考无独立实现面 → 自有设计 + 高级能力计划门槛。
- 周旋点：网关/H5 全自写（Node + 自有前端）；配对令牌协议自定。

### SP017–SP018 四类 IM（原规划）
- 状态：用户 2026-11-17 决定暂缓；编号保留，以下保留作恢复储备。
- 现定义：im-adapter-contract、identity-binding、telegram、feishu、wechat、dingtalk、im-cross-channel。
- 清单对应：CAP-L4-15。
- 参考事实/补充任务：待回填（参考适配器行为面：路由/审批/流式编辑/去重）。
- 周旋点：各平台公开 Bot API 自写适配；微信接入方式开轮固定（受限记 BLOCKED）。
