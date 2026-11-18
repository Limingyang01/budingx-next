# SP003 工作区与安全修改 · 实施计划

版本：v1.0｜状态：**active**｜依据：[design.zh.md](design.zh.md) v1.0（approved，Agent 自审 2026-11-17）｜分支：`feature/SP003/workspace-tools`（基线 `master` = `b0ffc9e`）｜cwd 约定：所有命令在仓库根 `D:\my_project\budingx-next` 执行

---

## Goal

把 budingx 从「能聊天」推进到「能在受控工作区内改代码」：模型获得五个受边界约束的文件工具；所有写操作经三权限模式与底线规则判定；改动可预览、可撤销；用户可用 `@` 引用文件。出口以路线图 SP003 门槛为准：跨目录搜索、编码/CRLF/大文件/忽略规则、补丁冲突、目录穿越/junction 越界有回归；拒绝写入磁盘不变；diff 与实际修改一致；用户无关改动保留；三权限模式切换与边界有回归。

## Architecture

- 新模块 `src/workspace`（IO 感知）：paths / ignore / read / write / edit / search / diff / checkpoint / policy / tools。
- `src/core` 保持无 IO：新增纯端口 `PermissionPolicy`，扩展 `ToolHandler`（capability/target）、`ApprovalDecision`（`allow_session`）、`MessageBlock`（`context`）、新事件（`permission_changed` / `change_set` / `denial_recorded`）、`Session.submit` 支持上下文。
- `src/storage` 新增 `permissions.json` 规则持久化（schemaVersion 1，原子写）。
- `src/tui`：审批三档卡片、权限模式徽标、diff 对话框（list→detail）、`@`/`/` 共用补全 overlay、新命令组。
- 依赖方向 `tui → workspace → core`，`workspace → storage`；`core` 不依赖 workspace/storage/IO（边界检查新增 workspace 条目）。

## Spec（权威来源）

- 设计：[design.zh.md](design.zh.md) v1.0
- 需求：[workspace-tools](../workspace-tools/requirements.md) v0.1、[change-preview](../change-preview/requirements.md) v0.1、[permission-controls](../permission-controls/requirements.md) v0.1、[file-context](../file-context/requirements.md) v0.1
- 路线图 r6、能力矩阵 v1.1、排查文档 r1 §4 SP003

## Global Constraints

1. 不新增运行时第三方依赖；diff、ignore、规则解析全部自实现；不迁入参考仓源码、提示词、内部类型或 bundle。
2. JS/TS：2 空格、ESM、无分号、UTF-8；中文注释与文案（用户可见文案随既有 `lang` 约定，机器面保持英文）。
3. 行为变更先写有意义的失败回归（RED），再最小实现（GREEN）；零测试、全 skip、基础设施报错不算 RED。
4. 不动 `~/.claude`；用户数据只写 `~/.budingx`；不硬编码用户名、盘符、cwd。
5. 既有 SP002 行为不得回归：`npm run test:unit` 既有 166 项必须持续全绿。
6. 每阶段完成即本地提交（中文提交说明）；不 push、不发布、不打标签、不设远端、不删分支。
7. 证据分层记录：L0 纯函数 / L1 真实文件进程 / L2 伪 TTY e2e / L3 真终端人工；互不冒充。

## Review Focus（评审重点）

- 越界与底线：B-1…B-5 是否在任何模式下都拒绝（含 `full_access`）。
- 磁盘不变量：拒绝、冲突、取消路径后磁盘逐字节不变。
- diff 一致性：预览描述的改动与落盘结果一致。
- 无关改动保留：并发外部修改不被覆盖；撤销不吞用户改动。
- 契约兼容：`ApprovalDecision`/`MessageBlock`/事件扩展不破坏 SP002 行为。
- 依赖与许可：零新增运行时依赖；来源台账一致。

---

## 任务清单

### T1 · workspace 模块骨架与路径边界

