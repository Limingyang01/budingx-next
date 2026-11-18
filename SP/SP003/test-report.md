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
| `npm run merge:gate` | **GREEN**（2026-11-17T13-39-37Z）；报告 `artifacts/merge-gate/feature-SP003-workspace-tools-2026-11-17T13-39-37-977Z.md`（json 同名）；含 npm test / spec:check / skills:check / pack-smoke 与 outgoing 扫描、test-report 审计 |
| 合入 master | **已合入**：源 `910e282` → 目标 `master`，merge-base `b0ffc9e`，merge-tree 预演无冲突，实际合并提交 `3e796be`（--no-ff，保留历史）；ancestry 已证明（`git merge-base --is-ancestor 910e282 master` 为真）；合入后在 master 复跑 `npm test` 全绿（342 项，0 失败）；push 与 npm 发布不在授权内 |

## 8. 验收修复分支

2026-11-18｜基线 `master` `76edf2c`｜分支 `fix/SP003/workspace-tui`。依据用户本轮要求在独立工作树完成修复与门禁。此前 §1–7 保留原始交付的历史记录，本节记录验收复查和修复复测。

| 验收点 | 结论 | 证据 |
| --- | --- | --- |
| FC-01…09 | PASS（自动化） | 伪 TTY 捕获指定文件行进入 Provider 请求，多个范围、排队时的最新内容、忽略和拒读反馈、空格文件名和模糊候选分别复测。真实 CLI 子进程对本地 HTTP fixture 验证了 `--prompt` 和管道两条入口。 |
| CP-01…04、PC-06、WT-15/16 | PASS | 审批卡显示改前、改后行，批准后实际文件对应；拒绝时磁盘保持原样，审批期间外部编辑和目标被新建均使计划失效。失败的计划不产生检查点，也不记住审批。 |
| CP-05…09 | PASS（自动化） | 无参数撤销保留较早回合，恢复原 CRLF 字节；本回合内同一文件两次写入都计入结果，撤销后当前统计归零。只读 Git 源在临时 Git 工作区验证了既有文件变更和未跟踪文件。 |
| WT-01…03、WT-07、WT-09…12、WT-19 | PASS | 合法 U+FFFD、超过原大小上限的文件范围、CRLF 插入、单文件 Grep、超过 2 MiB 的匹配和超限提示、多行空行、`-i`/`-n`、glob 备选、忽略字符类、缺失父目录路径检查。 |
| L3 真实终端与线上模型 | UNVERIFIED | 恢复条件为在 Windows Terminal 或 ConHost 手动走完补全、审批滚动和 diff 切换，再用隔离的真实模型配置发起带文件上下文与编辑的回合。 |

- 初始 15 项回归在基线上复现 14 项断言失败。另对 Git 差异源及缺失父目录判定分别确认 RED。最终 `sp003-review-regressions.test.mjs` 扩充至 23 项，连同 CLI、workspace、core 权限、审批、补全、diff 和 wire 回归，专项共 **162 项通过、0 失败、0 跳过**。在 fix 工作树运行 `npm run build`，然后用 `node --test` 运行上述用例。
- 独立的全量 `npm test` 在最终新增审批复测前执行，365 项通过，模块边界检查通过。提交后再次执行 `npm run merge:gate`，其全量测试和隔离制品验证结果保存到 `artifacts/merge-gate/`。
- 自审核对了提交范围、审批计划与写盘契约、工作区边界、终端与 CLI 请求入口。Git 差异通过固定的只读 Git 子命令获取，保留会话基线差异。搜索和 Git 快照超限会提示不完整。没有新增依赖或存储迁移，参考仓用于行为比对，由本仓独立实现。产品说明书 §5.1、§5.2、§5.4 已同步。回退范围是本 fix 分支的提交。

## 9. master 集成与发布准备

