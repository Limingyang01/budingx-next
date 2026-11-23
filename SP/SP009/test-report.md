# SP009 验收报告 — TUI 独立交付和 npm 发布工程

| 项 | 值 |
| --- | --- |
| 迭代 | SP009 |
| 分支 | `feature/SP009/tui-distribution-and-npm-release`（基线 master `39b8665`） |
| 需求 | [tui-delivery-and-npm-release](tui-delivery-and-npm-release/requirements.md)（TD-01–06、UC-01–05、NP-01–10、SD-01–03、EX-01–02，共 27 条） |
| 设计 / 计划 | [design.zh.md](tui-delivery-and-npm-release/design/design.zh.md) v1 · [plan.zh.md](tui-delivery-and-npm-release/design/plan.zh.md) v1 |
| 环境 | Windows（Node v22.22.0、npm 10.9.4）；CI 另在 ubuntu-24.04 + Node 24 跑发布预演 |
| 记录日期 | 2026-11-23 |

## 1. 证据分层

| 层 | 含义 | 本节证据 |
| --- | --- | --- |
| U 单元 | 纯逻辑/文件检查，无外部进程 | `scripts/release/*.test.mjs`、`sp009-*-test` 中非 TTY 用例 |
| F 功能 | 真实 npm 子进程 / 真实 Ink TUI 帧 | `npm run test:install`、`npm run test:upgrade`、`mountTty` 用例 |
| R 受控发布 | 注入假 npm runner 的发布状态机 | `scripts/release/publish.test.mjs` |
| 未执行 | 无证据或环境不具备 | 见 §6 |

## 2. AC → 任务 → 文件 → 用例 → 结果

### 2.1 tui-distribution

| AC | 实现 | 用例（文件:行） | 命令 / cwd | 结果 |
| --- | --- | --- | --- | --- |
| TD-01 包白名单/无私有依赖 | `scripts/release/tarball.mjs:assertPackedFiles` | `lifecycle.mjs` install 段断言包内只有 `package.json/README.md/LICENSE/dist/**/*.js` | `npm run test:install`（`$ROOT`） | PASS（真实 npm pack，96 个文件，白名单通过） |
| TD-02 无 devDependency、入口一致 | `lifecycle.mjs` 依赖闭包 + shim | install 段断言 `typescript/@types/node/yaml` 不在安装树、`node cli.js --version` 与 `npm exec shim` 均等于清单版本 | 同上 | PASS |
| TD-03 干净安装核心链路 | `smoke.mjs:smokeInstalled`（新增隔离 home 参数） | install 段：fixture Provider 一次流式回合、请求计数 1、`USERPROFILE` 指向临时 home | 同上 | PASS |
| TD-04 版本一致性 | `scripts/release/version-check.mjs` | `version-check.test.mjs`（9 例：一致、台账缺失、说明缺失、草稿、说明书缺版本、已发布版本漂移、README、状态文档、engines） | `node --test scripts/release/version-check.test.mjs` | PASS 9/9；真实仓库执行抓到 `PRODUCT.md` 0.7.0/0.8.0 漂移并修复 |
| TD-05 dry-run 先安装再上传 | `publish-core.mjs` 阶段顺序 | `publish.test.mjs` dry-run 用例断言 `test→pack→install→exec` 均执行且无 `publish/whoami` | `node --test scripts/release/publish.test.mjs` | PASS |
| TD-06 engines 一致 | `version-check.mjs` `node-engine` | 同上 | 同上 | PASS |

### 2.2 upgrade-compatibility