- **设计**：§3.1、§3.4
- **AC**：WT-11（部分）、WT-01（前置）
- **依赖**：无（首个任务）
- **Create**：`src/workspace/paths.ts`、`src/workspace/index.ts`、`src/workspace/test/paths.test.mjs`
- **Modify**：`scripts/checks/module-boundaries.mjs`（新增 workspace 条目）
- **Consumes**：工作区根（真实路径 `process.cwd()`）
- **Produces**：`resolveWorkspacePath(root, input)` → `{ absolute, relative, real }`；`isInside(root, target)`；`assertInside()`；错误码 `BUDINGX_WORKSPACE_001`（越界）、`_003`（非文件）
- **RED**：`paths.test.mjs` 断言 `../` 穿越、绝对路径越界、指向区外的 junction/symlink 均被判越界，且不读出区外内容
- **GREEN**：实现真实路径解析（存在路径取 realpath；不存在目标取父目录 realpath）+ Windows 大小写不敏感比较
- **验证**：`node --test src/workspace/test/paths.test.mjs`；`npm run test:checks`
- **完成事实**：待填（变更文件、用例数、结果）

### T2 · 忽略规则（gitignore 语义自实现）

- **设计**：§3.4
- **AC**：WT-12、FC-01（候选过滤前置）
- **依赖**：T1
- **Create**：`src/workspace/ignore.ts`、`src/workspace/test/ignore.test.mjs`
- **Consumes**：文件/目录绝对路径、工作区根
- **Produces**：`createIgnoreMatcher(root)` → `isIgnored(absolutePath): boolean`；支持 `.gitignore`/`.ignore`/目录级 `.gitignore`、`!` 取反、`/` 锚定、`**`、目录尾 `/`；默认忽略 `.git/`、`node_modules/`
- **RED**：断言根级与目录级规则、`!` 取反、锚定、默认忽略目录的匹配结果
- **GREEN**：自实现匹配器（不引入第三方 ignore 库）
- **验证**：`node --test src/workspace/test/ignore.test.mjs`
- **完成事实**：待填

### T3 · 读取工具 Read

- **设计**：§3.5
- **AC**：WT-01、WT-02、WT-03、WT-14
- **依赖**：T1
- **Create**：`src/workspace/read.ts`、`src/workspace/test/read.test.mjs`
- **Consumes**：路径解析结果、行范围参数
- **Produces**：`readFile(root, { path, offset, limit })` → `{ text, totalLines, truncated, bytes, kind: 'text'|'binary'|'image' }`；错误码 `_002`（不存在）、`_004`（编码不支持）、`_005`（超大）
- **RED**：断言行号格式、范围语义、越界范围报错、UTF-16/非法字节拒绝、大文件截断、CRLF 归一为 LF 且磁盘不变
- **GREEN**：实现读取与截断（单文件上限可配置，默认 10 MB）
- **验证**：`node --test src/workspace/test/read.test.mjs`
- **完成事实**：待填

### T4 · 写入工具 Write（原子写 + 基线指纹）

- **设计**：§3.5、§3.6
- **AC**：WT-04、WT-05、WT-06、WT-14、CP-04（部分）
- **依赖**：T1、T7（指纹与 diff 共用）
- **Create**：`src/workspace/write.ts`、`src/workspace/test/write.test.mjs`
- **Consumes**：旧内容指纹（SHA-256）、新内容
- **Produces**：`writeFile(root, { path, content, expectedFingerprint? })` → `{ path, bytes, created }`；错误码 `_008`（冲突）
- **RED**：断言父目录不存在报错、目标为目录报错、原子写后读回一致、指纹不匹配时拒绝且磁盘保留外部改动、失败无残留临时文件
- **GREEN**：临时文件 + rename 实现原子写，写前重算指纹
- **验证**：`node --test src/workspace/test/write.test.mjs`
- **完成事实**：待填

### T5 · 精确编辑工具 Edit

- **设计**：§3.5
- **AC**：WT-07、WT-08、WT-14
- **依赖**：T1、T4
- **Create**：`src/workspace/edit.ts`、`src/workspace/test/edit.test.mjs`
- **Consumes**：目标文件内容、`old_string`/`new_string`/`replace_all`
- **Produces**：`editFile(root, {...})` → `{ replacements, path }`；错误码 `_006`（未命中）、`_007`（歧义）
- **RED**：断言唯一命中替换、多处命中未给 `replace_all` 时拒绝、不存在时拒绝并给最接近片段、`old==new` 拒绝、空串 `old_string` 在目标已存在时拒绝
- **GREEN**：实现字面串匹配语义（不使用模糊匹配）
- **验证**：`node --test src/workspace/test/edit.test.mjs`
- **完成事实**：待填

### T6 · 搜索工具 Glob 与 Grep

