# tui-parity-and-extensions · 设计

| 元数据 | 值 |
| --- | --- |
| 需求 slug | tui-parity-and-extensions |
| 所属 SP | SP006 |
| 版本 | v1.1（自审通过；实施偏差补记 D-12…D-14，2026-11-20） |
| 状态 | SELF_REVIEWED（Agent 自审 ≥2 轮，见 §16；无需人工审阅点，2026-11-17 委托） |
| 材料来源 | ①用户 m00001 原话；②`docs/iteration-plan.md` r9 SP006 行与出口门槛；③`docs/tui-command-roadmap.md`（2026-11-20）；④`docs/tui-fidelity-gap-baseline.md` §3.6；⑤`skills/buding-sdd/references/reference-repo-inventory.md` 行为事实锚点；⑥参考仓 `D:\my_project\budingWorkerSpace` 的**只读**行为侦察（本轮亲自核实，文件路径见各节「参考对照」） |
| 身份区分 | USER_CONFIRMED：功能目录、出口门槛、P0 判定项、命令清单、分支与不合入 master；MODEL_PROPOSED：模块切分、命名、字段契约的取舍与实现方式；OPEN：见 §15 |
| 关联链接 | `SP/SP006/tui-parity-and-extensions/requirements.md`；`SP/SP006/tui-parity-and-extensions/STATUS.md`；`docs/independent-development.md`；`docs/tui-fidelity-gap-baseline.md` |

## §1 背景与目标

### 1.1 前后行为对比

| 面 | 现状（master `dc94731`） | 本轮后（功能分支） |
| --- | --- | --- |
| TUI 结构 | `src/tui/app.tsx:1376-1623` 直接以 JSX 顺序排布首屏、消息、输入、底部元信息，区域边界靠 `flexShrink`/`flexGrow` 隐式维持 | 四区成为**显式契约**：区域标识、可见性、行高预算、resize 重排规则写入 `src/tui/render/layout.ts`，并可被单元与帧级用例断言 |
| 重绘 | 每次状态变化由 Ink 重新输出整棵组件树 | 渲染层内部引入**帧缓冲差分**与**消息冻结缓存**，只对变化行做更新；渲染输出可量化断言 |
| 键位 | `src/tui/editor/keys.ts:39` `applyKey(buffer,input,key,context)` 单一上下文、无 chord、无保留键校验 | 新增 `src/tui/keybindings/`：上下文块分发 + chord 前缀状态机 + 保留键校验 + 用户 `~/.budingx/keybindings.json` 覆盖（损坏隔离） |
| 状态栏 | `src/tui/app.tsx:1581-1601` 底部一行拼接模式/上下文/推理强度 | 新增 `src/tui/render/statusline.ts`：固定字段契约（13 字段）、外部命令通道（stdin JSON / stdout 渲染）、失败降级 |
| 命令面 | `src/tui/commands.ts:1-947` 单文件 `switch` 分发 | 迁移为 `src/tui/commands/` 注册表驱动，命令声明三型（local / local-jsx / prompt）与 `immediate`；既有命令行为不变（CMD-12 回归） |
| 项目指令 | 无 | 工作区级指令文件发现 + 注入（`src/tui/project-instructions.ts`） |
| 技能 | `src/tui/commands.ts` `loadSkillBody` 只扫 `~/.budingx/skills` 与 cwd `.budingx/skills` 的 `SKILL.md` | 目录级发现（`<dir>/SKILL.md`）+ frontmatter 解析 + 项目级优先 + 空正文降级 |
| MCP | 无 | stdio JSON-RPC 客户端（`src/tui/mcp/`），工具注册进 Agent 工具表，走既有审批 |
| hooks | 无 | 受控 hooks 引擎（`src/tui/hooks/`），事件 + 处理器类型 + 输出契约 |
| 联网来源 | 仅 `createWebSearchTool`（Tavily） | 新增网页正文抓取工具（`src/tui/tools/web-fetch.ts`），含内网拒绝、审批、体积上限、错误码 |
| 无头 CLI | `src/tui/cli.ts:60-90` `--prompt` 单回合，stdout 写 text_delta、stderr 写 notice，退出码 0/1 | 事件协议 `--output-format stream-json`、稳定退出码 0/1/2、非 TTY 自动无头、无头不写用户数据 |
| 制品 | `scripts/release/pack-smoke.mjs` 已有隔离安装冒烟 | 扩展为可复用的**验收脚本**，含 tarball 白名单、仓库外隔离安装、真实核心任务、`npm publish --dry-run` 骨架 |

### 1.2 目标

1. **P0 结构判定可复现**：四区骨架、冻结缓存、帧缓冲差分、上下文键位系统、状态栏契约五项各至少有 1 条自动化用例，且能给出 PASS/PARTIAL/MISS 结论。
2. **协议成为可复用契约**：命令三型、键位上下文与 chord、hooks 输出、MCP JSON-RPC、无头事件流五套契约以**类型 + fixture + 单测**三重固定。
3. **新增能力不破坏既有回合**：项目指令、技能、MCP、hooks、抓取全部挂在既有 `Session`/工具/审批链路上，任何新增失败都降级而不中断回合。
4. **制品可交付**：实际 tarball 仓库外隔离安装后能完成一次真实核心任务，并产出 npm dry-run 骨架。

### 1.3 明确排除

同 `requirements.md` §范围与非目标（12 项），设计上补充三条实现级排除：

| 排除 | 说明 |
| --- | --- |
| 不实现 Ink 之外的自研渲染引擎 | 基线 M1 决定「保留上游 Ink 8，在 `src/tui/render` 内自建受控扩展层」；本轮只加差分与冻结缓存，不换渲染栈 |
| 不做备用屏 / 鼠标选区 / kitty 图形协议 | 属可选预算项（R-A），超预算应拆轮 |
| 不做 Vim 双模式 | 键位系统先支持「vim 模式」作为**状态栏字段**，不引入模式机 |

### 1.4 保留行为（不得回归）

| 编号 | 行为 | 回归手段 |
| --- | --- | --- |
| K-01 | 回合事件联合类型、取消/排队/审批语义、错误码前缀 `BUDINGX_` 不变 | 既有单测全绿 + `src/tui/test/contract-*.test.mjs` 契约断言 |
| K-02 | 三档权限与底线规则不被绕过 | 新工具全部经既有 `approval` 通道；新增用例断言拒绝后磁盘不变 |
| K-03 | 检查点/撤销语义不变 | SP003 既有测试 |
| K-04 | 既有 22 条内联命令行为不变 | CMD-12 回归矩阵 |
| K-05 | `core` 零 IO、分层依赖不破 | `npm run test:checks`（module-boundaries） |
| K-06 | 用户数据只落 `~/.budingx` | 新增单测断言不触碰 `~/.claude` |

## §2 当前状态

### 2.1 已存在事实（本仓，含源码位置）

