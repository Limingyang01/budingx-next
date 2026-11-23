# SP009 · TUI 独立交付和 npm 发布工程 — 需求

状态：正式 SDD（设计自审对象）。SP 编号 SP009 已由用户 2026-11-23 指令 `/buding-sdd 开始SP009` 确认开轮。
需求 slug：`tui-delivery-and-npm-release`。对应路线图功能目录：`tui-distribution`、`upgrade-compatibility`、`npm-publish-pipeline`。

## 1. 原始材料与用户指令

| 来源 | 内容 |
| --- | --- |
| USER_CONFIRMED（用户 2026-11-23，`/buding-sdd 开始SP009`） | 按正式 SDD 开发 SP009 全部内容；沿用 AGENTS.md「审查与集成委托」（Agent 自审、feature 分支、各阶段中文本地提交、交叉验证门禁 GREEN 后自主合入 master 并自主推送、发布前准备在委托内；打标签、npm 发布触发、远端设置、分支删除不在委托内）。 |
| USER_CONFIRMED（AGENTS.md 长期委托，2026-11-17） | 产品版本以 `src/tui/package.json` 为准；新 SP 完成交付至少 minor 更新；发布台账必须有真实回执；实际 npm 发布由用户在 GitHub 手动触发。 |
| USER_CONFIRMED（路线图 r8/r9，docs/iteration-plan.md:76） | SP009 = TUI 独立交付和 npm 发布工程；依赖 SP008 与 SP006–SP007 的 npm 制品/校验基础。 |
| USER_CONFIRMED（docs/npm-release-plan.md:32） | SP009 交付：一键发布入口、账号/registry/版本/权限检查、候选与稳定通道、同一 tarball 发布、回执/失败恢复、安装升级卸载和发布说明。 |
| MODEL_PROPOSED（docs/npm-release-plan.md:56–66 验收场景表） | 单条命令稳定发布、dry-run/门禁失败、tarball 与运行依赖、生产安装、版本与通道、身份与政策、上传结果不确定、升级回退卸载、npm 原生命令与钩子——本轮以这些场景作为 AC 来源。 |
| 参考仓事实（只读，`buding-worker-space`，机制参考） | 中央版本源 + 目标版本同步、`persistence-upgrade` 迁移门禁、`package-smoke` 制品门禁、`release --dry` 预览。 |

## 2. 目标

1. **独立交付**：TUI 作为一个可独立安装、可升级、可卸载的 npm 制品交付，用户按说明书一条命令装上就能用，不需要源码、仓库或开发依赖。
2. **升级兼容**：从已发布版本升级到新版本时，用户数据（`~/.budingx`）不丢失、旧数据可读、命令入口稳定；卸载默认保留数据；回退到指定旧版本可行且兼容条件明确。
3. **发布工程**：一条 `npm run publish` 完成「门禁 → 同一 tarball 安装测试 → 上传 → 回执」；dry-run 无副作用；同版本、权限失败、上传结果不确定三类失败都有明确判定与可执行恢复路径，不会产生假成功。

## 3. 边界

- 不做 Desktop / VS Code / 远程 H5 / IM；不引入第二套安装器（.msi / brew / 独立下载站）。
- 不改变产品运行时行为、命令面、权限三档、Provider 协议与数据结构；本轮只动发布与交付工具链、文档与验证证据。
- 不改变「实际 npm 发布由用户在 GitHub 手动触发」的分工；本轮交付发布前准备与交接参数。
- 不引入 Bun、不更换测试框架、不新增运行时依赖。
- 不复用参考仓源码；仅对照其发布/迁移/制品门禁的机制事实，独立实现。

## 4. 稳定验收条件（AC）

> 编号仅标记验收条件。测试层级：U=单元（纯逻辑/文件检查），F=功能（真实 npm 子进程 / 真实安装与进程运行），R=发布链路（受控假 npm runner，不触网）。

### 4.1 tui-distribution（独立交付）

