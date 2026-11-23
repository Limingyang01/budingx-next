# SP009 · TUI 独立交付和 npm 发布工程 — 实施计划（v1）

| 项 | 值 |
| --- | --- |
| 关联设计 | [design.zh.md](design.zh.md) v1（自审通过） |
| 关联需求 | [../requirements.md](../requirements.md) |
| 分支 | `feature/SP009/tui-distribution-and-npm-release`（基线 master `39b8665`） |
| 工作目录 | 仓库根 `D:\extra_project\budingx-next`（下称 `$ROOT`），测试 cwd 见各任务 |

## Goal

让 `budingx` 作为**可独立安装、可升级、可卸载、可回退**的 npm 制品交付，并把发布链路变成**一条命令 + 可判定的失败分支**：干净安装与升级卸载有可重复门禁，版本漂移被机器发现，发布失败能被分类、被判定、被恢复，且全程不产生假成功。

## Architecture

```
scripts/release/
  options.mjs        （既有）参数解析
  process.mjs        （既有，扩）npm 调用统一注入 --cache/registry
  pipeline.mjs       （新）纯判定：通道规则 / 失败分类 / 发行说明结构 / 上传结果判定
  publish-core.mjs   （新）可注入 npm runner 的发布状态机
  publish.mjs        （改）CLI 入口：解析参数 → runPublish → 打印报告与处置建议
  resolve.mjs        （新）上传结果不确定的只读判定命令
  version-check.mjs  （新）版本与文档一致性检查
  lifecycle.mjs      （新）干净安装 / 覆盖升级 / 旧数据 / 卸载 / 回退
  *.test.mjs         （新/既有）单元与功能测试
```

根脚本新增：`test:install`、`test:upgrade`、`version:check`、`release:resolve`。

## Spec（行为规格）

1. **发布状态机**（`publish-core.mjs`）：`checking → verified-local → [dry-run-complete | upload-started → uploaded-awaiting-receipt → registry-confirmed → published-and-installed]`；失败写 `report.failure = { kind, message, guidance }` 并返回 `exitCode = 1`；状态进入上传阶段后，失败信息附带「先用 `release:resolve` 判定远端状态」。
2. **通道规则**（`validateChannel`）：tag 必须 `^[a-z][a-z0-9-]*$`；预发布禁止 `latest`；稳定版用非 `latest` 通道时发行说明必须含 `dist-tag: <tag>`。
3. **失败分类**（`classifyRegistryFailure`）：`auth` / `permission` / `conflict` / `network` / `unknown`，各自给出处置建议；任何分类都不得改 registry、换账号、改 tag。
4. **发行说明结构**（`validateReleaseNotes`）：必须含 `变更`、`兼容性`、`升级`、`已知限制`、`验证` 五小节。
5. **上传结果判定**（`classifyRemoteState`）：`not-published` / `published` / `mismatch` / `unknown`；只读，绝不上传、bump 或改 dist-tag。
6. **生命周期门禁**（`lifecycle.mjs`）：包白名单 → 依赖闭包 → 入口与 shim → fixture 核心链路；覆盖升级 → 旧数据可读 → 卸载保留数据 → 指定旧版回退。
7. **版本一致性**（`version-check.mjs`）：六项检查（台账、发行说明、PRODUCT.md、README、current-status、engines 一致），冲突逐条列出并非零退出。

## Global Constraints

- ESM、2 空格、无分号；UTF-8；与既有 `scripts/release/*.mjs` 风格一致。
- 不新增 npm 运行时依赖；不引入 Bun；不升级测试框架（Node test runner）。
- 所有 npm 子进程必须显式 `--cache <工作目录临时目录>`、`--no-audit --no-fund`；不读写用户配置区缓存。
- 不读取、不写入真实 `~/.budingx`、真实密钥或真实聊天历史；验证一律用隔离 home（Windows `USERPROFILE`、POSIX `HOME`）与本地 fixture Provider。
- 不改 `src/tui` 产品运行时行为；不改发布台账结构；不改工作流发布语义。
- 行为变更先写有意义的失败用例（RED），再实现（GREEN）；基础设施报错、零测试、全部 skip 不算 RED/PASS。
- 测试产物落在 `artifacts/`（已 gitignore）；不提交依赖、日志、凭据、缓存、产物。
- 提交说明使用中文；本轮全部本地提交在功能分支完成。

