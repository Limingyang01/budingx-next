# SP001 能力基线、核心边界与发布范围 · 正式设计

> 本历史记录沿用当时的 SP 编号，现行排期及新旧编号见[路线图 r8](../../../docs/iteration-plan.md)。

| 项 | 值 |
| --- | --- |
| 需求 | SP001（4 项：capability-baseline / evaluation-suite / core-boundaries / release-scope） |
| 版本 | v1 |
| 状态 | **approved —— 用户 2026-11-16 批准（v1）；同日拍板 O1=A / O2=A / O5=B，四项需求验收通过** |
| 更新 | 2026-11-16 |
| 执行依据 | 本文件的英文版 `design.en.md`（内容等价，AC 与决策一致） |
| 材料来源 | USER_CONFIRMED（用户 2026-11-16 两批决定 + `AGENTS.md` + `docs/iteration-plan.md` r3）｜MODEL_PROPOSED（本文件除标注为用户确认以外的全部内容）｜OPEN（见 §6，O1/O2/O5 已决） |

> **结构说明（MODEL_PROPOSED）**：SP001 的四个需求互相咬合（基线定义「水平」→ 边界决定能否实现 → 评测决定是否达成 → 发布范围决定如何交付），拆成四份设计会产生大量重复与互相矛盾。本轮采用**迭代级单份设计 + 四份需求正文**，各需求正文链接到本文件对应章节。这是本仓第一个实际启动的 SP，该布局将作为后续迭代的先例，若不认可可在批准前改回「每个 slug 一份 design/」。

---

## 1. 背景与目标

### 1.1 问题陈述

用户要求新仓实现的 TUI「达到 `D:\extra_project\buding-worker-space` 的 TUI 水平」，但该仓**未开源**、不得直接使用其代码。这产生三个必须先解决的问题：

1. **「水平」是什么？** 一句形容词无法验收；原产品规模为 60 万行 / 2,360 文件，若以「同样多」为标准则该目标不可度量、也不可排期。
2. **能不能做到？** 若原产品的「水平」中包含不可迁移的部分（例如自研了终端渲染引擎），照搬其形态既违反来源边界，也不可行。
3. **怎么证明做到了？** 「功能清单有 92 个命令」不是效果证据。

### 1.2 本轮要产出的东西

一张**版本化的能力清单**（把「水平」拆成 85 个可勾选项）、一套**责任边界与不变量**（决定哪些能力能在 21 轮内落地）、一套**评测集规格**（决定怎么证明）、一份**发布范围定义**（决定怎么交付）。全部是规格，不是代码。

### 1.3 目标（Goals）

- G1：把「达到原 Agent TUI 水平」转成可逐项验收的 CAP 清单，覆盖 L1–L4 四层，且不遗漏用户已确认的必交能力。
- G2：定义 Core / Provider / Tools / Storage / Host 的边界与不变量，使 TUI、Desktop、VS Code 三端可共享 Core 而互不绑架。
- G3：定义可自动断言、含盲测与预算上限的评测集规范，使后续轮次能真实测量效果。
- G4：定义发布形态、平台矩阵、运行条件与待决项，把需要用户拍板的事从后续轮次里提前挑出来。
- G5：留下来源台账，证明本仓没有复制未开源代码。

### 1.4 非目标（Non-Goals）

- 不实现任何产品代码；不改 `src/tui` 现有运行时行为。
- 不运行原 Agent，不采集其成功率/耗时/成本。**本轮不存在原产品效果基线。**
- 不选定终端 UI 框架的具体包与版本（SP002 决定，本轮只定验收方式）。
- 不定义 API 字段、事件 schema、存储 schema、权限规则语法。
- 不引入插件框架、微服务、常驻网关进程。
- 不做 Git 提交、合并、推送、发布、远端设置。

### 1.5 反目标（Anti-Goals，本设计明确拒绝的「看起来完成」）

