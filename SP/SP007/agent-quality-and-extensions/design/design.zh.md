# SP007 设计 — Agent 质量与扩展（agent-quality-and-extensions）

状态：自审中 ｜ 2026-11-21 ｜ 需求：../requirements.md（60 AC）
参考：budingWorkerSpace b5c9be8（只读，读机制不抄代码）；三份侦察事实已固化入需求 R1–R6。
委托：2026-11-17 设计为 Agent 自审对象；本轮用户 m00001 覆盖合入步骤——止于推送功能分支。

## 1. 背景与目标

SP006 交付命令注册表三型+模态槽、/btw、hooks 8 事件、MCP 客户端。SP007 按路线图 :74/:136
交付五工作流：子代理执行（/agents、Agent 工具、卡片）、运行时诊断（/status /stats /doctor、ToolSearch）、
供应商兼容（第二公开协议）、多模态上下文（图片粘贴/附件/降级）、评估回归（自有任务集 runner），
并回归联网/hooks/MCP 失败边界与宿主契约。出口验收见需求「目标」节。

## 2. 当前状态（本仓事实，均已读原文）

- Session（src/core/session.ts，2314 行）：完整工具循环 runTurn:1373（迭代上限 MAX_ITERATIONS、
  hooks SessionStart/UserPromptSubmit/PreToolUse/PostToolUse(Failure)/Notification/Stop(Failure)、
  上下文溢出压缩重试一次、CT-07 完成证据、空转熔断两级）；dispatchTools:1637 **顺序 for 循环**
  （JSON 校验→hook→policy.decide→计划模式闸门→审批→执行→TOOL_OUTPUT_CAP 截断→pushToolResult）；
  buildRequest:1334（normalizeForApi＋system 身份提示＋resolveSystemContext＋hookContext＋tools specs
  受 snapshot.capabilities.tools 门控）；finalize:2150（error 回合抹除本回合消息、cancelled 可恢复原文、
  needs_review 落盘、queue drain）；submitSideQuestion:1132 独立上下文旁路（只收文本、不写历史）。
  SessionOptions:75 含 resolveProvider/resolveSnapshot/permissionPolicy/transcript/contextBudget/
  resolveReasoningEffort/resolveSystemContext/hooks/tracer/disposers/onEvent。
- 事件（src/core/events.ts）：SessionEvent 联合 JSON 可序列化；MessageBlock 六型（text/thinking/
  tool_use/tool_result/interrupt_mark/context）；TurnOutcome 已含 image_error；NoticeCode 可扩展；
  Usage{inputTokens?,outputTokens?}；TurnSnapshot{modelId,model,baseUrlHost,capabilities:{tools}}。
- 工具端口（src/core/tools.ts）：ToolHandler{name,parameters?,summary?,describe,requiresApproval?,
  mandatoryApproval?,capability?,target?,prepareApproval?,execute(input,ToolContext)}；
  ToolContext{signal,onUpdate?,changes?,turnId?,callId?,emit?,onCommandResult?,approved?}；
  ApprovalGateway.request→ApprovalDecision{outcome allow|allow_session|deny|cancelled,via,remember?,feedback?}。
- 权限：PermissionMode='read_only'|'workspace_edit'|'full_access'（src/core/permissions.ts:6）；
  createPermissionPolicy 在 src/workspace/policy.ts（BudingPermissionPolicy，rules+mode+remember）。
- 工具名：Read/Write/Edit/Glob/Grep（src/workspace/tools.ts:216-332）、Bash/PowerShell（src/exec/tools.ts:13）、
  WebSearch/WebFetch、mcp__*、AskUserQuestion、计划模式工具（runtime 构造后 push，数组引用共享）。
- Provider：ModelProvider.stream(ChatRequest)→ProviderEvent（src/core/provider.ts）；ApiMessage 纯文本
  content（openai 形状）；createOpenAiProvider（src/provider/openai.ts:170，ProviderLimits:58/DEFAULT_LIMITS:66/
  backoffDelay:113/parseRetryAfter:119/probe:622/discoverModels:590）；SseParser（src/provider/sse.ts:28）。
- normalizeForApi（src/core/normalize.ts）：user→context 包裹+纯文本；tool→逐块 role:tool；
  assistant→tool_calls+content:text||null+可选 reasoning_content；悬空调用补合成错误结果。
- runtime（src/tui/runtime.ts:241）：provider() 每次 getConfig 新建 openai；resolveSnapshot:377 读
  profile.capabilities.tools；tools 数组＝workspace+exec+web+mcp，构造后追加 question/plan；
  persistence→startSession transcript；sessionId 隔离。
- 命令：CommandOutcome 模态槽 openModels/openEffort/…/openList（src/tui/commands/types.ts）；
  app.tsx:479-557 消费；COMMAND_NAMES app.tsx:90-107 仅 16 旧名（**缺 SP006 扩展命令，本轮补全**）；
  面板范式 panels.tsx（usePanelInput+round 边框+❯ 选中+dim 脚注）。
- 键位（src/tui/keybindings/defaults.ts）：NON_REBINDABLE ctrl+c/d/m；chat ctrl+o/ctrl+r/shift+tab/ctrl+t；
  ctrl+v、alt+v、ctrl+b 均未绑定。usePaste 文本路径 app.tsx:734。
- 存储：~/.budingx/sessions/<id>/transcript.jsonl（TRANSCRIPT_VERSION=1）；TranscriptRecord
  message 带 usage?:Usage（src/core/transcript.ts:39）**无 model 字段**；paths.ts dataRoot/tasksDir/temporaryPath。
  ConfigStore ModelProfile.capabilities 仅{tools:boolean}（src/storage/config-store.ts:16）；
  providerTemplates（src/tui/model-management.ts:16）11 项全 OpenAI 兼容端点；ModelDraft 无 protocol。
