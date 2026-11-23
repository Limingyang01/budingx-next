# SP009 · TUI 独立交付和 npm 发布工程 — 设计（v1）

| 项 | 值 |
| --- | --- |
| 需求 slug | `tui-delivery-and-npm-release` |
| 已确认 SP | SP009（用户 2026-11-23 `/buding-sdd 开始SP009`） |
| 版本 | v1（本轮首版，自审通过） |
| 状态 | approved（Agent 自审对象，用户已委托常规人工审阅取消） |
| 材料来源 | [requirements.md](../requirements.md)、路线图 r8/r9 SP009 行、docs/npm-release-plan.md、docs/github-actions-npm.md、参考仓机制事实 |
| 身份 | 范围与验收来自 USER_CONFIRMED；技术方案与规则细节为 MODEL_PROPOSED |

---

## 1. 背景与目标

### 1.1 问题

本仓到 0.8.0 为止已经能构建、打包并把 `budingx` 发到 npm，但「独立交付」这件事只做到一半：

1. **交付证据分散**：干净安装、命令入口、核心链路只在 `scripts/release/pack-smoke.mjs` 与 `scripts/release/publish.mjs` 内部临时跑过，没有可重复执行、可被评审的独立门禁；「安装后不需要开发依赖」「不读源码回退」等结论没有独立断言。
2. **版本一致性靠人**：产品版本号同时出现在 `src/tui/package.json`、`release-ledger.json`、`release-notes/`、`PRODUCT.md`、`src/tui/README.md`、`docs/current-status.md`。本轮开工时 `PRODUCT.md` 头部仍写着「npm 已发布版本：0.7.0（latest）」而正文已是 0.8.0——这类漂移目前只能靠人工发现。
3. **升级/卸载/回退没有证据**：`~/.budingx` 的会话、记忆、凭据在跨版本升级时的兼容性从未被自动验证；卸载语义、回退到指定旧版本的条件只在文档里一句话带过。
4. **发布失败分支没有可执行判定**：`publish.mjs` 遇到上传后回执失败会打印提示并退出 1，但缺少一条「查询这个精确版本，判定已发/未发/未知」的命令；通道规则只挡了「预发布不得 latest」，稳定版发到 `next` 无约束；认证/权限/冲突类失败没有分类，错误信息无法区分「登录过期」和「没有写权限」。

### 1.2 目标行为

| 现在 | SP009 之后 |
| --- | --- |
| 干净安装只在发布脚本内部顺带验证 | `npm run test:install` 可独立复跑，逐条断言包白名单、依赖闭包、命令入口、核心链路 |
| 版本一致性靠人工比对 | `npm run version:check` 机器核对，冲突逐条列出并非零退出 |
| 升级/卸载/回退无自动证据 | `npm run test:upgrade` 覆盖覆盖升级、旧数据 fixture、卸载保留数据、指定旧版回退 |
| 失败只打印通用错误 | 失败分类为 auth / permission / conflict / network / unknown，并给出处置建议 |
| 上传结果不确定时只能人工查 | `npm run release:resolve -- --version X.Y.Z` 判定已发/未发/不一致/未知 |
| 发行说明只检查「不是草稿」 | 发行说明必须含变更/兼容性/升级/限制/验证五小节 |

### 1.3 保留行为

- 产品运行时行为、命令面、三档权限、Provider 协议、数据结构全部不动。
- `npm run publish` 仍是唯一发布编排入口；CI 仍由维护者在 GitHub 手动触发 OIDC 发布。
- 根维护包 `private: true`；只有 `src/tui` 是可公开发布单元。
- 发布台账 `release-ledger.json` 结构不变（schemaVersion 1）。

### 1.4 明确排除

- 不做 `.msi` / brew / 独立下载站 / 自动更新器；不引入第二套安装器。
- 不新增 npm 运行时依赖；不升级测试框架。
- 不动 `src/tui` 产品代码（除非要暴露只读校验接口，见 §3.2 D-3 说明）。

---