| 事实 | 位置 | 对本轮的意义 |
| --- | --- | --- |
| 命令分发是单文件 switch | `src/tui/commands.ts:52-947` | 迁移到注册表时需保持 `CommandOutcome` 语义与既有分支结果一致 |
| `CommandOutcome` 已有 14 个可选出口字段 | `src/tui/commands.ts:27-41` | 注册表执行结果需要能表达这些出口（面板类 → 模态槽） |
| 键处理是单函数无状态 | `src/tui/editor/keys.ts:39-120` | chord 需要在 `keys.ts` 之上引入**会话级前缀状态**，不能放在纯函数里 |
| 输入区与底部元信息已存在 | `src/tui/app.tsx:1536-1607` | 四区契约把这两块正式命名为「输入区」「页脚」 |
| 首屏渲染在消息区内部 | `src/tui/app.tsx:1386-1409` | 「首屏」需从消息区**提升为独立区域**，否则骨架判定不成立 |
| 上下文占用可取 provider 真实 usage | `src/tui/runtime.ts` `contextUsage.usage()` | 状态栏 `context_window` 字段有真实数据源；无数据时用占位 |
| 已有 `~/.budingx` 根与配置/凭据存储 | `src/tui/storage` 相关实现（`runtime.ts` 装配） | 新配置（hooks/键位/MCP）统一落该根 |
| 测试基建支持真实 Ink + 伪 TTY | `src/tui/test/helpers/mount-tty.mjs` | 帧级与 resize 用例可复用该基建 |
| AST 复核脚本已可用 | `scripts/review/sp004-ast.mjs` | 复用检测口径，新增 SP006 映射表 |
| 制品冒烟脚本已可用 | `scripts/release/pack-smoke.mjs` | 扩展为 SP006 验收脚本 |

### 2.2 不存在、必须新建

| 能力 | 新建位置 | 归属 |
| --- | --- | --- |
| 四区布局契约 | `src/tui/render/layout.ts` | tui-usability |
| 帧缓冲差分 | `src/tui/render/frame-buffer.ts` | tui-usability |
| 消息冻结缓存 | `src/tui/render/freeze-cache.ts` | tui-usability |
| 状态栏字段契约 + 外部命令 | `src/tui/render/statusline.ts`、`src/tui/statusline-command.ts` | tui-usability |
| 键位系统（上下文/chord/保留键/用户覆盖） | `src/tui/keybindings/{types,parser,contexts,reserved,resolve,validate}.ts` | tui-usability |
| 命令注册表 | `src/tui/commands/{registry,types}.ts` + 迁移后的命令目录 | 命令面 |
| 项目指令 | `src/tui/project-instructions.ts` | project-instructions |
| 技能发现 | `src/tui/skills.ts`（迁移 `commands.ts` 现有逻辑） | skills-and-mcp |
| MCP 客户端 | `src/tui/mcp/{client,config,tools}.ts` | skills-and-mcp |
| hooks 引擎 | `src/tui/hooks/{engine,config,types}.ts` | hooks |
| 网页正文抓取 | `src/tui/tools/web-fetch.ts` | web-retrieval |
| 无头事件协议 | `src/tui/headless/{events,runner}.ts` | headless-cli |
| 制品验收脚本 | `scripts/release/sp006-packaging.mjs` | npm-packaging |

### 2.3 假设（实施时必须验证）

| 编号 | 假设 | 验证方式 | 若不成立 |
| --- | --- | --- | --- |
| A-01 | Ink 8 允许在组件外做行级差分（自管 stdout 写入） | 在 `mount-tty` 基建上对比「全量输出字节 vs 差分输出字节」 | 退化为「渲染层内部差分 + 可断言帧」，TU-04 仍判定 PASS（口径写进 test-report） |
| A-02 | 伪 TTY 下 resize 能驱动 Ink 重新布局 | `mount-tty.resize()` 断言帧高变化 | 若不可用，则 TU-02 用 `layout.ts` 纯函数断言 + 记录 UI 部分 UNVERIFIED |
| A-03 | Node 22 内置 `fetch` 足以抓取网页 | 对本地 fixture HTTP 服务器实测 | 若不足，用 `node:https` 手写最小客户端 |
| A-04 | MCP stdio 服务器可用 `child_process` 拉起并按 JSON-RPC 行分隔读写 | 用仓库内假 MCP 服务器实测 | 若协议面过大，缩减到 `initialize`+`tools/list`+`tools/call` 三方法 |

## §3 方案总览

### 3.1 责任分层

```
src/tui/                      —— 宿主层（唯一持有终端与用户数据写入口）
  ├── render/                 —— 渲染契约层：layout / frame-buffer / freeze-cache / statusline
  │     ├── layout.ts            四区契约（区域 id、行高预算、resize 重排）
  │     ├── frame-buffer.ts      行级差分（只输出变化行）
  │     ├── freeze-cache.ts      消息排版冻结缓存（按条目 id + 宽度命中）
  │     └── statusline.ts        13 字段状态契约 + 外部命令输入构造
  ├── keybindings/            —— 键位契约层：contexts / parser / chord / reserved / resolve / validate
  ├── commands/               —— 命令注册表层：types（三型）/ registry / 各命令实现
  ├── project-instructions.ts —— 项目指令发现与注入
  ├── skills.ts               —— 技能发现与调用
  ├── mcp/                    —— MCP stdio 客户端与工具注册
  ├── hooks/                  —— 受控 hooks 引擎
  ├── tools/web-fetch.ts      —— 网页正文抓取
  ├── headless/               —— 无头事件协议与退出码
  └── runtime.ts / cli.ts     —— 装配与入口
```

### 3.2 依赖规则

1. `render/`、`keybindings/`、`commands/` 只依赖 `core` 契约与本仓 `storage` 的只读接口，**不直接读磁盘**（除显式 IO 模块）。
2. `mcp/`、`hooks/`、`tools/web-fetch.ts` 允许 IO（子进程 / 网络），但**必须**经既有审批与错误码通道。
3. 所有外部能力（mcp/hooks/web）返回**结构化失败**而非抛出未捕获异常；主回合按「失败不扩散」继续。
4. 新增模块一律 ESM、2 空格、无分号（沿用本仓风格）。
5. `core` 保持零 IO；`scripts/checks/module-boundaries.mjs` 规则不放宽。

## §4 tui-usability：四区骨架与渲染契约

### 4.1 四区契约

参考对照：参考仓以 Ink 组件分区渲染（首屏横幅、消息区、输入区、页脚），本仓结构同源但实现独立；本仓把分区从「JSX 顺序」提升为**可断言契约**。

```
┌─ 区域 A：首屏（header）────────────────────────────┐
│ 品牌行、模型行、工作区行、会话行（renderHeader 复用）  │
└───────────────────────────────────────────────────┘
┌─ 区域 B：消息区（transcript）───────────────────────┐
│ 历史消息（冻结缓存）+ live 流式区 + 审批/错误区       │
└───────────────────────────────────────────────────┘
┌─ 区域 C：输入区（input）───────────────────────────┐
│ 多行输入框、ghost text、队列提示、模态槽覆盖层         │
└───────────────────────────────────────────────────┘
┌─ 区域 D：页脚（footer）───────────────────────────┐
│ 权限模式 / Shift+Tab / Esc 打断 ‖ effort / context /  │
│ 外部命令状态栏输出（可为空）                          │
└───────────────────────────────────────────────────┘
```

契约（`src/tui/render/layout.ts`）：

