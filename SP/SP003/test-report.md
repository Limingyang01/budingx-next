# SP003 验证报告 · 工作区与安全修改

状态：自动化验证完成，待交叉验证门禁与合入｜迭代：SP003｜日期：2026-11-17｜分支：`feature/SP003/workspace-tools`｜基线：`master` = `b0ffc9e`｜负责人：Agent 执行 SDD（2026-11-17 委托自审）

## 1. 概要

| 项 | 值 |
| --- | --- |
| 本轮 AC 总数 | 52（WT-01…21、CP-01…09、PC-01…13、FC-01…09） |
| 结论 | PASS 51 / UNVERIFIED 1（FC-03 的真终端 IME 人工部分） |
| SP003 专项用例 | 129 项，全部通过（workspace 104、core 契约 6、TUI e2e 19） |
| 全量产品单元 | 302 项全部通过（`npm run test:unit`） |
| 其他门禁 | `npm run spec:test` 9/9、`npm run test:release` 16/16、`npm run merge:test` 5/5、`npm run skills:test` 10/10、`npm run test:checks` 模块边界检查通过 |
| 新增运行时依赖 | 无（`src/tui/package.json` 依赖仍为 ink 8.0.0 / react 19.3.1 / string-width 9.0.0，边界检查校验一致） |
| 工作目录 | 全部命令在仓库根 `D:\my_project\budingx-next` 执行 |

命令与结果（2026-11-17 实跑）：

```text
npm run build          # tsc -p src/tui/tsconfig.json，0 error
npm run test:unit      # 302 tests, 302 pass, 0 fail
npm run test:checks    # 模块边界检查通过（含新增 workspace 条目）
npm run spec:test      # 9 pass
npm run test:release   # 16 pass
npm run merge:test     # 5 pass
npm run skills:test    # 10 pass
npm run merge:gate     # 见 §6
```

## 2. 分层证据说明

| 层 | 含义 | 本轮取证方式 |
| --- | --- | --- |
| L0 | 纯函数/契约 | 路径解析、忽略规则、diff、策略判定、上下文构建、补全候选（真实临时目录与真实文件，不 mock 文件系统） |
| L1 | 真实文件进程 | 真实工作区目录上的读写/编辑/搜索/撤销/规则持久化，含 junction 与 symlink 越界 |
| L2 | 伪 TTY 端到端 | `test/helpers/mount-tty.mjs` + 真实 Ink 渲染 + 真实 Session/审批网关（审批三档、diff 对话框、补全 overlay） |
| L3 | 真终端人工 | **未执行**：Windows Terminal/ConHost 下的观感与中文 IME 输入需人工 smoke，记 UNVERIFIED |

## 3. AC 逐条结论

### 3.1 workspace-tools（WT-01…WT-21）

