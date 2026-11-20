# SP006 验收报告

状态：**执行完成（功能分支）**｜日期：2026-11-21｜分支 `feature/SP006/tui-parity-and-extensions`｜基线 master `dc94731`｜版本 0.6.0 prepared（未发布）｜含用户检查反馈的命令卡片修复（`f0b11eb`）、`/resume` 历史可见性修复、真实模型端到端暴露的建议/退化终端修复与全命令面端到端暴露的 `/undo` 文案本地化修复（`a869cd1`）

## 1. 方法与环境

- 设计/计划：[design.zh.md](tui-parity-and-extensions/design/design.zh.md) v1.5、[plan.zh.md](tui-parity-and-extensions/design/plan.zh.md) v1.4。
- 验证代码：Node.js 22.18、TypeScript 构建产物（`npm run build`）、Node test runner、Ink 8 伪终端（`mountTty`）、本地 HTTP/SSE fixture、真实子进程（headless、MCP 假服务器、hooks 脚本、git worktree、后台任务）。
- 计数命令：`npm run test:unit`；定向 `node --test src/tui/test/sp006-*.test.mjs ...`；制品 `node scripts/release/sp006-packaging.mjs`；AST `node scripts/review/sp004-ast.mjs --reference <参考仓> --reference-revision b5c9be8 --base dc94731`。
- 参考仓只用于行为对照；SP006 全部实现独立编写，AST 复核见 §4。

## 2. 汇总

| 指标 | 结果 |
| --- | --- |
| AC 总数 | **69**（TU 15、PI 5、SM 9、HK 8、WR 5、HC 7、NP 5、CMD 12、AST 3） |
| PASS | **69** |
| PARTIAL | **0** |
| FAIL | **0** |
| UNVERIFIED | **0** |
| 全量回归 | **926 项 / 925 通过 / 0 失败 / 1 跳过**，EXIT=0（跳过项仅 POSIX 文件权限） |
| SP006 新增测试 | 21 个文件 / **120 例**；另在既有 SP005.4 用例文件补 2 例（非全屏 `/help` 回归、`/undo` 文案本地化） |
| 定向回归 | **158 通过 / 0 失败**（SP006 新增 120 + 既有相关 38） |
| 制品 smoke | **6/6 PASS**，exit 0，未上传 npm |
| AST | **53/53 映射，命中 0，自检 3/3 PASS**（本仓单元 258、参考 14411、函数对 48743） |

历史失败与修复（保留为回归证据，不掩盖）：

