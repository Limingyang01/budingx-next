# SP003 工作区与安全修改 · 设计

> 本历史记录沿用当时的 SP 编号，现行排期及新旧编号见[路线图 r8](../../../docs/iteration-plan.md)。

版本：v1.0｜状态：**approved（Agent 自审通过，2026-11-17 委托）**｜迭代：SP003｜材料来源：路线图 r6、能力矩阵 v1.1、排查文档 r1、SP001/SP002 产物、本仓源码现状｜身份说明：三模式语义为 USER_CONFIRMED，其余为 MODEL_PROPOSED 并经本轮自审采纳

---

## 1. 背景与目标

### 1.1 要解决的具体问题

SP002 交付了「模型 ↔ 会话」闭环：真实 Provider 流式、tool_calls 组装、工具回合、审批挂起、取消与双中断注入都已可用，但**运行时注册的工具数为零**——`Session` 只是留出了 `ToolHandler` 端口。因此当前产品仍然只能聊天，不能读文件、不能搜索、不能改代码，谈不上 Coding Agent。

SP003 补上这一段：模型获得一组受控的工作区文件工具；所有写操作经过一层可判定的权限策略（用户固定的三模式）；改动可预览、可撤销；用户在输入时可用 `@` 引用文件。

### 1.2 范围

**本轮交付**：工作区路径与忽略规则、读取/写入/精确编辑/文件匹配/内容检索五个工具、结构化 diff 与预览对话框、本会话改动检查点与撤销、三权限模式（仅可查看 / 工作区内修改 / 完全权限）、审批三档、权限规则（增删改查 + 遮蔽检测）、拒绝记录、`@` 文件引用与 `@`/`/` 共用补全 overlay。

**本轮明确不做**：命令执行与 shell 审批（SP004）、Git 感知与 worktree（SP004）、长会话压缩/恢复与项目记忆（SP005）、hooks/Skills/MCP/无头 CLI/TUI 体验主战场（SP006）、子代理与多模态（SP007）、跨端架构入口（SP010）、持久化会话回溯与 rewind（SP005）。本轮**不新增任何运行时第三方依赖**。

### 1.3 与上一轮的衔接

- SP002 的 `ToolHandler`/`ToolContext`/`ApprovalGateway`/`ApprovalDecision`（`src/core/tools.ts`）与 `SessionEvent`（`src/core/events.ts`）是本轮扩展的基座，**扩展而非替换**：既有 166 项产品单元测试必须在扩展后保持全绿（回归门槛）。
- SP002 的审批结局只有 `allow`/`deny`/`cancelled`；本轮需要「允许一次 / 本会话记住 / 拒绝」三档，属**跨轮契约变更**，按契约版本化处理（见 §4.2）。
- SP002 的 `Session.submit(text)` 只接受纯文本；本轮需要携带 `@` 引用产生的上下文块，属**跨轮契约变更**（见 §4.3）。

---

## 2. 当前状态（真实代码事实，2026-11-17，`master` = `b0ffc9e`）

### 2.1 仓库现状

| 事实 | 证据 |
| --- | --- |
| 仓库有四个产品模块 `src/core`、`src/provider`、`src/storage`、`src/tui`，无任何文件工具实现 | `src/` 目录清单；`src/core/tools.ts` 仅定义端口 |
| `Session` 支持工具回合但运行时未注册工具 | `src/core/session.ts` `buildRequest` 仅在 `this.tools.length > 0` 时附带 tools 规格；`src/tui/runtime.ts` 构造 `Session` 时未传 `tools` |
| 审批闭环已存在但只有两档结局 | `src/core/tools.ts` `ApprovalDecision.outcome: 'allow' \| 'deny' \| 'cancelled'`；`src/tui/approval.ts` `InkApprovalGateway.resolve()` |
| 用户数据根固定 `~/.budingx`，从不读写 `~/.claude` | `src/storage/paths.ts` `dataRoot()` |
| 模块边界检查已存在并纳入 `npm test` | `scripts/checks/module-boundaries.mjs`；`core` 禁 IO 与跨模块依赖 |
| TUI 已用 Ink 8 渲染，编辑器为自研 buffer/keys，无补全层 | `src/tui/app.tsx`、`src/tui/editor/*` |
| 基线测试全绿（166 产品单元 + 9 spec + 边界检查） | 2026-11-17 实跑 `npm run test:unit` 166/166、`npm run spec:test` 9/9、`npm run test:checks` 通过 |

### 2.2 假设与未验证项

- **A-01（假设）**：`Session` 的工具派发串行执行同一回合内的多个调用，本轮保持该语义（并行写同一文件会引入新的竞态，SP004 再评估）。
- **A-02（假设）**：Provider 的 tool_calls 参数以 JSON 字符串给出，`parseToolArguments` 已归一；本轮工具 schema 采用 JSON Schema 子集（type/properties/required/enum），与 SP002 已实现能力一致。
- **U-01（UNVERIFIED）**：真实模型在提供五个文件工具时的调用质量（是否会滥用 Edit、是否会正确使用行范围）需真实凭据验证，缺凭据则记 UNVERIFIED。
- **U-02（UNVERIFIED）**：真终端（Windows Terminal / ConHost）下的 diff 对话框与补全 overlay 观感属人工清单，本轮只做伪 TTY 帧级验证。

---

## 3. 总体方案

### 3.1 责任划分