## 2. 当前状态（真实文件）

### 2.1 已存在并复用

| 文件 | 现状 |
| --- | --- |
| `scripts/release/publish.mjs` | 已实现：参数校验 → `npm test` 门禁 → `npm pack --json` → 包文件白名单 → 凭据扫描 → tarball integrity → 隔离 prefix 安装 → `npm exec` shim 版本核对 → 本地 fixture 流式 smoke → dry-run 停止 或 上传 → `waitForRegistryVersion` → integrity/dist-tag 核对 → 官方源安装复验 → 台账更新。**编排与判定逻辑写死在同一个文件里，无法用假 runner 测试。** |
| `scripts/release/options.mjs` | `--dry-run` / `--tag` / `--auth-mode` / `--expected-version` 解析；OIDC 上下文强校验。 |
| `scripts/release/version.mjs` | `bumpVersion`、`validateRelease`（含「预发布不得 latest」）、`prepareVersion`（写版本、台账、发行说明草稿）。 |
| `scripts/release/registry.mjs` | `waitForRegistryVersion`：上传后可见性轮询，明确提示「不要再次发布」。 |
| `scripts/release/receipt.mjs` | CI 回执合并进台账（`applyReceipt`）。 |
| `scripts/release/pack-smoke.mjs` | tarball 隔离安装 + fixture 流式冒烟，独立可跑，但不校验依赖闭包、不做升级/卸载。 |
| `scripts/release/{options,receipt,registry,version,workflow}.test.mjs` | 已有单元测试；**`publish.mjs` 本身没有测试**。 |
| `.github/workflows/publish-tui.yml` | `workflow_dispatch`（version/tag/dry_run），verify 矩阵 windows+ubuntu，publish job 仅 OIDC、有 `id-token: write`、锁 master/environment `npm-publish`，两端都调用同一个 `npm run publish`。 |
| `docs/npm-release-plan.md` | SP009 归属与「必须实现的验收场景」表（本轮 AC 来源）。 |

### 2.2 确认的缺口

| 缺口 | 证据 |
| --- | --- |
| 发布编排不可测 | `scripts/release/` 下无 `publish.test.mjs`；`publish.mjs` 顶层直接执行，import 即发布 |
| 无干净安装/升级/卸载门禁 | `package.json` 脚本中无 `test:install` / `test:upgrade` |
| 无版本一致性检查 | `package.json` 脚本中无 `version:check` |
| 无上传不确定的判定命令 | 根脚本只有 `publish` / `version:prepare` / `release:sync`；`release:sync` 需要 CI 回执文件，不解决「本地刚上传完回执失败」 |
| 文档版本漂移 | `PRODUCT.md:3` 写「npm 已发布版本：0.7.0（latest）」，`PRODUCT.md:5` 已是 0.8.0 |

### 2.3 环境事实

- Node v22.22.0，npm 10.9.4；仓库根 `engines.node >= 22.18.0`。
- 本机 npm 默认缓存目录在用户配置区，当前会话不可写；**所有新脚本必须显式指定 `--cache`**（指向工作目录内的临时目录），否则 pack/install 会以 EPERM 失败。
- `os.homedir()` 在 Windows 跟随 `USERPROFILE`、在 POSIX 跟随 `HOME`，可用环境变量隔离用户数据根，无需改产品代码。

---

## 3. 方案

### 3.0 责任分层

| 层 | 职责 | 本轮新增/改动 |
| --- | --- | --- |
| 发布编排层（`scripts/release/`） | 决定「做什么、允许什么、失败了怎么办」 | `publish-core.mjs`（抽出）、`pipeline.mjs`（纯判定）、`resolve.mjs`（上传不确定判定）、`version-check.mjs`（版本一致性）、`lifecycle.mjs`（安装/升级/卸载/回退） |
| npm 调用层（`scripts/release/process.mjs`） | 执行 npm 子进程 | 复用；新增统一的 `--cache` 注入 |
| 产品层（`src/tui`） | 被安装、被升级的产品 | 不改（仅读取其 `package.json`） |
| 文档层 | 说明书、发布方案、CI 指南、发行说明 | 同步更新 |