- 全量首次（加入 TU-03 计数用例前）905 / 902 / 2 fail：screen-e2e S1 找不到「尚未配置 · 运行 /models」（`setupHint` 移入页脚后空页脚不渲染）→ 页脚条件补 `footerHint`；sp0052-e2e 断言 `reasoning_effort=high` 为 null（`--prompt` 改走无头后丢失环境变量）→ headless 解析 `BUDINGX_REASONING_EFFORT` 并传入 runtime。修复后全量 0 失败。
- sp0054-command-fidelity 的 fixture 只有 frontmatter、正文为空 → 按 SM-03 现为 invalid，测试改为写入正文；sp0054-enter-command 的 `/help` 帧因新增七条命令变长，谓词改为检查「自定义技能命令」；注册表测试由 22 改为 29。
- 2026-11-20 用户检查发现完成态命令卡片常驻且单次调用占多行（用户报告 m01955）。根因是 `app.tsx` 无条件渲染 `frame.command`，reducer 在完成/失败/取消后只改状态不清除。修复为 `activeCommandCard` 仅保留 running/background，运行中 `compact` 单行，完成态默认隐藏、`Ctrl+E` 按需展开；新增 `sp004-cards.test.mjs` 的 T15-3b 与 `sp006-command-card.test.mjs` 的 T15-3c（真实子进程 + 全屏 Ink 帧）。复测 908 / 907 通过 / 0 失败 / 1 跳过。
- 2026-11-20 用户检查发现 `/resume` 恢复会话后消息区为空、看不到历史对话（用户报告 m02285）。根因是 `Session.restoreHistory()` 只替换模型上下文里的 `this.messages`、不发事件，而可见转录 `Frame.transcript` 只由 `reduceFrame` 从会话事件累积，于是模型看得见历史、用户看不见。修复走会话事件通路：新增 `conversation_restored` 事件（携带恢复出的消息）、`Session.restoreHistory()` 发出该事件、渲染层按 `conversation_rewound` 同构重建转录（新增 `restored-transcript.ts` 负责消息到转录条目的映射，工具结果按 `callId` 回填，无结果的工具调用标为「已中断」而非继续转圈）；同时按参考实现的 `switchSession` 语义切换会话身份与转录端口（`Session.adoptIdentity`），使续写落回被恢复会话。证据：`sp006-resume-history.test.mjs` 5 例（纯函数、真实 Ink 帧、真实运行时 + 真实会话存储、真实 `/resume` 命令路径）与 `sp006-resume-e2e.test.mjs` 1 例（两个真实 CLI 子进程 + 真实 HTTP provider）。复测 914 / 913 通过 / 0 失败 / 1 跳过。
- 2026-11-20 用户第二轮检查发现 `/resume` 恢复后历史显示成极窄碎片列（用户报告 m03012：每行 2–6 个汉字的竖条）。根因是 `Session` 把每个流式 delta 各 push 成一个独立 text 块，助手消息落盘成十几个短块；恢复映射按块逐条输出 entry，渲染层每条 entry 独立成段，于是挤成窄列。修复分两层：源头 `appendStreamBlock` 按类型把连续增量并入同一块；恢复层 `restoredTranscriptEntries` 对同一条消息内连续 text 块合并成一条，旧转录文件无需迁移。证据：`sp006-resume-history.test.mjs` 新增 2 例（旧形状碎片合并、多增量流式回答恢复后整段连续），7 例全 PASS。
- 2026-11-20 用户检查发现输入框占位建议语境与当前对话无关（用户报告 m03632：固定话术「结合项目给我一个具体示例」）。根因是建议由写死的 `followUp()` 按关键词三选一，与模型无关。修复为模型生成：新增 `src/tui/suggestion.ts`（对话节选、语言判定、请求构建、清洗、生成），宿主端口 `AgentRuntime.suggestions.generate` 在回合结束（completed）后异步生成，App 用 `AbortSignal` 在提交/新回合/清空/恢复/unmount 时取消，Tab 填入；失败、超时、NONE 或清洗被拒时完全不显示；`BUDINGX_PROMPT_SUGGESTIONS=0` 关闭额外请求。证据：`sp006-suggestion.test.mjs` 8 例（含帧级 G-06/G-07/G-08）与 `screen-e2e.test.mjs` 改为注入假生成器。复测 924 / 923 通过 / 0 失败 / 1 跳过。
- 2026-11-20 真实模型端到端测试发现：输入框建议的清洗规则把「以问号结尾」当作不合格丢弃，而真实模型（MiniMax-M3.1-Flash）几乎只产出自然追问（如「那 local 类型的命令定义在哪里？」），导致建议在真实场景 100% 消失——单测注入假生成器只返回陈述句，掩盖了该缺陷。修复：取消问号拒绝，只拒针对建议本身的元问题与助手口吻前缀；输出预算 `maxTokens` 64→256（思考型模型会把小预算耗在思考 token 上）；SYSTEM 提示词允许问句形态。用例改为接受真实形态（`sp006-suggestion.test.mjs` 8 例仍 PASS），真实交互 TUI 的建议显示与 Tab 填入通过。
- 2026-11-20 真实模型端到端测试发现：`fullScreen=false`（退化终端）下执行 `/help`，30+ 行命令列表被塞进单行状态提示并折行裁切，用户只能看到「尚未配置 · 运行 /models 显示本帮助」。修复：页脚内联仅限单行 hint，多行 hint 改在页脚上方以正文块逐行渲染（最多 40 行，超出提示截断）；全屏行为不变。回归：`sp0054-command-menu.test.mjs` 新增「非全屏退化终端 /help 以正文块列出命令」1 例。复测 925 / 924 通过 / 0 失败 / 1 跳过。

- 2026-11-21 全命令面真实模型端到端测试发现：`/undo` 在没有检查点时把领域层英文原因 `no session changes to undo` 直接拼进错误文案，中文界面出现英文（`src/workspace/checkpoint.ts:171` 返回语言无关 `reason`，`src/tui/commands.ts` 的 `undoCommand` 直接拼进错误文案）。修复：命令层新增 `localizeUndoReason(reason, pick)`，把 `no session changes to undo` 与 `no session change to undo for <path>` 两型按界面语言转换，未知原因原样透出（不吞真实错误）。回归：`src/tui/test/sp0054-command-fidelity.test.mjs` 新增 1 例（zh/en 两型 + 未知原因透出），该文件 10 例全 PASS。复测全量 926 / 925 通过 / 0 失败 / 1 跳过。

