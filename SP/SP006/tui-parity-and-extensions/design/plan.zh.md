# tui-parity-and-extensions · 实施计划

| 元数据 | 值 |
| --- | --- |
| 需求目录 | `SP/SP006/tui-parity-and-extensions/` |
| 已确认 SP | SP006（用户 m00001 明确「开始SP006的开发」） |
| 依据设计 | `design/design.zh.md` v1.3（SELF_REVIEWED，含 §16 四轮自审与用户检查反馈修复补记） |
| 功能分支 | `feature/SP006/tui-parity-and-extensions` |
| 文档起点 SHA | `dc94731`（master：「登记 0.5.4 发布回执并同步文档至 latest」） |
| 核对 master SHA | `dc94731`（建分支时工作区干净） |
| 版本 | v1.4（补记波次 E/F/G/H/I：用户检查反馈修复、真实模型端到端修复与全命令面端到端扩展） |
| 状态 | APPROVED（计划为 Agent 自审对象；RED 证据随实施记录） |

> 执行方式：每任务严格遵守「先写失败用例（RED，必须真实失败、不得靠 skip 制造）→ 最小实现转 GREEN → 跑本任务验证命令 → 跑相邻回归 → 回填完成事实」。完成事实栏不预填，只在真实执行后写入命令与结果。
> 分支纪律：全程留在 `feature/SP006/tui-parity-and-extensions`，**不合入 master**（用户 m00001 原话：「先不要直接合入master分支，我检查后再合入」；用户 m02328 再次确认「先不要合入master分支」，并授权提交后推送远端）。
> 参考纪律：参考仓 `D:\my_project\budingWorkerSpace` **只读**；只参考行为事实与协议字段，不抄代码、不抄提示词、不抄类型定义。

## Goal

1. **TUI 还原度 P0 达标**：四区骨架显式化、消息区冻结缓存、帧缓冲差分、上下文键位系统（含 chord 与保留键校验）、状态栏可执行契约（外部命令 + 13 字段载荷）。
2. **命令面收口**：`src/tui/commands.ts` 单文件 switch → 注册表驱动三型命令（local / local-jsx / prompt），既有 22 条命令行为不变，新增 `/init` `/btw` `/worktree` `/tasks` `/mcp` `/skills` `/export`。
3. **扩展能力**：项目指令注入、目录级技能发现、MCP stdio 客户端、受控 hooks、网页正文抓取、无头 stream-json 事件协议。
4. **制品与合规**：tarball 白名单 + 仓库外隔离安装 + 真实核心任务 + `npm publish --dry-run` 骨架；AST 映射表覆盖全部改动源码。

## Architecture

```
┌──────────────────────────── src/tui（UI 端）────────────────────────────┐
│ cli.ts ── 参数解析 / TTY 判定 / 无头编排                                 │
│   ├── headless.ts ── HeadlessEvent 序列化（text|json|stream-json）       │
│   └── app.tsx ── Ink 组件树（四区）                                     │
│         ├── render/layout.ts       区域契约 + 行高预算（纯函数）         │
│         ├── render/frame-buffer.ts 行级帧差分（纯函数）                 │
│         ├── render/freeze-cache.ts 冻结条目缓存（纯函数）               │
│         ├── render/statusline.ts   载荷组装 + 外部命令执行              │
│         ├── keybindings/           上下文分发 + chord + 保留键 + 用户覆盖│
│         └── commands/registry.ts   三型注册表 + 模态槽                  │
├──────────────────────────── 能力层（本轮新建）──────────────────────────┤
│ project-instructions.ts │ skills.ts │ mcp/ │ hooks/ │ tools/web-fetch.ts │
└─────────────────────────────────────────────────────────────────────────┘
依赖规则（同设计 §3.2）：
  render/ keybindings/ commands/ → core 契约 + storage 只读接口，不直接读盘
  mcp/ hooks/ tools/web-fetch.ts → 允许 IO，但必须经审批与结构化错误码
  core 保持零 IO；module-boundaries 规则不放宽
```

## Spec

权威来源：
- 设计：`SP/SP006/tui-parity-and-extensions/design/design.zh.md` v1.1（§4–§12 为实现契约，§14 为验证口径，§15 为偏离与 OPEN）。
- 需求 AC：`SP/SP006/tui-parity-and-extensions/requirements.md` 的 69 条（TU-01…TU-15、PI-01…PI-05、SM-01…SM-09、HK-01…HK-08、WR-01…WR-05、HC-01…HC-07、NP-01…NP-05、CMD-01…CMD-12、AST-01…AST-03）。

## Global Constraints

| 编号 | 约束 |
| --- | --- |
| G-01 | 全程不合入 master、不打标签（用户 m00001、m02328）。远端推送按用户 m02328 授权在提交后执行（推送到功能分支，不推 master）。本地提交用中文说明，分阶段提交。 |
| G-02 | 参考仓只读；实现独立编写，禁止逐字/改名搬运；AST 门禁命中必须处置。 |
| G-03 | `core` 零 IO 与零 UI 依赖；`src/tui/package.json` 运行时依赖白名单固定为 ink/lowlight/marked/react/string-width，**不新增依赖**。 |
| G-04 | 所有新模块 ESM、2 空格缩进、无分号；TS 严格模式随 `src/tui/tsconfig.json`。 |
| G-05 | 测试目录约定 `src/*/test/*.test.mjs`，测试导入 `dist/` 产物；先 `npm run build` 再 `node --test`。 |
| G-06 | 用户数据只落 `~/.budingx`；不读写 `~/.claude`；密钥不落明文。 |
| G-07 | 既有 49 个测试用例保持全绿；既有命令行为不得回归（CMD-12）。 |
| G-08 | 外部能力失败必须结构化降级，不得让主回合崩溃。 |
| G-09 | 零测试/全 skip/未执行不得记 PASS；证据分层互不冒充。 |
| G-10 | 本轮结束前同步 `PRODUCT.md`、`docs/current-status.md`、`SP/SP006/requirements-summary.md`、`SP/SP006/test-report.md`、`SP/SP006/tui-parity-and-extensions/STATUS.md`。 |

## Review Focus

1. 四区契约是否真正约束渲染（而非只是文档），resize 与 CJK 宽度是否可断言。
2. 行级差分与 Ink 重绘是否冲突（重复输出/错位），是否有全量回退开关。
3. 冻结缓存键（id + 宽度）是否会在宽度变化时错位。
4. 键位：chord 前缀超时、保留键不可绑定、用户覆盖文件损坏时的降级。
5. 状态栏：stdin JSON 契约 6+13 字段是否完整；非 0 退出码静默；5000ms 超时；去抖。
6. 无头：stdout 是否纯净（无 ANSI/提示语）；退出码 0/1/2；非 TTY 自动无头；不写用户数据。
7. MCP/hooks/web：审批是否必经；失败是否不扩散；超时与体积上限。
8. AST 映射是否覆盖全部改动文件，命中是否处置。

## 任务清单

### 波次 A：P0 骨架与无头协议

#### T-A1 四区布局契约与行高预算