- headless（src/tui/headless.ts）：stream-json 白名单映射 status/text_delta/tool_call_completed/
  tool_result/message_completed/turn_finalized/notice(file_context)；未知事件不输出。
- 任务面 src/tui/tasks.ts：TaskRegistry 后台 shell 六件套（running/completed/failed/cancelled）。
- 验证：node --test src/*/test/*.test.mjs；helpers agent-fixture/fake-mcp-server/model-keys/mount-tty；
  scripts/testing/live-provider.mjs opt-in 真实范式（预算帽/脱敏/summary JSON）。

## 3. 参考对照点（机制→本仓落点；不抄代码）

| # | 参考机制（b5c9be8 路径） | 本仓落点 |
| --- | --- | --- |
| C1 | AgentTool/loadAgentsDir.ts＋markdownConfigLoader.ts：frontmatter 定义、built-in→user→project 覆盖、memoize | src/core/agent-definitions.ts（yaml 解析，目录 .budingx/agents） |
| C2 | builtInAgents.ts：general-purpose/Explore/Plan 工具禁表 | 同文件内置常量（禁表映射本仓工具名） |
| C3 | runAgent.ts：独立 query 循环、工具裁剪、权限覆盖、sync 共享取消/async 独立、finally 清理 | src/core/agent-runtime.ts：子 Session 实例＋裁剪工具＋上限 policy＋AbortController 树 |
| C4 | AgentTool prompt.ts：入参/结果 10 万字符/并发安全/usage 尾注 | src/core/agent-tools.ts：Agent/TaskOutput/TaskStop |
| C5 | UI.tsx 卡片：8 色/Initializing/最后 3 条工具摘要/Done 计数/ctrl+o/ctrl+b/并行树 | src/tui/render/agent-card.ts＋transcript 接线 |
| C6 | commands/agents/AgentsMenu＋CreateAgentWizard＋agentFileUtils 'wx' | src/tui/agents-menu.tsx（面板范式同 panels.tsx） |
| C7 | task-notification 注入主循环、notified 原子防重、TaskStop 抑制 | agent-runtime 注册表＋Session.enqueueNotification |
| C8 | commands/status→Settings 三页签、字段集、不显权限模式 | src/tui/diagnostics/status-dialog.tsx＋status-report.ts |
| C9 | stats.ts/statsCache.ts/heatmap.ts/Stats.tsx：JSONL 聚合、版本缓存、今天实时、r/Tab/Ctrl+S | src/tui/diagnostics/stats.ts＋stats-dialog.tsx |
| C10 | screens/Doctor.tsx＋doctorContextWarnings.ts：警告式、阈值 40k/15k/25k、stale 清理 | src/tui/diagnostics/doctor.ts＋doctor-dialog.tsx |
| C11 | ToolSearchTool：select/关键词计分、延迟池、发现集、公告、门控、失败引导 | src/core/tool-search.ts |
| C12 | services/api/claude.ts＋withRetry.ts：Messages 协议、SSE 事件、重试纪律 | src/provider/anthropic.ts（方向见 D1） |
| C13 | providerPresets.ts：Anthropic 兼容端点预设 | model-management.ts providerTemplates 增 protocol 字段与预设 |
| C14 | imagePaste.ts/apiLimits.ts/imageResizer.ts/imageStore.ts/UserImageMessage.tsx | src/tui/image-paste.ts＋image-resize.ts＋src/storage/image-cache.ts＋输入区占位 |
| C15 | errors.ts isUnsupportedImageInputErrorMessage＋messages.ts 剥离图片块 | src/provider/image-errors.ts＋session 降级重试 |
| C16 | attachments.ts buildImageContentBlocks：双协议图片块 | normalizeForApi 扩展＋anthropic 适配器转换 |
| C17 | 流式工具参数 safeParseJSON＋InputValidationError 回灌 | dispatchTools 既有 JSON 错误路径增强（PC-05） |
| C18 | SP001 O5=B 自有测量；live-provider 预算范式 | scripts/eval/（runner＋live＋tasks） |

豁免：参考 swarm/team（SP011）、fork/resume/agent-memory/worktree 隔离、按代理 mcpServers/hooks/skills、
Read 读图/PDF、/stats 彩蛋对比、doctor 联网 Updates——需求排除清单已列，本轮不设计不实现。

## 4. 方案

### 4.1 R1 子代理（SA-01…16）

**定义加载** src/core/agent-definitions.ts：
- loadAgentDefinitions({cwd, home})→{agents: AgentDefinition[], warnings: string[]}；
  目录＝内置→~/.budingx/agents→项目自 cwd 向上每级 .budingx/agents 至 git 根（含）；同名后者胜；
  文件 <name>.md，YAML frontmatter（yaml 依赖已有）＋正文=系统提示词。
- AgentDefinition{name,description,source:'built-in'|'user'|'project',tools?:string[]（缺省=全部）,
  disallowedTools?:string[],model?:string（'inherit' 缺省）,effort?,permissionMode?:PermissionMode,
  color?:AgentColor,maxTurns?:number,initialPrompt?:string,background?:boolean,filePath?,body}。
  8 色 red/blue/green/yellow/purple/orange/pink/cyan；未支持字段（isolation/memory/mcpServers/hooks/skills）
  解析到即记 warning（doctor Agent Parse Errors 分区展示），不执行。
- name/description 必填校验；非法文件跳过记 warning；缓存 Map＋invalidateAgentCache()（写盘后调用）。
- 内置：general-purpose（全工具）；Explore（禁 Write/Edit/Bash/PowerShell/Agent/AskUserQuestion/计划工具，
  model inherit——本仓无 haiku 对应，偏离登记 D10）；Plan（同禁表，正文末尾要求列 3-5 Critical Files）。
- saveAgentFile({location:'project'|'user',definition})：'wx' 防覆盖、description YAML 双引号转义、
  tools 全许省略该行；deleteAgentFile 仅限 user/project 源。

**子会话运行** src/core/agent-runtime.ts：
- createAgentRegistry({sessionId, home, parentSession, policy, workspace, tools, getConfig,
  resolveSnapshot, approval, transcript?, contextBudget?})→AgentRegistry。
- AgentRecord{agentId,agentType,description,color,callId,state:'running'|'completed'|'failed'|'cancelled'|'backgrounded',
  background:boolean,toolUses:number,tokens:number,startedAt,finishedAt?,result?,error?,controller,
  session:Session,notified:boolean,stopped:boolean}。注册表与 TaskRegistry（tasks.ts）完全分离（SA-14）。
- spawn({definition, prompt, description, model?, runInBackground?, parentSignal, callId, turnId})：
  1. 并发闸：running 计数≥MAX_CONCURRENT_AGENTS(=10) 时等待（信号量 Promise 队列），取消可中断等待。
  2. 工具裁剪：父 tools 过滤——恒禁 Agent/TaskOutput/TaskStop/AskUserQuestion/EnterPlanMode/ExitPlanMode
     （本仓计划工具名以实际为准）；definition.tools 白名单（'*' 缺省全部）再减 disallowedTools；
     后台代理额外白名单 Read/Glob/Grep/WebSearch/WebFetch/Bash/PowerShell/Write/Edit/TodoWrite 类＋mcp__* 恒许。
  3. 权限上限：childPolicy=createPermissionPolicy({workspace, rules:父规则快照, mode:min(父当前模式,
     def.permissionMode??父模式)})；deny 规则继承；child remember 隔离不写父记忆。
     审批网关：sync→转发父 ApprovalGateway（**串行队列**：同一时刻只弹一个审批，防并行代理竞争）；
     background→自动 deny 网关（outcome:'deny',via:'policy'，不弹窗）。
  4. 子 Session：独立 messages（不见父历史）；系统提示词＝definition.body＋环境详情（cwd/平台/日期，
     复用 runtime 环境串）＋initialPrompt 前置首条 user；resolveSnapshot＝model override??父快照
     （capabilities 继承）；maxIterations＝maxTurns 参数??定义??SUBAGENT_MAX_TURNS(=30)；
     transcript＝sidechain JSONL ~/.budingx/sessions/<parent>/subagents/agent-<agentId>.jsonl
     （复用 createSessionTranscript 形状，独立目录）；hooks 不注入（排除项）；thinking 不启用。
  5. 取消：child 独立 AbortController；sync 时 parentSignal abort 监听→child.abort()（backgrounded 标志
     置真后解除监听）；registry.stop(agentId)→abort＋stopped=true（抑制通知）；父回合 cancel 只中止 sync 子。
  6. token 预算：累计子 usage≥SUBAGENT_TOKEN_LIMIT(=100000，MODEL_PROPOSED D7)→abort＋
     结果注明预算终止；maxTurns 耗尽→outcome max_turns 结果可见。
  7. 进度：子 session.on 事件→registry 更新 toolUses/tokens/lastTools→emit 父会话
     agent_started/agent_progress/agent_finished（§4.7 新事件）；onUpdate 不再用于代理进度。
  8. 清理：finally 释放并发闸、子 disposers（子代理无 runner 后台命令——Bash 后台任务属父 runner，
     子代理 Bash 共享父 runner 时其后台任务归父六件套；子代理自身 disposers 清控制器监听）。
- 结果：取子最后 assistant 文本块（纯 tool_use 回溯）；截断 100000 字符注明；
  尾注 '\n\n<usage>total_tokens: N\ntool_uses: N\nduration_ms: N</usage>'；
  失败/取消/预算→isError tool_result 带稳定码（AGENT_FAILED/AGENT_CANCELLED/AGENT_BUDGET）。
- 后台：spawn 即返 {status:'async_launched',agentId}（outputFile=sidechain 路径）；
  终态 registry 收集→parentSession.enqueueNotification('<task-notification>…XML…</task-notification>')
  （status/summary/result/usage）；notified 原子防重；stopped 抑制。通知进 Session queue→
  既有 drain 机制开启回合（idle 自动、回合内 intra_turn 注入），与参考「注入主循环」等价。
- background(callId)：sync 运行中代理转后台——置 backgrounded、解除父信号监听、
  execute Promise 立即以 async_launched 结果 resolve（子继续跑）；ctrl+b 触发（SA-14）。
- TaskOutput{agentId,block?=true,timeout?≤600000}：等待终态返最终答案；未知 id 报错。
  TaskStop{agentId}：停止＋抑制通知＋返回状态。

**Agent 工具** src/core/agent-tools.ts：createAgentTools(registry, definitions)→[Agent,TaskOutput,TaskStop]。
Agent.parameters JSON Schema（description/prompt 必填，subagent_type/model/run_in_background 可选）；
concurrencySafe=true（ToolHandler 新增可选字段）；capability='read'（派发本身不写，子工具各自受 policy）；
describe＝'Agent(<type>): <description>'；省略 subagent_type→general-purpose；未知类型→错误列可用类型。
runtime 构造后 push（数组引用共享，同 question/plan 范式）。

**并行派发**（SA-05/SA-15）：dispatchTools 改造——将 calls 中**连续且全部 concurrencySafe 的 Agent 调用**
分为一组 Promise.all 并行（其余工具保持顺序，D6 范围限定）；结果按原序 pushToolResult；
组内任一 cancelled→整组取消判定同现状。审批串行队列保证弹窗不竞争。
并行 UI：≥2 个 running 代理→「Running N agents…」＋├─/└─树行（SA-15）。

**/agents 面板** src/tui/agents-menu.tsx（local-jsx，outcome.openAgents）：
模式机 list→view/edit/delete/back；list 行＝name＋source 标签＋被覆盖 dim；内置不可编辑删除；
创建向导 位置→方式（手动；「AI 生成」方式本轮以手动覆盖，参考 Generate 走模型生成——
  本仓以 prompt 型 /agent-create 辅助? 不：向导 Method 仅 Manual，Generate 延期登记 D10）→
  名称→提示词→描述→工具（多选/全部）→模型（inherit/当前模型列表）→颜色→确认；