| AC | 实现 | 用例 | 命令 / cwd | 结果 |
| --- | --- | --- | --- | --- |
| UC-01 覆盖升级保留数据 | `lifecycle.mjs:runUpgrade` | 旧版本 tarball → 隔离 home 写入旧格式数据 → 安装新 tarball：版本切换、单份 `budingx`、数据目录字节级不变 | `npm run test:upgrade`（`$ROOT`） | PASS |
| UC-02 旧数据 fixture 兼容 | 同上 + 安装包内 `dist/storage/*` | 用**安装后的产品代码**读取旧 fixture：会话列出、恢复状态 `restored`、1 条消息、v0 配置迁移出 `legacy` 模型、未知字段 `legacyFlag` 保留 | 同上 | PASS |
| UC-03 卸载保留数据 | 同上 | `npm uninstall` 后包目录与 bin 消失、数据目录（含迁移后的 `.bak`）不变 | 同上 | PASS |
| UC-04 指定旧版回退 | 同上 | 重新安装旧 tarball → `--version` 为旧版本 | 同上 | PASS |
| UC-05 一条命令门禁 | `package.json` `test:upgrade` | 上述四段在同一脚本内顺序执行，任一失败非零退出 | 同上 | PASS |

> 说明：升级门禁的「旧版本」取最近一个不同于源码版本的已发布版本。0.9.0 发布后在台账 published 状态下复跑一次，结果为 **0.8.0 → 0.9.0**，并再次验证回退到 0.8.0 可运行（证据 `artifacts/release-lifecycle/2026-11-23T02-50-14-049Z/evidence.json`）。

### 2.3 npm-publish-pipeline

| AC | 实现 | 用例 | 命令 / cwd | 结果 |
| --- | --- | --- | --- | --- |
| NP-01 一条命令的状态序列 | `publish-core.mjs` | `publish.test.mjs` 「完整发布」用例：状态 `published-and-installed`、台账置 published、integrity 记录 | `node --test scripts/release/publish.test.mjs` | PASS |
| NP-02 dry-run 无副作用 | 同上 | dry-run 用例：无 `publish`/`whoami`、台账保持 prepared、状态 `dry-run-complete` | 同上 | PASS |
| NP-03 门禁失败不上传 | 同上 | 门禁用例：`failure.kind='gate'`、无 publish 调用 | 同上 | PASS |
| NP-04 同版本拒绝 | 同上 | 远端已存在用例：`failure.kind='conflict'`、无 publish | 同上 | PASS |
| NP-05 失败分类 | `pipeline.mjs:classifyRegistryFailure` | `pipeline.test.mjs` 5 例 + `publish.test.mjs` E403 用例（`permission`，只上传 1 次） | `node --test scripts/release/pipeline.test.mjs` | PASS |
| NP-06 通道规则 | `pipeline.mjs:validateChannel` | `pipeline.test.mjs`：稳定版 latest、预发布禁止 latest、预发布 next、稳定版 next 需 `dist-tag:`、非法通道名 | 同上 | PASS |
| NP-07 上传不确定判定 | `scripts/release/resolve.mjs` | `resolve.test.mjs` 5 例：只调用 `view`、published/not-published/mismatch/unknown 与退出码、缺参数 | `node --test scripts/release/resolve.test.mjs` | PASS |
| NP-08 发行说明结构 | `pipeline.mjs:validateReleaseNotes` + `version.mjs` 草稿骨架 | `pipeline.test.mjs` 4 例 + `version.test.mjs` 草稿五小节用例 + `publish.test.mjs` 缺小节阻断用例 | 见上 | PASS |
| NP-09 发布流水线测试 | `scripts/release/publish.test.mjs` | 8 例覆盖 NP-02–NP-06 | `node --test scripts/release/publish.test.mjs` | PASS 8/8 |
| NP-10 CI 同源 | `.github/workflows/publish-tui.yml` | `workflow.test.mjs` 新增 2 例：参数名在支持集合内、tag 只允许 latest/next、发布 job 仅 OIDC 且非 dry-run | `node --test scripts/release/workflow.test.mjs` | PASS 4/4 |

### 2.4 skill-display（用户 2026-11-23 追加）