- fix 提交 `9e3984c` 的交叉验证门禁为 GREEN。以 `76edf2c` 为目标预演无冲突，合并提交 `598fb891a44882743e94cdf0beca4fb6b8243bf2`；Git ancestry 核对通过。
- 在干净工作树检出该合并提交执行 `npm test`，共 366 项通过、0 失败、0 跳过，模块边界检查通过。
- 使用 `npm run version:prepare -- minor --iteration SP003` 准备首次公开交付 0.3.0。发布预演使用 `CI=true` 和显式发布参数 `--dry-run --expected-version 0.3.0 --tag latest`，报告保存在被忽略的 `artifacts/release/`。公开状态与完整性在实际手动发布后写回台账。
- 产品说明书、TUI README、文档入口、版本规范及发布指引均已同步。Git 提交和制品范围为 SP003 与候选版本资料，主工作树中 SP004 本地文档继续保留。

## 模型管理面板修复（目标 0.3.1）

分支 `fix/SP003/model-management`，基线 `46c38a5`。旧命令移除与新面板、模板/拉取和使用手册范围经用户确认。0.3.1 仅为目标版本，包版本和发布台账留待发布准备。

| 验收项 | 结论 | 证据 |
| --- | --- | --- |
| MM-F1 面板与命令 | PASS | 旧代码上打开面板的伪 TTY 用例先红；新分支验证 `/models`、Custom、新增、编辑、取消与确认删除、切换，管道列表和旧命令拒绝。 |
| MM-F2 模型发现与测试 | PASS（本地） | 模板仅需录入 Key，拉取后筛选和选择；Qwen 接口形状、OpenAI 兼容列表、无列表建议/自填、401 与请求取消覆盖。本地 HTTP 覆盖授权头、无重定向与结果解析。 |
| MM-F3 存储和回合边界 | PASS | 伪 TTY 确认密钥不回显、局部编辑保留同主机凭据，换主机旧凭据失效，删除支持替代或留空，队列等待面板退出；本地 HTTP 真实切换后会话保留。旧档案和显式空默认都受测。 |
| MM-F4 用户文档 | PASS | `PRODUCT.md` 按 Bootstrap/SP002/SP003 归类，补齐语法、示例、权限边界与迁移。文件测试核对每个帮助命令都有用法。写作规范见 [文档约定](../../docs/documentation.md#产品使用文档怎么写)。 |
| 真实账号和终端 | UNVERIFIED | 恢复条件是用各模板的授权测试 Key 验证实际模型可用性，并用 Windows Terminal 与 ConHost 手动验证输入法、剪贴板和窄屏。 |

专项回归 54 项通过，随后命令专项为 14 项通过（新增文档覆盖、发现路由和默认选择断言）。交叉验证对提交后精确内容执行并生成 `artifacts/merge-gate/` 回执。实现独立编写；未复制旧仓源码、未新增依赖或读取实际用户凭据。回退以该 fix 提交为界；无自动配置迁移和 npm 上传。

## 0.3.1 合并与发布准备

- `fix/SP003/model-management` 的 `8902b24` 门禁 GREEN，合并提交为 `8556ba4489c59278c5f833b3ef0955c70bea71b0`。检出精确合并提交后以 `CI=true npm test` 重跑，375 项通过、0 失败、0 跳过，模块边界检查通过。
- 0.3.0 的 Windows、Linux 和 OIDC 发布见 [GitHub Actions #9](https://github.com/Limingyang01/budingx-next/actions/runs/44218571836)。官方隔离安装及 HTTP 冒烟通过，核验 46 个 registry signatures、5 个 attestations；provenance 的源码、工作流、运行和 SHA-512 与已发布包一致。原 CI artifact 下载需认证（HTTP 401），台账以公开来源及实际安装证据回填。
- 同轮修复使用 `npm run version:prepare -- patch --iteration SP003` 准备 0.3.1。发布预演对精确准备提交执行，回执保存在忽略目录 `artifacts/release/`；实际发布由维护者在 GitHub 手动触发。更新了产品使用说明的发布版本提示，按迭代归类及文档编写规范继续保留。
- 首次 0.3.1 发布预演检出了伪终端模型输入测试的时序问题，写入档案前测试读取了结果。辅助流程改为逐步等待面板、字段焦点和保存回显，原有密钥持久化及隐藏断言保留。最终候选重新执行发布预演。

## 0.3.1 公开发布回执

- [GitHub Actions #11](https://github.com/Limingyang01/budingx-next/actions/runs/44229230445) 从 `314fedf0a84b74b40a1b077de5dfcbeaeaa97a78` 完成 Windows、Linux 阶段和 OIDC 发布。公共 npm 发布于 `2026-11-18T03:20:51.605Z`，dist-tag `latest` 核对为 `0.3.1`。
- 官方源隔离安装通过，绝对路径 npm shim 输出 `0.3.1`，管道 `/models` 与本地 HTTP 流式请求通过。npm 验证 46 个 registry signatures 和 5 个 attestations。SHA-512 与候选预演、npm 安装锁和 provenance 的 subject 一致，provenance 工作流、源码和运行 URL 核对通过。
- CI 原始 artifact 下载返回 HTTP 401。发布台账保留该证据边界，并记录公开 provenance 和独立安装，不代替真实 Provider 或终端输入法验证。

## 0.3.2 厂商模板与连接兼容修复

分支 `fix/SP003/minimax-032`，基线 `af6b6d3`。用户确认 Qwen 已改用 Token Plan 地址后可调用。0.3.2 在独立分支准备，当前 npm latest 仍为 0.3.1。

| 项 | 结论 | 证据 |
| --- | --- | --- |
| MiniMax 探测 | PASS | 低预算以及仅有思考内容的两条 fixture 在旧代码上复现失败。新实现采用有界 completion 预算和低思考档，覆盖正文、仅思考及真实工具回填判断。 |
| 档案模板与列表 | PASS | 伪 TTY 验证 MiniMax 中国站和 Qwen Token Plan 从模板、隐藏粘贴 Key 到选择并应用。命令回归覆盖百炼工作空间 URL、Token Plan 专用 URL、列表缺失建议和 401 不降级。 |
| 工具续跑 | PASS | 同档案、主机和模型的工具回合携带 opt-in 思考；切换档案后省略。非 MiniMax 请求形状保持。 |
| 外部 Provider | UNVERIFIED | 恢复条件是用对应地域与套餐的授权 Key，在 MiniMax 中国站与百炼 Token Plan 验证实际连接和真实工具往返。此轮没有读取用户 Key。 |

专项 55 项与模型面板 5 项均通过。交叉验证和真实制品 dry-run 在该修复分支的确切提交上运行，回执位于忽略的 `artifacts/`。产品说明与模板迁移见 [0.3.2 发行说明](../../release-notes/v0.3.2.md)。
- 首次全量门禁复现模型面板刚显示时首个快捷键丢失（Ink 子视图的输入事件通过被动 effect 注册）。改为主应用维持输入监听，模型面板在布局阶段接管处理；回归保留原输入与持久化断言。

### 0.3.2 模型共享回归

- 红绿验证覆盖批量建档只保存一份 Key、同组切换与删到最后一个才移除密钥，以及已有单模型档案显式添加同组、同端点的独立账号互不共享。
- 模拟真实配置保存失败后验证恢复旧 Key。更换同域名的端点路径时共享 Key 不沿用，活动档案也刷新。CLI 子进程从独立临时 home 启动，切换同组模型后本地 HTTP fixture 验证 Authorization。
- 伪 TTY 验证空格多选、筛选后保留已选模型、批量保存、A 添加同组沿用 Key，密钥不回显。专项命令与 CLI 25 项通过，模型面板 6 项通过。没有新增依赖和持久化格式版本，也未读取实际用户配置。
- 原 0.3.2 候选仍为 prepared，最终提交重跑门禁与 dry-run。真实厂商回执和 Windows 真终端输入法仍待对应环境验证。

### 0.3.2 全屏与会话标签回归

`npm run build` 通过。使用 `node --test src/tui/test/screen-e2e.test.mjs src/tui/test/header.test.mjs` 验证 26 项，通过 26 项，覆盖备用屏幕进入与退出、窗口缩放、Shift+Tab、长会话翻页和会话标题状态转换。Windows Terminal 实际标签观感与中文输入法仍待真终端验证。

### 0.3.2 主线集成

源提交 `edd6a4e` 的交叉验证门禁 GREEN，覆盖 5 个提交和 34 个文件。合并预演无冲突，已在独立工作树合入 master（合并提交 `35bb2a1`），确认合并结果与预演树一致。发布预演以最终 master 提交为准，回执留存在本地 `artifacts/release/`；正式发布由维护者在 GitHub Actions 手动触发。

### 0.3.2 公开发布回执

- [GitHub Actions #12](https://github.com/Limingyang01/budingx-next/actions/runs/44248899298) 使用源码 `027e0195bd7d188e2bd28fc658682c2fe6bb2547`，Windows、Linux 与 OIDC 发布作业均成功。npm 发布于 `2026-11-18T06:11:51.994Z`，`latest` 指向 `0.3.2`。
- 官方源隔离安装通过。npm 命令入口返回 `0.3.2`，本地 HTTP 流式冒烟通过。已验证 46 个 registry signatures 和 5 个 attestations。SHA-512 与候选预演、安装锁和 provenance 的 subject 一致。provenance 的源码、工作流路径和运行地址与本次任务一致。
- Actions 原始回执下载需登录（HTTP 401）。台账依据公开 provenance 和独立安装证据更新。本次发布验证沿用真实 Provider 和终端输入法的既有未验证范围。

### 0.3.3 会话体验

以 0.3.2 为基线，伪 TTY 的用户消息、计时和 Tab 续问用例及 HTTP 请求身份用例先失败。编译后运行 TUI、HTTP 与 CLI 三组专项用例，共 27 项通过。

| 验收项 | 结果 | 证据 |
| --- | --- | --- |
| 提问、阶段和计时 | PASS | 伪 TTY 检查提问与回答顺序、思考阶段秒数递增、结束耗时及本地时刻。 |
| 回答后可编辑续问 | PASS | 伪 TTY 检查 Tab 填入、填入后隐藏提示、会话发送次数仍为一次。 |
| Budingx 身份和模型对话历史 | PASS | 本地 HTTP 检查 system 消息、模型切换、普通请求与故障恢复历史。 |
| 真实模型与终端 | UNVERIFIED | 用实际供应商发起身份提问，并在 Windows Terminal 检查屏幕与输入法。 |

自审确认变更集中于运行时事件、请求身份、TUI 与 0.3.3 发行文档。供模型调用的思考片段仍由已有会话逻辑管理，TUI 仅展示思考阶段。Tab 续问由本地规则生成。

### 权限模式持久化与配色

针对 PC-02 和 PC-11，先用伪 TTY 验证缺少配色和免审批提示，并在隔离用户目录复现重建运行时丢失模式。实现后，存储、运行时、审批和屏幕专项 54 项通过。

- 交互运行时分别恢复只读、工作区内修改和完全权限。测试覆盖 `/permission` 切换、规则修改后保留偏好、管道启动不继承全自动、无效偏好和损坏规则回退、写入失败返回可供 TUI 提示的状态。
- 伪 TTY 核对三种徽标的 ANSI 颜色、全自动文字、Shift+Tab 切换和 42 列缩放。完全权限仍通过已有凭据拒绝、审批边界和规则优先级回归。
- 自审确认偏好与规则分文件写入，原子写入使用独立临时文件。PRODUCT.md、随包 README 和 PC-02/PC-11 已同步。Windows Terminal 实际配色观感为 UNVERIFIED，恢复条件为在真终端启动并切换三种模式。

### 0.3.4 集成与发布准备

权限模式分支 `1e35b36` 门禁 GREEN。合并预演与实际合并树一致，合并提交 `490166d` 中 391 项全量测试通过。用户确认 0.3.4 同时包含会话体验和权限模式，原 0.3.3 候选登记为 superseded。正式发布由维护者手动触发，最终候选的本地预演回执保存在 `artifacts/release/`。

### 0.3.4 公开发布回执

- [GitHub Actions #13](https://github.com/Limingyang01/budingx-next/actions/runs/44257392923) 从 `a68e6a179df6288f47d6dcca60bfcdd91c22d048` 完成 Windows、Linux 验证与 OIDC 发布。npm 发布时间为 `2026-11-18T07:19:20.042Z`，`latest` 指向 `0.3.4`。
- 官方包隔离安装通过，命令入口返回 `0.3.4`，本地 HTTP 流式请求通过。在隔离用户目录保存完全权限后，管道启动仍显示只读。已验证 46 个 registry signatures 和 5 个 attestations。SHA-512 与候选预演、安装锁和 provenance 的 subject 一致。provenance 的源码、工作流和运行地址与本次发布一致。
- Actions 原始回执下载需登录（HTTP 401）。发布台账依据公开 provenance 和官方包独立安装证据登记。真实供应商回答措辞和 Windows Terminal 实际显示仍待对应环境验证。

### 会话排版与状态栏精修

对照旧仓的独立用户消息组件、Markdown tokenizer 和辅助信息样式，沿用行为机制并用 BudingX 色彩独立实现。Markdown 解析使用公开的 Marked 18.2.1，未迁入旧仓产品代码。原用例在旧渲染上复现原始 Markdown、消息前缀和底部空闲状态。

专项 36 项通过。伪 TTY 断言提问底色、去掉角色前缀、强调与代码呈现、完成行低亮度和只读短标签，并在 32 列检查折行。已回归模式颜色、全自动提示、权限切换、输入补全和历史滚动。Windows Terminal 实机显示为 UNVERIFIED，恢复条件为在真实终端比较常规与窄屏下的消息层级和配色。

### 0.3.5 集成与发布准备

源提交 `aad9a5b` 的交叉验证门禁为 GREEN，覆盖 3 个提交和 17 个文件。合并预演与实际合并树一致，合并提交为 `7f6c488`。发行说明记录 Markdown 排版、提问样式及状态栏调整，发布预演以最终准备提交为准。正式发布由维护者在 GitHub Actions 手动触发。

### 0.3.5 公开发布回执

- [GitHub Actions #14](https://github.com/Limingyang01/budingx-next/actions/runs/44262744543) 使用源码 `f2682cdce765339daf0bbb2a551f7f09751c5446`，Windows、Linux 与 OIDC 发布均成功。npm 发布时间为 `2026-11-18T08:01:03.067Z`，`latest` 指向 `0.3.5`。
- 官方包隔离安装通过，命令入口返回 `0.3.5`，本地 HTTP 流式冒烟通过。已验证 47 个 registry signatures 和 6 个 attestations。SHA-512 与候选预演、安装锁和 provenance 的 subject 一致。provenance 的源码、工作流和运行地址均与本次发布一致。
- Actions 原始回执下载需登录（HTTP 401）。台账根据已核验的公开 provenance 和官方包独立安装结果登记。Windows Terminal 的实际观感仍待实机确认。

### REPL 交互对齐

旧形态首先复现了滚轮未启用 SGR、进度位于输入下方和交互默认只读。伪终端回归覆盖分段滚轮数据、上下滚动、欢迎区随历史滚动、草稿保留、Ctrl+End 和退出禁用鼠标追踪。真实临时工作区回归覆盖普通写入直通、敏感目标请求审批及拒绝后磁盘保持不变。工具行回归检查运行脉动、成功绿色、失败红色以及隐藏请求 ID。

自审确认改动位于 TUI、交互权限策略和文档，现有 Provider 事件与发布工作流未改。Windows Terminal 实际滚轮、配色和图标观感为 UNVERIFIED，恢复条件为在实机启动包含长历史的会话并分别触发成功和失败工具。

同步回归 SP002，补齐输入下方排队预览、行首尾按键和输入分隔线。参见 [SP002 对照复验](../SP002/test-report.md#20-旧-tui-对照复验2026-11-18)。

### REPL 差异清单复验

- PC-06。普通许可的「本会话记住」会在写入成功后生效。强制审批只展示允许一次和拒绝。伪 TTY 验证在敏感请求按 2 时继续等待，目标仍未写入。
- TC-02/03/04。虚拟窗口、未读计数、输入历史和转录搜索已通过 TUI 回归。工具接收参数、用时、状态与展开均通过现有会话的本地 fixture 验证。
- FC-01/02。目录内前缀及模糊候选并存，候选继续受已有工作区限制。CP-08 窄屏详情按显示宽度折行，保证长行内容可读。常见代码按文件语言显示语法色，原文和纯文本 diff 形态保持不变。
- 验收和剩余差异见 [SP002 与 SP003 清单](repl-alignment-gap-checklist.md)。真实终端滚动手感及颜色为 UNVERIFIED。