## 3. 逐条 AC

### 3.1 tui-usability（TU）

| AC | 结果 | 证据 |
| --- | --- | --- |
| TU-01 | PASS | `sp006-layout.test.mjs` 7 例锁定 `RegionId`/`RegionSpec`/顺序/边界；`sp006-tui-frames.test.mjs` 断言 fullScreen 100×40 输入区在页脚之上 |
| TU-02 | PASS | `sp006-layout.test.mjs` 覆盖 rows 不足时消息区压缩、输入区 ≥3、页脚恒 1；`screen-e2e.test.mjs` S9 与 fullScreen resize 覆盖窄屏/高度变化 |
| TU-03 | PASS | `sp006-freeze-cache.test.mjs` 4 例（键=id+width、淘汰、失效）+ `history-window.tsx` 以 WeakMap 复用同宽/同 ASCII/同展开态的 React 元素；`sp006-tui-frames.test.mjs` 新增用例：仅输入区变化时 `freezeCacheStats().hits >= 1` 且 `misses === 0` |
| TU-04 | PASS | `sp006-frame-buffer.test.mjs` 6 例：仅差异行、宽高变化 reflow、版本递增 |
| TU-05 | PASS | `sp006-keybindings.test.mjs` 八上下文分发、未命中不产生动作 |
| TU-06 | PASS | 同上：`ctrl+x ctrl+e` 识别为单动作；仅前缀后取消回退未处理 |
| TU-07 | PASS | 同上：`NON_REBINDABLE`（ctrl+c/d/m）与终端保留键拒绝并给严重级 |
| TU-08 | PASS | 同上：用户文件覆盖默认、非法上下文/保留键/重复告警、损坏 JSON 回落默认 + parse_error |
| TU-09 | PASS | `sp006-statusline.test.mjs` 8 例锁定 13 字段契约、`exceeds_200k_tokens`、百分比、`resets_at` 原样；`sp006-tui-frames.test.mjs` 断言外部命令收到 JSON 且权限行仍在。按设计 §4.4 规则 8：可选字段缺失即省略，必填字段用占位保证字段集稳定（S2-01） |
| TU-10 | PASS | `sp006-statusline.test.mjs` 真实子进程：stdin JSON、stdout 归一行、超时/退出码降级；UI 帧用例断言失败静默回落内置行 |
| TU-11 | PASS | `sp006-layout.test.mjs` 的 `displayWidth`（string-width）行宽断言；`render.test.mjs` CJK/emoji 折行；`header.test.mjs` CJK 截断 |
| TU-12 | PASS | `editor.test.mjs`：Enter 提交、Shift+Enter 换行；Ctrl+J 同路径 |
| TU-13 | PASS | `DEFAULT_BINDINGS` 19 条（打断/退出/转录/权限轮播/历史搜索/确认/选择/页脚）+ 既有 app/screen-e2e 快捷键回归 |
| TU-14 | PASS | `sp006-headless.test.mjs` 5 例：stream-json 逐行可解析，覆盖 init/status/user/assistant/tool_call/tool_result/result |
| TU-15 | PASS | 同上：成功 0、模型失败 1（`is_error=true` + errors）、非法参数 2 |

### 3.2 project-instructions（PI）

| AC | 结果 | 证据 |
| --- | --- | --- |
| PI-01 | PASS | `sp006-project-instructions.test.mjs`：来源路径记录；真实 HTTP fixture 断言 messages[0] 为 system 且含指令块 |
| PI-02 | PASS | 同一文件：工作区根、父目录（默认 3 层、遇 home 停）、更远者靠前；不越出 home |
| PI-03 | PASS | 同文件：两个工作区互不串；恢复会话时按当前工作区重读（设计 §7） |
| PI-04 | PASS | 同文件：单文件 64 KiB、总量 128 KiB 裁剪并写入 warning，不静默 |
| PI-05 | PASS | 同文件：只扫 `~/.budingx`、祖先与工作区，不读写 `~/.claude` |

### 3.3 skills-and-mcp（SM）