## Review Focus

1. 发布失败是否可能被误报为成功（尤其权限/认证/冲突三类）。
2. dry-run 是否真的没有任何远端与 Git 副作用。
3. 上传后失败路径是否明确阻止重复上传。
4. 生命周期验证是否可能读到真实用户数据或真实密钥。
5. 通道与发行说明规则是否会误伤历史版本或阻断合法预发布。
6. 文档版本号漂移是否真的被 `version:check` 抓到（本轮已知 PRODUCT.md 头部 0.7.0/0.8.0 冲突应作为回归夹具）。

---

## 任务清单

> 每个任务给出：设计段与 AC、精确文件、Consumes/Produces、依赖、cwd 与真实命令、RED→GREEN 判据、测试收口映射。

### T1 发布判定层 `pipeline.mjs`

- **设计段**：D-1 / D-5；**AC**：NP-05、NP-06、NP-08、NP-07（判定部分）。
- **文件**：新增 `scripts/release/pipeline.mjs`；新增 `scripts/release/pipeline.test.mjs`。
- **Consumes**：`{ version, tag, releaseNotes, error, metadata, expectedIntegrity }`。
- **Produces**：`validateChannel() → { tag, prerelease }`；`classifyRegistryFailure(error) → { kind, message, guidance }`；`validateReleaseNotes(text, { version, tag }) → { sections, distTag }`；`classifyRemoteState({ error, metadata, expectedIntegrity }) → { state, detail }`。
- **依赖**：无（纯逻辑）。
- **验证命令**：cwd `$ROOT`；`node --test scripts/release/pipeline.test.mjs`。
- **RED**：先写测试断言四条规则（预发布+latest 被拒；稳定版+next 缺 `dist-tag:` 被拒；E401/E403/E409/网络错误分类正确；发行说明缺小节被拒；远端 404/一致/不一致/查询失败四种判定）。实现前运行必须失败（模块不存在）。
- **GREEN**：测试全绿且用例数与断言数记录在案。
- **完成事实**：待回填。

### T2 发布编排层 `publish-core.mjs` + `publish.mjs` 瘦身

- **设计段**：D-1；**AC**：NP-01、NP-02、NP-03、NP-04、NP-05、NP-09。
- **文件**：新增 `scripts/release/publish-core.mjs`；修改 `scripts/release/publish.mjs`（瘦身，外部行为不变）；新增 `scripts/release/publish.test.mjs`。
- **Consumes**：`runPublish({ root, options, env, npm, now, log })`；注入的 npm runner 需支持 `test` / `pack` / `install` / `exec` / `view` / `publish` / `whoami`。
- **Produces**：`{ report, exitCode }`；报告写入 `artifacts/release/<版本>-<时间戳>/report.json`，字段保持 `state`、`failure`、`integrity`、`tarball`、`files`、`smoke` 等既有语义。
- **依赖**：T1（使用 `pipeline.mjs` 判定）、T3（`process.mjs` 的 npm 注入）。
- **验证命令**：cwd `$ROOT`；`node --test scripts/release/publish.test.mjs`。
- **RED**：先写假 runner 驱动的失败用例：
  1. dry-run 断言**没有** `publish`/`view` 写类调用、无台账写入、报告 `state = dry-run-complete`；
  2. 门禁（`npm test`）失败 → `exitCode = 1` 且从未调用 `publish`；
  3. 远端已存在同版本 → 拒绝上传，报 `conflict` 类错误；
  4. `publish` 抛 E403 → 报告 `failure.kind = 'permission'`，不调用 `view` 改 tag、不重试上传；
  5. 上传后回执超时 → `state = 'uploaded-awaiting-receipt'`，错误信息含「先判定远端状态」，不重发。
- **GREEN**：以上全绿；`npm run publish -- --dry-run --expected-version <当前版本> --tag latest` 真实执行产出报告且不上传。
- **完成事实**：待回填。

### T3 npm 调用统一注入（`process.mjs`）