- **设计**：§3.5、§3.4
- **AC**：WT-09、WT-10、WT-13
- **依赖**：T1、T2
- **Create**：`src/workspace/search.ts`、`src/workspace/test/search.test.mjs`
- **Consumes**：模式、工作区根、忽略匹配器
- **Produces**：`globFiles(root, { pattern, path? })`、`grepFiles(root, { pattern, path?, glob?, caseInsensitive? })` → `{ matches, total, shown }`（含计数摘要文本）
- **RED**：断言递归匹配、稳定排序、忽略规则生效、结果截断与计数摘要、二进制跳过计数、取消（AbortSignal）后尽快返回
- **GREEN**：自实现 glob 与正则检索（Node 内置能力）
- **验证**：`node --test src/workspace/test/search.test.mjs`
- **完成事实**：待填

### T7 · 行级 diff 与变更集合

- **设计**：§3.6
- **AC**：CP-01、CP-02
- **依赖**：T1
- **Create**：`src/workspace/diff.ts`、`src/workspace/test/diff.test.mjs`
- **Consumes**：旧文本、新文本
- **Produces**：`diffLines(oldText, newText)` → `DiffHunk[]`（`oldStart/oldLines/newStart/newLines/lines[{type,text,oldNo?,newNo?}]`）；`ChangeRecord` 类型
- **RED**：断言多 hunk 分组、行号 gutter、增删标记、上下文行上限、相同内容为空 diff
- **GREEN**：自实现行级 LCS（Myers 思路）
- **验证**：`node --test src/workspace/test/diff.test.mjs`
- **完成事实**：待填

### T8 · 检查点与撤销

- **设计**：§3.6
- **AC**：CP-05、CP-06
- **依赖**：T4、T7
- **Create**：`src/workspace/checkpoint.ts`、`src/workspace/test/checkpoint.test.mjs`
- **Consumes**：写入前旧内容、写入后指纹
- **Produces**：`createCheckpointStore()` → `record(change)`、`undo(last?)` → `{ undone: boolean, reason? }`
- **RED**：断言「磁盘内容仍等于我们写的内容」时可撤销；用户随后改动时停止自动撤销并提示；多文件改动集合可整组或单文件撤销
- **GREEN**：会话内存检查点（不落盘，SP005 负责持久化）
- **验证**：`node --test src/workspace/test/checkpoint.test.mjs`
- **完成事实**：待填

### T9 · core 契约扩展与策略接入

- **设计**：§4.1–§4.4、§3.3.4
- **AC**：PC-01（默认模式）、PC-10（拒绝后继续）、FC-04（上下文块通道）
- **依赖**：T1
- **Create**：`src/core/permissions.ts`
- **Modify**：`src/core/tools.ts`、`src/core/events.ts`、`src/core/session.ts`、`src/core/normalize.ts`、`src/core/constants.ts`
- **Consumes**：`ToolHandler.capability/target`、`PermissionPolicy` 端口
- **Produces**：判定结果 `allow | ask | deny`；`ApprovalDecision.outcome` 扩 `allow_session`；`MessageBlock` 增 `context`；事件 `permission_changed` / `change_set` / `denial_recorded`；`Session.submit(text, { context })`
- **RED**：core 单测断言——策略 deny 时不执行工具且产生错误结果、ask 时进入审批、allow 直接执行；`allow_session` 调用 `policy.remember`；上下文块在 API 归一化时与用户原话分离；既有 SP002 会话用例不回归
- **GREEN**：在 `dispatchTools` 前插入判定阶段；扩展事件与归一化
- **验证**：`node --test src/core/test/*.test.mjs`；`npm run test:unit`
- **完成事实**：待填

### T10 · 权限策略实现（三模式 + 规则 + 底线）

- **设计**：§3.3
- **AC**：PC-01、PC-02、PC-03、PC-04、PC-05、PC-07、PC-08、PC-09
- **依赖**：T1、T9
- **Create**：`src/workspace/policy.ts`、`src/workspace/test/policy.test.mjs`
- **Consumes**：工作区根、规则集合、模式
- **Produces**：`createPermissionPolicy({ root, rules, mode })` → `decide(request)`、`remember(request)`、`setMode(mode)`、`getMode()`
- **RED**：断言矩阵逐格行为（§3.3.1）、底线 B-1…B-5 在 `full_access` 下仍拒绝、deny 规则优先、allow 规则不放宽底线、遮蔽检测可识别被 deny 覆盖的 allow
- **GREEN**：实现判定流程（§3.3.4）
- **验证**：`node --test src/workspace/test/policy.test.mjs`
- **完成事实**：待填