落盘 saveAgentFile＋invalidate；退出输出变更汇总（created/updated/deleted 计数）。
键位↑↓/Enter/Esc（面板范式）；Ctrl+C/D 双击退出同参考。
/agent <type> <prompt>：prompt 型命令→注入「使用 Agent 工具，subagent_type=<type>，任务：<prompt>」；缺参给用法。

**卡片** src/tui/render/agent-card.ts：agent_started→卡片标题=description（agentType 8 色，
general-purpose 无色）；无进度 'Initializing…'；运行中连续工具分组摘要仅显最后 3 条＋
'+N more tool uses (ctrl+o expand)'；高度不足单行 'In progress… · N tool uses · X tokens'；
≥2s 显 'ctrl+b to background'；完成 'Done (N tool uses · X tokens · 时长)'；失败/取消态红色；
ctrl+o 展开子转录（读 sidechain）＋最终答案；后台化 'Backgrounded agent (↓ manage)'。
/tasks 面板增 Agents 分组（registry.list()），键位 x 停止、ctrl+x 停全部代理（同参考）。

### 4.2 R2 诊断（RD-01…16）

**性能采集**（RD-16）：Session 增 private perf={firstTokenMs:number[],requestMs:number[]}；
runTurn 每迭代记请求开始→首个 text/thinking_delta 延迟、请求总时长（completed/failed 时）；
clearHistory 重置；getter performance()→{requests,firstTokenAvgMs,p50Ms,p95Ms}（纯函数 percentile）。
不新增网络、不进转录（进程内）。