```text
┌───────────────────────────── TUI 宿主 (src/tui) ─────────────────────────────┐
│  Ink 渲染：审批三档卡片 / diff 对话框(list→detail) / 权限模式徽标 / @ 补全 overlay │
│  命令：/permission /rules /diff /undo /denials                                  │
└───────────────┬──────────────────────────────────────────────┬────────────────┘
                │ SessionEvent（宿主只订阅）                   │ 工具调用
                ▼                                              ▼
┌──────────────────────── Core 策略与编排 (src/core) ──────────────────────────┐
│ Session：回合状态机 / 工具派发 / 审批挂起 / 取消                                │
│ PermissionPolicy 端口（纯函数判定：allow | ask | deny）                        │
│ ToolHandler 端口扩展：capability(input) / target(input)                       │
└───────────────┬──────────────────────────────────────────────┬────────────────┘
                │                                              │ 实现
                ▼                                              ▼
┌────────────────── Workspace 实现 (src/workspace，拟新增) ────────────────────┐
│ paths 路径解析与真实路径边界 │ ignore gitignore 语义 │ read/write/edit        │
│ search glob+grep              │ diff 行级 diff      │ policy 策略实现         │
│ checkpoint 改动检查点与撤销   │ tools 工具装配（ToolHandler 实现）              │
└───────────────┬──────────────────────────────────────────────────────────────┘
                │ 规则持久化
                ▼
┌────────────────── Storage (src/storage) ─────────────────────────────────────┐
│ permissions.json：schemaVersion + 规则集合（原子写，沿用既有 atomic 模式）    │
└───────────────────────────────────────────────────────────────────────────────┘
```

**依赖方向**：`tui → workspace → core`；`tui → core`；`workspace → storage`；**core 不依赖 workspace/storage/IO**（既有边界检查继续生效并新增 `workspace` 条目）。策略判定逻辑放在 `src/workspace/policy.ts`（需要真实路径解析，属 IO 感知），core 只保留纯端口与状态机，避免把 IO 语义塞进 core。

### 3.2 模块与文件（拟新增标记 ✅）

| 路径 | 状态 | 责任 |
| --- | --- | --- |
| `src/workspace/paths.ts` | ✅ 新增 | 工作区根确定、相对/绝对路径解析、真实路径（realpath）解析、越界判定、junction/symlink 处理 |
| `src/workspace/ignore.ts` | ✅ 新增 | `.gitignore` / `.ignore` 语义匹配（自实现） |
| `src/workspace/read.ts` | ✅ 新增 | 读取工具实现：行范围、截断、编码/二进制/CRLF/大文件策略 |
| `src/workspace/write.ts` | ✅ 新增 | 写入工具实现：原子写、基线指纹校验 |
| `src/workspace/edit.ts` | ✅ 新增 | 精确编辑：唯一字面串、replace_all、空串创建、old==new 拒绝 |
| `src/workspace/search.ts` | ✅ 新增 | Glob 模式匹配与 Grep 正则检索、截断与计数摘要 |
| `src/workspace/diff.ts` | ✅ 新增 | 行级 diff（自实现）与 hunk 结构 |
| `src/workspace/checkpoint.ts` | ✅ 新增 | 本会话改动检查点、撤销判定 |
| `src/workspace/policy.ts` | ✅ 新增 | 三模式 + 规则 + 底线规则的判定实现（实现 core 的 `PermissionPolicy` 端口） |
| `src/workspace/tools.ts` | ✅ 新增 | 五个工具的 `ToolHandler` 装配、参数 schema、能力与目标分类 |
| `src/workspace/index.ts` | ✅ 新增 | 模块导出 |
| `src/workspace/test/*.test.mjs` | ✅ 新增 | 单元与真实文件进程用例（`npm run test:unit` 自动纳入 `src/*/test/*.test.mjs`） |
| `src/core/permissions.ts` | ✅ 新增 | 纯端口：`PermissionMode`、`PermissionAction`、`PermissionPolicy`、请求/判定类型 |
| `src/core/tools.ts` | ✏️ 修改 | `ToolHandler` 增 `capability`/`target`；`ApprovalDecision.outcome` 增 `allow_session`；`ToolContext` 增 `signal` 已有 + `workspace` 上下文 |
| `src/core/events.ts` | ✏️ 修改 | `MessageBlock` 增 `context` 块；新增事件 `permission_changed`、`change_set`、`denial_recorded` |
| `src/core/session.ts` | ✏️ 修改 | 工具派发前经策略判定；审批三档；`submit` 支持上下文块；变更集合与拒绝事件 |
| `src/core/normalize.ts` | ✏️ 修改 | `context` 块转 API 文本（前置上下文，不污染用户原话） |
| `src/core/constants.ts` | ✏️ 修改 | 新增 workspace / permission 错误码 |
| `src/storage/permissions.ts` | ✅ 新增 | 规则集合持久化（schemaVersion 1，原子写 + 备份） |
| `src/storage/paths.ts` | ✏️ 修改 | 新增 `permissionsPath()` |
| `src/tui/approval.ts` | ✏️ 修改 | 审批三档结局与会话记忆登记 |
| `src/tui/app.tsx` | ✏️ 修改 | 审批三档卡片、权限模式徽标、diff 对话框、补全 overlay 挂载 |
| `src/tui/commands.ts` | ✏️ 修改 | `/permission` `/rules` `/diff` `/undo` `/denials` |
| `src/tui/runtime.ts` | ✏️ 修改 | 装配 workspace 工具与策略（工作区根 = 启动 cwd） |
| `src/tui/render/diff-view.ts` | ✅ 新增 | diff 帧渲染（hunk + gutter + 增删标记 + 窄屏降级） |
| `src/tui/render/completion.ts` | ✅ 新增 | `@`/`/` 补全候选计算（纯函数，可测） |
| `src/tui/editor/completion.ts` | ✅ 新增 | overlay 状态与候选选择（编辑器集成） |
| `src/tui/test/*.test.mjs` | ✅ 新增 | 伪 TTY e2e（审批三档、diff 对话框、补全 overlay、模式切换） |
| `scripts/checks/module-boundaries.mjs` | ✏️ 修改 | 新增 `workspace` 条目：禁 UI 库、禁依赖 `src/tui` |
| `PRODUCT.md` | ✏️ 修改 | 同步本轮用户可见能力（功能表 / 使用说明 / 已知限制 / 版本历史） |