### T11 · 规则持久化

- **设计**：§3.3.3
- **AC**：PC-07、PC-11
- **依赖**：T10
- **Create**：`src/storage/permissions.ts`、`src/storage/test/permissions.test.mjs`
- **Modify**：`src/storage/paths.ts`（`permissionsPath()`）
- **Consumes**：规则集合
- **Produces**：`loadPermissions()` / `savePermissions(rules)`；`schemaVersion: 1`；原子写 + 备份；损坏文件按「空规则 + 警告」处理且不覆盖原文件
- **RED**：断言保存后读回一致、未知 schemaVersion 报 `BUDINGX_STORAGE_002`、损坏文件不丢原文件、规则文件不含凭据
- **GREEN**：沿用既有 `atomic.ts` 写入模式
- **验证**：`node --test src/storage/test/permissions.test.mjs`
- **完成事实**：待填

### T12 · TUI 审批三档、模式徽标与命令组

- **设计**：§3.8
- **AC**：PC-02、PC-06、PC-10、FC-03（命令候选来源）
- **依赖**：T9、T10、T11
- **Modify**：`src/tui/approval.ts`、`src/tui/app.tsx`、`src/tui/commands.ts`、`src/tui/runtime.ts`、`src/tui/render/types.ts`、`src/tui/render/reducer.ts`
- **Create**：`src/tui/test/approval-tiers.test.mjs`
- **Consumes**：`ApprovalDecision` 三档、`change_set`/`denial_recorded`/`permission_changed` 事件
- **Produces**：审批卡片三档（`1/2/3`，兼容 `y/n`）；状态行模式徽标；命令 `/permission` `/rules` `/diff` `/undo` `/denials`；`Shift+Tab` 循环切换
- **RED**：伪 TTY e2e 断言三档各自效果、「记住」后同目标不再询问、拒绝后回合继续、模式徽标更新、命令输出可读
- **GREEN**：扩展 Ink 组件与命令分派
- **验证**：`node --test src/tui/test/approval-tiers.test.mjs`；`npm run test:unit`
- **完成事实**：待填

### T13 · TUI diff 对话框（list → detail + 源切换 + 窄屏）

- **设计**：§3.6
- **AC**：CP-02、CP-03、CP-07、CP-08
- **依赖**：T7、T8、T12
- **Create**：`src/tui/render/diff-view.ts`、`src/tui/test/diff-view.test.mjs`
- **Modify**：`src/tui/app.tsx`（对话框状态与按键）、`src/tui/render/types.ts`
- **Consumes**：`ChangeRecord[]` 与 diff hunk
- **Produces**：列表级（文件 + 增删行数）→ 详情级（hunk + gutter）；`turn`/`current` 源切换；窄屏（<70 列）单栏
- **RED**：伪 TTY e2e 断言两级切换、源切换内容不同、窄屏无分栏且行号可见、拒绝写入场景下预览与磁盘一致
- **GREEN**：Ink 自绘 diff 视图（纯文本 fallback 始终可用）
- **验证**：`node --test src/tui/test/diff-view.test.mjs`
- **完成事实**：待填

### T14 · 文件上下文注入（@ 引用）

- **设计**：§3.7
- **AC**：FC-04、FC-05、FC-06、FC-07
- **依赖**：T3、T9
- **Create**：`src/workspace/context.ts`、`src/workspace/test/context.test.mjs`
- **Consumes**：用户输入文本、读取能力、忽略匹配器
- **Produces**：`extractFileReferences(text)` → 引用列表；`buildContextBlocks(refs)` → `ContextBlock[]`（含截断标注与图片占位摘要）
- **RED**：断言引用存在文件注入内容、超上限截断标注、引用不存在/越界/被忽略给明确提示、图片只给尺寸摘要、每次引用读最新内容
- **GREEN**：实现引用解析与注入组装
- **验证**：`node --test src/workspace/test/context.test.mjs`
- **完成事实**：待填

### T15 · 补全 overlay（@ 与 / 共用）

