# 旧仓 TUI 机制与行为规格盘点（内部侦察）

来源：2026-11-16 只读侦察子代理对 `D:\my_project\budingWorkerSpace`（master_node，侦察时 HEAD `b5c9be8`）的调查；行为级描述 + file:line 指针，无源码摘录、无提示词内容。**仅用于本仓设计参考；任何交付制品（代码、注释、README、npm 包）不得引用或复制此处路径与内容。** 实现按 SP001 决定 3「读机制、不抄代码」独立编写，行为锚点一律用 `CAP-*` ID 表述。

## 1. Agent 主循环回合结构

- 主循环是 async generator 状态机：`while(true)`，跨迭代状态集中于单一 State 对象（messages / toolUseContext / compact 跟踪 / 恢复计数 / turnCount / transition），每个 continue 点整体重建；`transition` 记录上一迭代继续原因（旧仓 src/query.ts:207-242,244+）。
- 迭代内固定顺序：①消息组装管线——截到最近 compact 边界 → 工具结果总量预算（超阈值替换为预览）→ 各类压缩/投影 → 自动摘要（成功后以摘要后历史继续）→ 系统/用户上下文注入；②超限硬阻断预检；③调模型并流式消费，assistant 内容按 content block 粒度产出；**tool_use 块的存在是循环续跑的唯一信号**（注释明言 stop_reason 不可靠）；④工具分派：流式期间即可提前启动并发安全工具执行并回填；⑤结果回填 + 排队命令/附件注入 → 下一迭代（旧仓 src/query.ts:368-470,556-869,1388-1416,1543-1651；toolOrchestration.ts:19-189）。
- 多工具并行规则：按到达顺序把连续 `isConcurrencySafe` 的工具并为并发批（上限 10，可配），不安全工具单独串行；判定抛错/入参解析失败一律视为不安全；结果缓冲后按调用顺序发出；「兄弟级联取消」仅 Bash 错误会杀同批兄弟（隐式依赖假设），其他工具失败不牵连，被取消者得到合成 error tool_result（StreamingToolExecutor.ts:40-519）。
- 循环终止原因（枚举）：completed / aborted_streaming / aborted_tools / blocking_limit / prompt_too_long / image_error / model_error / max_turns / stop_hook_*。
- 错误与重试路径：限流与瞬时错误指数退避重试（默认上限 10、尊重 Retry-After、重试以可见事件呈现而非中断流）；过载连击触发**显式** fallback 模型整请求重做——清空本轮、给已 yield 的 tool_use 补发缺失结果、剥离思考签名、发一条 warning 系统消息；流式中途失败可降级非流式重试，已 yield 的孤儿消息用 tombstone 事件从 UI/历史移除；上下文超限走「扣留错误→先排水折叠→再全量摘要→失败才放行」恢复链；输出超限先升档一次再注入最多 3 次「继续」恢复消息；直接抛错兜底补发缺失 tool_result + 合成错误消息（withRetry.ts；claude.ts:2501-2730；query.ts:719-748,1093-1260）。
- SDK/无头层终止额外有 max_turns、max_budget、结构化输出重试超限、执行期错误诊断前缀（QueryEngine.ts:1013-1198）。

## 2. 中断与取消

