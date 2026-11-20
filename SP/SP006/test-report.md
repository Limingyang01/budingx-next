# SP006 验收报告

状态：**执行完成（功能分支）**｜日期：2026-11-20｜分支 `feature/SP006/tui-parity-and-extensions`｜基线 master `dc94731`｜版本 0.6.0 prepared（未发布）｜含用户检查反馈的命令卡片修复（`f0b11eb`）与 `/resume` 历史可见性修复

## 1. 方法与环境

- 设计/计划：[design.zh.md](tui-parity-and-extensions/design/design.zh.md) v1.1、[plan.zh.md](tui-parity-and-extensions/design/plan.zh.md) v1.1。
- 验证代码：Node.js 22.18、TypeScript 构建产物（`npm run build`）、Node test runner、Ink 8 伪终端（`mountTty`）、本地 HTTP/SSE fixture、真实子进程（headless、MCP 假服务器、hooks 脚本、git worktree、后台任务）。
- 计数命令：`npm run test:unit`；定向 `node --test src/tui/test/sp006-*.test.mjs ...`；制品 `node scripts/release/sp006-packaging.mjs`；AST `node scripts/review/sp004-ast.mjs --reference <参考仓> --reference-revision b5c9be8 --base dc94731`。
- 参考仓只用于行为对照；SP006 全部实现独立编写，AST 复核见 §4。

## 2. 汇总

| 指标 | 结果 |
| --- | --- |
| AC 总数 | **69**（TU 15、PI 5、SM 9、HK 8、WR 5、HC 7、NP 5、CMD 12、AST 3） |
| PASS | **67** |
| PARTIAL | **0** |
| FAIL | **0** |
| UNVERIFIED | **0** |
| 全量回归 | **914 项 / 913 通过 / 0 失败 / 1 跳过**，EXIT=0（跳过项仅 POSIX 文件权限） |
| SP006 新增测试 | 20 个文件 / **110 例** |
| 定向回归 | **135 通过 / 0 失败** |
| 制品 smoke | **6/6 PASS**，exit 0，未上传 npm |
| AST | **52/52 映射，命中 0，自检 3/3 PASS** |

历史失败与修复（保留为回归证据，不掩盖）：

- 全量首次（加入 TU-03 计数用例前）905 / 902 / 2 fail：screen-e2e S1 找不到「尚未配置 · 运行 /models」（`setupHint` 移入页脚后空页脚不渲染）→ 页脚条件补 `footerHint`；sp0052-e2e 断言 `reasoning_effort=high` 为 null（`--prompt` 改走无头后丢失环境变量）→ headless 解析 `BUDINGX_REASONING_EFFORT` 并传入 runtime。修复后全量 0 失败。
- sp0054-command-fidelity 的 fixture 只有 frontmatter、正文为空 → 按 SM-03 现为 invalid，测试改为写入正文；sp0054-enter-command 的 `/help` 帧因新增七条命令变长，谓词改为检查「自定义技能命令」；注册表测试由 22 改为 29。
- 2026-11-20 用户检查发现完成态命令卡片常驻且单次调用占多行（用户报告 m01955）。根因是 `app.tsx` 无条件渲染 `frame.command`，reducer 在完成/失败/取消后只改状态不清除。修复为 `activeCommandCard` 仅保留 running/background，运行中 `compact` 单行，完成态默认隐藏、`Ctrl+E` 按需展开；新增 `sp004-cards.test.mjs` 的 T15-3b 与 `sp006-command-card.test.mjs` 的 T15-3c（真实子进程 + 全屏 Ink 帧）。复测 908 / 907 通过 / 0 失败 / 1 跳过。
- 2026-11-20 用户检查发现 `/resume` 恢复会话后消息区为空、看不到历史对话（用户报告 m02285）。根因是 `Session.restoreHistory()` 只替换模型上下文里的 `this.messages`、不发事件，而可见转录 `Frame.transcript` 只由 `reduceFrame` 从会话事件累积，于是模型看得见历史、用户看不见。修复走会话事件通路：新增 `conversation_restored` 事件（携带恢复出的消息）、`Session.restoreHistory()` 发出该事件、渲染层按 `conversation_rewound` 同构重建转录（新增 `restored-transcript.ts` 负责消息到转录条目的映射，工具结果按 `callId` 回填，无结果的工具调用标为「已中断」而非继续转圈）；同时按参考实现的 `switchSession` 语义切换会话身份与转录端口（`Session.adoptIdentity`），使续写落回被恢复会话。证据：`sp006-resume-history.test.mjs` 5 例（纯函数、真实 Ink 帧、真实运行时 + 真实会话存储、真实 `/resume` 命令路径）与 `sp006-resume-e2e.test.mjs` 1 例（两个真实 CLI 子进程 + 真实 HTTP provider）。复测 914 / 913 通过 / 0 失败 / 1 跳过。

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
| AST-01 | PASS | 52 个改动源码文件全部有映射或「无对应参考模块」说明，未覆盖 0 |
| AST-02 | PASS | 命中「无」；映射中的处置项无 UNRESOLVED |
| AST-03 | PASS | 自检 3/3：相似片段命中、无关实现不命中、<60 节点短样板排除 |

