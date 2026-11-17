# 参考仓行为事实盘点沉淀（budingWorkerSpace）

来源：SP001–SP003 多轮只读侦察与排查（2026-11-16 ~ 2026-11-17），汇总自 [旧仓机制盘点](../../../SP/SP002/attachments/old-repo-mechanism-inventory.md)、[剩余 SP 参考复刻排查](../../../docs/reference-tui-replication-audit.md)、[独立实现边界](../../../docs/independent-development.md)。

**使用限制**：仅用于本仓设计参考；任何交付制品（代码、注释、README、npm 包）不得引用或复制此处路径与内容。实现按「读机制、不抄代码」独立编写，行为锚点用 `CAP-*` ID 表述。

## 1. Agent 主循环回合结构

- async generator 状态机：`while(true)`，跨迭代状态集中于单一 State 对象（messages / toolUseContext / compact 跟踪 / 恢复计数 / turnCount / transition）。
- 迭代内固定顺序：①消息组装管线（截到最近 compact 边界 → 工具结果总量预算 → 压缩/投影 → 自动摘要 → 系统/用户上下文注入）→ ②超限硬阻断预检 → ③调模型并流式消费 → ④工具分派（流式期间即可提前启动并发安全工具）→ ⑤结果回填 + 排队命令/附件注入 → 下一迭代。
- **tool_use 块的存在是循环续跑的唯一信号**（stop_reason 不可靠）。
- 多工具并行：连续 `isConcurrencySafe` 工具并为并发批（上限 10），不安全工具单独串行；Bash 错误杀同批兄弟，其他工具失败不牵连。
- 循环终止原因枚举：completed / aborted_streaming / aborted_tools / blocking_limit / prompt_too_long / image_error / model_error / max_turns / stop_hook_*。
- 错误重试：限流指数退避（默认上限 10、尊重 Retry-After）；过载连击触发显式 fallback 模型整请求重做；流式中途失败可降级非流式重试；上下文超限走「扣留错误→排水折叠→全量摘要→失败才放行」恢复链；输出超限先升档一次再注入最多 3 次「继续」恢复消息。

## 2. 中断与取消

- Escape=取消当前任务；Ctrl+C=中断（空闲时双按退出）。
- AbortController 树：每回合根 controller → 流式执行器 sibling 子 controller → 每工具 per-tool 子 controller；per-tool 被非 sibling 原因 abort 时向上冒泡终止回合。
- 子进程终止：abort → 杀整棵进程树；reason==='interrupt' 时不杀，转后台让模型仍能看到部分输出。
- **半截输出落史规则**：部分 assistant 文本保留在历史；未完成 tool_use 不丢弃，补齐 is_error 合成 tool_result；中断以 user 文本消息标记（reason==='interrupt' 时跳过标记消息）；API 提交前经「孤儿 tool_result 剥离、去重 tool_use id、缺失占位」规范化。
- UI 取消分派优先级：有活动请求 → 清审批队列 + abort；空闲但有排队命令 → 回灌输入框；否则兜底取消。
- auto-restore：纯用户取消且新回合未起、输入框与队列皆空、末条用户消息后全是合成消息时，回滚会话并把用户原始输入还原回输入框。

## 3. 执行中排队输入

- 执行中输入不被拒：提交时若回合活跃——仅接受普通 prompt/bash 模式；若全部执行中工具都是 cancel 型先以 reason='interrupt' 打断；然后入优先级命令队列（now>next>later）。
- 并发安全：三态守卫 idle/dispatching/running，reserve 同步占位杜绝并行第二回合。
- **注入边界 A（回合内）**：当前迭代工具结果全部回填后、下一次模型调用前，取队列快照注入为 queued_command 附件消息（slash 命令排除，必须等回合结束）。
- **注入边界 B（回合间）**：守卫空闲时批处理队列——slash/bash 逐条执行，普通 prompt 批量各成独立 user 消息起新回合。
- 'now' 优先级即时打断：高优先级命令到达直接 abort('interrupt')。

## 4. 流式渲染管线