- **AC**：TU-01、TU-02、TU-11
- **文件**：Create `src/tui/render/layout.ts`；Create `src/tui/test/sp006-layout.test.mjs`；Modify `src/tui/app.tsx`
- **Consumes**：无（纯函数）
- **Produces**：`RegionId`、`RegionSpec`、`LayoutInput`、`LayoutPlan`、`planLayout(input): LayoutPlan`、`displayWidth(text): number`（CJK 双宽）
- **依赖**：无
- **责任/复用**：复用 `string-width`（已在白名单）计算宽度；区域顺序 = 设计 §4.1
- **工作目录**：仓库根
- **验证命令**：`npm run build && node --test src/tui/test/sp006-layout.test.mjs`
- **预期行为**：
  1. 目标失败（RED）：`planLayout` 未实现时用例如实失败（导入报错/断言失败），**不得** skip。
  2. 最小实现：四区固定顺序 header→transcript→input→footer；footer 恒 1 行；input 最小 3 行；header 仅消息为空时占行；总高超出时从 transcript 收缩；`overflow=true` 且 transcript 收到最小 1 行。
  3. 目标成功：`rows=24/40/60` 三组断言；CJK 字符串（`中文abc`）宽度 = 7。
- **检查**：既有 `screen-e2e` 用例仍绿
- **状态记录**：DONE 2026-11-20；7 例 PASS（sp006-layout.test.mjs）；TU-01/02/11

#### T-A2 帧缓冲差分

- **AC**：TU-03
- **文件**：Create `src/tui/render/frame-buffer.ts`；Create `src/tui/test/sp006-frame-buffer.test.mjs`
- **Consumes**：`FrameBuffer` 契约（设计 §4.2）
- **Produces**：`createFrameBuffer(width,height,lines?)`、`resizeFrameBuffer(buffer,width,height)`、`diffFrames(prev,next): number[]`、`patchLines(prev,next): string[]`
- **依赖**：无
- **责任/复用**：行级差分（D-01）
- **工作目录**：仓库根
- **验证命令**：`npm run build && node --test src/tui/test/sp006-frame-buffer.test.mjs`
- **预期行为**：
  1. RED：模块缺失即失败。
  2. 最小实现：行内容相同 → 不产出补丁；单行变化 → 仅该行；宽度变化 → 全量重绘。
  3. 目标成功：无变化 / 单行 / resize 三组用例。
- **检查**：—
- **状态记录**：DONE 2026-11-20；6 例 PASS（sp006-frame-buffer.test.mjs）；TU-03

#### T-A3 消息冻结缓存

- **AC**：TU-04
- **文件**：Create `src/tui/render/freeze-cache.ts`；Create `src/tui/test/sp006-freeze-cache.test.mjs`
- **Consumes**：`FrozenEntry`
- **Produces**：`createFreezeCache(limit)` → `get(id,width,build)`、`invalidate(id?)`、`size()`、`hitRate()`
- **依赖**：无
- **责任/复用**：键 = id+宽度（D-02）
- **工作目录**：仓库根
- **验证命令**：`npm run build && node --test src/tui/test/sp006-freeze-cache.test.mjs`
- **预期行为**：
  1. RED：无实现失败。
  2. 最小实现：命中返回同一数组引用；宽度变化未命中重排；超 limit 按 LRU 淘汰。
  3. 目标成功：命中/未命中/宽度变化/淘汰 4 组断言。
- **检查**：—
- **状态记录**：DONE 2026-11-20；4 例 PASS（sp006-freeze-cache.test.mjs）+ 元素级冻结（history-window.tsx）；TU-04

#### T-A4 上下文键位系统

- **AC**：TU-05、TU-06、TU-07、TU-08
- **文件**：Create `src/tui/keybindings/types.ts`、`parser.ts`、`resolver.ts`、`defaults.ts`、`store.ts`、`index.ts`；Create `src/tui/test/sp006-keybindings.test.mjs`；Modify `src/storage/paths.ts`（新增 `keybindingsPath`）；Modify `src/tui/editor/keys.ts`
- **Consumes**：设计 §5
- **Produces**：`parseKeyStroke`、`parseChord`、`chordToString`、`formatKeyStroke`、`KeyBindingResolver.resolve`、`loadKeybindings(homeDir)`、`DEFAULT_BINDINGS`、`NON_REBINDABLE`、`TERMINAL_RESERVED`
- **依赖**：无
- **责任/复用**：8 上下文（D-03）
- **工作目录**：仓库根
- **验证命令**：`npm run build && node --test src/tui/test/sp006-keybindings.test.mjs`
- **预期行为**：
  1. RED：模块缺失失败。
  2. 最小实现：chord 首键 `pending`，500ms 超时清空；`ctrl+c` 绑定 → `reserved`；`command:/new` → `{kind:'command',name:'new'}`；损坏 JSON → 空覆盖 + 警告。
  3. 目标成功：解析/保留键/chord/command 引用/损坏隔离 5 组断言。
- **检查**：—
- **状态记录**：DONE 2026-11-20；8 例 PASS（sp006-keybindings.test.mjs）；TU-05…TU-08

#### T-A5 状态栏契约与外部命令

- **AC**：TU-09、TU-10、TU-12
- **文件**：Create `src/tui/render/statusline.ts`；Create `src/tui/test/sp006-statusline.test.mjs`；Modify `src/storage/config-store.ts`（`statusLine` 字段）；Modify `src/tui/app.tsx`
- **Consumes**：设计 §4.4、§4.5
- **Produces**：`HookBaseInput`、`StatusLineFields`、`StatusLineInput`、`buildStatusLineInput`、`normalizeStatusLineOutput`、`runStatusLineCommand`
- **依赖**：T-A1
- **责任/复用**：复用 ConfigStore（D-08）
- **工作目录**：仓库根
- **验证命令**：`npm run build && node --test src/tui/test/sp006-statusline.test.mjs`
- **预期行为**：
  1. RED：模块缺失失败。
  2. 最小实现：6 基础字段 + 13 状态栏字段；`current_usage` 对象或 null；`resets_at` epoch 秒；stdout 归一化；非 0 静默 `ignored`；超时 `error` 不阻塞。
  3. 目标成功：真实子进程 + 契约字段 + 非 0 三组断言。
- **检查**：—
- **状态记录**：DONE 2026-11-20；8 例 PASS（sp006-statusline.test.mjs）+ 真实子进程通道；TU-09/10/12

#### T-A6 四区接线（app.tsx）

- **AC**：TU-01、TU-13
- **文件**：Modify `src/tui/app.tsx`；Modify `src/tui/render/types.ts`；Create `src/tui/test/sp006-tui-frames.test.mjs`
- **Consumes**：T-A1..T-A5
- **Produces**：四区顺序由 `planLayout` 决定；消息区按冻结缓存取行；statusline 外部命令结果作为 footer 附加行（dim）
- **依赖**：T-A1、T-A2、T-A3、T-A4、T-A5
- **责任/复用**：复用 `helpers/mount-tty.mjs`
- **工作目录**：仓库根
- **验证命令**：`npm run build && node --test src/tui/test/sp006-tui-frames.test.mjs src/tui/test/screen-e2e.test.mjs`
- **预期行为**：
  1. RED：伪 TTY 挂载后断言 statusline 文本出现（当前无 → 真实失败）。
  2. 最小实现：接线；resize 到 60 列无崩溃且顺序不变。
  3. 目标成功：2 组帧级断言 + 既有 screen-e2e 全绿。