- **设计**：§3.7、§3.8
- **AC**：FC-01、FC-02、FC-03
- **依赖**：T2、T14
- **Create**：`src/tui/render/completion.ts`、`src/tui/editor/completion.ts`、`src/tui/test/completion.test.mjs`
- **Modify**：`src/tui/app.tsx`（overlay 挂载与按键）、`src/tui/editor/buffer.ts`（overlay 状态钩子）
- **Consumes**：工作区文件候选、已注册命令列表、忽略匹配器
- **Produces**：纯函数候选计算（`completionCandidates(input, cursor, { files, commands })`）与 overlay 交互（上下键、Enter 选中、Esc 关闭、目录续补）
- **RED**：纯函数单测断言候选过滤与排序；伪 TTY e2e 断言 `@src/` 补全、目录续补、`/` 命令补全、忽略文件不出现、选中后插入完整相对路径
- **GREEN**：Ink 自绘 overlay
- **验证**：`node --test src/tui/test/completion.test.mjs`
- **完成事实**：待填

### T16 · 工具装配与宿主接线

- **设计**：§3.1、§3.5
- **AC**：WT-01…WT-14（端到端通道）、PC-01…PC-11（端到端通道）
- **依赖**：T3…T6、T10、T11
- **Create**：`src/workspace/tools.ts`、`src/workspace/test/tools.test.mjs`
- **Modify**：`src/tui/runtime.ts`（注册工具与策略、工作区根 = 启动 cwd）、`src/tui/cli.ts`（帮助文案与命令列表）
- **Consumes**：`Session` 的 `tools` 与 `permissionPolicy` 端口
- **Produces**：五个 `ToolHandler`（名称 `Read`/`Write`/`Edit`/`Glob`/`Grep`、参数 schema、capability、target、错误码）
- **RED**：断言工具注册后能力分类正确、路径参数解析一致、错误回传形态统一、既有 SP002 行为不回归
- **GREEN**：装配实现
- **验证**：`node --test src/workspace/test/tools.test.mjs`；`npm run test:unit`
- **完成事实**：待填

### T17 · 交付记录与文档同步

- **设计**：§9、仓库文档约定
- **AC**：全部（验收收口）
- **依赖**：T1…T16
- **Create**：`SP/SP003/test-report.md`
- **Modify**：`SP/SP003/requirements-summary.md`、四个 `STATUS.md`、`PRODUCT.md`、`docs/current-status.md`、`docs/iteration-plan.md`（SP003 状态）、`docs/reference-tui-replication-audit.md`（如需登记偏离）
- **Consumes**：各任务完成事实、门禁报告
- **Produces**：AC 逐条结论（PASS/FAIL/UNVERIFIED/NOT_APPLICABLE + 依据）、分层证据、自审记录、遗留项与风险、说明书同步
- **验证**：`npm test`；`npm run merge:gate`（GREEN 后合入 master）
- **完成事实**：待填

---

## 测试收口映射（AC → 任务 → 用例 → 命令）