### 3.1 D-1：可测的发布编排（`publish-core.mjs` + `pipeline.mjs`）

**问题**：`publish.mjs` 顶层即执行，阶段判定与 I/O 混在一起，无法用受控假 runner 覆盖失败分支。

**方案**：把 `publish.mjs` 拆成两层。

- `scripts/release/pipeline.mjs`：**纯函数**判定层，不碰 I/O。
  - `validateChannel({ version, tag, releaseNotes })` → 通道规则（NP-06）。规则：
    1. tag 必须匹配 `^[a-z][a-z0-9-]*$`；
    2. 预发布版本（带 `-prerelease`）**禁止** `latest`；
    3. 稳定版本用非 `latest` 通道时，发行说明必须包含 `dist-tag: <tag>` 行；
    4. 其余放行。
  - `classifyRegistryFailure(error)` → `{ kind, message, guidance }`（NP-05）。分类：
    | kind | 触发 | 处置建议 |
    | --- | --- | --- |
    | `auth` | `E401`、`ENEEDAUTH`、`EOTP`、`2FA` | 重新登录 npm 并完成 2FA 后重跑同一版本；不要改版本号 |
    | `permission` | `E403`、`EPERM`（registry 拒绝） | 账号没有该包的写权限或包名归属冲突；找账号所有者授权，不要换 registry |
    | `conflict` | `E409`、`EPUBLISHCONFLICT`、版本已存在 | 版本已占用；核对远端版本后再决定，不要重复上传 |
    | `network` | `ENOTFOUND`、`ECONNRESET`、`ETIMEDOUT`、`EAI_AGAIN`、`E502`、`E503` | 网络或 registry 暂时不可用；用 `release:resolve` 判定远端状态后再决定 |
    | `unknown` | 其它 | 保留 report 与原始错误，人工判断 |
    任何分类都**不得**改 registry、换账号或换 tag。
  - `validateReleaseNotes(text, { version, tag })` → 发行说明结构（NP-08）：必须包含 `变更`、`兼容性`、`升级`、`限制`、`验证` 五个小节标题；稳定版非 latest 通道还需 `dist-tag:` 行。
  - `decideUploadOutcome({ state, remote, integrity, tag, version })` → 上传后判定（NP-07 复用）：`published` / `not-published` / `mismatch` / `unknown`。
- `scripts/release/publish-core.mjs`：编排层，导出 `runPublish({ root, options, env, npm, now, log })`，返回 `{ report, exitCode }`。全部 npm 调用走注入的 `npm` 函数，因此测试可替换为假 runner。阶段与状态机保持与现网一致：

  ```
  checking → verified-local → (dry-run) dry-run-complete
                          → upload-started → uploaded-awaiting-receipt
                          → registry-confirmed → published-and-installed
  任一阶段失败 → report.failure = { kind, message, guidance }，exitCode = 1
  ```

- `scripts/release/publish.mjs` 瘦身为 CLI 入口：解析参数 → 调用 `runPublish` → 打印报告路径与失败处置建议 → 设置 `process.exitCode`。**外部行为保持不变**：`npm run publish -- --dry-run --expected-version X --tag latest` 仍产出 `artifacts/release/<版本>-<时间戳>/report.json`。

**状态归属**：报告文件是唯一事实源，状态字段 `state` 与 `failure.kind` 决定恢复路径；台账只在 `published-and-installed` 后更新。

**失败与恢复**：失败一律非零退出；状态处于 `upload-started` 之后时，错误信息追加「先用 `npm run release:resolve -- --version <版本>` 判定远端状态，不要盲目重发」。

**取消**：不引入新的取消路径；npm 子进程按现有 `run()` 语义结束。

### 3.2 D-2：上传结果不确定的判定命令（`resolve.mjs`）

**问题**：上传成功但回执/安装失败时，发布者需要一条「只查询、不动作」的判定命令。