- **检查**：既有 screen-e2e 回归
- **状态记录**：DONE 2026-11-20；3 例 PASS（sp006-tui-frames.test.mjs，真 Ink 伪 TTY）；四区接线 + 状态栏 + setupHint 归位

#### T-A7 无头 CLI 与事件协议

- **AC**：TU-14、TU-15、HC-01…HC-07
- **文件**：Create `src/tui/headless.ts`；Create `src/tui/test/sp006-headless.test.mjs`；Modify `src/tui/cli.ts`
- **Consumes**：设计 §11
- **Produces**：`parseCliArgs(argv)`、`formatHeadlessEvent(event,format)`、`runHeadless(config,stores,io)`
- **依赖**：无
- **责任/复用**：stdout 纯净；退出码 0/1/2
- **工作目录**：仓库根
- **验证命令**：`npm run build && node --test src/tui/test/sp006-headless.test.mjs`
- **预期行为**：
  1. RED：`--output-format stream-json` 当前被忽略 → 用例真实失败。
  2. 最小实现：默认 text 不变；stream-json 逐行；result 最后；is_error→1；非法参数→2；非 TTY 自动无头；不写 `~/.budingx`。
  3. 目标成功：真实子进程 4 组用例。
- **检查**：既有 wire-e2e 回归
- **状态记录**：DONE 2026-11-20；5 例 PASS（sp006-headless.test.mjs，真实子进程）；cli.test.mjs 未知选项改判 2；TU-14/15、HC-01…HC-07
### 波次 B：命令注册表

#### T-B1 注册表核心与三型契约

- **AC**：CMD-01、CMD-02、CMD-03、CMD-04
- **文件**：Create `src/tui/commands/types.ts`、`registry.ts`、`index.ts`；Create `src/tui/test/sp006-command-registry.test.mjs`
- **Consumes**：设计 §6
- **Produces**：`CommandKind`、`CommandDefinition`、`CommandRegistry`（`register`/`get`/`list`/`resolve`）、`ModalSlot`
- **依赖**：无
- **责任/复用**：注册表驱动（设计 §6.1）
- **工作目录**：仓库根
- **验证命令**：`npm run build && node --test src/tui/test/sp006-command-registry.test.mjs`
- **预期行为**：
  1. RED：注册表缺失失败。
  2. 最小实现：`/new extra args` → `{command:'new',args:'extra args'}`；别名解析；未知名 → undefined；重名注册抛错；三型 kind 保留。
  3. 目标成功：5 组断言。
- **检查**：—
- **状态记录**：DONE 2026-11-20；`src/tui/commands/{types,registry,index,util}.ts`；7 例 PASS（含别名/重名/hidden/三型 kind）

#### T-B2 既有命令迁移

- **AC**：CMD-12
- **文件**：Create `src/tui/commands/builtin-session.ts`、`builtin-config.ts`、`builtin-permission.ts`、`builtin-view.ts`；Modify `src/tui/commands.ts`（保留 `runCommand` 导出，改为委派注册表）
- **Consumes**：T-B1、既有 `CommandContext`
- **Produces**：22 条既有命令的 `CommandDefinition`（help/exit/clear/config/models/model/permission/rules/diff/undo/rewind/denials/sessions/resume/continue/context/compact/cost/plan/permissions/memory/effort）
- **依赖**：T-B1
- **责任/复用**：包装既有实现，`CommandOutcome` 形状不变
- **工作目录**：仓库根
- **验证命令**：`npm run build && node --test src/tui/test/sp006-command-registry.test.mjs src/tui/test/sp0054-*.test.mjs`
- **预期行为**：
  1. RED：「注册表能解析全部 22 条」用例失败。
  2. 最小实现：逐条包装；技能命令降级保留。
  3. 目标成功：22 条全部可解析且 sp0054 用例全绿。
- **检查**：既有 sp0054 系列回归
- **状态记录**：DONE 2026-11-20；`builtin-session/config/permission/view.ts` 54 例回归 PASS；`runCommand` 懒加载注册表，`CommandResult.outcome` 桥接宿主副作用

#### T-B3 新增命令

- **AC**：CMD-05…CMD-11
- **文件**：Create `src/tui/commands/builtin-extended.ts`（七条同文件，按 session/config/permission/view 之后的第五组）；Create `src/tui/init.ts`、`src/tui/export.ts`、`src/tui/worktree.ts`、`src/tui/tasks.ts`；Modify `src/tui/commands/index.ts`、`src/tui/commands.ts`
- **Consumes**：T-B1；/init 依赖 T-C1；/skills /mcp 依赖 T-C2/T-C3
- **Produces**：7 条新命令（含 prompt 型进度提示、sideQuestion 旁路通道、openList 只读模态）
- **依赖**：T-B1、T-C1、T-C2、T-C3
- **责任/复用**：7 条命令行为（CMD-05…CMD-11）
- **工作目录**：仓库根
- **验证命令**：`npm run build && node --test src/tui/test/sp006-commands-extended.test.mjs src/tui/test/sp006-command-ui.test.mjs`
- **预期行为**：
  1. RED：7 条命令未注册 → 用例失败。
  2. 最小实现：/init 生成项目指令提示词且不覆盖既有 AGENTS.md；/btw 包装为 `prompt` 型侧问（宿主走 `submitSideQuestion`，不写主历史）；/worktree 列出/创建/删除（删除经宿主确认并复用 SP004 授权）；/tasks 列出宿主后台任务登记表（状态/退出码/输出路径，取 CMD-08 而非 todos）；/mcp 打开只读列表；/skills 打开只读列表；/export 导出 JSONL/文本到 `~/.budingx/exports/`。
  3. 目标成功：7 条各自断言（含 /export 文件落盘）。
- **检查**：—
- **状态记录**：DONE 2026-11-20；10 例 PASS（sp006-commands-extended.test.mjs）+ 2 例帧级 PASS（sp006-command-ui.test.mjs）；偏差 D-12/D-13

### 波次 C：扩展能力

#### T-C1 项目指令

- **AC**：PI-01…PI-05
- **文件**：Create `src/tui/project-instructions.ts`；Create `src/tui/test/sp006-project-instructions.test.mjs`；Modify `src/tui/runtime.ts`（注入首条用户消息前）
- **Consumes**：设计 §7
- **Produces**：`loadProjectInstructions({workspaceDir,homeDir,includeNested?})` → `{files,content,sources,warnings}`（另导出同步版与常量）
- **依赖**：无
- **责任/复用**：优先级：`~/.budingx/AGENTS.md` → 工作区 `AGENTS.md` → `CLAUDE.md`
- **工作目录**：仓库根
- **验证命令**：`npm run build && node --test src/tui/test/sp006-project-instructions.test.mjs`
- **预期行为**：
  1. RED：模块缺失失败。
  2. 最小实现：单文件 64KiB、总 128KiB 截断并警告；不存在 → 空；首条用户消息前缀注入（带围栏标记）。
  3. 目标成功：优先级/截断/空/注入位置 4 组断言。