| AC | 任务 | 单元用例（文件） | 功能用例 | 命令 |
| --- | --- | --- | --- | --- |
| WT-01 | T3 | `workspace/test/read.test.mjs` | `tui/test/wire-e2e.test.mjs`（Read 回合） | `node --test src/workspace/test/read.test.mjs` |
| WT-02 | T3 | 同上 | 同上 | 同上 |
| WT-03 | T3 | 同上 | 同上 | 同上 |
| WT-04 | T4 | `workspace/test/write.test.mjs` | `tui/test/wire-e2e.test.mjs` | `node --test src/workspace/test/write.test.mjs` |
| WT-05 | T4 | 同上 | 同上 | 同上 |
| WT-06 | T4 | 同上 | 同上 | 同上 |
| WT-07 | T5 | `workspace/test/edit.test.mjs` | `tui/test/wire-e2e.test.mjs` | `node --test src/workspace/test/edit.test.mjs` |
| WT-08 | T5 | 同上 | 同上 | 同上 |
| WT-09 | T6 | `workspace/test/search.test.mjs` | `tui/test/wire-e2e.test.mjs` | `node --test src/workspace/test/search.test.mjs` |
| WT-10 | T6 | 同上 | 同上 | 同上 |
| WT-11 | T1 | `workspace/test/paths.test.mjs` | `tui/test/wire-e2e.test.mjs`（越界拒绝） | `node --test src/workspace/test/paths.test.mjs` |
| WT-12 | T2 | `workspace/test/ignore.test.mjs` | `tui/test/wire-e2e.test.mjs` | `node --test src/workspace/test/ignore.test.mjs` |
| WT-13 | T6 | `workspace/test/search.test.mjs` | `tui/test/wire-e2e.test.mjs`（取消） | 同上 |
| WT-14 | T3/T4/T5 | 各工具用例 | `tui/test/wire-e2e.test.mjs` | `node --test src/workspace/test/*.test.mjs` |
| CP-01 | T7 | `workspace/test/diff.test.mjs` | `tui/test/diff-view.test.mjs` | `node --test src/workspace/test/diff.test.mjs` |
| CP-02 | T4/T7 | `write.test.mjs` | `tui/test/diff-view.test.mjs` | 同上 |
| CP-03 | T4/T13 | `write.test.mjs` | `tui/test/diff-view.test.mjs` | 同上 |
| CP-04 | T4 | `write.test.mjs` | `tui/test/wire-e2e.test.mjs` | 同上 |
| CP-05 | T8 | `workspace/test/checkpoint.test.mjs` | `tui/test/wire-e2e.test.mjs` | `node --test src/workspace/test/checkpoint.test.mjs` |
| CP-06 | T8 | 同上 | 同上 | 同上 |
| CP-07 | T13 | — | `tui/test/diff-view.test.mjs` | `node --test src/tui/test/diff-view.test.mjs` |
| CP-08 | T13 | — | 同上 | 同上 |
| PC-01 | T9/T10 | `core/test/session.test.mjs`、`workspace/test/policy.test.mjs` | `tui/test/wire-e2e.test.mjs` | `node --test src/workspace/test/policy.test.mjs` |
| PC-02 | T10/T12 | `policy.test.mjs` | `tui/test/approval-tiers.test.mjs` | 同上 |
| PC-03 | T10 | `policy.test.mjs` | `tui/test/wire-e2e.test.mjs` | 同上 |
| PC-04 | T10 | 同上 | 同上 | 同上 |
| PC-05 | T10 | 同上 | 同上 | 同上 |
| PC-06 | T12 | — | `tui/test/approval-tiers.test.mjs` | `node --test src/tui/test/approval-tiers.test.mjs` |
| PC-07 | T10/T11 | `policy.test.mjs`、`storage/test/permissions.test.mjs` | `tui/test/wire-e2e.test.mjs` | 同上 |
| PC-08 | T10 | `policy.test.mjs` | `tui/test/wire-e2e.test.mjs` | 同上 |
| PC-09 | T10 | 同上 | — | 同上 |
| PC-10 | T9/T12 | `core/test/session.test.mjs` | `tui/test/approval-tiers.test.mjs` | 同上 |
| PC-11 | T11 | `storage/test/permissions.test.mjs` | — | `node --test src/storage/test/permissions.test.mjs` |
| FC-01 | T2/T15 | `tui/render` 候选纯函数用例 | `tui/test/completion.test.mjs` | `node --test src/tui/test/completion.test.mjs` |
| FC-02 | T15 | 同上 | 同上 | 同上 |
| FC-03 | T12/T15 | 同上 | 同上 | 同上 |
| FC-04 | T14 | `workspace/test/context.test.mjs` | `tui/test/wire-e2e.test.mjs` | `node --test src/workspace/test/context.test.mjs` |
| FC-05 | T14 | 同上 | 同上 | 同上 |
| FC-06 | T14 | 同上 | 同上 | 同上 |
| FC-07 | T14 | 同上 | 同上 | 同上 |

汇总：40 条 AC 全部有单元用例与功能（端到端）用例；CP-07/08、PC-06、PC-09、PC-11 的功能层证据并入相邻用例组，用例中显式标注对应 AC。

---

## 执行顺序与依赖

```text
T1 ─┬─ T2 ── T6
     ├─ T3 ─┬─ T4 ── T5
     │      └─ T8
     ├─ T7 ── T8
     ├─ T9 ── T10 ── T11
     └─ T9 ── T14 ── T15
T16（装配）在 T3–T6、T10、T11 之后
T12（TUI 审批/命令）在 T9–T11 之后
T13 在 T7、T8、T12 之后
T17（交付）在全部实现任务之后
```

## 全量门禁（合入前）

```bash
npm test            # skills/spec/unit/checks/release/merge 全段
npm run merge:gate  # 交叉验证门禁（含 pack-smoke 与 test-report 审计）
```