**方案**：`npm run release:resolve -- --version <版本> [--integrity <sha512-…>]`。

- 纯函数 `classifyRemoteState({ error, metadata, expectedIntegrity })`：
  - 查询报 `E404`/`ETARGET` → `not-published`（可按流程发布同一版本）；
  - 查到版本且 `dist.integrity` 与 `--integrity` 一致 → `published`（只需补回执与台账）；
  - 查到版本但 integrity 不一致 → `mismatch`（停止，人工核对远端内容）；
  - 查询失败（网络/超时）→ `unknown`（只允许重试查询）。
- 命令**只读**：不调用 `npm publish`、不改 dist-tag、不 bump 版本、不写台账。
- 退出码：`published` / `not-published` = 0；`mismatch` = 1；`unknown` = 1（附「状态未知，先重试查询」）。

### 3.3 D-3：独立交付门禁（`lifecycle.mjs`）

**方案**：新增两条真实 npm 门禁，全部在**仓库外**的临时目录执行，使用 `--cache <临时目录>/npm-cache` 避免依赖用户配置区。

- `npm run test:install`（`lifecycle.mjs` 的 install 段）：
  1. `npm pack --json` 产出 tarball（记录文件名、文件清单、integrity）；
  2. 包内容白名单断言：只允许 `package.json`、`README.md`、`LICENSE`、`dist/**/*.js`（TD-01）；
  3. 隔离 prefix 安装（`--ignore-scripts --no-audit --no-fund --package-lock=false`）；
  4. 依赖闭包断言：安装树顶层只含产品 `dependencies` 及其传递依赖，**不存在** `typescript` 等 devDependency（TD-01/TD-02）；
  5. 入口断言：`node <prefix>/node_modules/budingx/dist/tui/cli.js --version` 与 `npm exec --offline --prefix <prefix> -- budingx --version` 均等于清单版本（TD-02）；
  6. 核心链路：本地 fixture HTTP Provider 下 `--prompt` 完成一次流式回合，断言请求次数为 1、回复命中，且 `USERPROFILE`/`HOME` 指向临时目录、不读取真实 `~/.budingx`（TD-03）。
- `npm run test:upgrade`（lifecycle.mjs 的 upgrade 段）：
  1. 用当前 `dist` + 旧版本号（0.8.0）构造「旧版本 tarball」（`npm pack` 于临时副本），作为回退与覆盖升级的被测对象；
  2. 覆盖升级：先装旧 tarball → 在隔离 home 写入 0.8.0 时期 fixture（`config.json`、`credentials.json`、`sessions/*.jsonl`、`memory/`）→ 再装新 tarball → 断言版本切换、仅一份 `budingx`、fixture 字节级不变、CLI 可运行（UC-01、UC-02）；
  3. 旧数据可读：用新版本 CLI 读取 fixture 的会话列表并恢复历史，断言未知字段在写回后保留（UC-02）；
  4. 卸载：`npm uninstall --prefix <prefix> budingx` → 断言包目录与 shim 消失、隔离 home 的数据目录仍在（UC-03）；
  5. 回退：再次安装旧 tarball → `--version` 输出旧版本且可运行（UC-04）。

**为什么用环境变量而不是产品开关**：验证只需要隔离数据根，`os.homedir()` 已跟随 `USERPROFILE`（Windows）/ `HOME`（POSIX）；不新增产品配置项，避免本轮引入用户可见行为变化（OPEN-02 结论）。

**失败/清理**：任一步失败即非零退出并打印失败阶段；临时目录保留在 `artifacts/release-lifecycle/<时间戳>/`（已 gitignore）便于诊断，不自动清理未知目录。

### 3.4 D-4：版本一致性检查（`version-check.mjs`）

**方案**：`npm run version:check`，纯读取检查，输出冲突清单：