- **设计段**：D-3 前提、§2.3；**AC**：TD-01、UC-01–UC-04 的可执行前提。
- **文件**：修改 `scripts/release/process.mjs`。
- **Consumes**：`npm(args, { cwd, cache })`。
- **Produces**：所有 npm 调用带 `--cache <cache>`、`--no-audit --no-fund`（registry 另行显式指定）。
- **依赖**：无。
- **验证命令**：cwd `$ROOT`；`node --test scripts/release/*.test.mjs`。
- **RED/GREEN**：由 T4/T5 的真实 npm 用例覆盖（无缓存目录时会 EPERM 失败）。
- **完成事实**：待回填。

### T4 生命周期门禁 `lifecycle.mjs`（安装 + 升级 + 卸载 + 回退）

- **设计段**：D-3；**AC**：TD-01、TD-02、TD-03、UC-01、UC-02、UC-03、UC-04。
- **文件**：新增 `scripts/release/lifecycle.mjs`（导出 `runInstall()` / `runUpgrade()`，可被测试与 CLI 复用）；新增 `scripts/release/lifecycle.test.mjs`。
- **Consumes**：产品目录 `src/tui`（打包源）、本地 fixture Provider、隔离 prefix 与隔离 home。
- **Produces**：安装/升级/卸载/回退四段证据（文件清单、版本、依赖闭包、入口输出、请求次数、数据目录校验结果），输出到 `artifacts/release-lifecycle/<时间戳>/`。
- **依赖**：T3。
- **验证命令**：cwd `$ROOT`；`node --test scripts/release/lifecycle.test.mjs`（真实 npm，较慢）；单段调试 `node scripts/release/lifecycle.mjs --stage install|upgrade`。
- **RED**：先写断言（包白名单、依赖闭包无 devDependency、入口与 shim 版本一致、fixture 请求 1 次、覆盖升级后版本切换且数据字节不变、卸载后包与 shim 消失而数据仍在、回退安装旧版版本号正确）。实现前因脚本不存在而失败。
- **GREEN**：全绿；记录真实用例数与耗时。
- **完成事实**：待回填。

### T5 生命周期入口脚本（`test:install` / `test:upgrade`）

- **设计段**：D-3；**AC**：UC-05、TD-05 的前置。
- **文件**：修改 `package.json`（新增 `test:install`、`test:upgrade`）。
- **依赖**：T4。
- **验证命令**：cwd `$ROOT`；`npm run test:install`、`npm run test:upgrade`。
- **RED/GREEN**：脚本存在前执行失败（缺脚本）；补齐后两条命令均以 0 退出并打印证据摘要。
- **完成事实**：待回填。

### T6 上传结果判定命令 `resolve.mjs`

- **设计段**：D-2；**AC**：NP-07。
- **文件**：新增 `scripts/release/resolve.mjs`；测试并入 `scripts/release/pipeline.test.mjs`（纯函数）与新增 `scripts/release/resolve.test.mjs`（命令级：断言只读、退出码）。
- **Consumes**：`--version`、`--integrity`（可选）。
- **Produces**：结论 `published` / `not-published` / `mismatch` / `unknown` + 处置建议 + 退出码。
- **依赖**：T1（复用 `classifyRemoteState`）。
- **验证命令**：cwd `$ROOT`；`node --test scripts/release/resolve.test.mjs`。
- **RED**：先写「命令只调用 `npm view`，不调用 `publish`/`dist-tag`/`install`」与四种结论的退出码断言。
- **GREEN**：全绿。
- **完成事实**：待回填。

### T7 版本一致性检查 `version-check.mjs`

- **设计段**：D-4；**AC**：TD-04、TD-06。
- **文件**：新增 `scripts/release/version-check.mjs`；新增 `scripts/release/version-check.test.mjs`；修改 `package.json`（新增 `version:check`）。
- **Consumes**：仓库内六个文件（package.json、台账、发行说明、PRODUCT.md、README、current-status）。
- **Produces**：冲突清单 + 退出码；只读不改。
- **依赖**：无。
- **验证命令**：cwd `$ROOT`；`node --test scripts/release/version-check.test.mjs`；`npm run version:check`。
- **RED**：先写临时目录夹具：一致 → 通过；版本号漂移 / 缺发行说明 / 草稿发行说明 / engines 不一致 → 各自被报出。
- **GREEN**：全绿；仓库真实执行能抓到当前已知的 PRODUCT.md 0.7.0/0.8.0 漂移。
- **完成事实**：待回填。