- **检查**：—
- **状态记录**：DONE 2026-11-20；9 例 PASS（sp006-project-instructions.test.mjs，末例真实 HTTP + createAgentRuntime 断言 system 注入）；实现为 resolveSystemContext 每次请求重读（PI-02 向上受限发现）

#### T-C2 技能发现

- **AC**：SM-01…SM-04
- **文件**：Create `src/tui/skills.ts`；Create `src/tui/test/sp006-skills.test.mjs`；Modify `src/tui/commands.ts`（`discoverSkillCommands`/`loadSkillBody` 委派）
- **Consumes**：设计 §8.1
- **Produces**：`discoverSkills({homeDir,workspaceDir})` → `SkillEntry[]`；`parseFrontmatter(text)`
- **依赖**：无
- **责任/复用**：目录级发现 + 项目级优先
- **工作目录**：仓库根
- **验证命令**：`npm run build && node --test src/tui/test/sp006-skills.test.mjs`
- **预期行为**：
  1. RED：忽略项目级目录的用例失败。
  2. 最小实现：扫两类根下 `<dir>/SKILL.md`；frontmatter 缺失用目录名；正文空 → `valid:false` 调用时降级；项目级优先同名。
  3. 目标成功：4 组断言。
- **检查**：—
- **状态记录**：DONE 2026-11-20；7 例 PASS（sp006-skills.test.mjs）；parseFrontmatter 兼容旧式无围栏头

#### T-C3 MCP stdio 客户端

- **AC**：SM-05…SM-09
- **文件**：Create `src/tui/mcp/types.ts`、`client.ts`、`index.ts`；Create `src/tui/test/sp006-mcp.test.mjs`、`sp006-mcp-approval.test.mjs`；Create `src/tui/test/helpers/fake-mcp-server.mjs`；Modify `src/storage/paths.ts`（`mcpPath`）、`src/tui/runtime.ts`、`cli.ts`、`headless.ts`
- **Consumes**：设计 §8.2
- **Produces**：`McpClient`（`connect`/`listTools`/`callTool`/`close`）、`loadMcpConfig(homeDir)`、`toAgentTools(client)`（名 `mcp__<server>__<tool>`）
- **依赖**：无
- **责任/复用**：stdio JSON-RPC 三方法（D-06）
- **工作目录**：仓库根
- **验证命令**：`npm run build && node --test src/tui/test/sp006-mcp.test.mjs`
- **预期行为**：
  1. RED：客户端缺失失败。
  2. 最小实现：initialize → notifications/initialized → tools/list；连接 10s、调用 30s；非 0/协议错结构化；工具调用走既有审批；密钥从 env 注入不落日志。
  3. 目标成功：假 MCP 服务器（真实子进程）4 组断言。
- **检查**：—
- **状态记录**：DONE 2026-11-20；6 例协议/配置 PASS + 2 例审批/宿主 PASS；runtime/cli/headless 已接入

#### T-C4 受控 hooks

- **AC**：HK-01…HK-08
- **文件**：Create `src/core/hooks.ts`、`src/tui/hooks/types.ts`、`config.ts`、`runner.ts`、`index.ts`；Create `src/tui/test/sp006-hooks.test.mjs`；Modify `src/storage/paths.ts`（`hooksPath`）、`src/core/session.ts`、`src/core/events.ts`、`src/tui/runtime.ts`、`cli.ts`、`headless.ts`
- **Consumes**：设计 §9
- **Produces**：`HookEvent`（8 事件）、`HookResponse`、`runHooks(event,payload,config,{spawn,timeoutMs=30000})` → `{blocked,reason,additionalContext,systemMessages,warnings}`
- **依赖**：无
- **责任/复用**：8 事件 + command/prompt 两类处理器（D-04/D-05）
- **工作目录**：仓库根
- **验证命令**：`npm run build && node --test src/tui/test/sp006-hooks.test.mjs`
- **预期行为**：
  1. RED：模块缺失失败。
  2. 最小实现：command 处理器 stdin JSON、stdout 解析、退出码 2 → 阻塞；prompt 展开系统片段；PreToolUse `permissionDecision` allow/deny/ask；损坏隔离；超时/非 0 非 2 降级。
  3. 目标成功：6 组断言（含真实 hook 脚本子进程）。
- **检查**：—
- **状态记录**：DONE 2026-11-20；8 例 PASS（sp006-hooks.test.mjs）；Session 接入 8 事件 + permissionDecision/updatedInput/additionalContext

#### T-C5 网页正文抓取

- **AC**：WR-01…WR-05
- **文件**：Create `src/provider/web-fetch.ts`；Create `src/tui/test/sp006-web-fetch.test.mjs`；Modify `src/tui/runtime.ts`（注册工具）
- **Consumes**：设计 §10
- **Produces**：`createWebFetchTool(options)`、`isPrivateHost(hostname)`、`extractReadableText(html)`
- **依赖**：无
- **责任/复用**：内网拒绝 + 审批 + 512KiB 上限
- **工作目录**：仓库根
- **验证命令**：`npm run build && node --test src/tui/test/sp006-web-fetch.test.mjs`
- **预期行为**：
  1. RED：模块缺失失败。
  2. 最小实现：本地 fixture 抓正文；私网 → `BUDINGX_WEB_PRIVATE_HOST`；超 512KiB 截断；非 2xx 结构化；重定向 ≤3；审批拒绝不发起。
  3. 目标成功：5 组断言（含真实 HTTP 服务）。
- **检查**：—
- **状态记录**：DONE 2026-11-20；7 例 PASS（sp006-web-fetch.test.mjs）；工具名 WebFetch，env 开关 BUDINGX_WEB_FETCH_ALLOW_PRIVATE=1

### 波次 D：制品、AST 与文档收口

#### T-D1 制品验收脚本与台账

- **AC**：NP-01…NP-05
- **文件**：Create `scripts/release/sp006-packaging.mjs`；Create `src/tui/test/sp006-release-ledger.test.mjs`；Modify `release-ledger.json`
- **Consumes**：设计 §12
- **Produces**：仓库外隔离安装 + `--version` 比对 + 本地 SSE fixture 真跑 + `publish --dry-run` 骨架
- **依赖**：T-A7、全部实现完成
- **责任/复用**：复用 `pack-smoke` 基建
- **工作目录**：仓库根
- **验证命令**：`node scripts/release/sp006-packaging.mjs`
- **预期行为**：
  1. RED：脚本缺失/台账无 SP006 条目 → 失败。
  2. 最小实现：tarball 白名单断言；隔离安装；真实任务跑通；dry-run 不上传；台账状态 `prepared`。
  3. 目标成功：脚本 exit 0 并输出实际检查项。