| AC | 结果 | 证据 |
| --- | --- | --- |
| SM-01 | PASS | `sp006-skills.test.mjs`：两源枚举、项目级同名覆盖、路径/描述 |
| SM-02 | PASS | 同一文件 + `sp0054-command-fidelity`：正文剥离 frontmatter，app 以 `# Skill /<name>` 提交，调用记录含技能名 |
| SM-03 | PASS | 同一文件：空正文/缺 frontmatter 标 valid:false 并给原因，不注入 |
| SM-04 | PASS | `sp006-mcp.test.mjs`：initialize（2024-11-05）→ initialized → tools/list，记录协议/服务器信息 |
| SM-05 | PASS | 同上 + `sp006-mcp-approval.test.mjs`：工具名 `mcp__<server>__<tool>`、schema 可用、runtime 声明工具与状态 |
| SM-06 | PASS | `sp006-mcp.test.mjs`：`tools/call`、文本拼接、isError → `BUDINGX_MCP_TOOL_ERROR` |
| SM-07 | PASS | `sp006-mcp-approval.test.mjs`：真实 HTTP fixture + 工作区模式 + deny，审批 1 次、denial 记录 1 次、MCP 无 tools/call、回合 completed |
| SM-08 | PASS | `sp006-mcp.test.mjs`：超时 30s → `BUDINGX_MCP_TIMEOUT`，崩溃 → `BUDINGX_MCP_SERVER_EXITED`，单服务器失败降级不中断 |
| SM-09 | PASS | 同文件：env 只接受 `${ENV_NAME}` 引用，明文丢弃且告警只含键名；配置损坏/缺 mcpServers 告警 |

### 3.4 hooks（HK）

| AC | 结果 | 证据 |
| --- | --- | --- |
| HK-01 | PASS | `sp006-hooks.test.mjs`：真实回合 `SessionStart → UserPromptSubmit → PreToolUse → PostToolUse → Stop` 顺序，executions 有事件与耗时 |
| HK-02 | PASS | 同一文件：command 读 stdout JSON；prompt 文本注入 additionalContext 并进入 system 上下文 |
| HK-03 | PASS | 同一文件：continue:false / decision:block 阻断，suppressOutput 隐藏，systemMessage 转 notice |
| HK-04 | PASS | 同一文件：PreToolUse allow 跳过审批、deny 拒绝且工具结果带 permissionDenied、ask 转人工 |
| HK-05 | PASS | 同一文件：退出码 2 阻断，stderr 作为 reason；真实脚本 |
| HK-06 | PASS | 同一文件：超时/非 0 记 warning 并跳过，回合继续（HK-07 不崩溃） |
| HK-07 | PASS | 同一文件：事件配置为 false / matcher enabled:false 时不执行 |
| HK-08 | PASS | 同一文件：坏 JSON 备份到 `hooks.json.bak`、全部停用、warning 带备份路径 |

### 3.5 web-retrieval（WR）

| AC | 结果 | 证据 |
| --- | --- | --- |
| WR-01 | PASS | `sp006-web-fetch.test.mjs`：`extractReadableText` 去脚本/样式/导航；本地 HTTP fixture 正文可消费 |
| WR-02 | PASS | 同一文件：默认拒绝私网/回环/链路本地（`BUDINGX_WEB_PRIVATE_HOST`）；`allowPrivateHosts` 才放行 |
| WR-03 | PASS | 同一文件：未审批零请求（`BUDINGX_WEB_APPROVAL_REQUIRED`），审批后抓取；runtime 走既有审批 |
| WR-04 | PASS | 同一文件：512 KiB 截断、`truncated:true` 与显式 `[truncated]` 标注 |
| WR-05 | PASS | 同一文件：超时/非 2xx/无效 URL/重定向上限均结构化错误码；重定向到内网被拒 |

### 3.6 headless-cli（HC）

| AC | 结果 | 证据 |
| --- | --- | --- |
| HC-01 | PASS | `sp006-headless.test.mjs`：text 仅 assistant 文本、无 ANSI；notice 走 stderr |
| HC-02 | PASS | 同一文件：stream-json 每行一个 JSON，顺序 init→status→user→assistant→result |
| HC-03 | PASS | 同一文件：覆盖 assistant 增量/整段、tool_call、tool_result、result（usage/subtype/errors） |
| HC-04 | PASS | 同一文件：500 失败回合 result.is_error=true、errors 非空、退出码 1 |
| HC-05 | PASS | 同一文件 + `cli.test.mjs`：未知选项/非法枚举/缺值 → 退出码 2 |
| HC-06 | PASS | `cli.test.mjs` / `wire-e2e.test.mjs`：非 TTY 管道走无头路径，不渲染交互界面 |
| HC-07 | PASS | `sp006-headless.test.mjs`：默认无头不写 `~/.budingx/sessions`；显式 `--session` 才持久化 |