- 按键绑定：Escape=取消当前任务；Ctrl+C=中断（空闲时双按退出，第一下提示）。特殊输入模式/vim INSERT 时 Escape 让位（defaultBindings.ts:40,66；useCancelRequest.ts:63-276；useExitOnCtrlCD.ts:45-80）。
- AbortController 树：每回合一个根 controller → 流式执行器建 sibling 子 controller → 每工具再建 per-tool 子 controller；per-tool 被非 sibling 原因 abort 时**向上冒泡**终止回合（修复过「权限拒绝后该终止却没终止」回归）（StreamingToolExecutor.ts:44-61,301-318）。
- 子进程终止：abort 监听 → 杀整棵进程树（detach 进程组 + tree-kill SIGKILL）；例外——reason==='interrupt'（提交式打断）时不杀，转后台让模型仍能看到部分输出。当前旧仓**没有任何工具实现 interruptBehavior**，默认 'block'，故提交打断实践中不强杀前台工具（ShellCommand.ts:199-359；BashTool.tsx:684）。
- **半截输出落史规则（关键行为规格）**：部分 assistant 文本**保留**在历史；未完成 tool_use **不丢弃**，一律补齐配 is_error 合成 tool_result；中断本身以一条 user 文本消息标记——但 reason==='interrupt'（后续有排队用户消息自带上下文）时**跳过**标记消息；API 提交前再经「孤儿 tool_result 剥离、去重 tool_use id、缺失占位」规范化保证历史合法（query.ts:1023-1060；messages.ts:213-246,5275+）。
- UI 取消分派优先级：有活动请求 → 清审批队列 + abort；空闲但有排队命令 → 把可编辑排队项**回灌输入框**；否则兜底取消。取消后立刻置空 controller 防 stale signal 令后续 Escape 失效（REPL.tsx:2105-2183）。
- auto-restore：纯用户取消且新回合未起、输入框与队列皆空、末条用户消息后全是合成消息时，**回滚会话并把用户原始输入还原回输入框**，同时删除对应历史条目（REPL.tsx:2995-3021）。
- 进程被杀后的恢复语义（属 SP005，仅登记）：载入时过滤未解决 tool_use/孤儿 thinking；末条是 user 时插入「未请求响应」哨兵；检测 mid-turn 中断可自动重排队 prompt 续跑，桌面预热显式关闭自动续跑（conversationRecovery.ts:155-253；print.ts:1173-1190）。

## 3. 执行中排队输入（已实现：排队，非即时打断）

- 执行中输入不被拒：提交时若回合活跃——仅接受普通 prompt/bash 模式（其他丢弃）；若「全部执行中工具都是 cancel 型」先以 reason='interrupt' 打断本回合；然后入**优先级命令队列**（now>next>later；用户输入默认 next，任务通知默认 later），清空输入框（handlePromptSubmit.ts:313-350；messageQueueManager.ts:53-135）。
- 并发安全：三态守卫 idle/dispatching/running，reserve 在输入处理前同步占位，杜绝并行第二回合（QueryGuard.ts:29-121）。
- **注入边界 A（回合内）**：当前迭代工具结果全部回填后、下一次模型调用前，取队列快照注入为 queued_command 附件消息（slash 命令排除，必须等回合结束）；主线程只 drain 用户命令，子代理只见发给自己的通知；注释说明必须等 tool_result 之后注入，否则 user 消息与 tool_result 交错会被 API 拒绝（query.ts:1543-1651）。
- **注入边界 B（回合间）**：守卫空闲时批处理队列——slash/bash 逐条执行，普通 prompt 批量各成独立 user 消息起新回合（useQueueProcessor.ts:28-68；queueProcessor.ts:52-96）。
- 'now' 优先级即时打断：高优先级命令到达直接 abort('interrupt')，与提交打断共用 reason（跳过中断标记）（REPL.tsx:4099-4103）。
- 排队可见性：输入框下方预览队列项；空闲/取消时 Escape 把可编辑项合并回输入框（含图片还原）；系统通知项不可 pop；双按 kill 路径清空队列（messageQueueManager.ts:428-484）。

## 4. 流式渲染管线