```ts
export type RegionId = 'header' | 'transcript' | 'input' | 'footer'

export interface RegionSpec {
  id: RegionId
  minHeight: number
  maxHeight: number
  flexible: boolean
}

export interface LayoutInput {
  columns: number
  rows: number
  regions: RegionSpec[]
}

export interface LayoutPlan {
  regions: { id: RegionId; top: number; height: number }[]
  totalHeight: number
  overflow: 'none' | 'transcript' | 'input'
}

export function planLayout(input: LayoutInput): LayoutPlan
```

规则：
1. 页脚固定 1 行、输入区最小 3 行（多行输入需要可见）、首屏在**消息区为空**时占用其上方固定行数，消息非空时首屏折叠为 0 行（避免重复占用）。
2. 剩余高度全部给消息区；总高不足时**先压缩消息区**，其次提示 `overflow: 'transcript'`；输入区不得被压到 3 行以下。
3. `planLayout` 是纯函数，无 IO、无 React 依赖 → 可直接单测（TU-01/TU-02）。

### 4.2 帧缓冲差分

问题：Ink 每次状态变化重绘整树；长转录下输出字节线性增长。

方案：在 `src/tui/render/frame-buffer.ts` 实现**行级差分缓冲**，与 Ink 并存而非替换：

```ts
export interface FrameBuffer {
  width: number
  height: number
  lines: string[]
  version: number
}

export function diffFrames(prev: FrameBuffer | null, next: FrameBuffer): string[]
```

规则：
1. 输入是「已渲染的纯文本行数组」，输出是**需要重写的行**（含 ANSI 的整行内容）。
2. 相等行不输出；宽度变化（全行重写）标记 `reflow: true`。
3. 差分结果供两种消费方：(a) Ink 内 `<Static>`/自定义行组件只渲染 diff 行；(b) 无头/测试路径直接断言字节量下降。
4. 契约不改变 Ink 的输出协议；差分只减少**重复输出行数**。

验收：TU-04 —— 相同帧二次渲染 diff 行数为 0；单行变化时 diff 行数 = 1；宽度变化时整行重写。

### 4.3 消息冻结缓存

问题：已完成消息每帧重新排版（Markdown 渲染、宽度计算），长会话成本高且导致滚动抖动。

方案：`src/tui/render/freeze-cache.ts`

```ts
export interface FrozenEntry {
  id: string
  width: number
  lines: string[]
  hash: string
}

export interface FreezeCache {
  get(id: string, width: number): FrozenEntry | undefined
  set(entry: FrozenEntry): void
  invalidate(id: string): void
  clear(): void
  size(): number
}

export function createFreezeCache(limit = 500): FreezeCache
```

规则：
1. 缓存键 = 条目 id + 渲染宽度；宽度变化即失效重排（保证 CJK 宽度正确性，TU-10）。
2. 条目 id 来自回合事件的稳定标识（assistant 消息序号 / 工具调用 id），不得用数组下标（流式插入会错位）。
3. 上限 500 条，按插入序淘汰；淘汰后重排成本仍在可接受范围。
4. 流式未完成条目**不缓存**（内容仍在变）。

### 4.4 状态栏契约

参考对照：参考仓 `buildStatusLineCommandInput` 产出结构化 JSON 给外部命令（stdin），stdout 渲染为状态栏；本仓按同一**字段语义**独立实现（字段名与取值语义对齐，代码独立编写）。

契约（`src/tui/render/statusline.ts`）：

```ts
/** Hook 基础输入（所有 hook 处理器共用的 6 个字段）。 */
export interface HookBaseInput {
  session_id: string
  transcript_path: string
  cwd: string
  permission_mode: string
  agent_id: string
  agent_type: string
}

/** 状态栏专用字段（13 个）。 */
export interface StatusLineFields {
  session_name?: string
  model: { id: string; display_name: string }
  workspace: { current_dir: string; project_dir: string; added_dirs: string[] }
  version: string
  output_style: { name: string }
  cost: {
    total_cost_usd: number
    total_duration_ms: number
    total_api_duration_ms: number
    total_lines_added: number
    total_lines_removed: number
  }
  context_window: {
    total_input_tokens: number
    total_output_tokens: number
    context_window_size: number
    current_usage: {
      input_tokens: number
      output_tokens: number
      cache_creation_input_tokens: number
      cache_read_input_tokens: number
    } | null
    used_percentage: number
    remaining_percentage: number
  }
  exceeds_200k_tokens: boolean
  rate_limits?: {
    five_hour?: { used_percentage: number; resets_at: string }
    seven_day?: { used_percentage: number; resets_at: string }
  }
  vim?: { mode: string }
  agent?: { name: string }
  remote?: { session_id: string }
  worktree?: {
    name: string
    path: string
    branch: string
    original_cwd: string
    original_branch: string
  }
}

export type StatusLineInput = HookBaseInput & StatusLineFields

export function buildStatusLineInput(state: StatusLineState): StatusLineInput
export function renderStatusLine(input: StatusLineInput): string
```

外部命令通道（`src/tui/statusline-command.ts`）：

```ts
export interface StatusLineCommand {
  command: string
  args?: string[]
  timeoutMs?: number
}

export async function runStatusLineCommand(
  spec: StatusLineCommand,
  input: StatusLineInput,
): Promise<{ ok: true; text: string } | { ok: false; reason: string }>
```

规则：
1. stdin 收到 `JSON.stringify(input)`（单次写入 + 结束）；载荷 = hook 基础输入 6 字段 + 状态栏 13 字段**合并成一个 JSON 对象**。
2. 退出码 0 → 使用 stdout；归一化顺序：整体 trim → 按行 split → 每行 trim → 丢弃空行 → 以换行 join。
3. 退出码非 0 或执行异常 → **静默忽略**（只进 debug 日志），回落到内置状态栏，绝不中断会话（TU-10）。
4. 超时默认 **5000ms**（可配）；新一轮触发时中止上一轮未完成的执行。
5. 触发时机 **300ms 去抖**：仅在「最后一条 assistant 消息 id / 权限模式 / vim 模式 / 模型」变化时重算；结果文本与上次相同则不触发重绘。挂载时与命令串变化时立即执行一次（不去抖）。
6. 渲染：内联在页脚，dim 样式，**保留 ANSI 转义**，超宽截断；配置了 `padding` 时按其加水平内边距。
7. 字段来源：`model` 来自 provider 配置、`version` 来自 `src/tui/package.json`、`context_window` 来自既有 `contextUsage.usage()`、`cost` 在本仓无计费时以 0 填充、`transcript_path` 来自会话转录存储路径。
8. 可选字段（`session_name`/`rate_limits`/`vim`/`agent`/`remote`/`worktree`）**缺失即省略**；必填字段缺失时用占位值（如 `unknown`）保证字段集稳定。
9. `rate_limits.resets_at` 使用 Unix epoch **秒**（整数），与参考仓一致。

### 4.5 配置面落点

本仓用户数据根唯一（`~/.budingx`）。本轮新增配置面：