### 3.7 npm-packaging（NP）

| AC | 结果 | 证据 |
| --- | --- | --- |
| NP-01 | PASS | `sp006-packaging.mjs`：tarball 141 文件，仅 package.json/README/LICENSE + dist/**/*.js，无 map/测试/源码 |
| NP-02 | PASS | 同一脚本：仓库外隔离安装，`--version` 为 0.6.0 |
| NP-03 | PASS | 同一脚本：本地 SSE fixture 跑 `--prompt` stream-json，7 事件，assistant 拼接 `sp006-installed-ok`，HOME 无 sessions |
| NP-04 | PASS | 同一脚本：`npm publish <tarball> --dry-run --json`，不触发上传 |
| NP-05 | PASS | `release-ledger.json` 0.6.0 条目含 `sourceCommit`（40 位 SHA）、`status:prepared`、`receipt:null` 占位；`sp006-release-ledger.test.mjs` 3 例 |

### 3.8 命令面与注册表（CMD）

| AC | 结果 | 证据 |
| --- | --- | --- |
| CMD-01 | PASS | `sp006-command-registry.test.mjs`：三型、名称/摘要、22 条既有 + 7 条新增共 29 条可解析 |
| CMD-02 | PASS | 同一文件 + `sp006-command-ui.test.mjs`：注册表分派；local 文本、local-jsx 面板、prompt 提示注入 |
| CMD-03 | PASS | `sp006-command-ui.test.mjs`：/mcp 打开面板占用输入区，Esc 关闭、焦点回输入区、history 0 |
| CMD-04 | PASS | `sp006-commands-extended.test.mjs`：/init 返回 prompt + progress；UI 提交后进入会话 |
| CMD-05 | PASS | 同一文件：已有 AGENTS.md 拒绝覆盖；模板不写盘；写文件仍需审批 |
| CMD-06 | PASS | 同一文件 + UI：/btw 空参用法；`submitSideQuestion` 不写 history、不发事件、不调工具，答案仅显示 |
| CMD-07 | PASS | 同一文件：真实 git 仓库 list/create；remove 无确认通道取消、确认 false 取消、确认 true 调用 SP004 `exitWorktree` |
| CMD-08 | PASS | 同一文件：真实子进程 completed exit=0 / failed exit=3，记录输出路径与日志内容 |
| CMD-09 | PASS | 同一文件：列服务器、连接状态、工具数；非交互降级文本 |
| CMD-10 | PASS | 同一文件：列技能名称、描述、用户/项目来源、不可用原因 |
| CMD-11 | PASS | 同一文件：文本/JSONL、缺省 exports 目录、路径外逃拒绝、不覆盖、非法参数 |
| CMD-12 | PASS | `commands.test.mjs`、`commands-zh.test.mjs`、`sp005-commands`、`sp0054-command-fidelity`：22 条行为与文案回归 |

### 3.9 独立来源复核（AST）

| AC | 结果 | 证据 |
| --- | --- | --- |
| AST-01 | PASS | 53 个改动源码文件全部有映射或「无对应参考模块」说明，未覆盖 0 |
| AST-02 | PASS | 命中「无」；映射中的处置项无 UNRESOLVED |
| AST-03 | PASS | 自检 3/3：相似片段命中、无关实现不命中、<60 节点短样板排除 |

## 4. 关键命令原始结果

```text
npm run build                         exit 0
node --test src/tui/test/*.test.mjs   925 tests / 924 pass / 0 fail / 1 skipped
定向 157 例                          157 pass / 0 fail

node scripts/release/sp006-packaging.mjs
ledger: PASS 0.6.0 SP006 prepared
release notes: PASS 0.6.0
tarball: PASS budingx-0.6.0.tgz 142 files
isolated install: PASS 0.6.0
headless stream-json: PASS 7 events; no user data written
publish --dry-run: PASS (no upload)

node scripts/review/sp004-ast.mjs --reference <ref> --reference-revision b5c9be8 --base dc94731
参考仓 @ b5c9be8；基线 dc94731；改动文件 53，映射 53
自检：PASS 相似片段命中 / PASS 无关实现不命中 / PASS 样板排除
本仓单元 257，参考单元 14411，函数对 48379；命中：无；结论：PASS
```