### 3.3 权限模型（核心设计）

#### 3.3.1 三模式语义（USER_CONFIRMED，不得变更）

| 模式 | 标识 | 读类工具 | 写类工具（目标在工作区内） | 写类工具（目标在工作区外） |
| --- | --- | --- | --- | --- |
| 仅可查看 | `read_only` | 放行 | **拒绝**（模式直接拒绝，不弹审批） | 拒绝 |
| 工作区内修改 | `workspace_edit` | 放行 | **询问一次审批**（可选「本会话记住该目标」） | 拒绝 |
| 完全权限 | `full_access` | 放行 | **自动放行**（无需反复确认） | 拒绝 |

补充约定（MODEL_PROPOSED，本轮自审采纳）：

- **默认模式为 `read_only`**（保守默认），且**不跨会话提升**：进程重启回到 `read_only`，避免「上次开了完全权限」被静默继承。`workspace_edit` 与 `full_access` 为会话内状态。
- `full_access` 的含义是「自动执行、不反复确认」，**不是「无边界」**：底线规则在任何模式下都拒绝。
- 模式切换对**切换之后**的工具调用生效；进行中的回合不因切换而改变已发出的调用判定（避免同一回合内判定漂移）。切换在下一次工具派发时生效，且切换事件对用户可见。

#### 3.3.2 底线规则（任何模式都拒绝，不可被规则覆盖）

| # | 底线 | 理由 |
| --- | --- | --- |
| B-1 | 目标位于用户数据根 `~/.budingx` 下（含 `config.json`、`credentials.json`） | 凭据与配置是产品自有数据，Agent 不应读写（AGENTS.md 用户数据边界） |
| B-2 | 目标文件名匹配凭据特征：`credentials.json`、`.env` / `.env.*`、`*.pem`、`*.key`、`id_rsa` / `id_rsa.*`、`*.p12` / `*.pfx` | 凭据保护：AGENTS.md 明确「不得借完全权限绕过凭据保护」 |
| B-3 | 写入目标解析后的真实路径不在工作区根内 | 「完全权限」是免确认，不是越界授权 |
| B-4 | 读取目标解析后的真实路径不在工作区根内 | 同上；工作区外不可读 |
| B-5 | 任何经 junction / symlink 指向工作区外的路径 | 目录穿越与链接绕过一并拦截 |

B-1…B-5 是**代码内固定**的，不来自用户规则文件，也不提供关闭开关（本轮）。

#### 3.3.3 规则（用户可配置，持久化）

规则文件 `~/.budingx/permissions.json`：

```json
{
  "schemaVersion": 1,
  "rules": [
    {
      "id": "r-1",
      "action": "allow",
      "tool": "Write",
      "path": "src/**",
      "note": "允许改动 src 目录"
    },
    {
      "id": "r-2",
      "action": "deny",
      "tool": "*",
      "path": "**/*.env*",
      "note": "禁止触碰环境文件"
    }
  ]
}
```

- 字段：`action`（`allow` | `deny`）、`tool`（工具名或 `*`）、`path`（相对工作区根的 glob，可空表示不限）、`note`（可选说明）。`contentPrefix` 字段**本轮保留但不使用**（为 SP004 的命令前缀规则预留，写入时若出现则拒绝并提示不支持，避免未来语义漂移）。
- 路径 glob 语义（自实现）：`*` 不跨分隔符，`**` 跨分隔符，`?` 单字符，`/` 锚定到工作区根；忽略规则同源但语义不同（见 §3.4）。
- **优先级**：`deny` 规则 > `allow` 规则 > 模式默认。规则只能**收紧**或**放宽模式的默认判定**，`allow` 规则**不能覆盖底线规则**（B-1…B-5 恒生效）。
- **遮蔽检测**：若一条 `allow` 规则的作用域被某条 `deny` 规则完全覆盖（同工具匹配且路径 glob 被 deny 的路径模式覆盖），在 `/rules` 列表中标注「被 r-x 遮蔽」，并在写入规则时即时提示（MODEL_PROPOSED：只做可判定的路径包含关系检测，不做一般化 glob 包含算法）。
- **会话记忆**：「本会话记住」产生**会话内**的 allow 记忆（工具名 + 归一化目标路径），不写入规则文件，进程退出即失效。
- 规则文件损坏时：读取失败按「空规则集 + 警告」处理，保留原文件不覆盖（沿用 SP002 存储层既有策略），并把损坏文件另存备份。

#### 3.3.4 判定流程

```text
工具调用到达
  → 解析参数（非法 JSON → 既有错误路径）
  → handler.capability(input) → 'read' | 'write'
  → handler.target(input) → { path?, kind }
  → policy.decide({name, capability, path}) :
      1. 底线检查（B-1…B-5）命中 → deny(原因)
      2. 命中 deny 规则 → deny(规则 id)
      3. 命中会话记忆 → allow(会话记忆)
      4. 命中 allow 规则 → allow(规则 id)
      5. 否则按模式默认：read_only→write 拒绝 / read 放行；
                        workspace_edit→write 询问 / read 放行；
                        full_access→allow
  → deny：产生工具错误结果（模型可继续），记录 denial 事件，不弹审批
  → ask：进入既有审批挂起流程（扩展为三档）
  → allow：直接执行
```

### 3.4 路径与忽略规则