- A1：不用命令数量、文件行数、功能菜单条目数当达标证据。
- A2：不用「清单里 85 项都打勾」宣称达到原 Agent 水平——清单只证明「有」，效果由评测集证明。
- A3：不用 mock/fixture 结果冒充 live Provider 或真实安装证据。
- A4：不因为原产品基线缺失就降低门槛或删题提分；缺失就写 UNVERIFIED 与恢复条件。
- A5：不通过改名或逐文件改写把旧仓代码「洗」成新实现。

### 1.6 约束（Constraints）

| 约束 | 来源 |
| --- | --- |
| Node.js >= 22.18 + TypeScript；**禁止 Bun** | `AGENTS.md` + 用户 2026-11-16 追加 |
| Core 不依赖 UI/终端框架；终端 UI 框架只允许 MIT 且仅出现在 TUI 渲染层 | 用户 2026-11-16 决定 |
| 用户数据唯一根 `~/.budingx`（`os.homedir()` 解析）；禁止读/写/回退/迁移 `~/.claude` | `AGENTS.md` |
| 旧仓只读；不复制源码、提示词、内部 SDK 类型、全局状态、bundle、配置、历史 | `AGENTS.md` + [独立实现边界](../../../docs/independent-development.md) |
| 模块化单仓：产品模块统一在 `src/` 下，各模块独立构建/打包 | `AGENTS.md` |
| 主分支 `master`；未获授权不建分支、不提交、不推送、不发布 | `AGENTS.md` |

---

## 2. 当前状态

### 2.1 现有文件与代码（真实核对）

| 路径 | 事实 |
| --- | --- |
| `src/tui/src/cli.ts` | 152 行。readline 行式输入；6 个斜杠命令（`/help /config /model /endpoint /clear /exit`）；Ctrl+C 取消；会话仅内存 |
| `src/tui/src/provider.ts` | 121 行。OpenAI 兼容 `POST {baseUrl}/chat/completions` SSE 流式；显式拒绝 tool_calls；超时用 `AbortSignal.timeout` + `AbortSignal.any` |
| `src/tui/src/config.ts` | 56 行。配置来自 CLI 参数 + `BUDINGX_*` 环境变量；base URL 强制 HTTPS（回环地址除外）且禁带凭据/查询/片段 |
| `src/tui/test/{cli,runtime}.test.mjs` | Node test runner；共 127 + 127 行 |
| `src/tui/package.json` | 包名 `budingx`，版本 0.1.1，MIT，`bin: budingx → dist/cli.js`，`engines.node >= 22.18.0`，**无运行时第三方依赖** |
| 根 `package.json` | 私有维护仓；`build` / `start` / `test:tui` / `test:release` / `test` / `publish` / `version:prepare` / `release:sync` 等真实脚本 |
| `docs/iteration-plan.md` | r3，21 轮路线图；SP001 定义为「能力盘点、基线和核心边界」 |
| `docs/agent-capability-matrix.md` | r2，能力与验收矩阵（MODEL_PROPOSED） |
| `docs/architecture.md` | 逻辑边界草案（DRAFT，未落到目录与不变量） |
| `SP/` | 只有 `README.md` 与 `templates/`，**此前没有任何实际 SP 目录** |

### 2.2 对照基线（只读盘点结果，MODEL_PROPOSED）

对 `D:\extra_project\buding-worker-space`（`budingx` 0.5.0，private，未开源）做只读盘点，未读取源码内容、未读取 `.env`、未运行、未写入。事实摘要：