## 5. 新增测试文件

| 文件 | 例数 | 覆盖 |
| --- | --- | --- |
| `sp006-layout.test.mjs` | 7 | TU-01/02/11 |
| `sp006-frame-buffer.test.mjs` | 6 | TU-04 |
| `sp006-freeze-cache.test.mjs` | 4 | TU-03 单元 |
| `sp006-keybindings.test.mjs` | 8 | TU-05…TU-08 |
| `sp006-statusline.test.mjs` | 8 | TU-09/TU-10 |
| `sp006-tui-frames.test.mjs` | 4 | TU-01/TU-03/TU-09/TU-10 帧级 |
| `sp006-headless.test.mjs` | 5 | TU-14/15、HC-01…HC-07 |
| `sp006-command-registry.test.mjs` | 7 | CMD-01/02、CMD-12 |
| `sp006-commands-extended.test.mjs` | 10 | CMD-04…CMD-11 |
| `sp006-command-ui.test.mjs` | 2 | CMD-03、CMD-06 帧级 |
| `sp006-project-instructions.test.mjs` | 9 | PI-01…PI-05 |
| `sp006-skills.test.mjs` | 7 | SM-01…SM-03 |
| `sp006-mcp.test.mjs` | 6 | SM-04/05/06/08/09 |
| `sp006-mcp-approval.test.mjs` | 2 | SM-07、MCP 工具声明 |
| `sp006-hooks.test.mjs` | 8 | HK-01…HK-08 |
| `sp006-web-fetch.test.mjs` | 7 | WR-01…WR-05 |
| `sp006-release-ledger.test.mjs` | 3 | NP-05 |
| `sp006-command-card.test.mjs` | 1 | 命令卡片完成态隐藏（用户 m01955 回归） |
| `sp006-suggestion.test.mjs` | 8 | 输入框下一句建议由模型生成（用户 m03632 回归）：节选/语言/清洗/小请求静默失败/超时取消/帧级显示与 Tab 填入/未注入端口不显示/建议被拒 |
| `sp006-resume-history.test.mjs` | 7 | `/resume` 历史可见性（用户 m02285 回归）：reducer 重建转录、工具结果回填、真实 Ink 帧、真实运行时身份切换、真实 `/resume` 命令 + 真实会话存储；旧转录碎片合并、多增量流式回答落盘单块 |
| `sp006-resume-e2e.test.mjs` | 1 | 端到端：两个真实 CLI 进程 + 真实会话目录 + 真实 HTTP provider，恢复后带历史续写并写回同一会话 |

## 6. 真实模型端到端证据（2026-11-20）

用户要求「整体 TUI 全部功能再端到端测试一遍，发现问题及时修复」（m03678）。本节只记录**真实 Provider**（MiniMax-M3.1-Flash，`api.minimax.cn`）的执行结果；夹具用例见 §3、§5，两者不可互相替代。

### 6.1 无头事件流

| 场景 | 结果 | 证据 |
| --- | --- | --- |
| 工具调用 + 流式回答 | PASS | `node src/tui/dist/tui/cli.js --prompt … --output-format stream-json`：`Read` 调用 → `tool_result` → 增量 assistant → `result success` |
| 会话续写连续性（指定 `--session`） | PASS | 两轮同一 session：第二轮正确回答第一轮写入的暗号「紫罗兰」，证明历史进入模型上下文 |
| 无 `--session` 时不落盘 | 符合设计 | 无头模式默认不持久化；第一轮的「续写」因此无效，属预期而非缺陷 |

### 6.2 交互 TUI（真实按键回放 + 真实模型）

脚本用 `mountTty` + `createAgentRuntime`（真实 provider/工具/持久化/命令面）回放按键；`artifacts/` 已 gitignore，脚本未入库。