### T8 发行说明结构校验与草稿骨架

- **设计段**：D-5；**AC**：NP-08。
- **文件**：修改 `scripts/release/version.mjs`（`prepareVersion` 写五小节骨架）；使用 T1 的 `validateReleaseNotes`。
- **依赖**：T1。
- **验证命令**：cwd `$ROOT`；`node --test scripts/release/version.test.mjs`。
- **RED**：先写断言「`prepareVersion` 生成的草稿包含五个小节标题」「缺小节的说明被拒绝」。
- **GREEN**：全绿。
- **完成事实**：待回填。

### T9 CI 同源断言

- **设计段**：D-6；**AC**：NP-10。
- **文件**：修改 `scripts/release/workflow.test.mjs`（或新增 `scripts/release/workflow-options.test.mjs`）。
- **依赖**：T1（`parseReleaseOptions` 参数集合）。
- **验证命令**：cwd `$ROOT`；`node --test scripts/release/workflow.test.mjs`。
- **RED**：先写断言「工作流使用的参数名都在 `parseReleaseOptions` 支持集合内」「工作流 tag 只允许 latest/next」「工作流与本地调用同一个 `npm run publish`」。
- **GREEN**：全绿。
- **完成事实**：待回填。

### T10 文档同步

- **设计段**：§4.2；**AC**：TD-04、TD-06、UC-03、UC-04（对外语义）。
- **文件**：修改 `PRODUCT.md`（§3 安装/升级/卸载/回退、最低 Node、§2.2 SP009 状态、§8 版本历史）、`src/tui/README.md`、`docs/npm-release-plan.md`、`docs/github-actions-npm.md`、`docs/current-status.md`、`docs/iteration-plan.md`、`.gitignore`。
- **依赖**：T4–T8 的实际命令名。
- **验证命令**：cwd `$ROOT`；`npm run version:check`；`npm run skills:check`；`npm run spec:check`。
- **RED/GREEN**：文档漂移由 `version:check` 暴露（先记录冲突，修文档后转绿）。
- **完成事实**：待回填。

### T11 测试收口

- **设计段**：§测试收口；**AC**：全部 22 条。
- **文件**：新增/修改各 `*.test.mjs`。
- **要求**：每条 AC 至少 1 个单元用例 + 1 个功能用例；一次即绿的用例要核对确实能捕获该行为；真实 npm 与真实进程证据与 fixture 证据分开记录。
- **验证命令**：cwd `$ROOT`；`npm test`（全量）；`node --test scripts/release/*.test.mjs`（发布子集）。
- **完成事实**：待回填（实际用例数、通过数、失败数、跳过数）。

### T13 skill 提示词不进入可见会话（用户 2026-11-23 追加）

- **设计段**：D-7；**AC**：SD-01、SD-02、SD-03。
- **文件**：`src/core/normalize.ts`（`skill:` 上下文渲染为 `<skill>`）、`src/tui/app.tsx`（提交上下文块 + 短命令回显 + 提示文案）、`src/tui/commands/types.ts`（`skills` 注入点）、`src/tui/commands.ts`（技能解析与帮助段使用注入列表）；测试 `src/tui/test/sp009-skills-display.test.mjs`。
- **Consumes**：`skillPrompt { name, body }`；**Produces**：用户消息 = 短文本 + `context{source:'skill:<name>'}`；请求侧 `<skill name="…">` 包装。
- **验证命令**：cwd `$ROOT`；`npm run build && node --test src/tui/test/sp009-skills-display.test.mjs`。
- **RED/GREEN**：先写用例断言请求含 `<skill>` 包装、真实 TUI 帧含短命令而不含正文标记；实现后全绿（3/3）。
- **完成事实**：待回填。

### T14 /export 选择会话（用户 2026-11-23 追加）