**/status**（RD-01/02/03）：local-jsx immediate→outcome.openStatus→StatusDialog 三页签
Status/Config/Usage（Tab 切换、Esc 关闭＋系统消息 'Status dialog dismissed'）；
高度 max(15,min(floor(rows*0.8),30))；行格式 bold label:＋值。
- Status 页：Version（src/tui/package.json）、Session ID、cwd、Model＋档案 label、API baseUrl host、
  凭据来源（cli/env/file）、MCP 计数 connected/failed/pending＋'· /mcp'、Setting sources（仅非空源）、
  System Diagnostics 警告（config corrupt/doctor 警告摘要/项目指令>40000 字符）。不显示权限模式（同参考）。
- Config 页：ResolvedConfig source 优先级链（cli>env>file>default）＋档案摘要（protocol/model/tools/vision）。
- Usage 页：/cost 同格式（requests/输入输出 token/耗时）＋首 token 均值/请求 p50/p95（performance()）＋
  进程 RSS（process.memoryUsage().rss，MB）——矩阵诊断要求落点（D9）。
纯函数 src/tui/diagnostics/status-report.ts 组装字段（可单测）；面板只渲染。

**/stats**（RD-04…08）：local-jsx→outcome.openStats→StatsDialog。
- 聚合 src/tui/diagnostics/stats.ts：扫 ~/.budingx/sessions/*/transcript.jsonl＋
  <session>/subagents/agent-*.jsonl；20 文件一批并行读；mtime 预过滤（范围起始日前跳过）；
  message 记录 usage 按模型按日累加 input+output；**TranscriptRecord message 增可选 model 字段**
  （recordMessage 写 snapshot.model；旧转录无 model→归 'unknown' 桶，兼容不重算）；
  subagent 计 token 不计会话数；tool_use 块计数。
- 缓存 stats-cache.json（dataRoot）：{version:1, days:{date:{model:{input,output}}}, sessions, …}；
  版本更旧全量重算；磁盘只覆盖到昨天，今天恒实时；7d/30d 绕过缓存 fromDate=today-(days-1)。
- Overview 页：热力图（恒 all-time，周列×7 行强度字符）、Favorite model、Total tokens、Sessions、
  Longest session、Active days、Longest/Current streak、Most active day；r 循环 all/7d/30d 默认 all。
- Models 页：top3 折线（纯字符 asciichart，height 8、宽 min(52,max(20,termWidth-7))、y 轴 k/M、<2 天不画）；
  双列 4 模型（百分比＋'In: N · Out: N'）降序；↑↓ 滚 2 项。不显示费用（同参考）。
- Ctrl+S：renderAnsi(stats) 纯字符串（手工 ANSI 色）→Windows PowerShell Set-Clipboard；2 秒提示；
  非 Windows/失败明确提示（本机 Windows 验证，其他 UNVERIFIED）。
- Tab 切页、Esc/Ctrl+C/Ctrl+D 关闭。

**/doctor**（RD-09/10/11）：local-jsx→outcome.openDoctor→DoctorDialog 警告式静态报告
（**非 PASS/FAIL、无交互 Fix 屏**——按参考实际行为，修正 r5 措辞，D4）。
每条 'Warning: …'＋'Fix: …'；Enter/Esc 关闭＋'budingx diagnostics dismissed'。分区序：
Diagnostics（运行类型 development/npm-local/npm-global/unknown、版本、Node 版本、入口路径、搜索可用性）→
Multiple installations（npm 全局/本地并存探测）→Invalid Settings（ConfigStore corrupt）→
MCP 警告（failed 服务器）→Keybinding 解析警告→Environment Variables（BUDINGX_* 非法值/超限）→
Agent Parse Errors（definitions warnings）→Unreachable Permission Rules（deny 被更高优先级覆盖等）→
Context Usage Warnings。无问题分区隐藏。
- 上下文警告 src/tui/diagnostics/doctor-warnings.ts 四项并行：项目指令>40000 字符；
  代理描述总量>15000 token（estimateTokens，列前 5）；MCP 工具 schema>25000 token（按服务器前 5）；
  不可达权限规则逐条附 Fix。