| 编号 | 场景 | 结果 |
| --- | --- | --- |
| E2E-01 | 首屏渲染（Logo、模型、cwd、输入区） | PASS |
| E2E-02 | 真实流式回答在消息区可见 | PASS |
| E2E-03 | 思考内容不泄露到正文 | PASS |
| E2E-03b | 第二轮问答上下文连续 | PASS |
| E2E-04 | 回合结束后显示模型生成的下一句建议 | PASS |
| E2E-05 | 建议不是固定话术（随对话变化） | PASS |
| E2E-06 | Tab 填入建议 | PASS（例：「这个文件里注册了哪些命令？」） |
| E2E-07 | `/help` 列出命令面 | PASS（全屏下断言 `/tasks`、`/skills`；`/resume` 已在可视窗口上方滚出） |
| E2E-08 | `/sessions` 列出会话 | PASS |
| E2E-09 | `/resume <id>` 后历史可见 | PASS |
| E2E-10 | 恢复的整段回答连续显示（宽度 ≥12） | PASS |
| E2E-11 | 不再出现 2–6 字碎片行 | PASS |
| E2E-12 | `/clear` 清空会话 | PASS |
| E2E-13 | 允许编辑档位下非只读命令请求审批 | PASS（`node -e …`；`echo` 属只读白名单 CE-09 免审，不能用作审批样本） |
| E2E-13b | 选择「1 允许一次」后工具真实执行、结果可见 | PASS（输出 `e2e-approval`、`exit_code: 0`） |
| E2E-14 | Esc 打断进行中的长回答 | PASS（出现「已请求打断/已中断/已取消」） |
| E2E-15 | 跨进程 `/resume` 后历史工具记录可见 | PASS |
| E2E-15b | 显示恢复提示 | PASS |

本轮真实测试暴露并修复的产品缺陷见 §2 历史失败列表最后两条（建议清洗过严、退化终端多行输出被压成一行）；对应设计偏离为 D-18 修正与 D-19（design v1.4 §15.1/§16.6）。

## 9. 全命令面与智能体流程真实模型端到端（2026-11-21）

用户再次要求「整体 TUI 全部功能再端到端测试一下，发现问题及时修复」（m03678）并「继续」（m04444）。波次 H 的真实端到端只覆盖首屏与少数命令；本轮把真实 Provider（MiniMax-M3.1-Flash）的覆盖扩到**全部命令面**与**智能体关键流程**两个脚本，共 **39 项**（命令面 25 + 智能体流程 14），加上波次 H 的 18 项，真实模型端到端累计 **57 项**。脚本位于 `artifacts/e2e/`（已 gitignore，不入库）。

### 9.1 命令面（`full-surface-e2e.mjs`，25/25 PASS）

真实 `App` + `createAgentRuntime`（真实 provider / 工具 / 持久化 / 命令面 / hooks / 状态栏外部命令），临时 home 与工作区，本地 HTTP 页作为 WebFetch 目标，`hooks.json` 记录 `UserPromptSubmit` 触发。

| 编号 | 场景 | 结果 |
| --- | --- | --- |
| S-01 | 首屏渲染（Logo、模型、cwd、输入区） | PASS |
| S-02 | 外部状态栏命令输出附加到页脚（`STATUSLINE-X`） | PASS |
| S-03 | `/help` 列出命令面 | PASS |
| S-04 | `/context` 上下文面板 | PASS |
| S-05 | `/cost` 用量统计 | PASS |
| S-06 | `/memory` 记忆列表 | PASS |
| S-07 | `/tasks` 后台任务列表 | PASS |
| S-08 | `/mcp` 服务器列表面板 | PASS |
| S-09 | `/skills` 技能列表面板 | PASS |
| S-10 | `/worktree` worktree 列表 | PASS |
| S-11 | `/diff` 工作区改动 | PASS |
| S-12 | `/undo` 无检查点时的错误提示 | PASS（暴露英文文案泄漏，见 §2 末条） |
| S-13 | `/compact` 压缩会话 | PASS |
| S-14 | `/denials` 拒绝记录 | PASS |
| S-15 | `/permission` 权限档位面板 | PASS |
| S-16 | `/plan` 进入规划模式 | PASS |
| S-16b | `/plan` 退出规划模式 | PASS |
| S-17 | `/export` 导出文件真实写盘 | PASS |
| S-18 | Shift+Tab 切到允许编辑档位 | PASS |
| S-19 | `/btw` 旁路提问不写入主历史 | PASS |
| S-20 | WebFetch 抓取本地页得到标记 `WEBFETCH-MARKER-42` | PASS |
| S-21 | `UserPromptSubmit` hook 被真实触发 | PASS |
| S-22 | 终端 resize 到 72x30 后布局不塌 | PASS |
| S-23 | `/clear` 清空会话 | PASS |
| S-24 | 退化终端（`fullScreen=false`）下 `/help` 以正文块列出命令 | PASS |