| AC | 结论 | 依据（文件 → 用例 → 结果） |
| --- | --- | --- |
| WT-01 读取带行号与总行数 | PASS | `workspace/test/read.test.mjs`「a plain read returns numbered lines and the total」→ `1→one`、`3→three`、totalLines=4 |
| WT-02 行范围与越界报错 | PASS | 同文件「offset and limit select exactly the requested range」「an offset past the end is a clear error」→ `BUDINGX_WORKSPACE_002` |
| WT-03 编码/二进制/大文件/CRLF | PASS | 同文件「CRLF is normalised…file on disk is untouched」「a binary file is refused」「UTF-16 content is refused」「a whole-file read above the byte cap refuses with a range hint」 |
| WT-04 目标形态与父目录 | PASS | `workspace/test/write.test.mjs`「a missing parent directory is created by Write」「a directory target is refused」；`workspace/test/tools.test.mjs` 同名用例（需求 v0.2 语义） |
| WT-05 原子写与内容一致 | PASS | `write.test.mjs`「an existing file is overwritten atomically」+ 无残留 `.tmp` 断言 |
| WT-06 指纹冲突拒绝 | PASS | `write.test.mjs`「a stale fingerprint refuses the write and keeps the foreign change」→ `BUDINGX_WORKSPACE_008` |
| WT-07 Edit 唯一匹配语义 | PASS | `workspace/test/edit.test.mjs` 5 例（唯一命中/多处拒绝/replace_all/未命中提示/old==new 拒绝） |
| WT-08 空串创建 | PASS | `edit.test.mjs`「an empty old_string creates a file」「never overwrites an existing file」 |
| WT-09 Glob 递归与截断摘要 | PASS | `workspace/test/search.test.mjs`「a recursive glob finds files in any depth in stable order」「glob truncates with a count summary at the reference cap of 100」 |
| WT-10 Grep 形态与二进制跳过 | PASS | `search.test.mjs`「grep returns file, line number and content」「skips binary files and reports the skip count」 |
| WT-11 越界与 junction 防护 | PASS | `workspace/test/paths.test.mjs` 7 例（穿越/绝对路径越界/junction 越界/空路径） |
| WT-12 忽略规则 | PASS | `workspace/test/ignore.test.mjs` 9 例（根级/否定/目录级/`.ignore`/默认目录/`**`/注释） |
| WT-13 取消传播 | PASS | `search.test.mjs`「an aborted signal stops the search promptly」+ `tools.test.mjs` 同名用例 |
| WT-14 工具错误形态与稳定错误码 | PASS | `tools.test.mjs`「missing required parameter is a stable readable tool error」→ `BUDINGX_CORE_002`；错误码经 Session 透传（`core/test/permissions.test.mjs`） |
| WT-15 读后编辑门（未读拒绝） | PASS | `tools.test.mjs`「read-before-write gate: Write to an existing file that was never read is refused」→ `BUDINGX_WORKSPACE_010`，磁盘不变 |
| WT-16 读后陈旧拒绝 | PASS | `tools.test.mjs`「the file changed after the read blocks the write」→ `BUDINGX_WORKSPACE_011`，重读后放行 |
| WT-17 Write 行尾 LF | PASS | `write.test.mjs`「Write normalizes CRLF content to LF」；Edit 保留 EOL 由 `edit.test.mjs` CRLF 用例证明 |
| WT-18 整文件超限报错 | PASS | `read.test.mjs`「a whole-file read above the byte cap refuses with a range hint」→ `BUDINGX_WORKSPACE_005` + offset/limit 指引 |
| WT-19 Grep 参数族 | PASS | `search.test.mjs` 4 例（files_with_matches 按 mtime、count 汇总、上下文合并与分页、type/multiline）；工具层透传见 `tools.test.mjs`「Grep tool surface passes output_mode and pagination parameters」 |
| WT-20 弯引号容错 | PASS | `edit.test.mjs`「curly quote tolerance: a straight old_string hits a curly-quote file and the rest keeps its style」 |
| WT-21 搜索遵守 Read deny | PASS | 实现于 `workspace/tools.ts`（readDenied 排除钩子）+ `src/tui/runtime.ts` 装配；并入 WT-19 用例验证 |

### 3.2 change-preview（CP-01…CP-09）

| AC | 结论 | 依据 |
| --- | --- | --- |
| CP-01 结构化 diff | PASS | `workspace/test/diff.test.mjs` 6 例（hunk/行号/上下文上限/纯增纯删/超大回退/CRLF 等价） |
| CP-02 预览与磁盘一致 | PASS | `tui/test/diff-view.test.mjs`「preview matches disk: the /diff current source reflects external changes」 |
| CP-03 拒绝时磁盘不变 | PASS | `tui/test/diff-view.test.mjs`「a rejected write produces no change entry」；`tui/test/approval-tiers.test.mjs`「after a rejection the disk is unchanged」 |
| CP-04 并发改动保留 | PASS | `diff-view.test.mjs` 同 CP-02 用例：外部改动保留，撤销被阻止 |
| CP-05 撤销不吞用户改动 | PASS | `workspace/test/checkpoint.test.mjs`「automatic undo stops when the user changed the file after us」 |
| CP-06 改动集合粒度 | PASS | `checkpoint.test.mjs`「a turn touching several files undoes as a group」「chained edits to one file roll back in order」 |
| CP-07 两级对话框与源切换 | PASS | `tui/test/diff-view.test.mjs`「/diff opens the two-level dialog: list → detail → ←/→ source → Esc」；多源（Current + 逐回合）同用例验证 |
| CP-08 窄屏单栏 | PASS | `diff-view.test.mjs`「narrow terminal (60 columns) renders single column with gutter numbers」 |
| CP-09 多源切换 | PASS | 同 CP-07 用例（←/→ 在 Current 与回合差异间循环） |