1. `src/tui/package.json` 版本 = `release-ledger.json` 中同版本条目（状态须为 `prepared` 或 `published`）；
2. `release-notes/v<版本>.md` 存在且不含草稿标记；
3. `PRODUCT.md` 头部「说明书版本 / 已发布版本 / 更新日期」段落包含该版本号（源码版本与已发布版本允许不同，但两者必须都在文中出现且标注清楚）；
4. `src/tui/README.md` 声明的 npm 版本号与该版本一致；
5. `docs/current-status.md` 记录该版本；
6. `engines.node` 与 `PRODUCT.md`、`src/tui/README.md` 中的最低 Node 版本表述一致（TD-06）。

任何一条不满足 → 逐条打印冲突 → 非零退出。

**边界**：本命令只报告，不改文件；版本同步由 `buding-version-prepare` 规程执行。

### 3.5 D-5：发行说明结构与通道规则落地

- 发行说明小节标题固定为：`## 变更`、`## 兼容性`、`## 升级`、`## 已知限制`、`## 验证`（中英文均可，但必须五个都在）。
- `prepareVersion` 生成草稿时直接写出这五个小节骨架，避免发布前临时补写。
- 稳定版使用非 `latest` 通道时，发行说明需含 `dist-tag: <tag>` 行（与 `validateChannel` 同一判定）。

### 3.6 D-6：CI 与本地同源（NP-10）

- 工作流继续调用 `npm run publish`（同入口同参数）；新增断言测试：工作流里出现的参数名必须与 `parseReleaseOptions` 支持的参数集合一致，且 `tag` 只允许 `latest`/`next`。
- 不改工作流的发布语义（手动触发、dry 默认、environment 授权、action 钉版本）。

### 3.8 D-7：skill 提示词不进入可见会话（用户 2026-11-23 追加）

**问题**：`app.tsx` 触发技能时把整段技能正文拼成用户消息提交（`# Skill /name\n\n<body>`），导致技能提示词整段出现在用户会话里。

**方案**：技能正文改走**上下文块**，而不是用户文本：

- 提交文本只保留短命令回显 `/${name}`；
- 技能正文作为 `context` 块（`source = skill:<name>`，`content = 正文`）随用户消息入史；
- `normalize.ts` 对 `skill:` 来源单独渲染为 `<skill name="…">…</skill>`，与 `@` 文件上下文的 `<file_context>` 区分，模型仍完整收到正文；
- 恢复会话时 `restoredTranscriptEntries` 把上下文块渲染成「上下文 · skill:<name>」，正文同样不回显；
- 界面提示改为「技能 /name 已加载」。

**为什么不新增 Skill 工具**：参考仓以工具结果送达技能正文；本仓没有工具框架下的 skill 通道，上下文块是既有机制（`@` 引用同源），改动面最小且模型语义等价。**有意偏离**，理由与行为锚点记录在此。

**验证**：`normalizeForApi` 单测断言 `<skill>` 包装；真实 TUI 帧断言会话不出现正文标记、仍显示短命令；`/help` 列出技能名与描述。

### 3.9 D-8：/export 可选择会话（用户 2026-11-23 追加）

**问题**：`/export` 只导出当前会话，用户无法选择要导出哪个会话。

**方案**：

- 命令新增 `--session <id>`；`exportSelectedSession()` 决定数据来源：当前会话取 `session.history`，其他会话通过**只读** `sessions.read(id)`（新增宿主接口，内部只调用 `sessionStore.restore`，不切换身份、不写盘）读取历史；
- 交互模式不带 `--session` 时返回 `openExport`，宿主挂 `ExportPicker` 面板列出「当前会话 + 已保存会话」，选中即导出；
- 非交互模式不带 `--session` 明确报错，不静默导出错误对象；
- 仍复用 `exportSession` 的路径约束（必须位于 `~/.budingx` 内、不覆盖已有文件）。

**参考对照**：参考仓 `/export` 用对话框（剪贴板/文件）交互；本仓按同一交互形状提供会话选择面板，但保留本仓「导出到数据根内」的安全约束。