- **检查**：—
- **状态记录**：DONE 2026-11-20；`node scripts/release/sp006-packaging.mjs` exit 0：`ledger: PASS 0.6.0 SP006 prepared`、`release notes: PASS 0.6.0`、`tarball: PASS budingx-0.6.0.tgz 139 files`、`isolated install: PASS 0.6.0`、`headless stream-json: PASS 7 events; no user data written`、`publish --dry-run: PASS (no upload)`；台账含 `sourceCommit` 与 `receipt:null` 占位（sp006-release-ledger.test.mjs 3 例）。

#### T-D2 AST 映射与复核

- **AC**：AST-01、AST-02、AST-03
- **文件**：Modify `scripts/review/sp004-ast.mjs`（REFERENCE_ALLOWLIST/DISPOSITIONS 增 SP006 条目）
- **Consumes**：设计 §13
- **Produces**：SP006 映射表（覆盖全部改动源码）
- **依赖**：T-A1…T-C5 代码落盘后
- **责任/复用**：复用 AST 脚本阈值不变
- **工作目录**：仓库根
- **验证命令**：`node scripts/review/sp004-ast.mjs --reference <ref> --reference-revision <rev> --base dc94731`
- **预期行为**：
  1. RED：新增文件未映射 → 脚本失败（先验证）。
  2. 最小实现：补映射与处置；无对应项用 `{note}`。
  3. 目标成功：exit 0，输出命中数与处置；3 项自检全绿。
- **检查**：—
- **状态记录**：DONE 2026-11-20；`node scripts/review/sp004-ast.mjs --reference /d/my_project/budingWorkerSpace --reference-revision b5c9be8 --base dc94731`：48 改动文件 / 48 映射，自检 3 项 PASS，本仓单元 238、参考 14250、函数对 44941，命中「无」，结论 PASS。（2026-11-20 用户检查修复后按 T-E3 复核：52 改动文件 / 52 映射，命中「无」，结论 PASS。）

#### T-D3 文档收口

- **AC**：G-10（跨 AC 交付要求）
- **文件**：Modify `PRODUCT.md`、`docs/current-status.md`；Create `SP/SP006/tui-parity-and-extensions/STATUS.md`（若未建则补全）、`SP/SP006/requirements-summary.md`、`SP/SP006/test-report.md`
- **Consumes**：全部实施结果
- **Produces**：产品说明书同步（命令表、按键、配置、数据路径、版本历史）、当前状态、迭代汇总、测试报告、STATUS
- **依赖**：T-D1、T-D2
- **责任/复用**：文档与真实命令/行为一致
- **工作目录**：仓库根
- **验证命令**：`npm run spec:check && npm run skills:check`
- **预期行为**：
  1. 产品说明书章节同步；UNVERIFIED 项写明恢复条件。
- **检查**：spec:check / skills:check
- **状态记录**：DONE 2026-11-20；PRODUCT.md §2/§4.3/§5.7/§6/§7/§8 与 docs/current-status.md 同步；SP/SP006/requirements-summary.md、SP/SP006/test-report.md、本迭代 STATUS.md 已写；`npm run spec:check`、`npm run skills:check`、`npm run test:checks` 通过。

### 波次 E：用户检查反馈修复（2026-11-20）

> 触发：用户在功能分支检查阶段提出两处问题（m01955 命令卡片常驻与单次调用占多行；m02285 `/resume` 恢复后看不到历史），并要求端到端测试后提交并推送远端、暂不合入 master（m02328）。本波次不新增 AC，只修既有行为的可见性与一致性。

#### T-E1 命令卡片完成态隐藏与单行渲染

- **AC**：既有 TU/CMD 可见性要求（用户检查回归）
- **文件**：Modify `src/tui/render/cards.ts`、`src/tui/app.tsx`、`src/tui/test/sp004-cards.test.mjs`；Create `src/tui/test/sp006-command-card.test.mjs`
- **Consumes**：`Frame.command`、`commandCardLines`
- **Produces**：`activeCommandCard(card)`（只返回 running/background 卡片）；`commandCardLines(card, width, { compact })` 单行输出
- **依赖**：已完成波次 A–D
- **责任/复用**：不删除 reducer 的 `command` 字段（SP004 T15-1/2/3 回归依赖它），隐藏逻辑放在 app/纯函数层
- **工作目录**：仓库根
- **验证命令**：`npm run build && node --test src/tui/test/sp004-cards.test.mjs src/tui/test/sp006-command-card.test.mjs`
- **预期行为**：
  1. RED：完成态卡片仍常驻输入区上方 → 帧级断言失败。
  2. 最小实现：运行中/后台只占一行（`◐/▷ 命令 · interpreter · 状态 · 任务 <id>`）；完成/失败/取消后从实时区域移除，结果保留在转录工具条目；最近一次命令可 Ctrl+E 显式展开。
  3. 目标成功：纯函数 4 组断言 + 真实子进程帧级 1 组。
- **检查**：全量回归
- **状态记录**：DONE 2026-11-20；提交 `f0b11eb`；纯函数例 PASS + 帧级例 PASS；全量 908 项 / 907 通过 / 0 失败 / 1 跳过

#### T-E2 `/resume` 恢复后历史可见与会话身份切换

- **AC**：用户检查回归（会话恢复可见性）
- **文件**：Modify `src/core/events.ts`、`src/core/session.ts`、`src/tui/render/reducer.ts`、`src/tui/runtime.ts`、`src/tui/app.tsx`、`src/tui/commands/types.ts`；Create `src/tui/render/restored-transcript.ts`、`src/tui/render/tool-summary.ts`、`src/tui/test/sp006-resume-history.test.mjs`、`src/tui/test/sp006-resume-e2e.test.mjs`
- **Consumes**：`SessionEvent`、`Frame.transcript`、`SessionStore.restore/startSession`
- **Produces**：`conversation_restored` 事件；`Session.restoreHistory` 发事件；`Session.adoptIdentity({ id, transcript })`；`restoredTranscriptEntries(messages)`；`toolArgument(input)` / `summarizeInput(input)`
- **依赖**：已完成波次 A–D
- **责任/复用**：走会话事件通路（与 `conversation_rewound` 同构），渲染层不直接读会话；身份切换对齐参考实现 `REPL.tsx` 的 `setConversationId` + `switchSession` + `resetSessionFilePointer`
- **工作目录**：仓库根
- **验证命令**：`npm run build && node --test src/tui/test/sp006-resume-history.test.mjs src/tui/test/sp006-resume-e2e.test.mjs`
- **预期行为**：
  1. RED：恢复后消息区为空 → 帧级断言失败（先复现用户截图现象）。
  2. 最小实现：恢复事件重建转录（用户/助手文本、工具调用与结果、未决工具标为已中断）；恢复时切换会话 id 与转录端口，续写写回被恢复会话。
  3. 目标成功：纯函数 2 组 + 真实 Ink 帧 1 组 + 真实运行时/存储 1 组 + 真实 `/resume` 命令 1 组 + 进程外端到端 1 组。