- **TD-01（F）**：在仓库外的隔离 prefix 安装当前 tarball 后，包内只含白名单文件（`package.json`、`README.md`、`LICENSE`、`dist/**/*.js`），无源码目录、无凭据、无 `file:`/`workspace:` 私有依赖。
- **TD-02（F）**：安装后不需要开发依赖与本地编译：安装树内不存在 `typescript` 等 devDependency；`node <prefix>/node_modules/budingx/dist/tui/cli.js --version` 与 `npm exec` shim 均输出与包清单一致的版本号。
- **TD-03（F）**：干净安装后可完成一次核心链路：本地 fixture Provider 下 `--prompt` 发出 1 次请求并收到流式回复，且不读取真实密钥、不触碰真实 `~/.budingx`。
- **TD-04（U+F）**：新增 `npm run version:check`，校验 `src/tui/package.json`、`release-ledger.json`、`release-notes/v<版本>.md`、`PRODUCT.md`、`src/tui/README.md`、`docs/current-status.md` 的版本一致性与发行说明非草稿；不一致时非零退出并逐条列出冲突项。
- **TD-05（R+F）**：发布流水线的 dry-run 必须完成「同一 tarball 隔离安装 + 命令入口 + 核心链路」验证后才允许进入上传阶段；安装验证失败即中止，不上传。
- **TD-06（U）**：`src/tui/package.json` 的 `engines.node` 与 `PRODUCT.md`、`src/tui/README.md` 声明的最低 Node 版本一致；未在 macOS 实测安装则不宣称支持 macOS。

### 4.2 upgrade-compatibility（升级兼容）

- **UC-01（F）**：覆盖升级——同一 prefix 先装旧版本 tarball、再装新版本 tarball：版本切换正确、CLI 可运行、`node_modules` 只保留一份 `budingx`、用户数据目录内容字节级不变。
- **UC-02（F+U）**：旧数据 fixture 兼容——0.8.0 时期的 `~/.budingx` fixture（`config.json`、`credentials.json`、`sessions/*.jsonl`、`memory/`）在新版本下可读：会话可列出与恢复、config 未知字段在写回后仍保留。
- **UC-03（F）**：卸载后包目录与命令 shim 消失，用户数据默认保留；该语义写进产品说明书。
- **UC-04（F）**：可安装指定旧版本（回退）：本地构造的旧版本 tarball 安装后 `--version` 输出版本号且可运行；兼容条件（Node ≥ 22.18、数据向前兼容）在文档中明确。
- **UC-05（F）**：新增 `npm run test:upgrade` 一条命令跑完 UC-01–UC-04，任一失败非零退出。

### 4.3 npm-publish-pipeline（发布工程）

- **NP-01（R）**：`npm run publish`（非 dry-run）的执行序列固定为：校验 → 门禁 → 打包 → 白名单/秘密扫描 → 同一 tarball 隔离安装与核心链路 → 上传 → 回执核对 → 官方源安装复验 → 台账更新；上传的 tarball 就是被验证的那一个。
- **NP-02（R）**：dry-run 无副作用：不调用 registry 写操作、不改 dist-tag、不写台账、不做 Git 操作；报告写入 `artifacts/release/<版本>-<时间戳>/report.json`。
- **NP-03（R）**：任一门禁失败即非零退出，且不触发任何上传动作。
- **NP-04（R）**：同版本已存在时拒绝再次上传，不自动 bump、不覆盖、不改 dist-tag。
- **NP-05（R）**：认证/权限/冲突类失败被分类（登录失效、无写权限、命名冲突、网络未知），输出可执行处置建议；不降级到其他账号或 registry，不产生假成功。
- **NP-06（R）**：通道规则：预发布版本禁止 `latest`；稳定版默认 `latest`，显式使用其他通道时必须在发行说明中声明 `dist-tag: <tag>`，否则门禁失败；非法通道名非零退出。
- **NP-07（R）**：新增 `npm run release:resolve -- --version <版本>`：查询 registry 判定「未发布 / 已发布 / 远端内容与本地不一致 / 状态未知」，给出恢复步骤；绝不自动上传、自动 bump 或改 dist-tag。
- **NP-08（U+R）**：发行说明结构校验：`release-notes/v<版本>.md` 必须包含变更、兼容性、升级步骤、已知限制、验证结果五个小节，缺项在发布前门禁失败。
- **NP-09（R）**：新增 `scripts/release/publish.test.mjs`，用受控假 npm runner 覆盖 NP-02–NP-06，全部离线、不触网。
- **NP-10（U）**：CI（`.github/workflows/publish-tui.yml`）与本地使用同一 `npm run publish` 入口与同一组参数，参数名与取值约束由测试断言。