**验证**：`exportSelectedSession` 单测（指定会话、当前会话、读取失败）；真实 TUI 帧断言面板列出会话并能导出到隔离 home。

### 3.10 D-9：全自动档位不再被工作区边界拦截（用户 2026-11-23 报缺陷）

**问题**：`policy.ts:resolveTarget` 对工作区外路径一律返回 `floor:outside` 拒绝，与档位无关；`paths.ts:createWorkspace.resolve` 也会在解析阶段直接抛错。结果全自动档位读工作区外文件（如 `~/.budingx/mcp-wrappers/…`）仍被 `BUDINGX_PERMISSION_001` 拒绝。

**方案**：

- `createWorkspace(root, { allowOutside?: () => boolean })`：边界判定变为**动态谓词**；谓词为真时返回带 `outside: true` 的解析结果，不抛错。
- `runtime.ts` 把谓词接到当前权限模式（`policy.onModeChanged` 同步），因此 Shift+Tab 切换档位立即生效。
- `policy.ts:resolveTarget` 在 `full_access` 下不产生 `floor:outside`，改按绝对路径（含符号链接解析）继续后续判定。
- 地板规则不变：用户数据根（`floor:data`）与凭据形状文件（`floor:credential`）在所有档位拒绝；`.git` 写入仍强制确认。

**偏离说明**：SP003 原设计把「工作区边界」当作不可覆盖地板；用户 2026-11-23 明确全自动档位不应被拦截，故边界随档位放宽，安全地板保留。此为 USER_CONFIRMED 的行为变更，旧测试同步更新。

**验证**：策略测试（三档矩阵）与 Read 工具测试（真实读取工作区外文件）各 1 例。

### 3.7 状态归属与消费者一览

| 状态 | 归属 | 消费者 |
| --- | --- | --- |
| `report.json`（含 `state`、`failure.kind`） | `artifacts/release/<版本>-<时间戳>/` | 维护者、CI artifact、`release:resolve` 的人工输入 |
| `release-ledger.json` | 仓库根 | 版本准备、发布回执、台账查询 |
| `release-notes/v<版本>.md` | 仓库根 | 发行说明、结构校验、CI 回执 |
| `artifacts/release-lifecycle/<时间戳>/` | 本地忽略目录 | 安装/升级诊断证据 |

---

## 4. 变更集
### 4.1 新增（拟新增）

| 路径 | 责任 | 说明 |
| --- | --- | --- |
| `scripts/release/pipeline.mjs` | 发布编排 | 纯判定：通道规则、失败分类、发行说明结构、上传结果判定 |
| `scripts/release/publish-core.mjs` | 发布编排 | 可注入 npm runner 的发布状态机 |
| `scripts/release/resolve.mjs` | 发布编排 | 上传结果不确定的只读判定命令 |
| `scripts/release/version-check.mjs` | 发布编排 | 版本与文档一致性检查 |
| `scripts/release/lifecycle.mjs` | 分发验证 | 干净安装 / 覆盖升级 / 旧数据 / 卸载 / 回退 |
| `scripts/release/pipeline.test.mjs` | 测试 | 通道/分类/说明结构/结果判定单测 |
| `scripts/release/publish.test.mjs` | 测试 | 假 npm runner 驱动的发布序列与失败分支 |
| `scripts/release/version-check.test.mjs` | 测试 | 一致性检查（临时目录夹具） |
| `scripts/release/lifecycle.test.mjs` | 测试 | 安装/升级/卸载夹具断言（真实 npm，标记为慢测试） |

### 4.2 修改