- 自动修复（RD-10，D8）：打开时清理过期临时产物（os.tmpdir budingx-clipboard-* 超 24h、
  image-cache 孤儿临时文件），报告清理计数；本仓无 PID 版本锁机制，不清理不存在的锁。
- 隐私（RD-15）：三面板纯本地零网络；凭据脱敏（apiKey 只显来源不显值）；测试用两个临时 home 隔离。

**ToolSearch**（RD-12/13/14）src/core/tool-search.ts：
- createToolSearch({tools, contextWindow, env, mcpPending})→{tool?:ToolHandler, filter, notice, state}；
  门控 BUDINGX_TOOL_SEARCH=off|auto|auto:N|standard（默认 auto）；off/standard 或无延迟池→不注册。
  延迟判定：mcp__* 恒延迟；核心工具恒加载；ToolSearch 自身不延迟。
  auto 阈值：延迟工具估算 token（estimateTokens(JSON.stringify(spec))＋500/工具）≥contextWindow×N%（默认 10）。
- tool：name 'ToolSearch'，parameters{query:string,max_results?:number 默认 5}，capability='read'，
  concurrencySafe=true；select:A,B,C 直选（大小写不敏感、已发现 no-op）；裸名精确 fast path；
  mcp__server 前缀匹配；关键词空格分词 +词必需；计分每词累加：名称词精确 MCP12/普通10＞子串6/5＞
  summary 词边界4＞全名兜底3（仅 0 分时）＞描述词边界2；返回文本＝匹配名列表＋total_deferred_tools＋
  pending 提示（'still connecting…try searching again'）；无匹配 'No matching deferred tools found'；
  结果含机器标记 '<discovered-tools>A,B</discovered-tools>'。
- 发现集：state.discovered Set——execute 时加入；buildRequest 前 scanHistory(messages) 扫
  tool_result 标记重建（覆盖 /resume）；进程内 Set 跨压缩存活；压缩时经 SessionOptions.toolSearch
  快照为 preserved tool_state 项（跨进程恢复不丢，同参考 preCompactDiscoveredTools）。
- filter(tools)＝非延迟＋ToolSearch＋已发现；notice()＝'<available-deferred-tools>'＋排序名池
  （池变即更新；断连 MCP 工具移除）。Session.buildRequest 消费 filter＋notice（拼入 system 上下文）。
- 失败引导（RD-14）：dispatchTools Unknown tool 且名在延迟池→错误追加
  'call ToolSearch with query "select:<name>", then retry'。

### 4.3 R3 供应商兼容（PC-01…08）

**第二协议＝Anthropic Messages 直连适配器**（D1：参考 CLI 恒 Anthropic＋本地翻译代理接 OpenAI 供应商；
本仓已原生 OpenAI，取方向相反的直连适配器，能力等价「两类公开协议」，免新增本地代理服务面）。
src/provider/anthropic.ts：createAnthropicProvider({baseUrl,apiKey,limits})→ModelProvider。
- 请求：POST {baseUrl}/v1/messages；头 x-api-key、anthropic-version: 2023-06-01、content-type。
  ChatRequest（OpenAI 形状 ApiMessage）→Anthropic：system 消息→顶层 system 串；
  user content string|parts→blocks（image_url data URI→{type:'image',source:{type:'base64',media_type,data}}）；
  assistant tool_calls→tool_use blocks＋content text；role:tool→user 消息 tool_result block
  （tool_use_id,content,is_error）；tools→{name,description,input_schema}；tool_choice 缺省 auto；
  max_tokens＝request.maxTokens??ANTHROPIC_DEFAULT_MAX_TOKENS(=8192，必填协议要求)；
  stream:true；reasoningEffort→thinking{type:'enabled',budget_tokens:low 1024/medium 4096/high 16384}
  （D11：400 提及 thinking→去 thinking 重试一次，错误驱动不静默换模型）。
- SSE（复用 SseParser）：message_start(usage.input_tokens)→暂存；content_block_start
  type tool_use→tool_call_delta{index,callId,nameDelta}；content_block_delta text_delta→text_delta、
  thinking_delta→thinking_delta、input_json_delta→tool_call_delta{index,argsDelta}；
  message_delta stop_reason(end_turn→stop/tool_use→tool_calls/max_tokens→length/refusal→content_filter)
  ＋usage.output_tokens 累计（finish 与 usage 分帧→流末合并 message_completed，同参考扣帧纪律）；
  message_stop→message_completed{finishReason,usage}；error 帧→failed。
- 错误分类：authentication_error→auth、permission_error→auth、rate_limit_error→rate_limited、
  overloaded_error→overloaded、not_found_error→not_found、invalid_request_error→bad_request
  （'prompt is too long'/'context'→context_overflow）、api_error→unknown、网络→network/timeout。
  重试：复用 openai backoffDelay/parseRetryAfter（改为导出）＋ProviderLimits/DEFAULT_LIMITS；
  上限同 openai 口径、retry-after 优先、401 静态 key 不重试（PC-06）；不无界重试不静默换模型。
- probeAnthropic({baseUrl,apiKey,model,signal})：POST /v1/messages max_tokens:1 'ping'→
  ProbeResult 同形状；discoverModels：GET /v1/models（x-api-key）失败回退建议列表。