| AC | 实现 | 用例 | 结果 |
| --- | --- | --- | --- |
| SD-01 技能正文不进可见会话 | `app.tsx` 提交短文本 + `context{source:'skill:<name>'}`；`core/normalize.ts` 渲染 `<skill name>` | `sp009-skills-display.test.mjs`：normalize 断言 `<skill name="demo">` 且无 `<file_context>`；真实 TUI 帧断言 `/demo` 出现、`SKILL_BODY_MARKER_XYZ` 不出现 | PASS 3/3 |
| SD-02 恢复视图不回显 | 上下文块 + `restoredTranscriptEntries` 既有上下文渲染 | 同上（恢复路径由上下文块机制覆盖，见 §6 备注） | PASS（机制覆盖） |
| SD-03 帮助面仍列出技能 | `commands.ts:skillHelpSection` 使用注入技能列表 | 同一文件的 `/help` 用例：帧中出现 `/demo` 且不含正文标记 | PASS |

### 2.5 export-selection（用户 2026-11-23 追加）

| AC | 实现 | 用例 | 结果 |
| --- | --- | --- | --- |
| EX-01 选择会话导出 | `builtin-extended.ts:exportSelectedSession` + `--session`；交互模式 `openExport` → `ExportPicker` | `sp009-export.test.mjs`：指定会话导出所选历史（不含当前会话内容）、当前会话仍可导出、TUI 面板选择后导出 | PASS 4/4 |
| EX-02 读取失败不写空文件 | `sessions.read` 只读接口 + 明确错误 | 同上第 3 例 | PASS |

### 2.6 permission-boundary（用户 2026-11-23 报缺陷）

| AC | 实现 | 用例 | 结果 |
| --- | --- | --- | --- |
| BF-01 全自动可读工作区外 | `workspace/paths.ts` 动态 `allowOutside` + `policy.ts` full_access 放行 | `policy.test.mjs`「完全权限放行、另两档拒绝」+ `read.test.mjs`「全自动档位读取工作区外文件」 | PASS（真实文件读取） |
| BF-02 另两档仍拒绝 | 策略保持 `floor:outside` | `policy.test.mjs` 同上 | PASS |
| BF-03 地板不变 | 数据根/凭据/`.git` 规则未改 | 既有 `floor:data`、`floor:credential`、mandatory 用例保持通过 | PASS |
| BF-04 同类工具排查 | 全仓仅 `workspace/paths.ts` 与 `policy.ts` 两处边界判定（`git/worktree.ts` 属独立策略） | `sp009-full-access.test.mjs` 4/4：Read/Write/Edit/Glob/Grep 全部可访问工作区外、受限档位仍拒绝、地板不变、档位切换即时生效 | PASS |

## 3. 真实执行记录

| 命令 | cwd | 实际结果 |
| --- | --- | --- |
| `npm run test:install` | `$ROOT` | PASS；tarball 白名单/依赖闭包/命令入口/fixture 回合全部通过，证据 `artifacts/release-lifecycle/<ts>/evidence.json` |
| `npm run test:upgrade` | `$ROOT` | PASS；覆盖升级、旧数据迁移、卸载保留、回退全部通过 |
| `node --test scripts/release/*.test.mjs` | `$ROOT` | 见 §4 汇总 |
| `node --test src/tui/test/sp009-skills-display.test.mjs` | `$ROOT` | 3/3 PASS |
| `node --test src/tui/test/sp009-export.test.mjs` | `$ROOT` | 4/4 PASS |
| `npm run version:check` | `$ROOT` | 修复前 FAIL（`published-version`：说明书 0.7.0 ≠ 台账 0.8.0）；修复后 PASS |

## 4. 汇总

| 指标 | 结果 |
| --- | --- |
| 发布工具测试（`scripts/release/*.test.mjs`） | 56/56 通过（pipeline 19、publish 8、resolve 5、version-check 9、lifecycle 3、version 6、options/receipt/registry/workflow 其余） |
| 全量单元测试（`npm run test:unit`） | 1250 项 / 1249 通过 / 0 失败 / 1 跳过（既有的 POSIX 专属权限用例） |
| SP009 定向 TUI 用例 | skills 显示 3/3、export 选择 4/4 通过 |
| 权限边界回归 | `policy.test.mjs` 11/11、`read.test.mjs` 11/11、`sp009-full-access.test.mjs` 4/4 通过（含全自动读写工作区外与地板保持） |
| 生命周期门禁 | install PASS、upgrade PASS |
| 版本一致性 | PASS（修复说明书漂移后） |