- **工作区根**：进程启动时的 `process.cwd()`（真实路径），由 TUI 传入；不写入用户数据，不随会话改变（SP004 的 worktree 场景再引入根切换）。
- **路径解析**：相对路径基于工作区根；绝对路径必须落在工作区内；路径中的 `..` 在解析后判定；随后对**存在的路径**取真实路径（`fs.realpath`）再判定，规避 symlink/junction 绕过；对**尚不存在**的目标文件，取其**父目录**的真实路径判定（新建文件的越界检查）。
- **Windows 特性**：路径比较用真实路径 + 大小写不敏感比较（Windows）；比较前统一分隔符；处理长路径（>260 字符）时使用 `\\?\` 前缀的 Node 路径 API。
- **忽略规则**（自实现 gitignore 语义，不引入第三方库）：读取工作区根的 `.gitignore` 与 `.ignore`，以及各目录下的 `.gitignore`（目录级规则仅作用于该目录及其子目录）；支持 `!` 取反、`/` 锚定、`**`、行尾 `/` 表示目录；`.git/`、`.hg/`、`node_modules/` 默认忽略。忽略规则同时作用于：Glob/Grep 结果、Read/Write/Edit 的目标解析（被忽略的文件可显式路径访问吗？——**决定：显式指定路径仍允许读写，但不出现在搜索候选中**；这与「忽略规则生效」不冲突，因为忽略规则的本轮验收口径是搜索与补全结果，见 AC WT-12/FC-01）、`@` 补全候选。

### 3.5 工具契约

五个工具，名称采用模型生态通用名（行为兼容选择，非代码搬用）：

| 工具 | 能力 | 参数 | 返回（给模型） |
| --- | --- | --- | --- |
| `Read` | read | `path`（必填）、`offset?`、`limit?` | 带行号的文本；截断时尾部附 `[truncated: showing lines a-b of N]` |
| `Write` | write | `path`（必填）、`content`（必填） | 写入摘要（路径、字节数、新建/覆盖）；失败时错误码 |
| `Edit` | write | `path`、`old_string`、`new_string`、`replace_all?` | 替换摘要（替换次数、路径）；冲突/歧义时明确错误与建议 |
| `Glob` | read | `pattern`（必填）、`path?` | 匹配路径列表 + 计数摘要 `[N matches, showing M]` |
| `Grep` | read | `pattern`（必填）、`path?`、`glob?`、`case_insensitive?` | `文件:行号:内容` 列表 + 计数摘要；跳过二进制并计数 |

约定：

- 所有路径参数统一为工作区相对路径（模型传绝对路径也可，解析后判定边界）。
- 工具结果文本统一形态：成功给人类可读摘要；失败给「一句原因 + 稳定错误码」，供模型自我纠正。
- 输出长度受既有 `TOOL_OUTPUT_CAP`（32768）约束，超出截断并标为错误（既有语义）。
- 取消：`ToolContext.signal` 已存在；本轮在读文件与递归搜索中检查 `signal.aborted` 并尽快返回。
- 能力分类：`Read/Glob/Grep` = read；`Write/Edit` = write。

### 3.6 diff、预览与撤销

- **diff 算法**：行级 LCS（Myers 思路）自实现，输出 hunk：`{ oldStart, oldLines, newStart, newLines, lines: [{type:'context'|'add'|'remove', text, oldNo?, newNo?}] }`，默认上下文 3 行。
- **预览一致性**：写操作先算出「旧内容 → 新内容」的 diff 对象与**基线指纹**（旧内容 SHA-256）；落盘前重新读盘计算指纹，指纹不一致 → 拒绝写入（CP-04），磁盘保留外部改动。
- **变更集合**：每次成功写入产生一条 `ChangeRecord`（路径、操作、before/after 摘要、diff、时间戳、来源回合）；回合结束后在会话事件里发出 `change_set`，TUI 据此渲染 `/diff` 列表。
- **预览对话框**：列表级（文件 + 增删行数 + 操作类型）→ 详情级（hunk + gutter 行号 + 增删标记）；源切换：`turn`（本次会话产生的改动）与 `current`（工作区当前文件内容）两个来源；窄屏（< 70 列）放弃分栏，单栏纵向。
- **撤销（检查点）**：写入前保存旧内容到会话内检查点（内存，不落盘，SP005 负责持久化）。撤销条件：当前磁盘内容仍等于我们写入后的内容 → 可安全回滚；否则**停止自动撤销**并提示用户手工处理（不吞用户改动）。撤销粒度：整组（最近一次改动集合）或单文件。

### 3.7 文件上下文与补全

- **`@` 引用解析**：提交时扫描文本中的 `@<path>` 记号（路径可含空格需转义或引号，本轮支持无空格路径 + 引号包裹两种形态）；解析基于工作区相对路径；命中文件 → 读取内容（上限见下）形成上下文块。
- **上下文块**：新增 `MessageBlock { type: 'context'; source: string; content: string }`；在 `normalizeForApi` 中把上下文块转成**独立于用户原话**的前置文本块（`<file_context source="...">` 包裹），避免与用户指令混淆；用户侧在转录区显示「已引用文件：路径（行数）」。
- **注入上限**：单文件最多 2000 行或 64 KB（取先到者），超出截断并标注；单轮注入总量上限 128 KB，超出按文件顺序截断并提示。
- **图片引用**：本轮只给占位与尺寸摘要（类型、字节、宽高），**不假装已读图像内容**（多模态属 SP007）。
- **补全 overlay**：`@` 与 `/` 共用一个 overlay（候选列表 + 上下键移动 + Enter 选中 + Esc 关闭）；`@` 候选来自工作区文件（遵守忽略规则、按路径分段匹配、目录续补）；`/` 候选来自已注册命令。候选计算为纯函数（`src/tui/render/completion.ts`），便于单测。

### 3.8 宿主交互

- **审批卡片**：三档——`1 允许一次` / `2 本会话记住该目标` / `3 拒绝`（键位与现有 `y/n` 兼容：`y` 仍等价允许一次，`n`/Esc 仍等价拒绝）。
- **模式徽标**：状态行显示当前模式（如 `权限：工作区内修改`），切换时给出行内提示。
- **命令**：
  - `/permission`（查看）、`/permission read|workspace|full`（切换）
  - `/rules`（列出，含遮蔽标注）、`/rules add allow|deny <tool> [path]`、`/rules rm <id>`
  - `/diff`（列出本会话改动）、`/diff <path>`（详情）
  - `/undo`（撤销最近一次改动集合）、`/undo <path>`
  - `/denials`（拒绝历史）
- **shift+tab 循环切换模式**：本轮实现（与 SP004 的模式轮播属同一交互族，SP004 在此基础上扩展更完整的模式说明与联动，不重复实现）。

---

## 4. 契约变更（跨轮版本化）

### 4.1 `core/tools.ts`（v1 → v2）

```ts
export type ToolCapability = 'read' | 'write'
export type ToolTarget = { path?: string; kind: 'file' | 'directory' | 'search' | 'none' }
export type ToolHandler = {
  // ...既有字段
  capability?(input: unknown): ToolCapability
  target?(input: unknown): ToolTarget
}
export type ApprovalDecision = {
  outcome: 'allow' | 'allow_session' | 'deny' | 'cancelled'
  via: 'user' | 'policy'
  remember?: { tool: string; path?: string }   // allow_session 时给出记忆范围
}
```

兼容策略：`outcome` 扩值不破坏既有 `allow/deny/cancelled` 使用方；`session.ts` 对未知值按 `deny` 处理（防御式）。

### 4.2 `core/events.ts`（v1 → v2）

新增事件（均为可选消费，宿主不订阅也不影响回合）：

```ts
| { type: 'permission_changed'; mode: PermissionMode }
| { type: 'change_set'; changes: ChangeRecord[] }
| { type: 'denial_recorded'; denial: { tool: string; path?: string; reason: string; at: string } }
```

`MessageBlock` 新增 `{ type: 'context'; source: string; content: string }`。

### 4.3 `Session` 行为变更

- `submit(text: string, options?: { context?: ContextBlock[] })`：上下文块置于用户消息**之前**，且在 `normalizeForApi` 中与用户原话分离。
- 工具派发新增策略判定阶段（§3.3.4）。
- `ApprovalDecision.outcome === 'allow_session'` 时调用 `policy.remember(...)` 并放行。

### 4.4 新增错误码（`core/constants.ts`）

`BUDINGX_WORKSPACE_001…009`（路径越界、目标不存在、非文件、编码不支持、超大、编辑未命中、编辑歧义、编辑冲突、结果截断）、`BUDINGX_PERMISSION_001…003`（模式拒绝、规则拒绝、工作区外）。

---

## 5. AC 与验证映射

| 需求 | AC | 主要验证层 | 计划任务 |
| --- | --- | --- | --- |
| workspace-tools | WT-01…14 | L0 纯函数（路径/忽略）+ L1 真实文件进程（读写/编辑/搜索/越界/junction） | T1–T6 |
| change-preview | CP-01…08 | L0 diff/撤销判定 + L1 落盘一致性 + L2 伪 TTY 对话框 | T7–T9 |
| permission-controls | PC-01…11 | L0 规则匹配/遮蔽 + L1 三模式真实写入 + L2 审批三档与模式徽标 | T10–T13 |
| file-context | FC-01…07 | L0 候选/引用解析 + L1 注入与异常提示 + L2 overlay 交互 | T14–T15 |

每条 AC 至少各有一例单元用例与一例功能（端到端）用例；映射在 `plan.zh.md` 逐条列出。

---

## 6. 与参考实现（`budingWorkerSpace`）的对照

按「读机制、不抄代码」：本轮对照参考实现的行为事实，实现全部独立编写。

| 能力 | 参考实现行为事实 | 本轮设计 | 偏离与理由 |
| --- | --- | --- | --- |
| 权限模式 | 参考仓 7 档模式 | 用户固定三档（USER_CONFIRMED） | **有意偏离**：用户 2026-11-17 明确固定三档，参考 7 档仅作基线事实 |
| 审批弹窗 | 三档 + 会话记忆按目录限定 + Yes/No 反馈输入态 | 三档（允许一次/本会话记住/拒绝），记忆粒度为工具+路径 | 有意偏离：记忆粒度取本轮最小可用形态，目录级记忆留待 SP004/SP006 |
| 规则语法 | `Tool(content)` / bash 前缀 / 路径 gitignore 语义 / 别名归一 / 注入防护 | 自写规则模型（action/tool/path）+ 底线规则内建 | 有意偏离：参考含 bash 前缀规则（属 SP004 命令域），本轮先落文件工具域；注入防护对应「规则内容只作数据解析，不拼接执行」 |
| diff | hunk + gutter 行号 + 高亮 + Fallback；窄屏放弃分栏；list/detail 两级 + current(turn)/turn 源切换 | 同结构（自实现 diff）；高亮仅最小实现 + 纯文本 fallback；窄屏单栏；list/detail 两级 + `turn`/`current` 两源 | 无偏离；高亮为可选增强，fallback 必须始终可用 |
| Edit 语义 | 唯一字面串 / replace_all / 空串创建 / old==new 拒绝 / 容错回退 | 同（自实现） | 无偏离 |
| Read 语义 | 行范围 + 图片尺寸摘要 | 同；图片本轮只摘要不做多模态 | 收窄：多模态属 SP007 |
| Glob/Grep | 截断与计数摘要 | 同 | 无偏离 |
| @/命令 typeahead | 统一 overlay、目录续补 | 同（自绘 Ink overlay） | 无偏离 |

**周旋点（独立实现边界）**：

- diff：自实现行级 Myers，不引入第三方 diff 库、不搬参考组件。
- gitignore 语义：自实现匹配器，不引入第三方 ignore 库。
- 权限规则：自写解析器与匹配，不引入规则引擎。
- 弹窗/overlay/diff 视图：Ink 自绘。
- 参考仓源码、提示词、内部类型、bundle 一律不迁入本仓。

---

## 7. 风险与回退

| 风险 | 影响 | 缓解 | 回退 |
| --- | --- | --- | --- |
| R-01「完全权限」被当成万能钥匙 | 凭据或工作区外被改写 | 底线规则独立于模式判定，且有负向回归（PC-05/PC-08） | 关闭 `full_access`，规则与模式判定分离可单独回滚 |
| R-02 预览与磁盘不一致 | 用户看到的 diff 与实际不符 | 基线指纹 + 落盘前校验，冲突即拒绝（CP-02/CP-04） | 禁用写工具，仅保留读与搜索 |
| R-03 自实现 ignore/diff 语义偏差 | 漏搜、误判 | 公开规范 + 覆盖用例固定；忽略规则只影响搜索与补全候选，不阻断显式路径读写 | 退回「无忽略规则」开关（仅本轮代码内） |
| R-04 Edit 语义误伤文件 | 破坏用户代码 | 匹配数不符一律拒绝，不做模糊替换（WT-07） | 关闭 Edit，仅保留 Write |
| R-05 契约扩展破坏 SP002 行为 | 既有功能回归 | 既有 166 项单元全绿作为回归门槛；扩展值向后兼容 | 回滚 core 契约改动，工具层降级为只读 |
| R-06 junction 在部分 Windows 环境不可创建 | AC WT-11 无法取证 | 记录 UNVERIFIED 并写明恢复条件；用 symlink（需权限）与 `..` 穿越分别取证 | — |
| R-07 大仓搜索卡顿 | TUI 卡住 | 扫描上限 + 计数摘要 + 分段续补 | 降低上限常量 |

回退总体：本轮全部产出在 `feature/SP003/workspace-tools` 分支，产品版本保持 0.2.0 不动；失败可整体弃分支而不影响 master。

---

## 8. 开放项（OPEN，均不阻塞实施）

| # | 内容 | 处理 |
| --- | --- | --- |
| O-01 | 注入与读取的具体上限取值（2000 行 / 64KB / 128KB） | 设计定为可配置常量，落在 `src/workspace/constants` 或 core 常量区；实施时可按实测调整并记录 |
| O-02 | `Shift+Tab` 循环切换模式是否与既有键位冲突 | 本轮实现；键位系统整体属 SP006，届时统一登记 |
| O-03 | 撤销是否需要跨会话 | 本轮不做，SP005 负责持久化快照与 rewind |
| O-04 | 真实模型调用质量 | 无凭据则 UNVERIFIED（U-01） |

---

## 9. 自审记录（2026-11-17 委托：设计文档为 Agent 自审对象）

### 9.1 自审清单

| # | 检查项 | 结论 |
| --- | --- | --- |
| 1 | 需求覆盖：四个需求文档 40 条 AC 是否都在设计中有落点 | 是（§5 映射到 T1–T15；逐条 AC 映射在 `plan.zh.md`） |
| 2 | 与路线图 SP003 出口门槛逐条对齐 | 是（跨目录搜索/编码/CRLF/大文件/忽略/补丁冲突/越界 → WT；磁盘不变/diff 一致/无关改动保留 → CP；三模式切换与边界 → PC） |
| 3 | 三模式语义是否与 USER_CONFIRMED 一致 | 是（§3.3.1；「完全权限」不绕过 deny 与凭据保护，底线规则 B-1…B-5 独立生效） |
| 4 | 是否引入旧仓源码、提示词、内部类型或 bundle | 否（§6 周旋点：全部自实现；参考仅作行为对照） |
| 5 | 是否新增运行时第三方依赖 | 否（仅 Node 内置能力；模块边界检查新增 workspace 条目） |
| 6 | core 是否被塞入 IO | 否（IO 感知策略放 `src/workspace/policy.ts`，core 只留纯端口） |
| 7 | 契约扩展是否向后兼容且可回归 | 是（§4；既有 166 项单元作为回归门槛；未知 outcome 按 deny 防御） |
| 8 | 是否存在越过授权的动作 | 否（不 push、不发布、不打标签、不设远端、不删分支） |
| 9 | 失败路径是否都有可观察结果与稳定错误码 | 是（§3.5、§4.4） |
| 10 | 真终端/真实模型等不可验证项是否如实标注 | 是（U-01/U-02、R-06） |

### 9.2 自审结论

设计 v1.0 **approved**（Agent 自审通过，2026-11-17）。批准范围：本设计覆盖的计划、实施、测试、交付记录与各阶段本地提交，以及交叉验证门禁 GREEN 后按 buding-merge 合入 master。push、npm 发布、打标签、远端设置、分支/worktree 删除不在本批准内。

依 2026-11-17 委托，本设计批准后直接产出同目录 `plan.zh.md` 并进入实施，不再等待人工批准。

---

## 10. T18 能力对齐修订（v1.1，2026-11-17，Agent 自审追加）

### 10.1 触发与依据

用户在实现过程中要求「仔细检查 SP003 的功能，是否达到 budingWorkerSpace 里的 TUI 级别」。据此对参考仓做了**只读行为事实盘点**（Read/Write/Edit/Glob+Grep/权限审批/检查点撤销/@补全/diff 呈现 8 组），把与本轮原设计的差异逐项列出，判定为「模型可感知的能力差距」的进入本节修订；属于实现细节偏好、且本仓已有等价或更强行为的，记为保留差异。

盘点只用于**行为对照**：本轮实现全部独立编写，未迁入参考仓源码、提示词、内部类型或 bundle；参考仓登录/模型绑定类事实按用户既定设计排除。

### 10.2 修订条目（能力差距 → 处理）

| # | 参考行为事实 | 原设计 | 修订后 | 证据 |
| --- | --- | --- | --- | --- |
| A1 | 覆盖既有文件前必须先 Read；读后被外部修改则拒绝写入 | 仅「调用方自带指纹」时校验 | **读后编辑门**：会话内记录已读文件与指纹；Write/Edit 覆盖既有文件前必须已 Read，否则 `BUDINGX_WORKSPACE_010`；读后内容变化则 `BUDINGX_WORKSPACE_011`；写/编辑成功后更新记录 | `workspace/test/tools.test.mjs` 门禁用例 |
| A2 | Write 自动创建缺失的父目录 | 父目录缺失即报错（WT-04） | **改为自动创建**；AC WT-04 相应修订（MODEL_PROPOSED） | `workspace/test/write.test.mjs` |
| A3 | Write 强制 LF，不再沿用旧文件 CRLF | 未规定 | Write 统一 CRLF→LF；**Edit 保留原文件主导行尾**（两者语义不同，已在代码注释与 §4.1 说明） | `workspace/test/write.test.mjs`、`workspace/test/edit.test.mjs` |
| A4 | 整文件超限时**报错**并提示改用 offset/limit（其 prompt 文案与实现不一致，本轮按实现对齐） | 超限截断并标注 | 整文件读取上限 256KB 超限**抛错**并给出 offset/limit 提示；范围读取上限 10MB；`@` 引用走范围读取（2000 行截断），与参考的 @mention 行为一致 | `workspace/test/read.test.mjs`、`workspace/test/context.test.mjs` |
| A5 | Grep 参数族：`output_mode`(content/files_with_matches/count)、`-A/-B/-C`、`head_limit`、`offset`、`multiline`、`type`；files 模式按 mtime 新→旧 | 仅内容模式 + 截断计数 | **实现完整参数族**；files 模式 mtime 新→旧、同 mtime 按名；count 模式 `path:occurrences` + 汇总；分页提示 `[Showing X of Y matching lines]` | `workspace/test/search.test.mjs` |
| A6 | 拒绝时可附反馈文字并回传给模型 | 无 | **拒绝反馈输入态**：审批卡按 `3`/`n` 进入反馈输入，Enter 提交（反馈以 `User feedback:` 追加进工具结果回传模型），Esc 静默拒绝 | `tui/test/approval-tiers.test.mjs`、`core/test/permissions.test.mjs` |
| A7 | `/diff` 面板源为 Current + 每回合 T1..Tn，←/→ 切换 | 二元（turn/current） | **多源**：Current + 各回合差异，←/→ 循环切换；当前差异按会话基线与磁盘现况重算 | `tui/test/diff-view.test.mjs` |
| A8 | `@file#L10-20` 行范围引用 | 无 | **支持 `#L` 行范围片段**，读取时按范围取行 | `workspace/test/context.test.mjs` |
| A9 | Tab 先补最长公共前缀（LCP），再应用选中项 | 直接应用选中项 | **LCP 优先**：候选多于一个且 LCP 更长时先补到 LCP，可继续细化 | `tui/test/completion.test.mjs` |
| A10 | `.git`/配置目录写入强制询问（在 allow 规则之前） | 无 | **`.git` 写入强制 ask**，优先于会话记忆与 allow 规则，deny 规则仍最高优先 | `workspace/test/policy.test.mjs` |
| A11 | 搜索结果注入权限 deny 规则（Read deny 的文件不进检索结果） | 无 | **搜索遵守 Read deny 规则**（Glob/Grep 排除被拒读的文件） | `workspace/tools.ts` + runtime 装配 |
| A12 | Edit 对弯引号做等宽归一匹配（findActualString） | 仅 CRLF 容错 | **弯引号容错**：等长折叠后定位匹配位置，只替换命中区段，文件其余引号风格不变 | `workspace/test/edit.test.mjs` |