| 维度 | 事实 |
| --- | --- |
| 规模 | `src/` 2,360 个 TS/TSX 文件 / 602,826 行；`adapters/` 约 1.9 万行；`desktop/` 约 11.9 万行 |
| TUI 可交互层 | components + ink + screens + hooks + commands + keybindings + vim ≈ **871 文件 / 16.6 万行** |
| 工具层 | 58 个工具目录 / 227 文件 / 54,630 行 |
| 命令面 | 92 个命令目录 + 20 个散文件命令 |
| 渲染 | React 19 + Ink 6，但**自研渲染引擎约 2.0 万行**（reconciler、布局、ANSI 解析、终端事件层、备用屏、选择与搜索高亮） |
| 权限 | 7 种权限模式 + 规则解析/文件系统规则/命令规则/遮蔽检测/拒绝追踪 + 沙箱适配器 |
| Hook | 28 个生命周期事件 × 4 类处理器（command / agent / prompt / HTTP）+ SSRF 防护 |
| 上下文 | 压缩服务族（手动/自动/增量/会话记忆压缩）+ 成本与 token 追踪 |
| 持久化 | JSONL 会话存储、分支/fork/rewind、文件历史快照、11 项数据迁移、备份 |
| 无头输出 | `--print` + `text` / `json` / `stream-json`；`--input-format`、`--json-schema`、`--include-partial-messages`、`--include-hook-events`、`--replay-user-messages`、`--max-turns`、`--max-budget-usd`、`--no-session-persistence`、`--resume` / `--fork-session` / `--from-pr`；退出码 0/1 + 终止原因枚举 |
| 多端 | 本地 API/WS 服务（175 文件 / 6.3 万行 / 28 组接口）、stdio 宿主、Electron 桌面端、VS Code 扩展、IM sidecar（5 渠道） |
| 用户数据根 | `~/.claude`（`CLAUDE_CONFIG_DIR` 可覆盖）——**与新仓约定冲突，新仓必须用 `~/.budingx`** |

### 2.3 差距（真实结论）

新仓 `src/tui` 共 4 个源文件 / 329 行。距基线 L1 交互层约差 16 万行量级，L2/L3/L4 尚未起步。目前与基线一致的只有两条：Node 版本约束、用户数据根隔离约定（且基线用 `~/.claude`，新仓用 `~/.budingx`，此处新仓更严格）。

**因此「达到同等水平」不是 SP001 能交付的东西，而是 SP002–SP021 的目标。SP001 的作用是把这句话变成可逐轮推进的清单与边界。**

### 2.4 假设（须在后续轮次复核）

- AS-1：基线的**能力项**可被等价实现，而不必等价形态。依据：基线的自研渲染器正是为了补上游渲染库的能力缺口，若新仓改用具备等价能力的上游 MIT 框架，成本可大幅下降。**风险**：上游框架能力不足 → SP002 选型门槛必须实测等价性，不能假设。
- AS-2：21 轮（SP001–SP021）足以覆盖 53 项必交能力。**未经排期验证**，见 §6 R1。
- AS-3：能力清单的粒度（用户可见能力级）适合做验收单元。粒度过细则变成实现清单。

---

## 3. 方案

### 3.1 能力基线（capability-baseline）

**产物**：[能力清单 v1](../capability-baseline/capability-manifest.md)，85 项，CAP ID 稳定。

**口径**（写入清单，任何后续轮次不得自行改写）：