- 事件分流：stream 事件 → 增量状态。text_delta 累计进 streamingText；tool_use 的 input_json_delta 累加进对应卡片，**参数未流完就用原始前缀渲染卡片**；thinking 默认不显示内容只计长度；最终 assistant 消息到达时同批清空 streamingText，列表从 deferred 原子切到正式消息，避免重复/间隙（messages.ts:3047-3212；REPL.tsx:1457-1472）。
- 节流与揭示：set 每 delta 一次，渲染层 ~16ms 节流合并；显示**截到最后一个换行**——按行揭示而非按字符；低动效偏好或有粘贴 bug 的终端整体关闭流式预览（REPL.tsx:1457-1472）。
- 思考块：默认折叠为一行「∴ Thinking（ctrl+o 展开）」，transcript/verbose 才渲染全文（AssistantThinkingMessage.tsx:39-70）。
- 工具卡片契约在工具接口上：渲染参数（接受 Partial 输入）/进度/结果/拒绝/错误/分组渲染/结果截断门控展开/「读与搜」类自动折叠；列表级组合管线把同类调用合并成组、折叠 hook 摘要与后台通知；运行中状态由 inProgressToolUseIDs + progress 消息驱动；spinner 文案取工具的活动描述（Tool.ts:599-694；Messages.tsx:518-520）。
- 滚动/resize：全屏模式备用屏 + 虚拟滚动（只挂视口行，防全量挂载重排）；非全屏走终端原生 scrollback + 渲染条数上限；sticky 自动贴底，用户上滚解除贴底并显示「新消息」计数；弹层出现/消失重贴底防闪烁；resize 使转录搜索命中缓存作废；SIGSTOP/SIGCONT 恢复整树重挂（REPL.tsx:4246-4489,4117-4138）。
- 审批卡状态管理：队列仅渲染队首；**用户正在打字时弹层被抑制，停止输入后重现**；决策清理链 = onDone 弹队首 + 按 id 移除（供 hook/分类器/远端等非 UI 竞态方）+ **claim 原子 check-and-mark 保证多竞态方恰好一方 resolve**；自动批准的「✓」驻留 3s（失焦 1s）定时器移除并注册 abort 监听兜底移除——注释明说级联 abort 时必须丢弃装饰层否则挡住下一排队项；Esc 可提前 dismiss；取消时同步清空审批队列（REPL.tsx:2023-2067,4518；interactiveHandler.ts:57-531；PermissionContext.ts:337-379）。
- 「选择后残留」类问题：旧仓 TUI 无同名提交；等效正确性由 claim/resolve-once + 弹队首 + ✓ 驻留定时器 + abort 兜底 + 取消清队列成套保证。

## 5. 会话事件模型（跨进程契约，供本仓事件契约定形参考）

- 拓扑：服务端 spawn CLI 子进程（--print --input-format stream-json --output-format stream-json --include-partial-messages --replay-user-messages），通道二选一：SDK WebSocket（token 鉴权、环形缓存出站、断线宽限 + runtime_snapshot 重连补发）或 stdio JSONL（conversationService.ts:174-214,688-797）。
- CLI→服务消息族：system:init（model/slash_commands/cwd）、assistant/user/progress/attachment/tombstone、stream_event（原样流事件）、**result 终态**（subtype success|error_max_turns|error_max_budget|…；含 is_error/duration/num_turns/result/stop_reason/usage/cost/permission_denials/errors）、错误以合成 assistant 消息携带业务错误码、system 子类型（api_retry/streaming_fallback/status/compact_boundary/task_*/session_state_changed/hook_*）、control_request can_use_tool（审批上行）。
- 服务→CLI：user 消息、control_request interrupt / set_permission_mode / set_max_thinking_tokens / 通用 RPC（带超时）、control_response allow（可携带 updatedInput/updatedPermissions）| deny(message)。
- 服务→客户端事件清单：connected、runtime_snapshot（state/activeTurnId/pendingPermissions/lastEvents 环形回放/replayTruncated）、content_start(text|tool_use)/content_delta(text|toolInput)/thinking/tool_use_complete/tool_result/user_message_replay、**message_complete{usage, completion:{outcome success|error|cancelled|length|unknown, stopReason, errorCode}}（终态）**、permission_request⇄permission_response、stop_generation（→ 标 cancelled → interrupt → status Stopping → message_complete outcome:'cancelled'；与并发 result 竞态用停止请求集合裁决）、status{state idle|thinking|compacting|tool_executing|streaming|permission_pending}、permission_mode_changed、api_retry、streaming_fallback、error{code,retryable,businessErrorCode}、system_notification*、pong（ws/events.ts:66-113；sessionApplication.ts:1021-1053,1523-2018）。
- 翻译规则要点：流式优先——收过 stream_event 的 text/thinking 在最终消息时**不再重发**，只补发流式期未解析完的 tool_use（延迟到完整 input 到达）；assistant 错误与 result 错误去重；stop_reason 映射 completion outcome。

## 6. 「未实现/未发现」清单（不要当作旧仓能力继承）

- 无「拒绝输入」式排队策略；执行中输入一律可排队。
- 没有任何工具实现 interruptBehavior（'block' 为默认）；「提交即打断」仅在 'now' 优先级与 interrupt reason 传播中生效。
- CLI TUI 层无以「选择后残留」命名的修复；防残留靠成套竞态守卫（见 §4）。