### 10.3 保留差异（记录理由）

| # | 差异 | 理由 |
| --- | --- | --- |
| K1 | 行号格式用 `N→内容`，参考默认是 `N\t内容` | 本仓设计 v1.0 已定该格式且不影响能力锚点；参考的箭头格式是其 killswitch 回退路径 |
| K2 | Glob 默认遵守忽略规则（参考的 fork 默认 `--no-ignore`） | 能力矩阵要求「遵守忽略规则」；本仓按矩阵执行，差异记录在此 |
| K3 | Glob 上限 100、Grep 上限 250（与参考一致），但本仓默认值写在常量区可配置 | 可配置性为额外能力 |
| K4 | 会话记忆粒度为「工具+路径」，参考的会话档等于切到 acceptEdits 模式或加目录规则 | 本仓三模式语义固定为 USER_CONFIRMED，会话记忆不改变模式，只免重复询问；目录级记忆留待 SP004/SP006 |
| K5 | 未实现 rewind/消息级快照选择器、Read 去重、每次读取附加安全提醒 | 分别属 SP005（会话快照）、SP006（体验与 token 策略）；安全提醒属提示工程且不复制参考提示词 |
| K6 | 未实现图片多模态传递（参考会下发 base64 图像块并做缩放） | 属 SP007；本轮只给尺寸摘要，不假装已读图像内容 |
| K7 | 未实现 `.claude` 自身设置目录的专门保护档 | 本仓等价目标是 `~/.budingx` 用户数据目录（B-1，已实现）；项目内设置目录随 SP006 项目指令轮建立 |