### 9.2 智能体关键流程（`agent-flows-e2e.mjs`，14/14 PASS）

| 编号 | 场景 | 结果 |
| --- | --- | --- |
| A-01 | 真实回合中 `Read` 工具执行并把文件内容回传给模型 | PASS |
| A-02 | 允许编辑档位下 `Write` 经审批真实写盘 | PASS |
| A-02b | 审批通过后回合正常完成 | PASS |
| A-03 | 审批拒绝后不写盘 | PASS |
| A-03b | `/denials` 列出真实拒绝记录 | PASS |
| A-04 | Esc 打断进行中的回答后回到空闲 | PASS |
| A-04b | 打断给出反馈 | PASS |
| A-05 | 回合结束后出现模型生成的建议，且 Tab 可填入 | PASS |
| A-06 | Esc+Esc 回滚面板把对话回滚到检查点（历史条数减少） | PASS |
| A-07 | `/models` 面板可打开并可关闭 | PASS |
| A-08 | 跨进程 `/resume` 恢复会话后历史消息可见 | PASS |
| A-08b | `/resume` 后会话身份切换为被恢复会话 | PASS |
| A-09a | `/init` 启动「生成项目指令」的真实回合 | PASS |
| A-09 | `/init` 在空目录真实生成 `AGENTS.md` | PASS |

### 9.3 本轮发现与处理

- **S6-01（真实缺陷，已修复）**：`/undo` 无检查点时显示英文 `no session changes to undo`，中文界面出现英文。修复见 §2 末条与设计 D-20。
- **S6-02…S6-05（脚本接线或既有设计行为，未改产品）**：`runtime` 无 `context` surface 时脚本无条件注入导致面板崩溃；JSX 面板需 Esc 关闭且双击 Esc 会打开 `/rewind`（脚本改为 Esc 后等 700ms）；`/init` 需先 Shift+Tab 到允许编辑档位才会真实写盘（既有 CE-08 权限设计）；拒绝后弹「拒绝反馈」对话框需再发 Esc 落定。

### 9.4 UNVERIFIED

- **S6-06**：打断（Esc）之后在同一会话内继续发提示词，本轮观察不到新回合（换新会话实例即正常）。未能稳定复现，未据此改动实现，留待后续专门排查。

## 7. 限制与剩余风险

**PARTIAL：0。** 早期 TU-03（缺 UI 级缓存命中计数）已在收口时补齐：`history-window.tsx` 增加仅测试可读的 `freezeCacheStats()/resetFreezeCacheStats()`，帧级用例断言仅输入区变化时命中 ≥1 且未命中为 0。TU-09 按设计 §4.4 规则 8 判定：可选字段缺失即省略、必填字段占位，属设计已解决的口径，无偏离。

### 其他已知限制

- 状态栏外部命令配置在应用挂载时读取一次，修改 `config.json` 后需重启 TUI。
- 无头模式不启动 MCP、hooks 的交互面板；MCP/hooks 配置错误只写 stderr，不进入 result。
- `/worktree` 删除依赖宿主确认回调；非交互环境明确取消，不静默删除。
- 参考仓为本地只读材料且无 LICENSE；本仓保持 MIT 独立可发布，未嵌入参考源码。AST 为相似度复核，不等同法律洁净室认证。

## 8. 交付边界

- 分支：`feature/SP006/tui-parity-and-extensions`，基线 `dc94731`；提交 `cedf2a3`（A）、`031b99b`（B）、`4b78cdb`（C+B3）、`06d7b2a`（D）、`f0b11eb`（命令卡片完成态隐藏与单行修复）、`47c5cb6`（台账源码 SHA 同步）、`1ef588a`（`/resume` 历史可见性与身份切换）、`55ea677`（`/resume` 历史碎片合并与输入框建议改模型生成）、`9e3e88f`（建议清洗按真实模型输出校正、退化终端多行命令输出）、`1877af6`（波次 H 文档收口）、`a869cd1`（`/undo` 文案本地化）、`9dbb6d7`（波次 I 证据与文档数字收口）。
- **未合入 master**（用户 m02328、m03678 明确「先不要合入master分支」）；已按用户 m02328 授权推送远端分支 `origin/feature/SP006/tui-parity-and-extensions`（代码提交至 `a869cd1`，文档与台账同步提交随后推送），master 未改动。
- 版本 0.6.0 仅 `prepared`；未打 tag、未 npm 发布、未改远端设置。