| 配置 | 落点 | 读取方式 | 说明 |
| --- | --- | --- | --- |
| 状态栏外部命令 | `~/.budingx/config.json` 的 `statusLine` 字段（`{ type: 'command', command: string, padding?: number }`） | 复用既有 `ConfigStore`（原子写、版本化、未知字段保留） | 不新建第三种文件格式 |
| 键位覆盖 | `~/.budingx/keybindings.json` | 独立读取器，损坏隔离 | 与 TU-08 一致 |
| hooks | `~/.budingx/hooks.json` | 独立读取器，损坏隔离 | 与 HK-01/HK-08 一致 |
| MCP 服务器 | `~/.budingx/mcp.json` | 独立读取器，损坏隔离 | 与 SM-09 一致 |

对应路径函数新增在 `src/storage/paths.ts`：`keybindingsPath()`、`hooksPath()`、`mcpPath()`（与既有 `configPath()`/`permissionsPath()` 同风格，`home` 可注入以便测试）。

偏离说明：参考仓把状态栏配置放在 `settings.json`、键位放在 `~/.claude/keybindings.json`。本仓**不沿用 `~/.claude`**（AGENTS.md 硬约束），并把状态栏并入既有 `config.json` 以复用原子写与版本迁移；键位/hooks/MCP 仍用独立文件，因为它们是「可整体损坏并需要隔离」的配置单元。

## §5 上下文键位系统

参考对照：参考仓 `src/keybindings/schema.ts` 定义 18 个上下文块，`parser.ts` 解析 `ctrl+shift+k` 语法，`reservedShortcuts.ts` 定义不可重绑键。本仓实现独立，**上下文块名与语法对齐以保证用户体验一致**，代码不复制。

### 5.1 上下文块（本仓首批）

本仓不追求 18 个全开，按本仓实际 UI 面落地 8 个（基线 M2「上下文块列表 + 键→action + chord 前缀状态机 + 保留键校验 + command:<slash> 引用 + 用户 keybindings.json 覆盖」）：

| 上下文 | 用途 | 绑定示例 |
| --- | --- | --- |
| `global` | 任意时刻可用 | `ctrl+c`（打断/退出，硬编码） |
| `chat` | 输入区空闲时的消息级操作 | `ctrl+o` 展开转录、`ctrl+r` 历史搜索 |
| `input` | 编辑器级操作 | `ctrl+a`/`ctrl+e` 行首行尾、`ctrl+g` 外部编辑器 |
| `confirmation` | 审批弹层 | `y` 允许一次、`n` 拒绝、`a` 本会话允许 |
| `transcript` | 转录视图 | `ctrl+o` 折叠/展开、`esc` 返回 |
| `help` | 帮助面板 | `esc` 关闭 |
| `select` | 列表选择器（模型/会话/技能） | `up/down` 移动、`enter` 确认、`esc` 取消 |
| `footer` | 页脚区域焦点 | `tab` 切换焦点 |

### 5.2 键位解析与 chord

```ts
export interface ParsedKey {
  ctrl: boolean; alt: boolean; shift: boolean; meta: boolean
  key: string
}

export interface Chord {
  prefix: string
  rest: string
}

export function parseKeyStroke(input: string): ParsedKey | null
export function parseChord(input: string): Chord | null
export function chordToString(chord: Chord): string
export function formatKeyStroke(key: ParsedKey): string
```

语法：`ctrl+shift+k`、`alt+enter`、`meta+/`；别名 `ctrl`/`control`、`alt`/`opt`/`option`、`meta`/`cmd`/`command`/`super`/`win`。
chord 前缀状态机（会话级，不能放纯函数）：

```ts
export interface KeyBindingResolver {
  pending: string | null
  resolve(context: KeyContext, key: ParsedKey): KeyResolution
}

export type KeyResolution =
  | { kind: 'action'; action: string; command?: string }
  | { kind: 'pending'; prefix: string }
  | { kind: 'unbound' }
  | { kind: 'reserved'; key: string; severity: 'error' | 'warning' }
```

规则：
1. 未命中前缀的键若落在 `pending` 候集中 → 进入 pending；否则清空 pending。
2. pending 状态下收到不匹配键 → 丢弃并回落（不执行任何动作）。
3. 绑定目标可以是 action 名或 `command:<slash>`（直接触发一条命令）。

### 5.3 保留键校验

```ts
export const NON_REBINDABLE = ['ctrl+c', 'ctrl+d', 'ctrl+m'] as const
export const TERMINAL_RESERVED = ['ctrl+z', 'ctrl+\\'] as const

export interface KeybindingWarning {
  kind: 'parse_error' | 'duplicate' | 'reserved' | 'invalid_context' | 'invalid_action'
  severity: 'error' | 'warning'
  message: string
}
```

规则：
1. `ctrl+c`/`ctrl+d`/`ctrl+m` 为 **error** 级不可重绑；`ctrl+z` 为 warning（SIGTSTP），`ctrl+\` 为 error（SIGQUIT）。
2. Windows 不追加 macOS 的 cmd 保留键（macOS 专属）。
3. 用户文件解析失败 → **隔离**：忽略该文件、记录 warning、保留默认绑定（TU-07）。
4. 重复绑定同键同上下文 → warning，保留先注册者。

### 5.4 用户键位覆盖

文件：`~/.budingx/keybindings.json`（**不是** `~/.claude`）。

```json
{
  "bindings": [
    { "context": "chat", "bindings": { "ctrl+t": "command:/tasks" } }
  ]
}
```

结构与参考仓表面一致（`bindings[]{context, bindings}`），实现独立。合并顺序：默认 → 用户（用户覆盖同名键），非法项跳过并产出 warning。

## §6 命令注册表与命令面

### 6.1 三型契约

参考对照：参考仓 `src/types/command.ts` 定义 `local` / `local-jsx` / `prompt` 三型；本仓采用**同语义**的独立契约。

```ts
export type CommandKind = 'local' | 'local-jsx' | 'prompt'

export interface CommandResult {
  kind: 'text'
  value: string
  /** 宿主副作用（面板/退出/技能提示），既有 CommandOutcome 的桥接，见 D-11 */
  outcome?: CommandOutcome
}