### 10.4 契约影响

- `core/tools.ts`：`ToolContext` 增 `turnId`；`ApprovalDecision` 增 `feedback`（均向后兼容）。
- `core/events.ts`：`ChangeRecordSummary` 增可选 `turnId`。
- `core/constants.ts`：新增 `BUDINGX_WORKSPACE_010`（未读）、`_011`（陈旧读）。
- `workspace/constants.ts`：`MAX_FILE_BYTES` 256KB、新增 `MAX_READ_RANGE_BYTES` 10MB、`MAX_GLOB_RESULTS` 100、`MAX_GREP_RESULTS` 250。

### 10.5 自审结论（v1.1）

修订条目均为「补齐参考已验证的能力面」，未削弱任何既有门槛或底线规则；A1/A10 属**收紧**（更安全），A4 属错误语义对齐（模型拿到明确指引而非半截内容）。A2 改变了 AC WT-04 的行为（父目录缺失由报错改为自动创建），该 AC 为 MODEL_PROPOSED，相应修订已写入需求文档 v0.2 并在此登记。v1.1 **approved**（Agent 自审，2026-11-17），覆盖计划补充、后续实施、测试与交付。
## 验收修复设计增补

- `@` 引用按回合开始时的权限与文件现状解析并向模型传递，用户可见引用结果。补全正确引用含空格路径，并在目录前缀无匹配时支持跨目录文件名模糊匹配。
- 写工具生成一次变更计划，审批卡展示此计划的结构化差异，批准后校验文件路径与指纹再执行。检查点保留编辑前后的内容，按回合汇总差异，当前差异以会话基线和当前磁盘内容计算，另提供只读 Git 工作区与 HEAD 差异供源切换。撤销默认处理最近改动组并逐字节恢复文本；回合间撤销保持隔离。
- 扩展单文件 Grep、参数匹配、UTF-8、CRLF 和范围读取。工作区扫描、上下文和工具输出继续保持有界。独立实现对照旧 TUI 的行为，沿用项目的会话差异语义和三档权限决定。