- 上下文超限（PC-06 可选增强）：400 正则提数降 max_tokens 重试一次——本轮实现为明确报错＋
  既有 compactForOverflow 路径（不静默截断历史），正则降参增强记 MODEL_PROPOSED 延期。

**档案与配置**（PC-02/03/08）：
- ModelProfile.protocol?:'openai'|'anthropic'（缺省 openai，旧档案兼容）；capabilities.vision?:boolean。
- ResolvedConfig.protocol 字段；selectProfile/draftConnection/startupProfile 传递；
  runtime provider() 按 protocol 分支 createOpenAiProvider/createAnthropicProvider；
  resolveSnapshot capabilities{tools,vision}；TurnSnapshot.capabilities 类型扩展（vision?:boolean）。
- providerTemplates 增 protocol 字段＋Anthropic 预设：DeepSeek(api.deepseek.com/anthropic)、
  GLM(open.bigmodel.cn/api/anthropic)、Kimi(api.kimi.com/coding)、MiniMax(api.minimaxi.com/anthropic)；
  Custom 向导端点步骤后增协议选择（OpenAI 兼容/Anthropic Messages）；testProfile/loadModelIds 按协议分支。
- 凭据 host 绑定不复用不变；会话固定快照不变（切换档案下一请求生效，同现状）。
- PC-04 fixture：双协议各覆盖流式碎片/中断/多工具/错误参数/上下文上限/限流/网络/重试/取消
  （fake fetch 注入 SSE 帧）；PC-07 live：scripts/testing/live-provider.mjs 增 --protocol anthropic
  （BUDINGX_ANTHROPIC_* env），流式对话＋工具回合＋取消，预算/脱敏沿用；缺凭据 UNVERIFIED。
- PC-05：dispatchTools JSON 非法路径文案增强为 '<tool_use_error>InputValidationError: …</tool_use_error>'
  形状（isError 回灌自纠不中断，双协议共用）；schema 校验失败同路径（工具 parameters 校验本轮
  以 JSON 合法性＋工具内部校验为准，不引 zod）。

### 4.4 R4 多模态（MM-01…10）

**契约扩展**：MessageBlock 增 {type:'image',id:number,mediaType:string,data:string(base64),
width?:number,height?:number}；ApiMessage.content 类型 string|ApiContentPart[]
（ApiContentPart＝{type:'text',text}|{type:'image_url',image_url:{url:string}}，openai 形状为规范形）；
SubmitOptions.images?:{id,mediaType,data,width?,height?}[]；userMessage 追加 image 块；
normalizeForApi user 含图→content parts（text 在前图片在后，context 包裹不变）；纯文本路径字节级不变。
转录存 image 块含 data（D12：单图≤5MB base64 上限控制体积；image-cache 供重显链接）。
- 协议映射（MM-07）：openai 适配器 content parts 直传 image_url data URI；
  anthropic 适配器转 image source blocks；capabilities.vision===false→submit 前置明确拒绝
  （notice＋不发起请求）；vision undefined＝未知→发送走错误驱动降级。
- 媒体上限（MM-09）：buildRequest 统计请求内图片＞100→丢最旧＋notice 可见提示（D5）。
- 错误驱动降级（MM-08）：src/provider/image-errors.ts isImageUnsupportedError(message)
  （含 image 且 not support/unsupported/vision/multimodal/modality，或 image_url schema 拒绝特征）；
  runTurn providerFailure class bad_request 且匹配→剥离最近 user 消息 image 块→
  notice 'image_downgraded'（新 NoticeCode）→无图重试一次（imageRetried 标志，同 overflowRetried 范式）；
  再失败→outcome 'image_error'（既有枚举）。后续轮该消息无图。
- 粘贴键位（MM-01）：defaults.ts 平台分支——Windows {chat, alt+v, chat:imagePaste}、
  其他 {chat, ctrl+v, chat:imagePaste}（ctrl+v 现未绑定，无冲突；文本粘贴走 bracketed usePaste 不变）；
  保留键校验通过（不在 NON_REBINDABLE）。
- 剪贴板（MM-02）src/tui/image-paste.ts：Windows PowerShell Get-Clipboard -Format Image→
  os.tmpdir/budingx-clipboard-<rand>.png→读字节→fire-and-forget 删；无图明确提示；
  Linux xclip/wl-paste、macOS osascript 尽力而为（本机 Windows 验证，其他 UNVERIFIED）。
- 路径附件（MM-03）：输入文本中 /\.(png|jpe?g|gif|webp)$/i 路径 token（去外层引号＋还原反斜杠转义）→
  读文件→附件；读失败明确报错不假装已读；提交时从文本移除已附件路径 token。
- 尺寸（MM-04）src/tui/image-resize.ts：base64 长度＞5MB 或尺寸＞8000 触发；
  PNG 纯 JS（node:zlib inflate/deflate＋IHDR/IDAT 解析＋unfilter＋双线性降采样＋filter0 重编码，
  支持 8-bit RGB/RGBA 非隔行；调色板/16-bit/隔行→明确拒绝）级联 8000→2048→1568 目标 raw≤3.75MB；
  非 PNG 超限→明确拒绝＋缩小建议（D2：不引 sharp/native）。
- 附件状态与显示（MM-05）：app pastedContents Map<id,{mediaType,data,dimensions}>；
  输入区 '[Image #N]' 占位；提交→SubmitOptions.images；转录/user 消息渲染 '[Image #N]'
  （终端超链接支持时 file:// 指向 image-cache）；不做像素渲染。
- 缓存（MM-06）src/storage/image-cache.ts：~/.budingx/image-cache/{sessionId}/{id}.{ext}；
  内存 Map 上限 200 逐旧淘汰；目录私有权限（同 storage 既有 0o700 纪律）。