| 路径 | 改动 |
| --- | --- |
| `scripts/release/publish.mjs` | 瘦身为 CLI 入口，逻辑迁到 `publish-core.mjs`；外部参数与产物路径不变 |
| `scripts/release/version.mjs` | `prepareVersion` 的发行说明草稿改为五小节骨架；`validateRelease` 与新的 `validateChannel` 共用通道规则 |
| `scripts/release/process.mjs` | 新增统一的 npm 调用参数注入（`--cache`、registry、`--no-audit --no-fund`） |
| `package.json` | 新增 `test:install`、`test:upgrade`、`version:check`、`release:resolve` 脚本 |
| `.gitignore` | 忽略本地 npm 缓存目录 `.npm-cache/` |
| `PRODUCT.md` | 安装/升级/卸载/回退语义、最低 Node 版本、SP009 功能与版本历史 |
| `src/tui/README.md` | 安装升级卸载说明、版本一致性、最低 Node 版本 |
| `docs/npm-release-plan.md` | SP009 交付状态与新命令 |
| `docs/github-actions-npm.md` | 新增的判定/一致性命令与通道规则 |
| `docs/current-status.md` | SP009 进度与版本说明 |
| `docs/iteration-plan.md` | SP009 行状态更新 |

### 4.3 材料来源、许可与处理决定

| 来源 | 许可 | 处理决定 |
| --- | --- | --- |
| 本仓既有 `scripts/release/*` | 自有 MIT | 内部重构，独立编写新文件，不复制外部代码 |
| 参考仓 `buding-worker-space` | **无 LICENSE 声明（视为未开源）** | 仅读取机制事实（版本同步、迁移门禁、制品门禁、dry 预览），**不复制任何源码、脚本或提示词**；实现全部独立编写 |
| npm 官方文档 | 公开 | 作为 `npm publish`/`npm install`/`dist-tag` 行为依据，见 docs/npm-release-plan.md 引用 |

---

## 5. AC 索引

AC 唯一来源见 [requirements.md §4](../requirements.md)。映射：

| AC | 设计段 | 主要实现 |
| --- | --- | --- |
| TD-01 | D-3 | lifecycle 白名单与依赖闭包断言 |
| TD-02 | D-3 | lifecycle 入口与 shim 断言 |
| TD-03 | D-3 | lifecycle fixture 核心链路 |
| TD-04 | D-4 | version-check |
| TD-05 | D-1 / D-3 | publish-core 阶段顺序 + lifecycle 复用 |
| TD-06 | D-4 | version-check 的 engines 一致性 |
| UC-01 | D-3 | lifecycle 覆盖升级 |
| UC-02 | D-3 | lifecycle 旧数据 fixture |
| UC-03 | D-3 | lifecycle 卸载 |
| UC-04 | D-3 | lifecycle 回退 |
| UC-05 | D-3 | `npm run test:upgrade` 入口 |
| NP-01 | D-1 | publish-core 状态机 |
| NP-02 | D-1 | publish-core dry-run 分支 |
| NP-03 | D-1 | publish-core 门禁失败分支 |
| NP-04 | D-1 | publish-core 版本存在检查 + `conflict` 分类 |
| NP-05 | D-1 | `classifyRegistryFailure` |
| NP-06 | D-1 | `validateChannel` |
| NP-07 | D-2 | resolve 命令 |
| NP-08 | D-1 / D-5 | `validateReleaseNotes` + 草稿骨架 |
| NP-09 | D-1 | publish.test.mjs |
| NP-10 | D-6 | workflow 参数一致性断言 |
| SD-01 | D-7 | app 提交上下文块 + normalize `<skill>` 包装 |
| SD-02 | D-7 | 上下文块记录 + 恢复视图元信息 |
| SD-03 | D-7 | 技能帮助段使用注入技能列表 |
| EX-01 | D-8 | `/export --session` + ExportPicker |
| EX-02 | D-8 | 只读 `sessions.read` + 读取失败明确报错 |
| BF-01 | D-9 | 动态边界谓词 + full_access 放行 |
| BF-02 | D-9 | 另两档保持 floor:outside |
| BF-03 | D-9 | 地板规则不变（数据根/凭据/.git） |

---

## 6. 风险与开放项