## 5. 交付回填

| 动作 | 结果 | SHA / 证据 |
| --- | --- | --- |
| 交叉验证门禁（功能分支） | GATE GREEN | `2026-11-23T02:02:15Z`，2 commits / 42 files，禁带路径违规 0 |
| 合入 master | 已执行 | `10704ab`（--no-ff） |
| 缺陷修复门禁 | GATE GREEN | `2026-11-23T02:13:49Z`，含 `version:check` 与 `test:upgrade` |
| 缺陷修复合入 | 已执行 | `2a918b3`（--no-ff，21 files） |
| 推送远端 | 已执行 | `origin/master` = `2a918b3`，`ls-remote` 与本地一致 |
| 发布 dry-run（0.9.0） | PASS | `artifacts/release/0.9.0-1795400498179/report.json`：`dry-run-complete`、183 文件、integrity `sha512-7gL4…`、安装 smoke fixture 1 次请求 |
| 实际 npm 发布 | **已发布** | 维护者触发运行 #45100998785（源码 `aecd8b7`），npm `latest` = 0.9.0，publishedAt=2026-11-23T02:43:37.613Z |
| 发布后核验 | PASS | registry integrity、Trusted Publisher、attestation subject digest、dist-tag、隔离安装与入口、流式 smoke |

## 6. 未验证项与恢复条件

| 项 | 状态 | 恢复条件 |
| --- | --- | --- |
| macOS 安装/升级/卸载 | UNVERIFIED | 在 macOS + 声明 Node 版本执行 `npm run test:install` 与 `npm run test:upgrade` |
| Linux 的覆盖升级/卸载/回退 | UNVERIFIED | 在 Ubuntu 执行 `npm run test:upgrade`；CI `verify` 现只覆盖打包与安装 smoke |
| 真实 registry 回退安装与 dist-tag 移动 | UNVERIFIED | 获得发布授权后，用 `npm install -g budingx@<旧版本>` 与 dist-tag 查询核对 |
| 覆盖升级用「当前源码 + 旧版本号」构造旧包 | 有限证据 | 需重新构建历史版本时按 tag 源码打包复验 |
| 会话恢复视图对技能条目的实机渲染 | 机制覆盖 | 由 `restoredTranscriptEntries` 的上下文分支覆盖；如需像素级证据补 TTY 用例 |
| CI 回执 artifact | UNVERIFIED | 需登录 GitHub 下载 `tui-publication-receipt`；台账依据公开运行、provenance、registry integrity 与独立安装登记并标注缺口 |
| 真实外部模型 live 回合 | UNVERIFIED | 发布包的核心链路验证使用本地 fixture Provider；需真实端点凭据后补证 |

## 7. 0.9.1 补丁迭代验证（SP009 追加：技能创作 / 主循环与上下文 / 子代理保真）

来源：用户 2026-11-23 截图与指令（32 回合硬停、子代理预算中断与通知原样展示、上下文固定、技能创建/级别/刷新），要求「完全参考修复」「压缩手段也对齐」「必须端到端验证后才算完成」。分支 `feature/SP009/fix-0.9.1`（基线 master `0af9249`）。