### 3.3 permission-controls（PC-01…PC-13）

| AC | 结论 | 依据 |
| --- | --- | --- |
| PC-01 默认保守模式 | PASS | `workspace/test/policy.test.mjs`「default mode is read-only」；`core/test/permissions.test.mjs` 同义用例 |
| PC-02 模式切换与可见 | PASS | `tui/test/approval-tiers.test.mjs`「Shift+Tab cycles the three modes and the badge is visible」 |
| PC-03 只读拒绝写 | PASS | `policy.test.mjs`「the three-mode decision matrix」+ `approval-tiers.test.mjs`「read_only refuses writes without a card」 |
| PC-04 工作区内修改 | PASS | `policy.test.mjs` 同矩阵用例（ask） |
| PC-05 完全权限自动执行 | PASS | `policy.test.mjs` 同矩阵用例（allow）+ `approval-tiers.test.mjs`（无审批卡直接落盘） |
| PC-06 审批三档 | PASS | `approval-tiers.test.mjs`「the card shows three tiers; choosing 2 remembers the target」「choosing 1 allows only once」；拒绝反馈（PC-12）同批 |
| PC-07 规则增删改查生效 | PASS | `policy.test.mjs`「allow rules relax the mode default but not the floor or deny rules」「deny rules take priority over the mode」+ `storage/test/permissions.test.mjs` 持久化用例 |
| PC-08 底线不可绕过 | PASS | `policy.test.mjs`「the floor holds even in full access: credential-shaped files are refused in every mode」「paths outside the workspace and the user data directory are refused」+ `approval-tiers.test.mjs`「full access still refuses credential files」 |
| PC-09 遮蔽检测 | PASS | `policy.test.mjs`「shadowed rules are detectable」 |
| PC-10 拒绝后仍可继续 | PASS | `approval-tiers.test.mjs`「after a rejection the disk is unchanged, the session continues, /denials shows the record」 |
| PC-11 规则持久化 | PASS | `storage/test/permissions.test.mjs` 6 例（缺失/往返/损坏备份/新 schema 拒绝/contentPrefix 拒绝/坏规则） |
| PC-12 拒绝反馈回传模型 | PASS | `approval-tiers.test.mjs` 拒绝用例：反馈以 `User feedback:` 进入工具结果（断言于 provider 收到的第二次请求） |
| PC-13 `.git` 强制询问 | PASS | `policy.test.mjs`「version control metadata forces a question even in full access」 |

### 3.4 file-context（FC-01…FC-09）

| AC | 结论 | 依据 |
| --- | --- | --- |
| FC-01 @ 补全与忽略规则 | PASS | `tui/test/completion.test.mjs`「@ triggers the overlay: directory continuation, ignored files absent, ↓+Tab inserts the full path」 |
| FC-02 过滤与插入完整路径 | PASS | 同上（`@src/` → `alpha.ts`/`beta.ts`） |
| FC-03 @ 与 / 共用 overlay | PASS（自动化）| `completion.test.mjs`「/ and @ share the overlay」+ 纯函数用例「activeToken recognises both」；**真终端中文 IME 下的补全体验为人工项，记 UNVERIFIED（见 §5）** |
| FC-04 引用注入与上限 | PASS | `workspace/test/context.test.mjs`「an existing file becomes a context block with its content」「long files are truncated at the context line cap」「total budget overflow reports the skipped file」 |
| FC-05 异常引用提示 | PASS | `context.test.mjs`「missing, outside and unreadable references get readable errors」 |
| FC-06 图片占位摘要 | PASS | `context.test.mjs`「an image reference becomes a placeholder, never fake content」 |
| FC-07 每次读最新内容 | PASS | `context.test.mjs`「references read fresh content each build」 |
| FC-08 `#L` 行范围 | PASS | `context.test.mjs`「@file#L10-12 only brings the selected lines」 |
| FC-09 LCP 优先补全 | PASS | `tui/test/completion.test.mjs` 纯函数用例「longestCommonPrefix」+ e2e 插入用例 |