export interface CommandDefinition {
  name: string
  aliases?: string[]
  kind: CommandKind
  summary: string
  immediate?: boolean
  hidden?: boolean
  supportsNonInteractive?: boolean
  progressMessage?: string
  run(args: string, context: CommandContext): Promise<CommandResult>
}
```

语义对齐（行为锚点）：

| 型 | 语义 | 本仓实现 |
| --- | --- | --- |
| `local` | 内联文本输出，不进入模型 | 现有命令迁移至此；返回纯文本 |
| `local-jsx` | 打开**模态槽**渲染交互面板，结果可选择是否继续问模型 | 映射到本仓既有面板（models/effort/rules/resume/rewind/context/diff） |
| `prompt` | 展开为模型提示并走正常回合 | 新增 `/btw`、`/init` 等 |

`immediate` 标记：`true` 表示该命令无需用户确认立即执行（参考仓同名字段，语义一致）。

### 6.2 模态槽

本仓既有面板以 React 组件存在（`model-manager.tsx`、`rules-manager.tsx` 等）。本轮把「模态槽」定义为**统一挂载点**：

```ts
export interface ModalSlot {
  id: string
  title: string
  render(props: { onDone: (result?: unknown) => void }): unknown
}
```

规则：
1. 同一时刻最多一个模态槽占用输入区；模态打开时 `input` 上下文键位切到 `select`/`confirmation`。
2. 模态关闭后焦点回到 `chat`，键位上下文复位。
3. 模态槽不修改既有面板组件内部实现，只统一入口与生命周期。

### 6.3 新增命令面（SP006 必须落地）

| 命令 | 型 | 语义 | AC |
| --- | --- | --- | --- |
| `/init` | `prompt` | 生成项目说明（AGENTS.md 风格）骨架，产出文件前走审批 | CMD-05 |
| `/btw` | `prompt` | 旁路提问：不污染主会话上下文，单独问模型并回显答案 | CMD-06 |
| `/worktree` | `local` | 列出/创建/切换 Git worktree（复用 SP004 安全边界） | CMD-07 |
| `/tasks` | `local` | 列出后台/未完成任务 | CMD-08 |
| `/mcp` | `local-jsx` | MCP 服务器与工具列表面板 | CMD-09 |
| `/skills` | `local-jsx` | 技能清单面板（发现结果 + 说明） | CMD-10 |
| `/export` | `local` | 导出会话（JSONL/文本）到 `~/.budingx` 下或用户指定路径 | CMD-11 |

### 6.4 既有命令迁移

现有 22 条内联命令（`help/exit/quit/clear/new/reset/config/models/model/permission/rules/diff/undo/rewind/denials/sessions/resume/continue/context/compact/cost/usage/plan/permissions/allowed-tools/memory/effort`）迁移到注册表，**行为与输出一致**（CMD-12 回归矩阵逐条比对既有测试期望）。

## §7 project-instructions

### 7.1 发现规则

优先级由高到低：

1. `~/.budingx/AGENTS.md`（用户级）
2. 工作区父目录 `AGENTS.md` / `CLAUDE.md`（PI-02：受限向上，默认最多 3 层，遇到用户主目录或文件系统根即停；更远者靠前）
3. 工作区根 `<workspace>/AGENTS.md`
4. 工作区根 `<workspace>/CLAUDE.md`（兼容既有生态习惯）
5. 子目录 `AGENTS.md`（仅当用户显式启用 `--include-nested-instructions`，默认关闭）

冲突：用户级与工作区级**都加载**，工作区级排在后面（更具体者靠后）；同名冲突以工作区级为准。

### 7.2 注入契约

```ts
export interface ProjectInstructions {
  files: string[]
  content: string
  sources: { path: string; bytes: number }[]
}

export async function loadProjectInstructions(
  options: { workspaceDir: string; homeDir: string; includeNested?: boolean },
): Promise<ProjectInstructions>
```

规则：
1. 单文件上限 64 KiB；超出截断并标注。
2. 总上限 128 KiB。
3. 注入位置：**首条用户消息之前**的系统上下文（不改写用户原文）。
4. 内容变更时，**下一回合**生效（不打断当前回合）。
5. 注入失败（读文件报错）→ 忽略该文件并返回 notice，不中断。

## §8 skills-and-mcp

### 8.1 技能

现状：`src/tui/commands.ts` 的 `loadSkillBody` / `discoverSkillCommands` 已能扫 `~/.budingx/skills` 与 cwd `.budingx/skills` 的 `<dir>/SKILL.md`，取 frontmatter 的 name/description。

本轮改造：

```ts
export interface SkillEntry {
  name: string
  description: string
  body: string
  path: string
  scope: 'user' | 'project'
  valid: boolean
  error?: string
}

export async function discoverSkills(options: {
  homeDir: string
  workspaceDir: string
}): Promise<SkillEntry[]>
```

规则：
1. 扫描目录：`<root>/skills/<dir>/SKILL.md`；`<root>` ∈ {`~/.budingx`, `<workspace>/.budingx`}。
2. frontmatter 缺失/解析失败 → `valid:false`，**保留条目**并在 `/skills` 面板显示原因（不静默丢弃）。
3. 正文为空 → 视为无效技能，调用时返回明确提示（SM-05 降级）。
4. 同名冲突：项目级覆盖用户级。
5. 技能以 `prompt` 型命令暴露（`/<skillname>`），执行时把正文作为模型上下文注入。

### 8.2 MCP

参考对照：参考仓 MCP 客户端在 `src/services/mcp/client.ts`，工具命名 `mcp__<server>__<tool>`，方法面含 `initialize` / `tools/list` / `tools/call`，并处理 `tools/list_changed` 通知。

本仓实现（`src/tui/mcp/`）：

```ts
export interface McpServerConfig {
  name: string
  command: string
  args?: string[]
  env?: Record<string, string>
  enabled?: boolean
}

export interface McpToolDescriptor {
  name: string
  description?: string
  inputSchema?: unknown
}

export class McpClient {
  static async connect(config: McpServerConfig): Promise<McpClient>
  listTools(): Promise<McpToolDescriptor[]>
  callTool(name: string, args: unknown): Promise<unknown>
  close(): Promise<void>
}
```

配置位置：`~/.budingx/mcp.json`（`{ "mcpServers": { "<name>": {...} } }`），密钥只允许引用环境变量名（`${ENV_NAME}`），**不落明文**。

规则：
1. 传输：stdio，JSON-RPC 2.0，按行分隔。
2. 连接流程：`initialize` → `notifications/initialized` → `tools/list`。
3. 工具注册名：`mcp__<server>__<tool>`（与参考仓命名一致，便于迁移用户配置）。
4. MCP 工具调用**必须**经既有审批通道（用户逐次确认或会话允许），拒绝则返回结构化拒绝结果，不调用服务端。
5. 连接/调用失败 → 结构化失败（错误码 `BUDINGX_MCP_*`），回合继续。
6. 超时：连接 10s、调用 30s（可配）。
7. 服务器崩溃 → 关闭客户端、移除其工具、给出 notice。

## §9 hooks

### 9.1 事件与处理器

参考对照：参考仓 `HOOK_EVENTS`（`src/entrypoints/sdk/coreTypes.ts:24-52`）28 个事件；`src/schemas/hooks.ts` 定义 matcher/处理器类型。

本轮落地**受控子集**（不追求 28 全量）：

| 事件 | 触发时机 | 处理器类型 |
| --- | --- | --- |
| `SessionStart` | 回合/会话启动 | command / prompt |
| `UserPromptSubmit` | 用户提交消息后、调用模型前 | command / prompt |
| `PreToolUse` | 工具执行前 | command / prompt |
| `PostToolUse` | 工具成功执行后 | command / prompt |
| `PostToolUseFailure` | 工具失败后 | command |
| `Stop` | 回合正常结束 | command / prompt |
| `StopFailure` | 回合异常结束 | command |
| `Notification` | 需要通知用户时 | command |

### 9.2 输出契约

对齐参考仓 `syncHookResponseSchema`（`src/types/hooks.ts:59-163`）的**语义子集**：

```ts
export interface HookResponse {
  continue?: boolean
  suppressOutput?: boolean
  stopReason?: string
  decision?: 'approve' | 'block'
  reason?: string
  systemMessage?: string
  hookSpecificOutput?: {
    hookEventName: HookEventName
    permissionDecision?: 'allow' | 'deny' | 'ask'
    permissionDecisionReason?: string
    updatedInput?: unknown
    additionalContext?: string
  }
}
```

### 9.3 执行规则

1. 处理器类型：`command`（执行 shell，stdout 为 JSON 或文本）、`prompt`（把输出作为上下文注入）。`http` 与 `agent` 类型本轮**不实现**（显式记录 OPEN）。
2. 退出码 2 = 阻塞错误 → 阻断当前动作（PreToolUse 则拒绝工具调用），错误文本作为原因。
3. 其他非 0 退出码 = 非阻塞错误 → 记 notice，回合继续。
4. `PreToolUse` 的 `permissionDecision`：`allow` 放行、`deny` 拒绝、`ask` 走审批。
5. `updatedInput` 覆盖工具入参（仅当工具允许被改写）。
6. `additionalContext` 追加为模型上下文。
7. 超时（默认 30s，可配）→ 视为非阻塞错误。
8. 配置：`~/.budingx/hooks.json`，结构 `{ "hooks": { "<event>": [{ "matcher": "...", "hooks": [{ "type": "command", "command": "...", "timeout": 30 }] }] } }`。
9. hooks 失败**永不**让会话崩溃（HK-07）。

## §10 web-retrieval

既有 `createWebSearchTool`（Tavily）保留不变；本轮新增**网页正文抓取**工具：

```ts
export interface WebFetchOptions {
  maxBytes?: number
  timeoutMs?: number
  allowPrivateHosts?: boolean
}