| 检查 | 结果 |
| --- | --- |
| 主循环去固定上限（LF-01） | `sp009-loop-context` LF-01（40 次工具迭代完成）；E2E 真实无头子进程 40 迭代不再硬停 |
| 无头 `--max-turns`（LF-02） | E2E `--max-turns 2` → `error_max_turns`、非法值退出码 2 |
| 子代理默认无预算（LF-03/SF） | `agent-runtime.test` 新用例：未显式 `tokenLimit` 不再中断；显式 `tokenLimit:50` 仍生效 |
| 子代理通知系统化（SF-01…05） | `sp009-agent-notify` N-01/N-02：meta 系统行、无原始 XML、模型上下文仍含 XML |
| 窗口动态解析（LC-01…03） | `context-window` 优先级用例；`discoverModelMetadata` 解析 `context_length`；`/models` 面板自定义字段 |
| 默认启用自动压缩（LC-04） | runtime `contextBudgetLive` getter；E2E 小窗口多回合触发 |
| 阈值对齐 + 小窗口兜底（LC-05） | CB-05/LC-05；**端到端暴露并修复**「极小窗口触发点低于压缩目标导致无法裁剪」，触发点现恒高于压缩目标 |
| 压缩改模型摘要（LC-06） | `context-budget.e2e`（真实 HTTP + Session，2 请求含摘要）；E2E 多回合摘要请求 ≥1 且回合完成 |
| 技能多级别/创建/刷新（SA-01…08） | `sp009-skill-authoring` 7/7（含帧级：新建技能后 `/reload-skills` 补全立即出现，无需重启、不轮询） |
| 全量单元测试（`npm test`） | 1273 项 / 1272 通过 / 0 失败 / 1 跳过（既有 POSIX 专属用例） |
| 独立来源 AST 复核 | `sp004-ast.mjs` 结论 PASS（唯一命中为 Ink 列表布局样板，31/3824 节点，已处置） |
| 版本一致性（0.9.1 prepared） | `version:check` PASS；npm `latest` 仍 0.9.0 |
| 发布 dry-run（0.9.1） | PASS（`dry-run-complete`，未发布） |
| 交叉验证门禁 | GATE GREEN（npm test / spec / skills / version / pack-smoke / test:upgrade） |

端到端方法：真实无头子进程 + 本地 OpenAI 兼容 SSE fixture（`sp009-e2e.test.mjs`，4/4）；真实 Ink 帧级（mountTty）验证技能刷新。模型摘要压缩已接 Langfuse `context.compact` generation 观测；真实外部模型 live 回合仍 UNVERIFIED（见 §6，需真实端点凭据）。

### 7.1 交付回填（0.9.1）

| 动作 | 结果 | SHA / 证据 |
| --- | --- | --- |
| 交叉验证门禁（功能分支，两次） | GATE GREEN | `2026-11-23T08-19-32Z`、`2026-11-23T08-28-13Z`（npm test/spec/skills/version/pack-smoke/test:upgrade 全 ok） |
| merge-tree 预演 | 退出码 0，无冲突 | master `0af9249` × 源 `4abdc7c` |
| 合入 master | 已执行（--no-ff） | 合并提交 `ab65450`，源 `4abdc7c` 为祖先 |
| 推送远端 | 已执行 | `origin/master` = `ab65450`，`ls-remote` 与本地一致 |
| 版本准备（0.9.1） | prepared | 台账 `prepared`、发行说明五小节、版本文档同步、`version:check` PASS |
| 发布 dry-run（0.9.1） | PASS | `artifacts/release/0.9.1-1795420727943/report.json`，`dry-run-complete`，未发布 |
| 实际 npm 发布 | 待维护者触发 | GitHub Actions 手动：version=0.9.1、tag=latest、dry_run 不勾选 |

### 7.2 0.9.1 发布门禁回归自审

[Actions #31](https://github.com/Limingyang01/budingx-next/actions/runs/45143954524) 的 Windows 和 Ubuntu 验证均在 `sp0054-enter-command.test.mjs` 超时。最后一帧已显示帮助末尾的技能列表，旧断言等待的顶部标题超出可见区域。

- **回车执行契约 PASS（L1）**：`sp0054-enter-command.test.mjs` 在 Windows、`CI=true` 下定向运行 1/1 通过。90×30 伪 TTY 注入一条固定技能，按回车后核对该技能的帮助行，并检查没有「未知命令」。同一用例跳过回车的负向验证在帮助断言处超时。
- **范围自审**：仅调整该帧级测试和本验收记录，无产品行为、依赖、存储、版本或发布流程变更。产品说明书无需更新。
- **发布复核**：本机交叉验证门禁和 0.9.1 dry-run 的结果以本次生成的报告为准。新提交的 GitHub-hosted 双平台验证与正式发布待维护者重新触发工作流后取证。