- MM-10：非图片二进制/不支持扩展名→明确拒绝消息（不假装已读、不提升授权）。

### 4.5 R5 评估回归（ER-01…06）

scripts/eval/：runner.mjs（离线保护用例，fake provider 经 agent-fixture 范式）＋
live.mjs（opt-in 真实，复用 live-provider 预算/脱敏/summary 范式）＋tasks.json（≥12 版本化任务：
供应商错误恢复/错误参数自纠/拒图降级/子代理权限/子代理取消/子代理冲突/MCP 失败边界/诊断准确性/
编码回归子集沿用 SP001 inventory；≥3 盲测标记 blind 不参与调优）＋fixtures/（确定性小仓快照）。
每任务：指令＋可自动断言预期＋允许修改范围＋时间/token/请求预算＋失败分类
{provider_error,tool_error,permission,budget,assertion,timeout,cancelled}。
评分以测试/差异正确性（断言退出码），不以模型自报；报告总体＋分组 pass/fail＋失败类别，
禁只选成功案例；summary JSON＋markdown 入 artifacts/quality-runs/SP007/agent-quality-and-extensions/<run>/。
任务集纪律（docs/iteration-plan.md:94-99）：本轮 ≥12 新增＋沿用 SP001 编码回归子集，累计任务集
向 ≥30 任务/≥10 盲测/3 次重复纪律收敛（SP015/SP016 全量验收）；盲测任务本轮起标记 blind 不调优。
ER-05 未测能力清单（团队/浏览器/CU/调度/多端…）写入报告；ER-06 保护用例进 src/tui/test/ 既有 glob，
live 不进 npm test。

### 4.6 R6 失败边界与宿主契约（FB-01…04）

回归既有 SP004/005/006 用例＋新增：WebSearch/WebFetch 失败错误结果权限不变（FB-01）；
hooks 超时/崩溃/非零/递归防护（FB-02）；MCP 断线/超时/取消/输出上限＋断连延迟工具公告移除（FB-03）；
headless stream-json 既有事件形状/终态/退出码不变——agent_* 新事件 headless 不输出（UI-only，
Agent 语义已由 tool_call_completed/tool_result 承载），notice 新码按既有 notice 映射纪律（FB-04）；
npm pack dry-run 产物符合性；不新增运行时依赖（yaml/zlib 已有）。

### 4.7 契约扩展汇总（新增均向后兼容）

- SessionEvent += agent_started{turnId,callId,agentId,agentType,description,color,background} /
  agent_progress{agentId,toolUses,tokens,lastTools:string[],state} /
  agent_finished{agentId,outcome,toolUses,tokens,durationMs,background}。
- NoticeCode += 'agent_notification'|'image_downgraded'|'image_rejected'|'tool_search'。
- SessionOptions += toolSearch?{filter,notice,snapshot}；Session += enqueueNotification(text)、
  performance() getter；SubmitOptions += images?。
- ToolHandler += concurrencySafe?:boolean；ToolContext 不变。
- MessageBlock += image；ApiMessage.content 联合扩展；TurnSnapshot.capabilities += vision?。
- ModelProfile += protocol?、capabilities.vision?；ResolvedConfig += protocol?；
  TranscriptRecord message += model?；CommandOutcome += openAgents/openStatus/openStats/openDoctor。
- 键位 += chat:imagePaste（平台分支）、chat ctrl+b→agent.background（运行中代理存在时）。
- COMMAND_NAMES 补全注册表全名（修 SP006 缺口＋新命令）。

## 5. 变更集（精确路径）

新增：src/core/agent-definitions.ts、src/core/agent-runtime.ts、src/core/agent-tools.ts、
src/core/tool-search.ts、src/provider/anthropic.ts、src/provider/image-errors.ts、
src/storage/image-cache.ts、src/tui/image-paste.ts、src/tui/image-resize.ts、
src/tui/agents-menu.tsx、src/tui/render/agent-card.ts、
src/tui/diagnostics/{status-report.ts,status-dialog.tsx,stats.ts,stats-dialog.tsx,doctor.ts,doctor-dialog.tsx,doctor-warnings.ts,heatmap.ts,ansi-chart.ts}、
src/tui/commands/builtin-agents.ts、src/tui/commands/builtin-diagnostics.ts、
scripts/eval/{runner.mjs,live.mjs,tasks.json,fixtures/}、
测试 src/core/test/{agent-definitions,agent-runtime,agent-tools,tool-search,image-blocks}.test.mjs、
src/provider/test/{anthropic,anthropic-fixtures,image-errors}.test.mjs、
src/tui/test/{sp007-agents-panel,sp007-diagnostics,sp007-image-paste,sp007-eval,sp007-failure-boundaries}.test.mjs。
修改：src/core/{events.ts,tools.ts,provider.ts,session.ts,normalize.ts,transcript.ts}、
src/provider/openai.ts（导出 backoffDelay/parseRetryAfter；content parts 直传）、
src/storage/{config-store.ts,profiles.ts,paths.ts}、
src/tui/{runtime.ts,app.tsx,panels.tsx,commands.ts,commands/types.ts,commands/index.ts,
model-management.ts,model-manager.tsx,keybindings/defaults.ts,headless.ts,tasks.ts,render/transcript.tsx}、
scripts/testing/live-provider.mjs、docs/{iteration-plan.md,current-status.md,agent-capability-matrix.md,
independent-development.md}、PRODUCT.md、THIRD-PARTY-NOTICES.md（cc-switch MIT 线索登记：仅机制参考未嵌入代码）。

## 6. 偏离登记（参考→本仓，含理由）