| 风险 | 影响 | 处置 |
| --- | --- | --- |
| 真实 npm 安装依赖网络与 registry 缓存 | lifecycle 门禁在本机可能因网络失败 | 门禁失败即如实记录 FAIL；发布前用同一命令在 CI 复跑；不以降级断言掩盖 |
| npm 默认缓存目录在受限环境不可写 | pack/install 报 EPERM | 所有脚本显式 `--cache <临时目录>`；已在 §2.3 记录 |
| 旧版本 tarball 由本地构造（同一 dist + 旧版本号） | 覆盖升级验证的是安装路径与数据保留，不是旧产品逻辑差异 | 如实标注；产品侧数据兼容由 UC-02 的真实旧 fixture 覆盖 |
| 真实 macOS 安装、真实 registry 回退与 dist-tag 移动 | 无法在本轮取证 | 标 UNVERIFIED，恢复条件写在交付记录 |
| `publish.mjs` 重构影响既有发布路径 | 回归风险 | 保留参数、产物路径与状态字段；`publish.test.mjs` 断言调用序列与产物结构；发布前必须跑真实 dry-run |
| 发行说明结构校验可能误伤既有版本 | 老版本说明缺小节 | 结构校验只对**待发布版本**生效（`prepared` 台账条目），历史版本不追溯 |

开放项（OPEN-01–OPEN-04）见 [requirements.md §5](../requirements.md)，本轮按 MODEL_PROPOSED 默认方案处理，不阻塞。

---

## 7. 参考仓对照点（只读机制对照，不复制代码）

| 参考仓机制事实 | 本仓对照 | 差异与理由 |
| --- | --- | --- |
| 中央版本源 `version.json` + `syncVersion()` 同步到全部发布目标 | 本仓单一发布单元，版本源是 `src/tui/package.json`，`prepareVersion` 同步台账与发行说明 | 无多目标，**不引入**版本同步层；改用 `version:check` 保证跨文档一致（比逐目标写入更适合单制品） |
| `check:persistence-upgrade` 独立迁移门禁 | 本轮新增 `npm run test:upgrade`，覆盖旧数据 fixture + 覆盖升级 | 对齐「迁移要有独立门禁」的机制；本仓持久化面只有 `~/.budingx`，故只有一组门禁而非多组 |
| `package-smoke` 制品门禁（结构 + 运行） | 本轮 `lifecycle.mjs` 的包白名单 + 入口 + 核心链路 | 对齐制品门禁思路；本仓门禁额外覆盖依赖闭包与升级路径 |
| `release --dry` 预览将要改动的文件 | 本仓 `version:prepare` 直接落盘，`publish --dry-run` 只做发布预演 | **差异**：本轮不新增 `version:prepare --dry`（超出 SP009 验收面），记录为后续可选；发布预演已有 |
| `release.ts` 自动 `git commit` + `git tag` | 本仓打标签、发布触发**必须**由用户授权，Agent 不自动执行 | 有意偏离，遵守 AGENTS.md 授权边界 |
| 多端制品（desktop/vsix/adapters）打包门禁 | 本轮只做 TUI 单端 | r8 范围外，Desktop/VSIX 已移出当前 SP |
| Skill 以工具结果送达模型、`/export` 用对话框 | 本仓用上下文块 + `<skill>` 标签；`/export` 用会话选择面板 | 本仓没有 skill 工具通道；可见性效果等价，正文仍完整送达模型；面板保留「导出到数据根内」约束 |

---

## 8. 自审结论（Agent 自审对象）

- 与路线图 SP009 出口对齐：干净安装/升级/卸载（TD/UC-01–05）、一条 `npm run publish` 完成门禁与同一 tarball 安装测试与回执（NP-01）、dry-run/next/latest/同版本/权限失败/上传不确定的判定与测试（NP-02–NP-07）。
- 与 `docs/npm-release-plan.md` 验收场景表逐条对齐，缺项已登记为 UNVERIFIED 或排除项（真实 macOS、真实 registry 回退）。
- 不改产品运行时行为，不新增 npm 依赖，不引入 Bun。
- 自审通过 → 计划沿用同版结论，不等待人工审阅；后续各阶段自主推进、门禁 GREEN 后合入 master 并推送。