### 4.4 skill-display 与 export-selection（用户 2026-11-23 追加）

用户指令：「SP009中还需要参考buding-worker-space的tui实现skill，现在/触发skill后会在用户会话中输入大量skill的提示词，这不正确，不需要展示skill的提示词，直接复刻buding-worker-space的tui的skill的实现即可，但是不要直接复制代码注意AST检查」；「/export导出会话目前不能选择下载哪个会话，一样需要参考实现」。

- **SD-01（U+F）**：触发 skill（`/<skill>`）时，技能正文仍然完整送达模型（请求里可见），但**不出现在用户会话的可见转录里**；界面只显示一行「技能 /name 已加载」提示与一条短命令回显。
- **SD-02（U）**：会话恢复后重新渲染时同样不展示技能正文（技能以上下文块记录，恢复视图显示「上下文 · skill:<name>」）。
- **SD-03（U）**：`/help` 与补全仍能列出可用技能名与描述（不含正文）。
- **EX-01（U+F）**：`/export` 可以选择导出哪个会话：交互模式打开会话选择面板（当前会话 + 已保存会话），选中后导出；非交互模式必须用 `--session <id>` 明确指定。
- **EX-02（U）**：导出的内容来自所选会话的历史，读取失败时给出明确错误且不写出空文件；导出仍限制在 `~/.budingx` 内。

### 4.6 permission-boundary（用户 2026-11-23 报缺陷）

用户指令：「全自动模式的情况下不应该还有权限拦截，这个当做bug在SP009中修复」（截图为全自动档位下 `Read` 被 `BUDINGX_PERMISSION_001`「Reading outside the workspace is not allowed」拒绝）。

- **BF-01（U+F）**：**全自动（完全权限）档位**下，文件工具（Read/Write/Edit/Glob/Grep）可以访问工作区外的路径；策略判定为 allow，工具真实读到内容。
- **BF-02（U）**：仅可查看与工作区内修改两档仍按工作区边界拒绝（`floor:outside`），错误码与文案不变。
- **BF-03（U）**：地板规则在所有档位仍生效：`~/.budingx` 用户数据根与凭据形状文件不可读写；写 `.git` 仍需确认。

### 4.5 参考实现对照边界

两项均按「读机制、不抄代码」独立实现：参考仓的 skill 以工具结果送达模型、`/export` 以对话框交互；本仓没有 skill 工具，故以「上下文块 + `<skill>` 标签」达到同样的可见性效果，`/export` 用面板选择会话。新增代码全部纳入 AST 复核映射，不复用参考仓源码。

## 5. 开放问题

| ID | 问题 | 处理 |
| --- | --- | --- |
| OPEN-01 | 稳定版是否允许发到 `next` 通道 | 按 MODEL_PROPOSED：允许，但发行说明必须写 `dist-tag: next`，否则门禁失败。 |
| OPEN-02 | 是否需要给产品增加数据根环境变量（如 `BUDINGX_HOME`）以便隔离 | 不需要：验证用隔离 home（Windows `USERPROFILE`、POSIX `HOME`）即可覆盖 `os.homedir()`，避免产品行为变更。 |
| OPEN-03 | 真实 macOS 安装证据 | 本轮不具备条件，标 UNVERIFIED；说明书只声明 Windows/Linux 已验证。 |
| OPEN-04 | 真实 registry 上的回退安装与 `dist-tag` 移动 | 需要真实发布授权，超出本轮委托；以受控假 runner 与本地 tarball 证据替代，标 UNVERIFIED。 |