| # | 偏离 | 理由 |
| --- | --- | --- |
| D1 | 第二协议方向相反（Anthropic 直连适配器 vs 参考本地翻译代理） | 本仓已原生 OpenAI；能力等价两类公开协议；免新增服务面 |
| D2 | PNG 纯 JS zlib 缩放 vs sharp 级联编码 | 不新增 native 依赖；非 PNG/复杂 PNG 超限明确拒绝 |
| D3 | ToolSearch 客户端发现集＋文本标记 vs Anthropic tool_reference beta | 本仓 provider 契约无该 beta；行为等价（延迟池/发现/公告/门控） |
| D4 | /doctor 警告式（修正 r5「Fix 屏」措辞） | 参考实际即警告式静态报告，无交互 Fix 屏 |
| D5 | MM-09 超量丢最旧＋可见提示 vs 参考静默 | 矩阵「明确」纪律 |
| D6 | 并行仅限连续 Agent 调用组 vs 参考通用并发安全分组 | SP003 顺序派发回归安全；范围限定 |
| D7 | 子代理 token 上限 100000（参考仅 maxTurns） | 矩阵费用上限要求；MODEL_PROPOSED |
| D8 | doctor 自动清理＝过期临时产物 vs 参考 PID 锁 | 本仓无锁机制；等价自动修复动作 |
| D9 | /status Usage 增首 token/p50/p95/RSS vs 参考仅费用 | 矩阵诊断与性能要求 |
| D10 | Explore/Plan model inherit（无 haiku 对应）；向导 Generate 方式、fork/resume/memory/worktree 延期 | 排除清单；后续轮复用本轮契约 |
| D11 | anthropic thinking effort→budget＋400 去 thinking 重试 | MODEL_PROPOSED；错误驱动不静默换模型 |
| D12 | 转录 image 块含 base64 data | 契约简单一致；5MB 上限控体积；image-cache 供重显 |

## 7. AC→设计映射

SA-01…02→§4.1 定义加载；SA-03…08→§4.1 子会话运行/结果；SA-09…10→§4.1 后台/TaskOutput/TaskStop；
SA-11…12→§4.1 /agents 面板//agent；SA-13…15→§4.1 卡片/并行＋§4.7 事件；SA-16→§4.6 headless。
RD-01…03→§4.2 /status＋性能采集；RD-04…08→§4.2 /stats；RD-09…11→§4.2 /doctor；
RD-12…14→§4.2 ToolSearch；RD-15…16→§4.2 隐私/性能。
PC-01→§4.3 适配器；PC-02/03/08→§4.3 档案配置；PC-04/06/07→§4.3 fixture/重试/live；PC-05→§4.3 自纠。
MM-01…06→§4.4 粘贴/路径/尺寸/显示/缓存；MM-07…10→§4.4 映射/降级/上限/拒绝。
ER-01…06→§4.5。FB-01…04→§4.6。

## 8. 风险与开放项

- 并行代理审批 UX：串行队列可能让用户连续应答多个审批——可接受（安全优先），测试覆盖竞争。
- PNG 纯 JS 重编码复杂度：限定 8-bit RGB/RGBA 非隔行，其余明确拒绝；fixture 覆盖滤波类型 0-4。
- 转录体积：image data 入 JSONL，5MB/图上限＋100 图/请求上限控制；长会话风险记录 PRODUCT.md 限制。
- anthropic thinking 400：错误驱动去 thinking 重试一次；fixture 覆盖。
- /stats 旧转录无 model：归 unknown 桶，不迁移不重算（兼容纪律）。
- 真实模型双协议凭据：.env.e2e.local 在位（OpenAI 兼容）；Anthropic 兼容端点凭据若缺→UNVERIFIED＋恢复条件。
- 子代理 Bash 后台任务归属：共享父 runner→归父六件套（卡片分离纪律 SA-14 不受影响）。

## 9. 自审记录（Agent 自审，2026-11-21 委托）

检查项与结论：
1. AC 覆盖：60 AC 全部有设计落点（§7 映射逐条核对）；排除清单与参考豁免一致。PASS。
2. 契约核对（已读原文）：dispatchTools 顺序循环→Agent 组并行改造点明确；JSON 非法参数现有路径
   已回灌不中断（runTurn 过滤 providerToolArgumentsInvalid），PC-05 仅增强文案形状，低风险；
   计划工具实名 EnterPlanMode/ExitPlanMode（src/plan/tools.ts:77,92）、AskUserQuestion
   （src/core/questions.ts:49）与裁剪禁表一致；ctrl+v/alt+v/ctrl+b 现均未绑定，无键位冲突。
3. 事件端口：agent_* 经 ToolContext.emit（会话级，后台代理在 execute 返回后仍可发布）；
   headless 白名单映射自动忽略新事件（FB-04 不污染）；enqueueNotification 复用 queue/drain 既有机制。
4. 兼容：protocol/vision/model 字段均可选缺省，旧档案/旧转录不迁移不重算；normalizeForApi
   纯文本路径字节级不变（保护用例断言）；ApiMessage content 联合扩展需同步 openai 请求体构造。
5. 安全：子权限≤父（min 模式＋deny 继承＋remember 隔离）；后台自动 deny 不弹窗；审批串行队列
   防竞争；凭据脱敏；诊断零网络；不新增运行时依赖。PASS。
6. 偏离：D1–D12 全部有理由且可追溯 CAP/矩阵；MODEL_PROPOSED（SA-05 常量/RD-03 落点/D7/D11）
   已固化数值，实施不静默变更。PASS。
7. 遗留风险（§8）：并行审批 UX、PNG 重编码复杂度、转录体积、thinking 400、Anthropic 凭据可能缺——
   均有对策或 UNVERIFIED 纪律，不阻塞实施。
结论：自审通过。从 master 4705232 创建 feature/SP007/agent-quality-and-extensions，进入计划阶段。