- 事件分流：text_delta 累计进 streamingText；tool_use 的 input_json_delta 累加进对应卡片，参数未流完就用原始前缀渲染卡片；thinking 默认不显示内容只计长度；最终 assistant 消息到达时同批清空 streamingText，列表从 deferred 原子切到正式消息。
- 节流与揭示：set 每 delta 一次，渲染层 ~16ms 节流合并；显示截到最后一个换行——按行揭示而非按字符。
- 思考块：默认折叠为一行「∴ Thinking（ctrl+o 展开）」，transcript/verbose 才渲染全文。
- 工具卡片契约：渲染参数（接受 Partial 输入）/进度/结果/拒绝/错误/分组渲染/结果截断门控展开/「读与搜」类自动折叠。
- 滚动/resize：全屏模式备用屏 + 虚拟滚动；非全屏走终端原生 scrollback + 渲染条数上限；sticky 自动贴底，用户上滚解除贴底并显示「新消息」计数。
- 审批卡状态管理：队列仅渲染队首；用户正在打字时弹层被抑制，停止输入后重现；claim 原子 check-and-mark 保证多竞态方恰好一方 resolve；自动批准的「✓」驻留 3s 定时器移除并注册 abort 监听兜底移除。

## 5. 输入编辑与键位

- readline 键族（ctrl+a/e/k/u/w/y、meta+b/f/d、跳词）+ kill-ring 累积/yank-pop。
- shift/meta+Enter 换行；历史按模式过滤（prompt/bash，`!` 前缀）、多行时方向键先移行、ctrl+r 增量搜索。
- undo 防抖快照（ctrl+_ 与 kitty ctrl+shift+- 双绑定）。
- bracketed paste（DEC 2004），>10000 字符截断为首尾各 500 + 占位符，全文按 id 存 pastedContents。
- 图片粘贴（Win alt+v / 其他 ctrl+v，剪贴板/临时截图回退）。
- 外部编辑器 ctrl+g / ctrl+x ctrl+e（$VISUAL/$EDITOR，+N 跳行，ENOENT 容错）。
- ctrl+s stash 输入；shift+tab 循环权限模式（Win 无 VT 降级 meta+m）；ghost text 补全预览。
- Vim：仅 INSERT/NORMAL 两模式；11 态命令状态机；motion h l j k w b e W B E 0 ^ $ f/F/t/T g/gg；operator d/c/y + 文本对象 i/a；count≤10000；dot-repeat。
- 键位：18 个上下文块 + Scroll；约 90 个 action；`keybindings.json` 表面＝`bindings[]`{context, bindings: 键→action | `command:<slash>` | null 解绑}，支持 chord。

## 6. 斜杠命令面

- 三型契约：`local`（内联文本结果）/ `local-jsx`（REPL 模态槽对话框/面板）/ `prompt`（展开为模型提示，带 progressMessage）；另有 immediate 标记（不进模型回合）。注册表驱动。
- 核心会话 24 命令：clear/compact/resume/rewind/exit/help/model/config/permissions/memory/init/add-dir/context/files/diff/cost/status/plan/tasks/export/copy/rename/branch/goal。
- 状态诊断：/context（彩色网格占用可视化）、/files、/diff（未提交+逐轮 diff 对话框）、/status、/stats、/cost、/doctor。
- 模型推理：/model（ModelPicker）、/effort、/fast、/advisor。
- 设置输入外观：/config（分页面板）、/permissions（分页 recent/allow/ask/deny/workspace）、/hooks、/theme、/vim、/terminal-setup。
- 记忆初始化：/memory、/init。
- 扩展 MCP：/agents、/skills、/plugin、/mcp。
- Git 审查：/commit、/review、/security-review、/pr-comments。

## 7. 工具·权限·Hook