## 模型管理面板修复（目标 0.3.1）

依据用户确认的独立 fix 分支范围，交互式 `/models` 打开管理面板，非交互保留清单文本。新增、编辑、删除、选择当前模型、启动默认、工具开关和孤儿凭据确认集中到面板。`/provider` 命令移除。

- 面板沿用参考 TUI 的列表、选中应用和 Esc 返回机制，使用独立 Ink 实现。新增页先选模板或 Custom，已知模板带入端点并聚焦隐藏密钥。回车后发起模型列表查询，选择 ID 后可测试、保存或保存并使用。
- 通过 Provider 层发起限时、可取消的模型发现和最小聊天探测，请求以当前草稿端点及主机绑定凭据为准。厂商原始错误不进入模型面板；拒绝重定向。发现不可用时保留手填；受支持模板在明确无列表接口时可显示标记过的建议 ID。
- 档案与凭据仍独立存储。只改模型或名称保留同主机凭据；编辑改主机需要重新设置。主机和密钥变更保存失败时回滚凭据。默认值 `null` 表示明确留空，兼容旧文件省略该字段后选首个档案的行为。删除活动或默认档案先确认替代或留空。
- 模型面板占用输入且在回合边界打开。关闭或取消后恢复队列；网络结果按取消信号丢弃，密钥不进入聊天输入、帧输出和历史。