- **设计段**：D-8；**AC**：EX-01、EX-02。
- **文件**：`src/tui/commands/builtin-extended.ts`（`--session` 解析、`exportSelectedSession`、`openExport`）、`src/tui/commands/types.ts`（`openExport`、`sessions.read`）、`src/tui/runtime.ts`（只读 `read` 接线）、`src/tui/panels.tsx`（`ExportPicker`）、`src/tui/app.tsx`（面板挂载与互斥）；测试 `src/tui/test/sp009-export.test.mjs`。
- **验证命令**：cwd `$ROOT`；`npm run build && node --test src/tui/test/sp009-export.test.mjs`。
- **RED/GREEN**：先写「导出指定会话读的是该会话历史」「读取失败不写空文件」「TUI 面板可选择并导出」；实现后全绿（4/4）。
- **完成事实**：待回填。

### T15 交付与集成

- **设计段**：§3、§6；**AC**：全部。
- **文件**：`SP/SP009/test-report.md`、本 STATUS、`SP/SP009/requirements-summary.md`、`PRODUCT.md`（最终状态）。
- **验证命令**：cwd `$ROOT`；`npm run merge:gate`（必须 GREEN）；随后按 buding-merge 规程合入 master 并推送，记录远端 SHA。
- **完成事实**：待回填。

---

## 计划汇总：AC → 任务 → 用例

| AC | 任务 | 用例层 | 预期 RED 表现 | GREEN 判据 |
| --- | --- | --- | --- | --- |
| TD-01 | T4 | 功能 | 脚本不存在 | 包白名单与依赖闭包断言通过 |
| TD-02 | T4 | 功能 | 脚本不存在 | 入口与 shim 版本一致、无 devDependency |
| TD-03 | T4 | 功能 | 脚本不存在 | fixture 回合请求 1 次且命中 |
| TD-04 | T7 | 单元 | 模块不存在 | 一致→0；四类冲突→非零并列出 |
| TD-05 | T2 + T5 | 功能/受控 | 无发布序列断言 | dry-run 含安装验证阶段且失败即中止 |
| TD-06 | T7 | 单元 | 模块不存在 | engines 不一致被报出 |
| UC-01 | T4 | 功能 | 脚本不存在 | 覆盖升级后版本切换、数据字节不变 |
| UC-02 | T4 | 功能/单元 | 脚本不存在 | 旧 fixture 可读、未知字段保留 |
| UC-03 | T4 | 功能 | 脚本不存在 | 卸载后包/shim 消失、数据保留 |
| UC-04 | T4 | 功能 | 脚本不存在 | 旧版 tarball 可装可运行 |
| UC-05 | T5 | 功能 | 缺脚本 | `npm run test:upgrade` 退出 0 |
| NP-01 | T2 | 受控 | 无状态机断言 | 调用序列固定且上传同一 tarball |
| NP-02 | T2 | 受控 | 无断言 | dry-run 无写类调用、台账不变 |
| NP-03 | T2 | 受控 | 无断言 | 门禁失败非零且未 publish |
| NP-04 | T2 | 受控 | 无断言 | 同版本拒绝上传并分类为 conflict |
| NP-05 | T1 + T2 | 单元/受控 | 模块不存在 | 五类错误分类正确、建议明确 |
| NP-06 | T1 | 单元 | 模块不存在 | 三条通道规则生效 |
| NP-07 | T1 + T6 | 单元/受控 | 模块不存在 | 四种结论与退出码正确、命令只读 |
| NP-08 | T1 + T8 | 单元 | 模块不存在 | 缺小节被拒、草稿含五小节 |
| NP-09 | T2 | 受控 | 无测试文件 | 假 runner 覆盖五类分支 |
| NP-10 | T9 | 单元 | 无断言 | 工作流参数在支持集合内 |
| SD-01 | T13 | 单元+功能 | 正文出现在会话帧里 | 请求含 `<skill>`、会话帧不含正文 |
| SD-02 | T13 | 单元 | 无恢复断言 | 恢复视图只显示上下文元信息 |
| SD-03 | T13 | 功能 | /help 未列出注入技能 | /help 列出技能名与描述 |
| EX-01 | T14 | 单元+功能 | 只导出当前会话 | 指定会话导出所选历史；面板可选 |
| EX-02 | T14 | 单元 | 失败时仍写空文件 | 读取失败返回明确错误且不落盘 |

---

## 执行顺序

T1 → T2/T3 → T4 → T5 → T6/T7/T8/T9 → T10 → T11 → T12。
每完成一个任务即在本计划「完成事实」与 STATUS 回填，并按 AGENTS.md 在功能分支做中文本地提交。