门禁 RED 禁止合入 master；修完重跑，不得降阈值或删断言。

---

## T18 能力对齐批次（2026-11-17 追加，依据设计 v1.1 §10）

对照参考仓只读盘点后补齐的能力面，全部按 RED→GREEN 实施，证据落在同名测试文件。

| 任务 | 内容 | AC 覆盖 | 验证 | 状态 |
| --- | --- | --- | --- | --- |
| T18a | 读后编辑门（会话内已读记录 + 陈旧校验）+ 错误码 010/011 | WT-05/WT-06 扩展 | `workspace/test/tools.test.mjs`（3 例新增） | ✅ `10518f7` |
| T18b | Write 自动建父目录 + 强制 LF；Edit 保留 EOL；Read 整文件超限改为抛错并给 offset/limit 提示 | WT-03/WT-04 修订 | `workspace/test/read.test.mjs`、`write.test.mjs` | ✅ `10518f7` |
| T18c | 拒绝反馈输入态 + `ApprovalDecision.feedback` 回传模型 | PC-06/PC-10 扩展 | `core/test/permissions.test.mjs`、`tui/test/approval-tiers.test.mjs` | ✅ `10518f7` |
| T18d | Grep 参数族（output_mode/-A/-B/-C/head_limit/offset/multiline/type）+ Glob 上限 100 | WT-09/WT-10 扩展 | `workspace/test/search.test.mjs`（4 例新增） | ✅ `10518f7` |
| T18e | `@file#L10-20` 行范围引用 + 补全 LCP 优先 | FC-01/FC-04 扩展 | `workspace/test/context.test.mjs`、`tui/test/completion.test.mjs` | ✅ `10518f7` |
| T18f | `/diff` 多源（Current + 逐回合）+ ←/→ 切换 | CP-07 扩展 | `tui/test/diff-view.test.mjs` | ✅ `10518f7` |
| T18g | `.git` 写入强制询问（优先于记忆与 allow 规则） | PC-08 扩展 | `workspace/test/policy.test.mjs` | ✅ `10518f7` |
| T18h | Edit 弯引号等长折叠容错 | WT-07 扩展 | `workspace/test/edit.test.mjs` | ✅ `10518f7` |
| T18i | 搜索结果遵守 Read deny 规则 | WT-09/WT-10 扩展 | `workspace/tools.ts` + runtime 装配（并入 T18d 用例） | ✅ `10518f7` |

T18 之后的收口任务：T17（交付记录、test-report、说明书与文档同步）→ 交叉验证门禁 → 合入 master。

## 验收修复任务

- F1（FC-01…09）回归覆盖提交、排队、范围、引号和补全，接通 Session、workspace 与 TUI。
- F2（CP-01…09、PC-06、WT-15/16）回归覆盖审批前 diff、批准冲突、回合统计与撤销，修复变更计划和检查点。
- F3（WT-01…03、WT-07、WT-09…12、WT-19）回归覆盖检索、范围读取、匹配和编码边界，保留现有工作区约束。
- F4 更新说明书和证据记录，执行聚焦 test、npm test 与 npm run merge:gate。修复留在 fix 分支。

## 0.3.1 模型面板修复任务

| 任务 | 验收 | 代码和验证 |
| --- | --- | --- |
| MM-F1 | 管理入口、表单与移除旧命令 | `commands.ts` 与 `model-manager.tsx`；空列表、Custom、新增/编辑/删除/切换、管道列表、旧命令拒绝 |
| MM-F2 | 模板与模型发现、连接测试 | `model-management.ts` 与 `provider/openai.ts`；厂商模板、Bearer 绑定、列表解析、鉴权失败提示和手填 |
| MM-F3 | 数据与会话不变量 | 复用档案和凭据仓库；验证旧数据、密钥不回显、不同主机不复用、默认替代和队列边界 |
| MM-F4 | 用户文档 | `PRODUCT.md` 按交付迭代组织命令，随包 README 同步，写作约定归档到 `docs/documentation.md` |

实施在 `fix/SP003/model-management`；0.3.1 留待发布准备阶段。

## 0.3.2 厂商兼容任务

1. MiniMax 探测红绿与同档案工具续跑。
2. MiniMax 中国站及百炼 Token Plan 模板、工作空间列表路由和鉴权反馈。
3. 本地模板回归、全量门禁、0.3.2 patch 准备与发布预演。