- **检查**：长历史渲染性能（虚拟化阈值 64、折叠合并不变）
- **状态记录**：DONE 2026-11-20；提交 `1ef588a`；6 例 PASS；全量 914 项 / 913 通过 / 0 失败 / 1 跳过

#### T-E3 AST 映射表随新文件同批更新

- **AC**：AST-01（改动文件全映射）
- **文件**：Modify `scripts/review/sp004-ast.mjs`（REFERENCE_ALLOWLIST 增 `src/tui/render/restored-transcript.ts`、`src/tui/render/tool-summary.ts` 条目）
- **Consumes**：设计 §13
- **Produces**：52/52 映射，覆盖本轮全部改动源码
- **依赖**：T-E2 落盘后
- **责任/复用**：阈值不变，仅补对照路径（`src/commands/resume`、`src/utils/sessionRestore.ts`、`src/components/messages`、`src/utils/collapseReadSearch.ts`）
- **工作目录**：仓库根
- **验证命令**：`node scripts/review/sp004-ast.mjs --reference /d/my_project/budingWorkerSpace --reference-revision b5c9be8 --base dc94731`
- **预期行为**：
  1. RED：新文件未映射 → 脚本结论 FAIL（先验证）。
  2. 最小实现：补映射条目。
  3. 目标成功：52 改动文件 / 52 映射，自检 3 项 PASS，命中「无」，结论 PASS。
- **检查**：—
- **状态记录**：DONE 2026-11-20；52 改动文件 / 52 映射，自检 3/3 PASS，本仓单元 252、参考单元 14381、函数对 49285，命中「无」，结论 PASS

### 波次 F：`/resume` 恢复后历史显示成碎片列修复（2026-11-20）

> 触发：用户第二轮检查提出「`/resume` 恢复后历史显示有问题」（m03012，截图可见极窄碎片列），要求参考参考仓的恢复做法修复。本波次不新增 AC，修的是落盘形状与恢复映射。

#### T-F1 流式增量按类型合并进同一文本块

- **AC**：用户检查回归（会话恢复可读性）
- **文件**：Modify `src/core/session.ts`；Modify `src/tui/test/sp006-resume-history.test.mjs`
- **Consumes**：`SessionEvent.text_delta`/`thinking_delta`、`MessageBlock`
- **Produces**：`appendStreamBlock(blocks, kind, text)` —— 同类型连续增量并入最后一块，遇到异类型才新开块
- **依赖**：波次 E（`conversation_restored` 恢复通路）
- **责任/复用**：模型上下文一直由 `textOf()` 拼接，故只改落盘形状，不改上下文语义；对齐参考仓「一条助手消息一个文本块」
- **工作目录**：仓库根
- **验证命令**：`npm run build && node --test src/tui/test/sp006-resume-history.test.mjs`
- **预期行为**：
  1. RED：一轮 13 个 delta 落盘成 13 个 text 块 → 断言失败（复现用户截图）。
  2. 最小实现：按类型合并。
  3. 目标成功：多增量 SSE 流式回答落盘为单块，恢复后整段连续。
- **检查**：既有流式/转录用例不回归
- **状态记录**：DONE 2026-11-20；提交 `55ea677`；resume 历史用例 7 例 PASS

#### T-F2 恢复层合并同一条消息内的连续文本块（兼容旧转录）

- **AC**：用户检查回归（已有会话文件无需迁移）
- **文件**：Modify `src/tui/render/restored-transcript.ts`
- **Consumes**：`messagesFromRecords` 复原出的 `Message[]`
- **Produces**：`restoredTranscriptEntries(messages)` 对同一消息内连续 text 块合并为一条 entry；`tool_use`/`context`/`interrupt_mark` 保持顺序插入
- **依赖**：T-F1（新转录形状）
- **责任/复用**：旧转录（含用户报的 `7f93f578` 会话）不迁移文件，由该层兼容；thinking 块跳过且不打断合并
- **工作目录**：仓库根
- **验证命令**：`node --test src/tui/test/sp006-resume-history.test.mjs`
- **预期行为**：
  1. RED：旧形状转录恢复出 14 条碎片 entry → 断言失败。
  2. 最小实现：逐消息累积文本，非文本块先 flush。
  3. 目标成功：旧形状合并为 user + assistant 两条记录，帧内整段连续显示。
- **检查**：`/resume` 帧级用例
- **状态记录**：DONE 2026-11-20；提交 `55ea677`；同批 2 例新增回归 PASS

### 波次 G：输入框「下一句」建议改为模型生成（2026-11-20）

> 触发：用户指出输入框占位建议「提示词语境不对，不符合上下文逻辑」（m03632，截图显示固定话术「结合项目给我一个具体示例」），要求 AI 结合当前上下文生成。本波次不新增 AC。

#### T-G1 `suggestion.ts`：节选、清洗与生成

- **AC**：用户检查回归（输入区建议贴合上下文）
- **文件**：Create `src/tui/suggestion.ts`；Create `src/tui/test/sp006-suggestion.test.mjs`
- **Consumes**：`ModelProvider.stream`、`ChatRequest`、`Message`
- **Produces**：`suggestionExcerpt(messages, maxChars?)`、`conversationLanguage(messages)`、`buildSuggestionMessages(messages)`、`sanitizeSuggestion(raw)`、`generatePromptSuggestion({ provider, model, history, signal?, timeoutMs? })`
- **依赖**：无（纯逻辑 + provider 端口）
- **责任/复用**：不覆盖父请求参数（复用缓存）；`maxTokens=64`、无 tools、15s 超时、失败/NONE 静默；清洗阈值 24 汉字 / 80 字符 / 12 词，拒评价式与助手口吻
- **工作目录**：仓库根
- **验证命令**：`node --test src/tui/test/sp006-suggestion.test.mjs`
- **预期行为**：
  1. RED：无生成器时只能显示固定话术 → 用例失败。
  2. 最小实现：节选最近非工具消息 + 小请求 + 清洗。
  3. 目标成功：G-01…G-05 纯逻辑/流用例 PASS。
- **检查**：—
- **状态记录**：DONE 2026-11-20；提交 `55ea677`；用例 8 例 PASS

#### T-G2 宿主端口与 App 接线

- **AC**：用户检查回归
- **文件**：Modify `src/tui/runtime.ts`、`src/tui/app.tsx`、`src/tui/cli.ts`、`src/tui/test/helpers/mount-tty.mjs`；Modify `src/tui/test/screen-e2e.test.mjs`
- **Consumes**：`AgentRuntime`、`AppProps`
- **Produces**：`AgentRuntime.suggestions.generate(signal)`；`AppProps.suggestNextPrompt?`；`requestSuggestion`/`clearSuggestion`
- **依赖**：T-G1
- **责任/复用**：渲染层不直连 provider；未注入端口即不显示建议（测试与无 UI 宿主安全）；`BUDINGX_PROMPT_SUGGESTIONS=0` 关闭额外请求
- **工作目录**：仓库根
- **验证命令**：`npm run build && node --test src/tui/test/screen-e2e.test.mjs src/tui/test/sp006-suggestion.test.mjs`
- **预期行为**：
  1. RED：回合结束仍显示固定话术 → 帧级断言失败。
  2. 最小实现：回合完成（completed）异步生成，AbortSignal 在提交/新回合/清空/恢复/unmount 处取消。
  3. 目标成功：G-06…G-08 帧级用例 PASS。