- 权限模式：参考仓 7 模式（default/acceptEdits/plan/dontAsk/bypassPermissions/auto/fullAuto）；**新仓目标固定三模式**（仅可查看/工作区内修改/完全权限，用户 2026-11-17 r6）。
- 审批弹窗：文件类三档 accept-once/accept-session/reject；cwd 外按目录名限定会话记忆；bash 选项含可编辑前缀规则（`npm run:*`）；Yes/No 可展开反馈输入。
- 规则语法：`ToolName` 或 `ToolName(content)`；bash＝精确+前缀 `cmd:*`+通配；路径＝gitignore 风格。
- Hooks：27 个可持久化事件 + 不可持久化 function hook；处理器 4 类：command/prompt/agent/http；输出契约：continue/suppressOutput/stopReason/decision approve|block/reason/systemMessage/hookSpecificOutput；PreToolUse 专属 permissionDecision allow|deny|ask + updatedInput + additionalContext；exit 2＝blocking error。

## 8. 会话事件模型（跨进程契约）

- CLI→服务消息族：system:init、assistant/user/progress/attachment/tombstone、stream_event、result 终态（subtype success|error_max_turns|…）、control_request can_use_tool。
- 服务→CLI：user 消息、control_request interrupt/set_permission_mode/set_max_thinking_tokens/通用 RPC、control_response allow|deny。
- 服务→客户端事件清单：connected、runtime_snapshot、content_start/content_delta/thinking/tool_use_complete/tool_result/user_message_replay、message_complete{usage, completion:{outcome, stopReason, errorCode}}（终态）、permission_request⇄permission_response、stop_generation、status{state}、permission_mode_changed、api_retry、streaming_fallback、error、system_notification*、pong。
- 翻译规则：收过 stream_event 的 text/thinking 在最终消息时不再重发，只补发流式期未解析完的 tool_use。

## 9. 渲染难点与独立实现策略

| 参考仓能力 | 独立实现策略 |
|---|---|
| 自研渲染管线（reconciler+NAPI Yoga+log-update 差分+冻结缓存） | 上游 Ink + 自有帧缓冲扩展，接受性能差异 |
| IME 物理光标/kitty 协议/鼠标选区 | 自补 stdin 解析层或明确降级 |
| diff NAPI 着色 | JS 高亮 + Fallback |
| vim/kill-ring 键位耦合与平台可达性矩阵 | 纯逻辑独立重写 + 逐平台验证 |
| 折叠/虚拟化/transcript 三态一致性 | 先定单一渲染模式 |
| 权限弹窗交互态机 | 自写，语义以行为清单为对照测试依据 |
| 规则解析器语义等价 | 自写，别名归一、危险包装、glob 注入防护 |
| hook 输出对循环的六种影响路径 | 自写，语义以行为清单为对照测试依据 |

## 10. 规模事实

- 参考仓 `src/` 2,360 文件 / 602,826 行；TUI 可交互层约 871 文件 / 16.6 万行。
- 命令 92 目录 + 20 散文件；组件 423 文件；键位 20 个上下文块；Vim 模块。
- 工具 58 工具目录；权限 7 模式；Hook 28 事件 × 4 处理器。
- 持久化 JSONL + 11 项迁移；无头输出 text/json/stream-json。

## 11. 「未实现/未发现」清单（不要当作旧仓能力继承）

- 无「拒绝输入」式排队策略；执行中输入一律可排队。
- 没有任何工具实现 interruptBehavior（'block' 为默认）；「提交即打断」仅在 'now' 优先级与 interrupt reason 传播中生效。
- CLI TUI 层无以「选择后残留」命名的修复；防残留靠成套竞态守卫。

## 12. 已采纳的有意偏离

| 参考仓行为 | 新仓决定 | 理由 |
|---|---|---|
| 7 档权限模式 | 固定三档（仅可查看/工作区内修改/完全权限） | 用户 2026-11-17 r6 明确固定 |
| 远程/IM/多端 | 暂缓 DEFERRED | 用户 2026-11-17 r6 TUI 单端优先 |
| 计费/订阅业务 | 不复刻 | 自有产品无订阅业务 |
| 云审查 /ultrareview | 范围外 | 自有产品定位不同 |
| 趣味/内部/stub 命令 | 不复刻 | 非用户可见核心能力 |
| 效果基线对照 | O5=B 静态盘点 | 不运行原 Agent，效果口径为自有测量 + 覆盖度 |