1. 覆盖度 = 必交项中验收 PASS 的数量 / **53**（必交项总数）。`建议` / `可选` / `范围外` 不进分母，但进差距清单。
2. 清单只证明「有没有」；「好不好用」由 [评测集](#33-评测集evaluation-suite) 判定。
3. 数量类指标（旧仓 92 命令、58 工具、16.6 万行）只作背景事实，**不作达标证据**。

**层级与归属**（每项 CAP 必填归属 SP）：L1 交互 → SP002/003/006；L2 工具 → SP003/004/006/013/014/015/016/019；L3 Agent → SP002/003/004/005/006/007；L4 平台 → SP005/008/009/010/011/013/016/017/018/019/020/021。

**变更规则**：ID 不复用、不改语义；语义变化新增 ID 并标旧项 `DEPRECATED`；归属 SP 变更走迭代汇总的变更记录；封版后不可修改。

**与用户已确认范围的对应**（AC-06）：团队（CAP-L2-11 / L4-17）、浏览器（CAP-L2-15）、Computer Use（CAP-L2-16）、远程（CAP-L2-18 / L4-11 / L4-12）、IM（CAP-L4-15）、定时任务（CAP-L2-17 / L4-16）全部标 `必交`，无一项被降级为候选。

### 3.2 核心边界（core-boundaries）

**目录蓝图**（拟新增，非现状）：

```text
src/
  core/        # Agent 循环、上下文预算、工具调度、终态 —— 零 UI 依赖
  provider/    # 公开模型协议适配；不把厂商私有类型传播出本层
  tools/       # 工具实现、输入校验、输出上限；经审批接口调用
  storage/     # 会话/配置/凭据仓库；唯一数据根 ~/.budingx
  host/        # 宿主契约（进程内/stdio/WS），供 TUI、Desktop、VS Code 复用
  tui/         # 终端宿主与渲染层；唯一允许依赖终端 UI 框架的地方
  # 以下属后续迭代，本轮只登记名字，不建空工程：
  desktop/     # SP008 桌面工作台
  vscode/      # SP009 VS Code 扩展
  gateway/     # SP016 远程网关
  adapters/    # SP017/SP018 IM 渠道
  scheduler/   # SP019 定时调度
  mobile/      # 未来移动接入（原生 App 不在 21 轮范围）
```

**命名归属**（T-003 步骤 1 的执行结果，2026-11-16）：模块名与既有 [仓库布局](../../../docs/repository-layout.md) 的早期建议对齐结果 —— 早期建议的 `providers/` 归一为 `provider/`，与本仓既有的单数命名 `src/tui/` 一致；早期建议的 `protocol/` 归一为 `host/`（本仓的「宿主与传输协议契约」层），远程网关另立 `gateway/`（SP016）。两处归一都是为了避免同一职责出现两个目录名。

**不变量（Invariants）**——后续轮次的实现必须逐条可检查：

| # | 不变量 | 检查方式（交由后续轮次落地） |
| --- | --- | --- |
| I-01 | `core/` 不得 import 任何 UI / 终端 / 浏览器库 | 依赖白名单 + lint 规则 |
| I-02 | 厂商私有请求/响应类型不得出现在 `core/` 公共接口 | 类型审查 |
| I-03 | 用户数据只经 `os.homedir()` 解析出的 `~/.budingx`；代码中不出现 `~/.claude` 的读写或回退 | 路径审查 + 临时 home 隔离测试 |
| I-04 | 一个会话同一时刻只有一个写者；第二个写者被显式拒绝，不静默覆盖 | 并发测试 |
| I-05 | 凭据不写入普通共享 JSON，不进日志（脱敏） | 落盘检查 + 日志审查 |
| I-06 | 取消从 UI 传播到 provider、工具、子进程、子代理；拒绝后会话可继续 | 取消链路测试 |
| I-07 | 工具输出有上限；超限截断并标记，不静默丢弃 | 输出上限测试 |
| I-08 | 仓库指令、网页、工具输出、skill、模型返回一律视为不可信输入，不提升授权 | 提示注入负向用例 |
| I-09 | Node-only：不引入 Bun；`engines.node >= 22.18` | 依赖树检查 |
| I-10 | TUI 不是其他端的运行前置；各端可独立运行并复用同一 Core 契约 | 三端独立安装 smoke |
| I-11 | 进程内状态不跨端共享为隐式全局；跨端共享只经显式存储契约 | 契约审查 |
| I-12 | 旧仓的 Agent 循环、提示词、SDK 类型、全局状态、bundle 不进入本仓 | 来源审查 + 台账 |

**契约方向**（只定责任，不定字段）：

| 契约 | 定义方 | 消费方 | 失败责任 |
| --- | --- | --- | --- |
| Provider 适配 | `provider/` | `core/` | provider 层负责把上游错误归一为可诊断状态；core 不感知厂商语义 |
| 工具执行 | `tools/`（提供 `Tool` 契约） | `core/` | tools 层负责校验与输出上限；core 负责调度与终态 |
| 审批/权限 | `tools/` 侧策略 + `core/` 侧询问接口 | 宿主实现交互 | 宿主负责呈现；core 负责在拒绝后继续 |
| 存储 | `storage/` | `core/` + 各宿主 | storage 负责原子写/备份/迁移；并发写由 storage 拒绝 |
| 宿主 | `host/` | `tui` / 桌面 / VSIX | host 负责生命周期与传输；core 不感知宿主类型 |

**端无关与可取消的最低要求**（SP002–SP007 必须保持）：core 不得读写终端、不得直接 `process.exit`、不得依赖宿主全局变量；所有长操作接受取消信号。

**复用本仓既有资产**（AC-12）：`src/tui/src/config.ts` 的配置加载与 base URL 校验、`src/tui/src/provider.ts` 的 SSE 分帧与错误归一、`src/tui/src/cli.ts` 的终端安全输出（`stripVTControlCharacters` + 控制字符过滤），可直接作为 `provider/` 与 `core/` 的起点；SP002 拆分时做一次明确迁移，不另起炉灶。

### 3.3 评测集（evaluation-suite）

**任务 schema**（每题必备）：`id`、类别、语言、仓库规模、初始快照（版本号 + 内容哈希）、指令、可自动断言的预期结果、允许修改范围、外部依赖、预算（时间 / token / 费用 / 轮数）、失败分类、是否盲测。

**配额**（继承路线图 r3）：基本编码 ≥30、高级/跨端组合 ≥30、盲测 ≥20（基本 ≥10、高级 ≥10）。保护用例（权限、隔离、取消、安全）单独列出，**不计入盲测分母**。

**类别**：定位解释、跨文件修复、功能开发、测试失败修复、重构、长上下文、取消恢复、权限与对抗输入、Windows 路径与超大仓库、非英语内容、高级组合（团队/浏览器/桌面/远程/IM/定时）。

**评分**：以测试通过、差异正确性、用户目标达成为准。**不以模型自报「完成」计分。**

**失败分类**：定位错误、修改错误、越权、无效循环、超预算、幻觉成功（声称完成但断言不通过）。

**预算上限**（初始固定值，SP002 起生效，可在看到分布后一次性调整并记录版本）：

| 类别 | 单题墙钟上限 | 单题模型轮数上限 | 费用上限 |
| --- | --- | --- | --- |
| 基本编码 | 10 分钟 | 30 轮 | 按用户凭据实际计价，另设全局日预算 |
| 高级组合 | 20 分钟 | 50 轮 | 同上 |
| 保护/负向 | 5 分钟 | 10 轮 | 同上 |

**盲测纪律**：盲测题在封版前不得用于反复调优；分析失败后进入下一版本回归，同时**另留一批新的独立盲测**。

**统计纪律**：必报四项——独立任务数量、重复运行的相关性、关键分组结果、波动区间。结果区间跨越适用门槛时判「**证据不足**」，扩充样本或继续运行后再判断，不得只报点估计。（原「相对原产品 5 个百分点非劣门槛」已被用户决议 O5=B 废除；本纪律适用于后续轮次固定的自有测量门槛。）

**原产品基线缺口**（本轮最重要的事实）：

- 用户选择静态盘点、不运行旧 Agent ⇒ **没有原产品成功率基线**。
- 因此「可比集完成率相对原产品下降 ≤ 5 个百分点」这条门槛在 SP001 **不可计算**，并已被用户决议 O5=B 废除（见下）。
- 本轮能做的是：交付评测集规格、任务清单、断言口径、预算与盲测纪律，以及本仓自身的可重复测量能力（运行器归 SP002+）。
- **用户决议（2026-11-16，O5=B）**：不授权采集原产品效果基线。效果对比永久采用「自有能力测量 + 能力清单覆盖度」口径；「相对原产品 ≤ 5 个百分点」门槛废除，不再作为任何轮次的出口门槛。原恢复条件（单独授权 + 可用凭据 + 版本与入口固定）因本决议失效；若用户未来改变决定，须在迭代汇总变更记录中另行登记。
- 任何文档、汇报或提交信息中**永久禁止**出现「已对齐原 Agent」「达到同等水平（效果）」这类表述。

### 3.4 发布范围（release-scope）

| 项 | 结论 | 状态 |
| --- | --- | --- |
| 制品形态 | npm 发布的 TUI（主）、桌面应用（SP008）、VS Code 扩展（SP009） | MODEL_PROPOSED |
| npm 包名 | 已发布 `budingx`（0.1.1）为 bootstrap 预览。完整 Agent 制品**沿用 `budingx` 同名**（用户 2026-11-16 决议 O1=A）；预览版用户将收到破坏性升级，发布轮（SP006/SP011）必须提供升级/迁移说明并把关 `latest` 升级路径 | **USER_CONFIRMED** |
| 支持平台 | **已验证：Windows**（现有发布链路仅在 Windows/Linux 做过 dry-run 门禁，产品本体未认证 macOS/Linux）。计划中：SP011 打包工程后逐个验证（用户 2026-11-16 决议 O2=A 维持此默认） | **USER_CONFIRMED** |
| 运行条件 | Node >= 22.18；禁止 Bun；终端需支持 TTY，能力检测与降级路径必须明确 | USER_CONFIRMED |
| 模型访问 | 凭据经环境变量或系统钥匙串注入，不进包、不进日志、不进普通共享 JSON | MODEL_PROPOSED |
| 用户数据 | 唯一根 `~/.budingx`；不读 `~/.claude`；包内不携带用户数据 | USER_CONFIRMED |
| 第三方许可 | 新增依赖（含终端 UI 框架）逐项登记 `THIRD-PARTY-NOTICES.md`，须为 MIT 或等效可再分发许可 | USER_CONFIRMED |
| 发布授权 | 每轮发布单独授权；无授权不发布、不改版本、不推标签 | USER_CONFIRMED |
| 回执要求 | 每次发布须有 registry 回执 + provenance + 干净环境隔离安装 smoke | USER_CONFIRMED |
| 制品独立性 | 无需源码树 / Bun / 开发依赖即可安装运行 | MODEL_PROPOSED |

**发布节奏**：SP006 建立 npm dry-run 骨架（不上传）→ SP011 完成「一条 `npm run publish`」门禁与制品身份 → SP020 全能力制品复验 → SP021 完整替代验收。

**原须用户拍板的四项**（详见 [release-scope 需求](../release-scope/requirements.md) 的开放问题）：包名策略（**已决 O1=A：沿用同名**）、平台扩展（**已决 O2=A：Windows 先行**）、发布账号与签名归属（O3 待决，默认沿用现有路径）、桌面/扩展的分发渠道（O4 待决，默认只保证可安装制品）。

### 3.5 来源台账与处理决定

| 来源 | 位置 | 许可/可及性 | 本轮处理决定 |
| --- | --- | --- | --- |
| 原 Agent（对照基线） | `D:\extra_project\buding-worker-space`，`budingx` 0.5.0 | 私有，**未开源** | 仅只读观察用户可见行为与目录结构规模。**不复制**源码、提示词、内部 SDK 类型、全局状态、bundle、配置、历史记录；**不逐文件改写**冒充独立来源；不读取 `.env`。清单「基线证据」列只记录能力存在的事实与规模统计 |
| 本仓既有 TUI | `src/tui`（`budingx` 0.1.1，MIT） | 自有 | 直接复用配置加载、SSE 分帧、终端安全输出，作为 Provider/Core 契约起点 |
| 公开协议 | OpenAI 兼容 Chat Completions、Anthropic Messages、MCP | 公开协议，各按其服务条款与许可使用 | 作为互操作契约依据；不引入厂商私有类型 |
| 终端 UI 框架 | 待 SP002 选型 | 须确认 MIT | 选型后登记 `THIRD-PARTY-NOTICES.md`；未确认前不得进入依赖 |
| 本仓技能与文档 | `skills/`、`docs/` | MIT | 复用既有 SDD 流程与文档约定 |

工程隔离不构成法律洁净室认证（见 [独立实现与复用边界](../../../docs/independent-development.md)）。

---

## 4. 变更集

### 4.1 本轮新增（拟）

```text
SP/SP001/requirements-summary.md                       # 迭代汇总（索引）
SP/SP001/design/design.zh.md                           # 本文件
SP/SP001/design/design.en.md                           # 英文等效版（执行依据）
SP/SP001/design/plan.zh.md                             # 实施计划
SP/SP001/design/plan.en.md                             # 英文等效版
SP/SP001/capability-baseline/requirements.md
SP/SP001/capability-baseline/STATUS.md
SP/SP001/capability-baseline/capability-manifest.md    # 能力清单 v1（核心产物）
SP/SP001/evaluation-suite/requirements.md
SP/SP001/evaluation-suite/STATUS.md
SP/SP001/core-boundaries/requirements.md
SP/SP001/core-boundaries/STATUS.md
SP/SP001/release-scope/requirements.md
SP/SP001/release-scope/STATUS.md
scripts/spec/check-spec.mjs                           # 拟新增：能力清单与任务清单自洽性检查
scripts/spec/check-spec.test.mjs                      # 拟新增：检查器自检
```

### 4.2 本轮修改（拟）

| 文件 | 改动 | 理由 |
| --- | --- | --- |
| `package.json` | 新增 `spec:check` / `spec:test`，并把 `spec:test` 并入 `test` | 让规格自洽性成为门禁 |
| `docs/index.md` | 增加 SP001 入口链接 | 文档导航可达性 |
| `docs/iteration-plan.md` | 在「后续 Agent 的执行入口」标注 SP001 已启动（规格轮） | 路线图状态同步 |
| `docs/current-status.md` | 标注 SP001 规格轮进行中、未启动实现 | 状态文档不得说成已交付 |
| `docs/agent-capability-matrix.md` | 链接到能力清单 v1 | 矩阵与清单对齐 |
| `docs/repository-layout.md` | 与 §3.2 的目录蓝图对齐（含 `providers/`→`provider/`、`protocol/`→`host/` 的归一说明） | 消除两份文档的命名冲突 |
| `docs/development.md` | 登记 `npm run spec:check` | 命令可发现 |

> **本轮唯一的新增代码是规格自洽性检查**（维护工具，非产品代码）。文档可达性由本仓既有的 `scripts/skills/integrity.test.mjs` 覆盖，已包含 `SP/**/*.md`，因此不另建链接检查器。新增检查针对的是「必交能力被静默降级」——该风险不会让任何其他测试失败，必须有专门门禁。

### 4.3 验证（真实存在的命令）

| 检查 | 命令 | cwd |
| --- | --- | --- |
| 规格自洽性（清单 / 任务清单） | `npm run spec:check` | 仓库根 |
| 检查器自检（能检出人为破坏） | `npm run spec:test` | 仓库根 |
| 既有维护测试不回归（含文档链接完整性检查） | `npm test` | 仓库根 |
| 产物无提交/未推送 | `git status --short` | 仓库根 |

> `npm test` 当前包含 `skills:test`（含链接完整性检查）+ `spec:test` + `test:tui` + `test:release`；`test:tui` 会先跑 `npm run build`（tsc）。本轮不新增产品代码，因此这些门禁必须保持通过。已知盲区：链接检查剥离围栏代码块但不剥离行内代码跨度，正文里以行内代码写出的链接语法示例会被误判为断链 —— 本轮按「示例放进围栏块」规避，扩展该检查属共享维护工具行为变更，需单独授权。

---

## 5. AC 映射

| AC | 所在需求 | 对应设计章节 | 验证方式 | 状态 |
| --- | --- | --- | --- | --- |
| AC-01…AC-10（基线） | [capability-baseline](../capability-baseline/requirements.md) | §3.1、§3.5 | 人工核对清单 + 链接检查 | PASS 9 / NOT_APPLICABLE 1 |
| AC-01…AC-12（评测） | [evaluation-suite](../evaluation-suite/requirements.md) | §3.3 | 人工核对规格与任务清单 | PASS 12 |
| AC-01…AC-13（边界） | [core-boundaries](../core-boundaries/requirements.md) | §3.2 | 人工核对设计 | PASS 13 |
| AC-01…AC-12（发布） | [release-scope](../release-scope/requirements.md) | §3.4 | 人工核对设计 | PASS 12 |

AC 与设计章节一一对应，无悬空 AC。47 条 AC 已逐条走查：**46 PASS / 1 NOT_APPLICABLE**（capability-baseline AC-09 前置条件未触发），逐条依据见 [验证报告](../test-report.md)；用户 2026-11-16 验收通过。PASS 指规格条款被满足，不代表产品能力已实现。

---

## 6. 风险与开放项

| ID | 类型 | 内容 | 处理 |
| --- | --- | --- | --- |
| R1 | 风险 | 53 项必交能力在 21 轮内是否够，未做排期验证；基线 TUI 层就有 16.6 万行量级 | 每轮出口门槛按能力清单切片；某轮切不动就追加 SP 编号，不缩减必交范围 |
| R2 | 风险 | 用上游终端框架替代基线的自研渲染器，可能缺少等价能力（选择/搜索高亮/布局/备用屏） | SP002 选型设**实测门槛**：逐项对照 CAP-L1-01/02/03/04/05/14/15 的验收方式证明等价，不等价才引入受控扩展 |
| R3 | 风险 | 无原产品效果基线，「达到水平」在效果维度不可证 | 已写入 §3.3 与 AC-09；用户决议 O5=B：不采集原产品基线，效果口径永久为自有测量 + 覆盖度；「已对齐」措辞永久禁止 |
| R4 | 风险 | 任务集若晚于功能实现编写，会变成「为实现量身定做的题」 | 任务定义须在对应功能开工前冻结版本 |
| R5 | 风险 | 已占用 `budingx` 包名，与完整 Agent 制品命名冲突 | 用户已决 O1=A：完整制品沿用同名；风险转化为破坏性升级，SP006/SP011 必须提供升级/迁移说明并把关 `latest` 路径 |
| R6 | 风险 | 清单粒度与实际实现粒度不匹配，导致验收争议 | 清单变更须走迭代汇总变更记录，不静默改 |
| R7 | 风险 | 静态盘点无法发现「有但不可用」的能力 | 该类问题由评测集与真实进程 smoke 暴露，不靠清单兜底 |
| O1 | **RESOLVED** | npm 包名策略 | 用户 2026-11-16 决议（A）：沿用 `budingx` 同名；发布轮必须提供破坏性升级/迁移说明 |
| O2 | **RESOLVED** | Windows 之外的平台范围 | 用户 2026-11-16 决议（A）：只声明 Windows 已验证，macOS/Linux 于 SP011 打包工程后逐个验证 |
| O3 | OPEN | 发布账号与签名归属 | 默认沿用现有 Trusted Publishing 路径与账号 |
| O4 | OPEN | 桌面/扩展的分发渠道（商店上架） | 默认只保证可安装制品 |
| O5 | **RESOLVED** | 原产品效果基线的采集授权与时点 | 用户 2026-11-16 决议（B）：不授权采集；效果对比永久采用自有测量 + 覆盖度口径，5 个百分点非劣门槛废除 |
| O6 | OPEN | Core 是否独立成 npm 包 | 默认同仓 `src/core` 目录，SP002 确认 |
| O7 | OPEN | 跨端共享存储的并发模型 | 默认会话级单写者 + 只读观察，SP010 落地 |
| O8 | OPEN | 终端 UI 框架具体选型 | SP002 决定，须登记许可 |

---

## 7. 交付与下一步

- 本轮交付：规格与清单，**不含任何产品代码**。
- 已完成（2026-11-16）：
  1. 用户批准本设计（v1）与四项需求的 AC，验收通过（46 PASS / 1 NOT_APPLICABLE）；
  2. 用户拍板 O1=A（沿用 `budingx` 同名）、O2=A（Windows 先行）、O5=B（不采集原产品效果基线，效果口径永久为自有测量 + 覆盖度）。
- 下一步：用户授权后启动 SP002（模型与会话闭环），输入为能力清单 v1、不变量 I-01…I-12、任务 schema 与预算表、本发布范围。O3/O4/O6/O7/O8 按各自默认处理留待对应轮次。
- 执行与验收仍不自动获得 Git 提交、合并、推送或发布授权。