## 4. 出口门槛逐条对证（路线图 SP003）

| 门槛 | 结论 | 证据 |
| --- | --- | --- |
| 跨目录搜索、编码/CRLF/大文件/忽略规则、补丁冲突、目录穿越/junction 越界有回归 | PASS | `workspace/test/search.test.mjs` 13 例、`read.test.mjs` 10 例、`ignore.test.mjs` 9 例、`paths.test.mjs` 7 例（含 junction 与 symlink 越界）；补丁冲突见 `write.test.mjs` 指纹用例与 `checkpoint.test.mjs` 撤销阻断用例 |
| 拒绝写入磁盘不变，diff 与实际修改一致，用户无关改动保留 | PASS | `tui/test/approval-tiers.test.mjs` 拒绝用例（磁盘文件不存在 + `/denials` 记录）、`tui/test/diff-view.test.mjs` 预览一致与外部改动保留用例、`workspace/test/checkpoint.test.mjs` 撤销阻断用例 |
| 三权限模式切换与边界有回归 | PASS | `tui/test/approval-tiers.test.mjs` 6 例（轮播、三档、只读拒绝、完全权限、凭据底线）、`workspace/test/policy.test.mjs` 11 例 |
| 无旧仓源码/提示词/内部类型迁入；无新增运行时第三方依赖；模块边界检查通过 | PASS | `npm run test:checks` 通过（新增 workspace 条目）；`src/tui/package.json` 依赖白名单未变；参考仓仅用于行为对照，设计 §10 逐条登记差异与保留理由 |

## 5. 未验证项与恢复条件

| 项 | 状态 | 恢复条件 |
| --- | --- | --- |
| 真终端（Windows Terminal + ConHost）下的观感：首屏/审批卡/差异对话框/补全 overlay、中文 IME 输入 | UNVERIFIED | 需要人工在真实终端执行一次完整流程（模型配置 → 审批 → 改文件 → `/diff` → `@` 补全），并按人工清单逐条勾选；自动化伪 TTY 已覆盖帧级行为但不覆盖 IME 与观感 |
| live Provider 端到端（真实模型调用 Read/Write/Edit/Grep 的调用质量） | UNVERIFIED | 用户提供任一真实服务凭据与费用上限后执行：配置模型 → 让模型改一个文件 → 观察工具选择与读后编辑门行为；无凭据时按 SP002 既有口径记 UNVERIFIED，不用 mock 冒充 |
| 跨会话快照与 rewind（消息级撤销选择器） | NOT_APPLICABLE（本轮） | 属 SP005 会话可靠性范围，本轮只提供会话内撤销 |
| 图片多模态传递 | NOT_APPLICABLE（本轮） | 属 SP007；本轮图片只给尺寸摘要，不假装已读 |

## 6. 自审记录（合入前）

### 6.1 scoped diff 复核（master..HEAD）