- **检查**：迟到结果不覆盖用户输入
- **状态记录**：DONE 2026-11-20；提交 `55ea677`

#### T-G3 AST 映射与全量门禁

- **AC**：AST-01
- **文件**：Modify `scripts/review/sp004-ast.mjs`（REFERENCE_ALLOWLIST 增 `src/tui/suggestion.ts` → `src/services/PromptSuggestion`、`src/hooks/usePromptSuggestion.ts`）
- **Consumes**：设计 §13
- **Produces**：53/53 映射
- **依赖**：T-G1/T-G2 落盘后
- **责任/复用**：阈值不变
- **工作目录**：仓库根
- **验证命令**：`node scripts/review/sp004-ast.mjs --reference /d/my_project/budingWorkerSpace --reference-revision b5c9be8 --base dc94731`
- **预期行为**：
  1. RED：新文件未映射 → 结论 FAIL（先验证）。
  2. 最小实现：补映射条目。
  3. 目标成功：53 改动文件 / 53 映射，自检 3/3 PASS，命中「无」。
- **检查**：全量回归 + 制品
- **状态记录**：DONE 2026-11-20；提交 `55ea677`；53/53，本仓单元 257、参考单元 14411、函数对 48379，结论 PASS；全量 924 项 / 923 通过 / 0 失败 / 1 跳过

### 波次 H：真实模型端到端测试暴露的缺陷修复（2026-11-20）

> 触发：用户要求「整体 TUI 全部功能再端到端测试一遍，发现问题及时修复」（m03678）。本波次用真实 Provider 跑无头事件流与交互 TUI，暴露了三类只有真机才会出现的问题：建议清洗把真实模型的主要输出形态（自然追问）全部丢弃、思考型模型吃掉小 token 预算、退化终端多行命令输出被压成一行。本波次不新增 AC，修的是既有行为的可用性。

#### T-H1 建议清洗阈值与预算按真实模型输出校正

- **AC**：用户检查回归（输入区建议贴合上下文且真实可用）
- **文件**：Modify `src/tui/suggestion.ts`、`src/tui/test/sp006-suggestion.test.mjs`
- **Consumes**：`generatePromptSuggestion`、`sanitizeSuggestion`
- **Produces**：允许问句形态建议；只拒元问题/助手口吻/评价式/格式化/超长
- **依赖**：T-G1/T-G2
- **责任/复用**：`MAX_OUTPUT_TOKENS` 64→256（思考型模型先消耗思考 token）；超时、取消、失败仍静默；不覆盖父请求参数
- **工作目录**：仓库根
- **验证命令**：`node --test src/tui/test/sp006-suggestion.test.mjs`
- **预期行为**：
  1. RED：真实模型返回「那 local 类型的命令定义在哪里？」被 `/[?？]$/` 丢弃 → 建议恒为空（单测用假生成器只返回陈述句，掩盖了问题）。
  2. 最小实现：删问号拒绝、补元问题拒绝、补助手口吻前缀、抬高输出预算。
  3. 目标成功：8/8 PASS；真实交互 TUI 的 E2E-04/E2E-05/E2E-06 通过。
- **检查**：真实模型采样（不是假端口）
- **状态记录**：DONE 2026-11-20；提交 `9e3e88f`；用例 8 例 PASS；真实模型建议例「这个文件里注册了哪些命令？」可显示并可 Tab 填入

#### T-H2 退化终端多行命令输出按正文块渲染

- **AC**：CMD-01…CMD-12 在 `fullScreen=false` 下同样可读
- **文件**：Modify `src/tui/app.tsx`；Modify `src/tui/test/sp0054-command-menu.test.mjs`
- **Consumes**：命令分发 `setHint`
- **Produces**：多行 hint 在页脚上方以正文块渲染（最多 40 行，超出提示截断）；单行 hint 行为不变；全屏不变
- **依赖**：无
- **责任/复用**：渲染层只做展示，不解析命令语义
- **工作目录**：仓库根
- **验证命令**：`npm run build && node --test src/tui/test/sp0054-command-menu.test.mjs`
- **预期行为**：
  1. RED：`fullScreen=false` 执行 `/help`，帧里只剩折行裁切的单行提示 → 断言含 `/resume`、`/tasks` 失败。
  2. 最小实现：页脚内联仅限单行；多行改正文块逐行输出。
  3. 目标成功：4/4 PASS，含新增「非全屏退化终端 /help 以正文块列出命令」。
- **检查**：全屏模式无回归
- **状态记录**：DONE 2026-11-20；提交 `9e3e88f`；`sp0054-command-menu.test.mjs` 4/4 PASS

#### T-H3 真实模型端到端证据与文档收口

- **AC**：交付证据完整性（不属于 69 条产品 AC，属交付要求）
- **文件**：Modify `SP/SP006/test-report.md`、`STATUS.md`、`SP/SP006/requirements-summary.md`、`PRODUCT.md`、`release-notes/v0.6.0.md`、`docs/current-status.md`、`release-ledger.json`、`design/design.zh.md`（D-18 校正、D-19、§16.6）、`design/plan.zh.md`（本波次）
- **Consumes**：`artifacts/e2e/` 下的真实模型脚本（未入库，`artifacts/` 已 gitignore）
- **Produces**：test-report §6 真实模型端到端记录；文档数字与设计偏离表同步
- **依赖**：T-H1/T-H2
- **责任/复用**：证据只记录真实执行结果；未执行项标 UNVERIFIED
- **工作目录**：仓库根
- **验证命令**：`npm run test:unit`、`npm run test:checks`、`npm run spec:check`、`npm run skills:check`、`node scripts/release/sp006-packaging.mjs`、AST 脚本
- **预期行为**：
  1. RED：文档仍写 924 项与旧建议阈值 → 与实测不符。
  2. 最小实现：按实测更新数字与条目。
  3. 目标成功：门禁全 PASS，文档数字与实测一致。
- **检查**：AST 仍 53/53（本轮不新增源文件）
- **状态记录**：DONE 2026-11-20；全量 925 项 / 924 通过 / 0 失败 / 1 跳过；AST 53/53，本仓单元 257、参考 14411、函数对 48379，结论 PASS；真实模型交互 e2e 18 项 PASS


### 波次 I：全命令面与智能体流程真实模型端到端扩展（2026-11-21）

> 触发：用户要求「整体 TUI 全部功能再端到端测试一下，发现问题及时修复」（m03678）并「继续」（m04444）。波次 H 的真实模型端到端只覆盖首屏、流式、建议、help、sessions、resume、clear、审批、打断、跨进程恢复；本波次把覆盖扩到**全部命令面**（25 项）与**智能体关键流程**（14 项），共 39 项。

#### T-I1 全命令面真实模型端到端