export interface WebFetchResult {
  url: string
  finalUrl: string
  status: number
  contentType: string
  text: string
  truncated: boolean
  bytes: number
}

export function createWebFetchTool(options: WebFetchOptions): Tool
```

规则：
1. 默认最大体积 512 KiB，超出截断并标注 `truncated: true`。
2. 解析 HTML → 纯文本（去脚本/样式/导航噪声，保留段落换行）。
3. **内网默认拒绝**：解析目标主机 IP，若为私网/回环/链路本地地址 → 拒绝（错误码 `BUDINGX_WEB_PRIVATE_HOST`）。
4. 抓取前经既有审批通道（外网访问需确认），拒绝则不发起请求。
5. 超时默认 15s；HTTP 非 2xx → 结构化失败（携带状态码）。
6. 重定向最多跟随 3 次，每次重新做内网检查。
7. 工具入参仅接受 `url`，不接受任意 header 注入。

## §11 headless-cli：无头事件协议

参考对照：参考仓 `src/cli/print.ts` 与 `src/main.tsx` 支持 `--output-format text|json|stream-json`、`--input-format text|stream-json`；stream-json 每行一个 JSON 事件，事件 `type` ∈ {system,user,assistant,result}，终态 `result` 事件字段固定。

### 11.1 CLI 契约

```
budingx --prompt "<文本>" [--output-format text|json|stream-json] [--input-format text|stream-json]
          [--input-file <path>] [--session <id>] [--verbose]
```

| 参数 | 取值 | 默认 | 说明 |
| --- | --- | --- | --- |
| `--prompt` | 文本 | — | 无头单回合输入（既有参数，保持不变） |
| `--output-format` | `text` / `json` / `stream-json` | `text` | `text` 只输出最终文本（无 ANSI）；`json` 输出单个结果对象；`stream-json` 逐行事件流 |
| `--input-format` | `text` / `stream-json` | `text` | `stream-json` 时从 stdin 读多轮输入，每行一个用户消息对象 |
| `--input-file` | 路径 | — | 从文件读输入（与 `--prompt` 互斥） |
| `--session` | 会话 id | — | 复用既有会话（与 SP005 转录恢复一致） |
| `--verbose` | 布尔 | `false` | 打印诊断到 stderr（不影响 stdout 协议） |

规则：
1. **stdout 只承载协议数据**：不得写入 ANSI 控制序列、进度条或提示语；诊断一律走 stderr。
2. 非 TTY 且未显式指定格式 → 自动进入无头模式（HC-06），不尝试渲染交互界面。
3. 未知参数、互斥参数、非法格式值 → 用法错误到 stderr，退出码 **2**（HC-05）。
4. 无头模式**不写用户数据**（会话历史/记忆），除非显式 `--session` 指定既有会话（HC-07）。

### 11.2 事件契约（stream-json）

每行一个 JSON 对象，字段顺序稳定：

```ts
export type HeadlessEvent =
  | { type: 'system'; subtype: 'init'; session_id: string; model: string; tools: string[] }
  | { type: 'system'; subtype: 'status'; state: 'starting' | 'running' | 'waiting_permission' | 'stopping' }
  | { type: 'user'; message: { role: 'user'; content: string } }
  | { type: 'assistant'; message: { role: 'assistant'; content: string }; delta: boolean }
  | { type: 'tool_call'; tool_use_id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error: boolean }
  | { type: 'result'; subtype: 'success' | 'error_during_execution' | 'error_max_turns'; is_error: boolean; duration_ms: number; duration_api_ms: number; num_turns: number; stop_reason: string; session_id: string; total_cost_usd: number; usage: unknown; permission_denials: unknown[]; errors?: { code: string; message: string }[] }