- 引入差异仅含：`src/workspace/`（新模块 11 个源文件 + 8 个测试文件）、`src/core/{constants,session,tools,events,normalize,permissions,index}.ts`（契约扩展）、`src/storage/{paths,permissions,index}.ts`（规则持久化）、`src/tui/`（runtime/commands/app/approval/render 扩展 + 4 个测试文件）、`scripts/checks/module-boundaries.mjs`、`SP/SP003/**`、`PRODUCT.md`。
- **无**旧仓源码、提示词、内部类型、bundle 或生成物迁入；参考仓仅用于行为对照（设计 §10 登记 A1–A12 与 K1–K7）。
- **无**凭据、密钥、真实用户数据、日志、缓存与依赖目录进入提交；`src/tui/package.json` 依赖未增加。
- 契约两端核对：`core/tools.ts` 的 `ToolContext.turnId` 与 `ApprovalDecision.feedback` 均有消费方（session.ts 透传、app.tsx 反馈态）；`events.ts` 的 `turnId` 由 tools.ts 填充、`ChangeRecordSummary.turnId` 被 app.tsx 用于多源切换。
- 存储迁移：`permissions.json` 为新文件，schemaVersion 1，缺失即空集、损坏即备份并按空集运行；不改既有 `config.json`/`credentials.json` 语义。

### 6.2 本轮发现缺陷的 RED → 修复 → 复绿

| # | 缺陷 | RED 表现 | 修复 | 复绿 |
| --- | --- | --- | --- | --- |
| B-01 | 忽略目录内文件未被忽略（父目录命中目录规则时子文件仍出现） | `ignore.test.mjs`「a directory only pattern ignores directories」转红 | 增加父目录判定（`hasIgnoredParent`） | 9/9 绿 |
| B-02 | 空文件 diff 被算作「删一行」 | `tools.test.mjs` 写入新文件期望 `+1/-0` 实际 `+1/-1` | `splitLines('')` 返回零行 | 用例绿 |
| B-03 | 补全候选顺序与宿主提供的排序不一致 | `completion.test.mjs` 期望顺序不符 | 用例改为与 walk 排序一致的输入，保留「按宿主顺序」语义 | 6/6 绿 |
| B-04 | 拒绝键 `n`/`3` 改为反馈输入态后，既有 e2e 等待拒绝完成超时 | `wire-e2e.test.mjs` W4 超时 | 用例补一步 Esc 结束反馈态 | W4 绿 |
| B-05 | Grep 重写后 `mtimeMs` 被当作文件大小比较导致全部跳过 | `search.test.mjs` 多例转红 | 改用 `stats.size` 比较 | 13/13 绿 |

### 6.3 变异验证（确认用例能捕获目标行为）

- 路径边界：移除工作区包含判定后，3 项越界用例由绿转红；恢复后 7/7 绿。
- 写指纹：移除指纹比较后，陈旧指纹用例转红；恢复后 8/8 绿。
- Edit 歧义：放宽「多处匹配拒绝」后，对应用例转红；恢复后 9/9 绿。

### 6.4 风险与回退

| 风险 | 现状 | 回退 |
| --- | --- | --- |
| 权限过松 | 底线规则 B-1…B-5 与 `.git` 强制询问在完全权限下仍生效；负向回归已覆盖 | 关闭 `full_access`，模式与规则判定可独立回滚 |
| 覆盖用户改动 | 读后编辑门 + 指纹校验 + 撤销阻断三重保护 | 关闭写工具（保留读与搜索） |
| 自实现 ignore/diff 语义偏差 | 公开规范 + 覆盖用例；忽略规则只影响搜索与补全候选 | 退回「无忽略规则」开关（代码内） |
| 大仓搜索性能 | 扫描上限 20k 文件、结果上限 Glob 100 / Grep 250、补全缓存随回合失效 | 下调常量 |
| 回退总体 | 全部产出在 `feature/SP003/workspace-tools` 分支，产品版本保持 0.2.0 不动 | 整体弃分支，master 不受影响 |

## 7. 门禁与合入

| 步骤 | 结果 |
| --- | --- |
| `npm test`（skills/spec/unit/checks/release/merge） | GREEN（342 项，0 失败） |
| `npm run merge:gate` | 待执行（报告与自审记录齐备后运行，报告落 `artifacts/merge-gate/`） |
| 合入 master | 待门禁 GREEN 后按 [buding-merge](../../skills/buding-merge/SKILL.md) 执行；push 与 npm 发布不在授权内 |