接口文档：[DeepSeek 模型列表](https://api-docs.deepseek.com/api/list-models/) · [阿里云百炼模型列表](https://help.aliyun.com/zh/model-studio/list-models) · [火山方舟模型列表](https://console.volcengine.com/ark/region%3Acn-beijing/docs/models-api) · [硅基流动模型列表](https://api-docs.siliconflow.cn/docs/api/models-get)。

## 0.3.2 MiniMax 与百炼套餐兼容修复

用户 2026-11-18 报告 MiniMax 测试连接显示 `invalid_stream`，要求内置 MiniMax、独立分支和 0.3.2。Qwen 的实际原因经用户验证为 Token Plan 需要对应 URL。改动归 SP003 模型管理修复。

1. MiniMax 中国站模板预填官方 OpenAI 兼容地址。官方 M3 系列的思考会计入生成预算，探测使用 `max_completion_tokens`，Flash 使用低思考档；仍验证响应结构、HTTP 鉴权与工具调用。识别预算耗尽后仅有思考的响应，提示接通但未产生正文。
2. MiniMax M3 的工具续跑只回传相同档案、模型及主机来源的工具思考，其他 Provider 默认不携带。保留原非 MiniMax 请求形状。仓库复用现有 OpenAI 工具回合和旧 TUI 模型列表交互机制，独立实现厂商兼容。
3. 百炼按量与 Token Plan 范本分别绑定官方地址。工作空间模型列表用原生 API；套餐和通用端点先用兼容列表。不支持列表时给建议或手填。401/403 保持失败提示，并指向 Key、端点和套餐。
4. 验证顺序：先复现 MiniMax 探测误报，再测模板录入和列表退路、模型切换边界、全量回归、交叉验证门禁与 0.3.2 dry-run。保持独立修复分支，发布另行执行。

### 0.3.2 共享供应商配置

用户要求同一供应商配置一次即可使用多个模型。列表按空格标记多个 ID，Enter 返回表单后一次保存；A 从已有模型显式添加同组模型。列表不可用时 A 可手填新增模型 ID。

沿用现有档案数组与密钥引用。仅显式创建的组使用 group UUID 共享引用，绑定完整的规范化 Base URL。历史档案保持按档案 ID 与主机查找，格式版本不变，既有数据无需迁移。显式分组时只在完全相同端点迁移旧 Key，组内改 Key 或端点只更新该组。最后一个模型被删时才清理共享 Key。异账号可独立建组，按域名不会自动复用。凭据先写，档案写入失败则恢复原凭据快照。

### 0.3.2 全屏会话与终端标签

沿用 BudingX 的紫色与标识。现代交互终端使用 Ink alternate screen，固定底部编辑器和模式提示，中间视口默认跟随最新输出，用 PageUp／PageDown 翻页。旧式 Windows 控制台继续使用原有行内布局。标题使用 OSC 0，启动时设置为 `budingx`，首次实质输入生成限宽标题。仅本地计算，过滤控制字符并抑制含常见凭据特征的标题。信号点复用回合状态。`/clear` 重置标题，退出由 Ink 恢复终端主屏。