- **AC**：CMD-01…CMD-12 与 TU 各项在真实运行时下可观察
- **文件**：无产品改动；脚本 `artifacts/e2e/full-surface-e2e.mjs`（`artifacts/` 已 gitignore，不入库）
- **Consumes**：`createAgentRuntime`、`mountTty`、`commandContext` 装配
- **Produces**：命令面 25 项检查（S-01…S-24 含 S-16b）全部 PASS 的真实执行记录
- **依赖**：波次 H
- **责任/复用**：脚本侧按真实交互调整，不改产品语义
- **工作目录**：仓库根
- **验证命令**：`node --env-file-if-exists=.env.e2e.local artifacts/e2e/full-surface-e2e.mjs`
- **预期行为**：
  1. RED：首轮在 S-04 崩溃 `ERROR Cannot read properties of undefined (reading 'budget')`（脚本无条件注入 `context` surface，而 runtime 未创建该 surface）。
  2. 最小实现：脚本把 sessions/contextUsage/context/effort 改为条件展开；`wf` 谓词检查最近 8 帧而非最后一帧（Ink 分块输出常以空白 chunk 结尾）；JSX 面板 Esc 后等待 700ms 避开双击 Esc 的 `/rewind`。
  3. 目标成功：25/25 PASS。
- **检查**：真实 Provider（MiniMax-M3.1-Flash）；临时 home 与工作区；本地 HTTP 页与 hooks.json
- **状态记录**：DONE 2026-11-21；25/25 PASS

#### T-I2 智能体关键流程真实模型端到端

- **AC**：TU-14/TU-15（审批、打断）与 CMD 面在真实回合下闭环
- **文件**：无产品改动；脚本 `artifacts/e2e/agent-flows-e2e.mjs`（不入库）
- **Consumes**：`Session.submit`、审批链路、建议端口、`/resume`、回滚面板
- **Produces**：智能体流程 14 项检查（A-01…A-09b）全部 PASS 的真实执行记录
- **依赖**：T-I1
- **责任/复用**：`/init` 走真实回合与审批，不做本地脚手架
- **工作目录**：仓库根
- **验证命令**：`node --env-file-if-exists=.env.e2e.local artifacts/e2e/agent-flows-e2e.mjs`
- **预期行为**：
  1. RED：首轮 A-09 失败——`/init` 在只读档位下模型无写权限，AGENTS.md 未生成；另 `/init` 的真实回合需等待审批与回合结束。
  2. 最小实现：脚本先 Shift+Tab 切到允许编辑档位，等「正在生成项目指令…」后再等回合结束；拒绝反馈对话框补发 Esc 落定。
  3. 目标成功：14/14 PASS。
- **检查**：跨进程 `/resume` 会话身份切换；Esc+Esc 回滚；`/models` 面板；`/denials` 真实记录
- **状态记录**：DONE 2026-11-21；14/14 PASS

#### T-I3 命令层文案本地化修复（真实端到端暴露）

- **AC**：CMD-12（命令面中英文一致）——用户可见文案不得泄漏语言无关领域文案
- **文件**：Modify `src/tui/commands.ts`；Modify `src/tui/test/sp0054-command-fidelity.test.mjs`
- **Consumes**：`undoCommand`、`outcome.reason`
- **Produces**：模块级 `localizeUndoReason(reason, pick)`；zh/en 两型原因转换；未知原因原样透出
- **依赖**：T-I1（由命令面 e2e 的 `/undo` 用例暴露）
- **责任/复用**：领域层 `src/workspace/checkpoint.ts` 保持语言无关，界面本地化只在 TUI 命令层
- **工作目录**：仓库根
- **验证命令**：`npm run build && node --test src/tui/test/sp0054-command-fidelity.test.mjs`
- **预期行为**：
  1. RED：中文界面 `/undo` 无检查点时显示英文 `no session changes to undo`。
  2. 最小实现：命令层按界面语言转换两型已知原因，未知原因不吞。
  3. 目标成功：`sp0054-command-fidelity.test.mjs` 10/10 PASS（新增 1 例）。
- **检查**：英文界面显示 `Nothing to undo`；未知原因仍原样透出
- **状态记录**：DONE 2026-11-21；提交 `a869cd1`；用例 10 例 PASS

#### T-I4 端到端证据与文档收口

- **AC**：交付证据完整性（不属于 69 条产品 AC，属交付要求）
- **文件**：Modify `SP/SP006/test-report.md`、`STATUS.md`、`SP/SP006/requirements-summary.md`、`PRODUCT.md`、`release-notes/v0.6.0.md`、`docs/current-status.md`、`release-ledger.json`、`design/design.zh.md`（D-20、§16.7）、`design/plan.zh.md`（本波次）
- **Consumes**：`artifacts/e2e/` 下的真实模型脚本与日志（未入库，`artifacts/` 已 gitignore）
- **Produces**：test-report §9 全命令面与智能体流程真实端到端记录；文档数字与设计偏离表同步
- **依赖**：T-I1/T-I2/T-I3
- **责任/复用**：证据只记录真实执行结果；未执行项标 UNVERIFIED
- **工作目录**：仓库根
- **验证命令**：`npm run build`、`npm run test:unit`、`npm run test:checks`、`npm run spec:check`、`npm run skills:check`、`node scripts/release/sp006-packaging.mjs`、AST 脚本
- **预期行为**：
  1. RED：文档仍写 925 项与波次 H 的 18 项真实端到端计数 → 与实测不符。
  2. 最小实现：按实测更新数字与条目。
  3. 目标成功：门禁全 PASS，文档数字与实测一致。
- **检查**：AST 仍 53/53（本波次不新增源文件，仅修改既有 `commands.ts`）
- **状态记录**：DONE 2026-11-21；全量 926 项 / 925 通过 / 0 失败 / 1 跳过；AST 53/53，本仓单元 258、参考 14411、函数对 48743，命中「无」，结论 PASS；真实模型端到端累计 57 项（18 + 25 + 14）

## 全计划 AC 覆盖检查

| AC 组 | 单测任务 | 功能用例任务 |
| --- | --- | --- |
| TU-01…TU-13 | T-A1…T-A5 | T-A6（帧级） |
| TU-14/TU-15、HC-01…HC-07 | T-A7 | T-A7（真实子进程） |
| CMD-01…CMD-12 | T-B1、T-B2、T-B3 | T-B3（真实命令执行） |
| PI-01…PI-05 | T-C1 | T-C1（临时 home/workspace） |
| SM-01…SM-04 | T-C2 | T-C2 |
| SM-05…SM-09 | T-C3 | T-C3（假 MCP 子进程） |
| HK-01…HK-08 | T-C4 | T-C4（真实 hook 脚本） |
| WR-01…WR-05 | T-C5 | T-C5（真实 HTTP 服务） |
| NP-01…NP-05 | T-D1 | T-D1（仓库外安装） |
| AST-01…AST-03 | — | T-D2（脚本执行） |

未覆盖项：无。每条 AC 至少一例单测 + 一例功能用例（AST 以真实脚本执行作为功能证据）。