## 4. 关键命令原始结果

```text
npm run build                         exit 0
node --test src/tui/test/*.test.mjs   914 tests / 913 pass / 0 fail / 1 skipped
定向 135 例                          135 pass / 0 fail

node scripts/release/sp006-packaging.mjs
ledger: PASS 0.6.0 SP006 prepared
release notes: PASS 0.6.0
tarball: PASS budingx-0.6.0.tgz 141 files
isolated install: PASS 0.6.0
headless stream-json: PASS 7 events; no user data written
publish --dry-run: PASS (no upload)

node scripts/review/sp004-ast.mjs --reference <ref> --reference-revision b5c9be8 --base dc94731
参考仓 @ b5c9be8；基线 dc94731；改动文件 52，映射 52
自检：PASS 相似片段命中 / PASS 无关实现不命中 / PASS 样板排除
本仓单元 252，参考单元 14381，函数对 49285；命中：无；结论：PASS
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
| `sp006-resume-history.test.mjs` | 5 | `/resume` 历史可见性（用户 m02285 回归）：reducer 重建转录、工具结果回填、真实 Ink 帧、真实运行时身份切换、真实 `/resume` 命令 + 真实会话存储 |
| `sp006-resume-e2e.test.mjs` | 1 | 端到端：两个真实 CLI 进程 + 真实会话目录 + 真实 HTTP provider，恢复后带历史续写并写回同一会话 |

## 6. 限制与剩余风险

**PARTIAL：0。** 早期 TU-03（缺 UI 级缓存命中计数）已在收口时补齐：`history-window.tsx` 增加仅测试可读的 `freezeCacheStats()/resetFreezeCacheStats()`，帧级用例断言仅输入区变化时命中 ≥1 且未命中为 0。TU-09 按设计 §4.4 规则 8 判定：可选字段缺失即省略、必填字段占位，属设计已解决的口径，无偏离。

### 其他已知限制

- 状态栏外部命令配置在应用挂载时读取一次，修改 `config.json` 后需重启 TUI。
- 无头模式不启动 MCP、hooks 的交互面板；MCP/hooks 配置错误只写 stderr，不进入 result。
- `/worktree` 删除依赖宿主确认回调；非交互环境明确取消，不静默删除。
- 参考仓为本地只读材料且无 LICENSE；本仓保持 MIT 独立可发布，未嵌入参考源码。AST 为相似度复核，不等同法律洁净室认证。

## 7. 交付边界

- 分支：`feature/SP006/tui-parity-and-extensions`，基线 `dc94731`；提交 `cedf2a3`（A）、`031b99b`（B）、`4b78cdb`（C+B3）、`06d7b2a`（D）、`f0b11eb`（命令卡片完成态隐藏与单行修复）、`47c5cb6`（台账源码 SHA 同步）、`1ef588a`（`/resume` 历史可见性与身份切换）。
- **未合入 master**（用户 m02328 明确「先不要合入master分支」）；已按用户 m02328 授权推送远端分支 `origin/feature/SP006/tui-parity-and-extensions`（HEAD `a2fd0cc`），master 未改动。
- 版本 0.6.0 仅 `prepared`；未打 tag、未 npm 发布、未改远端设置。