```

规则：
1. 事件顺序 = 回合实际顺序；`result` 永远是最后一个事件。
2. 工具调用/工具结果为**独立事件类型**（参考仓把工具块嵌在 assistant 消息内容里；本仓提升为一等事件以便脚本消费，字段名 `tool_use_id`/`name`/`input`/`content`/`is_error` 与参考语义一致）。
3. `result.is_error` 为真 → 退出码 1；否则 0（HC-04/TU-15）。
4. `usage` 采用既有 provider 真实 usage 结构；无 usage 时为 `null`（不伪造）。
5. `total_cost_usd` 本仓无计费 → 恒为 `0`（不虚构账单）。
6. `json` 输出格式 = 单独一个 `result` 对象（去掉 `type` 字段包装）。

## §12 npm-packaging

### 12.1 制品白名单

沿用并强化 `scripts/release/pack-smoke.mjs` 的白名单：`package.json`、`README.md`、`LICENSE`、`dist/**/*.js`。**不得**包含 `src/`、`test/`、`node_modules/`、`artifacts/`、`.env`、`credentials*.json`、`*.pem`、`*.key`。

### 12.2 仓库外隔离安装

验收脚本 `scripts/release/sp006-packaging.mjs`：

1. `npm pack src/tui` → 在**仓库外**的临时目录 `npm init -y && npm install <tarball>`。
2. 断言安装后的 `budingx --version` 与 `src/tui/package.json` 版本一致。
3. 用本地 SSE fixture 端点跑一次 `--prompt` 真实核心任务，断言流式输出与退出码 0。

### 12.3 npm dry-run 骨架

`npm publish --dry-run --json`（在 `src/tui` 目录）产出文件清单/体积/入口，**不上传**（NP-04）。台账（`release-ledger.json`）新增条目：版本、源码 SHA（功能分支 HEAD）、状态 `prepared`、回执占位（NP-05）。

## §13 独立来源与 AST 复核

### 13.1 复核口径

复用 `scripts/review/sp004-ast.mjs`（阈值不变）：`TEXT_NODE_MIN=30`、`FUNCTION_NODE_MIN=60`、`SIMILARITY_MIN=0.80`、`CANDIDATE_SIMILARITY_MIN=0.45`；判定口径为「≥30 节点连续相同归一化子树」或「双方 ≥60 节点且 trigram-dice ≥0.80」。

### 13.2 本轮扩展

1. 新增 SP006 映射表条目：本轮**每个**改动的源码文件都要有对照项（`本仓路径 → 参考仓对照路径`）或显式标注「无对应参考模块（新协议层）」。
2. 映射表允许第三种形态：`{ note: '原因' }`，用于本仓自有模块（如 AST 复核脚本自身、制品脚本）；未映射文件**直接失败**（AST-01）。
3. 命中项必须给出处置结论（惯用样板 / 独立编写说明 / 协议对齐但独立实现），未处置命中标 `UNRESOLVED` 并失败（AST-02）。
4. 脚本自检三项保持全绿（AST-03）。

### 13.3 协议对齐的表述纪律

与参考仓对齐的是**协议字段名与行为语义**（JSON 字段、退出码、事件类型、命令三型语义、保留键清单），**不是**代码结构。实现独立编写，命名与内部结构按本仓风格；所有「对齐点」在设计里以「参考对照」标注出处，便于复核。

## §14 验证策略

### 14.1 证据分层（互不冒充）

| 层 | 含义 | 本轮手段 |
| --- | --- | --- |
| L1 单元 | 纯函数与契约断言 | `src/tui/test/*.test.mjs`（node:test），需先 `npm run build` |
| L2 真实进程 | 子进程/服务器/HTTP fixture | 假 MCP 服务器、假 hook 脚本、本地 HTTP fixture、真实 CLI 子进程 |
| L3 UI 帧级 | 真实 Ink + 伪 TTY | 复用 `src/tui/test/helpers/mount-tty.mjs` |
| L4 制品安装 | 实际 tarball 隔离安装 | `scripts/release/sp006-packaging.mjs` |
| L5 真实 Provider | 真实模型调用 | 本轮**不依赖**真实 Provider（无凭据则记 UNVERIFIED） |

### 14.2 AC → 证据映射（每条 AC 至少 L1 + 一项功能用例）

| AC 组 | L1 | 其他 |
| --- | --- | --- |
| TU-01…TU-13 | `sp006-tui-layout.test.mjs`、`sp006-keybindings.test.mjs`、`sp006-statusline.test.mjs`、`sp006-render-cache.test.mjs` | L3（`sp006-tui-frames.test.mjs`）、L2（外部命令真实进程） |
| TU-14/TU-15、HC-01…HC-07 | `sp006-headless.test.mjs` | L2（真实 CLI 子进程） |
| PI-01…PI-05 | `sp006-project-instructions.test.mjs` | L2（临时 home + 临时工作区） |
| SM-01…SM-09 | `sp006-skills.test.mjs`、`sp006-mcp.test.mjs` | L2（假 MCP 服务器进程） |
| HK-01…HK-08 | `sp006-hooks.test.mjs` | L2（真实 hook 脚本进程）+ fixture |
| WR-01…WR-05 | `sp006-web-fetch.test.mjs` | L2（本地 HTTP fixture） |
| NP-01…NP-05 | `sp006-release-ledger.test.mjs` | L4（制品脚本） |
| CMD-01…CMD-12 | `sp006-command-registry.test.mjs` | L2/L3 |
| AST-01…AST-03 | — | 脚本执行（`node scripts/review/sp004-ast.mjs …`） |

### 14.3 执行命令

```bash
npm run build            # tsc -p src/tui/tsconfig.json
npm run test:unit        # node --test src/*/test/*.test.mjs
npm run test:checks      # module-boundaries
npm run spec:check
npm run skills:check
node scripts/release/sp006-packaging.mjs
node scripts/review/sp004-ast.mjs --reference <ref> --reference-revision <rev> --base master
npm test                 # 全量门禁
```

### 14.4 判定口径

1. P0 五项逐项给 **PASS / PARTIAL / MISS**（PASS = 有自动化用例且实跑通过；PARTIAL = 有用例但只覆盖部分判据；MISS = 无用例或未跑）。
2. 零测试、全 skip、未执行 → 不得记 PASS。
3. UI 层证据若受终端/环境限制无法自动判定 → 记 UNVERIFIED 并写恢复条件。

## §15 风险与有意偏离

### 15.1 有意偏离（行为锚点仍对齐）

| 编号 | 偏离 | 理由 | 影响 |
| --- | --- | --- | --- |
| D-01 | 帧差分做**行级**，参考仓是**单元格级**（自研 fork Ink 的 cell buffer + 样式池 + patch 联合） | 基线 M1 决定保留上游 Ink 8，不 fork 渲染器；行级差分可在 Ink 输出层实现 | 中间字符变化（spinner/状态栏）重写整行，闪烁略多于参考；P0 判定按「只输出差异行」口径 |
| D-02 | 冻结缓存用「条目 id + 宽度」键的**排版结果缓存**；参考仓用「离屏时返回同一 React 元素引用」 | 本仓不 fork Ink 渲染管线，无法用元素引用恒等触发 React 跳过 | 等价效果（离屏/未变化消息不重排）；实现机制不同 |
| D-03 | 键位上下文 **8 个**，参考仓 18 个 | 本仓 UI 面较小（无主题/插件/标签页/附件选择器） | 后续轮次按需扩展 |
| D-04 | hooks 事件 **8 个**，参考仓 28 个 | USER_CONFIRMED「受控 hooks」；先覆盖回合关键路径 | 未覆盖事件本轮记 NOT_IMPLEMENTED |
| D-05 | hooks 处理器类型 **command / prompt**；参考仓另有 http / agent | http 需要出网与信任策略，agent 需要子代理（SP007） | 显式 OPEN |
| D-06 | MCP 仅 **stdio + initialize/tools/list/tools/call** | 参考仓支持 OAuth 远程 MCP、resources/prompts 协商 | 显式 OPEN |
| D-07 | 页脚保留本仓既有的 **effort / 上下文占用** 显示；参考仓页脚不含这两项（context 压力是独立告警组件、cost 只进状态栏载荷） | 本仓既有可见行为不得回归（K-04/保留行为） | 页脚信息量高于参考；状态栏载荷字段与参考一致 |
| D-08 | 状态栏配置并入 `~/.budingx/config.json`（参考仓用 `settings.json`） | 复用既有 ConfigStore 原子写与版本迁移；避免第三种文件格式 | 无功能差异 |
| D-09 | **单一终端模式**（参考仓有 classic scrollback + fullscreen 双模式） | 路线图 r9：「渲染模式先单一普通滚动 + 冻结缓存，fullscreen/虚拟列表/鼠标/备用屏列受控扩展预算，超预算拆轮」 | 本仓现有 `alternateScreen` 行为保持不变，不新增模式 |
| D-10 | 粘贴截断（>10000 字截断为首尾各 500 + 占位）、图片粘贴、外部编辑器、stash、kill-ring、`ctrl+r` 历史搜索 **不在本轮实现** | 属 P1 输入编辑完整性批次，超出 SP006 出口门槛 | 记 OPEN，归属后续轮次 |
| D-11 | `CommandResult` 在文本结果外增加可选 `outcome`（`CommandOutcome` 桥接） | 既有 22 条命令的面板/退出副作用必须原样保留（CMD-12 行为不变），纯文本结果无法表达 | 契约是设计 §6.1 的超集；新增命令可只返回文本 |
| D-12 | `/tasks` 读宿主**后台任务登记表**（真实子进程记录：状态/退出码/输出路径）；不读 todo/计划清单 | CMD-08 明确要求状态、退出码、输出路径，todo 清单没有这些字段；登记表由 `TaskRegistry` 提供，命令只读 | 命令面与设计 §6.3 语义一致；后台任务来源为 `src/tui/tasks.ts`，agent 回合暂不自动登记 |
| D-13 | `/init` 在 `AGENTS.md` 已存在时直接拒绝并输出路径；`/btw` 为空时输出用法；`/mcp`、`/skills` 在非交互模式降级为文本列表 | CMD-05 要求不覆盖、需确认；空问题不应提交给模型；local-jsx 在无 UI 宿主必须有等价输出（CMD-01/CMD-12） | 与设计 §6.3 语义一致；模态槽在 TUI 内由 `commandOverlay` 承载 |
| D-14 | `src/core/exec.ts` 的 `CommandResult` 增加 `command?`、`startedAt?`；后台任务快照回填二者 | /tasks 需要展示实际命令行与启动时间；既有字段不足以区分同类任务 | 纯增量字段，既有调用方无需改动 |

### 15.2 风险

| 编号 | 风险 | 缓解 |
| --- | --- | --- |
| R-01 | 行级差分与 Ink 重绘模型冲突，导致重复输出或错位 | 先做纯函数差分单测，再接渲染层；保留「全量输出」回退开关 |
| R-02 | 冻结缓存键设计不当导致宽度变化后错位 | 键含宽度；CJK 宽度断言用例（TU-11）；resize 用例 |
| R-03 | MCP 协议面越界拖长本轮 | 只做三方法 + tools 能力子集；其余显式 NOT_IMPLEMENTED |
| R-04 | hooks 可执行任意命令，安全面扩大 | 默认只读用户配置、命令超时可控、失败降级、exit 2 明确阻塞 |
| R-05 | 无头事件流破坏既有 `--prompt` 行为 | 默认 `text` 保持 stdout 纯文本；既有测试全绿作为门槛 |
| R-06 | 范围过大导致质量下滑 | 四波推进（P0 骨架 → 命令注册表 → 能力目录 → 制品），每波跑既有回归 |
| R-07 | 新文件未进 AST 映射表导致门禁 RED | 提交前先跑 AST 脚本，映射表随代码同批更新 |
| R-08 | 制品验收受网络/npm 环境波动影响 | 使用本地 fixture 与已有 `pack-smoke` 基建；失败时记录为 UNVERIFIED 而非伪造 |

### 15.3 OPEN 项（明确不在本轮，需后续轮次接手）

1. hooks 的 `http` / `agent` 处理器类型；hooks 事件补齐到参考仓 28 个。
2. MCP 的 OAuth 远程服务器、resources/prompts 能力协商、`tools/list_changed` 动态刷新。
3. 键位上下文补齐到 18 个；vim 双模式；鼠标选区；备用屏与 kitty 协议。
4. 输入编辑完整性：粘贴截断、图片粘贴、外部编辑器、stash、kill-ring、`ctrl+r` 历史搜索。
5. 单元格级差分（需自研渲染层）与参考仓双终端模式。
6. `/agents`、子代理、多模态（SP007）；浏览器（SP012）；Computer Use（SP013）；定时任务（SP014）。

## §16 自审记录

### 16.1 第 1 轮自审（对照参考仓协议事实）

| 编号 | 发现 | 处理 |
| --- | --- | --- |
| S1-01 | 初稿 §4.4 的 `context_window.current_usage` 写成数字，与参考仓协议（对象或 null）不符 | 已改为 `{input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens} | null` |
| S1-02 | 初稿状态栏载荷缺少 hook 基础输入 6 字段（session_id/transcript_path/cwd/permission_mode/agent_id/agent_type）与 `worktree` | 已补齐；并明确「基础输入 6 + 状态栏 13」两段式契约 |
| S1-03 | 初稿超时 2000ms、stdout 归一化未定义 | 对齐参考仓 5000ms；补 stdout 归一化顺序与退出码非 0 静默忽略 |
| S1-04 | 初稿未声明差分粒度与参考仓（cell 级）的差异 | 写入 D-01，并给出 P0 判定口径 |
| S1-05 | 初稿冻结缓存机制与参考仓离屏元素引用法不同 | 写入 D-02，说明等价效果与实现差异 |
| S1-06 | 初稿配置落点混用 `~/.budingx/*.json` 与 config.json，无统一说明 | 新增 §4.5 配置面落点表 + 与参考仓 `settings.json`/`~/.claude` 的偏离说明（D-08） |
| S1-07 | hooks/MCP/键位配置损坏隔离策略未成文 | 写入各节规则（HK-08/TU-08/SM-09），损坏即隔离并保留备份 |

### 16.2 第 2 轮自审（AC 覆盖与边界复核）

| 编号 | 发现 | 处理 |
| --- | --- | --- |
| S2-01 | TU-09 要求「缺失字段用占位而非省略」，与参考仓「可选字段缺失即省略」冲突 | 规则 8 分层：可选字段省略、必填字段占位；TU-09 的「占位」只针对必填字段缺失 |
| S2-02 | 初稿列出的键位上下文数（8）与路线图 r9「键位 18 上下文块」表述不一致 | 记为 D-03 偏离并写明扩展路径；不伪称已达 18 |
| S2-03 | 初稿 hooks 只写 3 类输出，未覆盖 `suppressOutput`/`systemMessage` | HK-03 已含四种语义，§9.2 契约补全字段 |
| S2-04 | 初稿无头事件未区分「工具调用/工具结果」为一等事件 | §11.2 提升为 `tool_call`/`tool_result` 事件并注明与参考仓的差异 |
| S2-05 | 未覆盖 AC「无头不写用户数据」的验证手段 | HC-07 对应用例：临时 home + 断言目录为空 |
| S2-06 | 未说明 npm dry-run 不上传的执行方式 | §12.3 明确 `--dry-run` 且台账状态为 prepared |
| S2-07 | 设计未约束「不改既有面板内部实现」 | §6.2 规则 3 明确 |

### 16.3 AC 覆盖自检结论

- requirements.md 的 69 条 AC 在本设计中均有落点（§14.2 映射表）；未落点项：无。
- 全部有意偏离集中在 D-01…D-14，均给出理由、影响与后续归属，不以「已对齐/同等效果」表述。
- P0 五项（四区骨架 / 冻结缓存 / 帧缓冲差分 / 上下文键位 / 状态栏契约）各有独立设计节与验证入口。
