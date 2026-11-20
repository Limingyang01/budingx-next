# SP005 验收与验证报告 · 长会话与数据可靠性

状态：**代码层验收全绿，交叉验证门禁 GREEN；已合入 master `293a337` 并推送远端；0.5.0 已通过 OIDC 发布**。分支 `feature/SP005/long-session-reliability`，文档起点 master `17afe34`，实施提交 `a76199e`，补强提交 `62f3e9e`（真实 Langfuse 栈接入、子进程超时预算与文档同步）、`ef90f11`（登录凭据对齐 `.env.e2e.local` 与登录自检）、`90f1e9a`（判定工具调用是否合适）、`ebfb882`（真实模型端到端：模型用量与工具观测载荷、判读允许熔断停机）。本报告是轮次级结论；逐条细节见 [long-session-reliability 验收报告](long-session-reliability/test-report.md)，配套 [需求](long-session-reliability/requirements.md)、[设计](long-session-reliability/design/design.zh.md)、[实施计划](long-session-reliability/design/plan.zh.md)与 [STATUS](long-session-reliability/STATUS.md)。

## 0. 本轮执行证据

环境：Windows 10 家庭版 10.0.19045 + MSYS bash；后期按用户要求在 WSL2 发行版 `Ubuntu22`（内核 6.18.58.1-1）内安装 Docker Engine 29.10.0，真实 Langfuse 4.78.0 栈已落地（详见 §1 与 `ops/langfuse/README.md` 第 9 节）；Node.js 见 `node -v`（`package.json` 要求 >=22.18）。所有命令在仓库根执行。

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 构建 | `npm run build` | 通过（tsc，无错误） |
| 单元/功能 | `npm run test:unit` | **716/716 通过**（`node --test src/*/test/*.test.mjs`） |
| 模块边界 | `npm run test:checks` | 通过（`core` 不 import `storage`） |
| 规格自洽 | `npm run spec:check` | 通过（路线图、能力清单与任务清单自洽） |
| 技能入口 | `npm run skills:check` | 通过（Skill entries are current） |
| 观测脚本 | `npm run test:langfuse` | 79/79 通过（含真实栈冒烟 5 例、登录自检 3 例、初始化凭据对齐 1 例、工具调用质量判读 4 例、场景收尾判读 2 例） |
| 发布脚本 | `npm run test:release` | 17/17 通过 |
| 合入门禁脚本 | `npm run merge:test` | 5/5 通过 |
| 全量 | `npm test` | **838 通过 / 0 失败**（skills 10 + spec 11 + unit 716 + langfuse 79 + release 17 + merge 5，`EXIT=0`，日志 `.runtime/npm-test-full9.log`） |
| 交叉验证门禁 | `npm run merge:gate` | **GATE GREEN**（`artifacts/merge-gate/feature-SP005-long-session-reliability-2026-11-19T16-10-43-342Z.md`（HEAD `ebfb882`）；outgoing 6 commits / 56 files；`npm test` / `spec:check` / `skills:check` / `pack-smoke` 全绿；其后 `62b5544` 仅回填本表，无代码变更） |
| 发布预演（0.5.0） | `npm ci --ignore-scripts --no-audit --no-fund` + `npm run publish -- --dry-run --expected-version 0.5.0 --tag latest` | **通过**（`EXIT=0`，日志 `.runtime/npm-ci-prep.log` / `.runtime/publish-dryrun.log`）：依赖安装 58 包；整轮 `npm test` 838 通过 / 0 失败（skills 10 + spec 11 + unit 716 + langfuse 79 + release 17 + merge 5）；`npm pack` 产物 99 个文件（`dist/core` `dist/exec` `dist/git` `dist/observability` `dist/plan` `dist/storage` `dist/tui` `dist/workspace` + `package.json` `README.md` `LICENSE`）；tarball integrity `sha512-iiZMl/BtZGXtC/Ky8d+qcLkBuOHRgPodcaiIiR06Ph02dNE70Vs8VtFfuzbQ/GzCt/YvYwTrg1Nuni312lK3xQ==`；隔离 prefix 安装后 `budingx --version` = `0.5.0`；安装态 smoke `version 0.5.0`、`fixtureRequests 1`、`externalProvider UNVERIFIED`；报告 `artifacts/release/0.5.0-1795132949779/report.json`，`state=verified-local`、`dryRun=true`（**未上传 npm**） |

本轮新增用例 101 例（12 个测试文件；另含 1 例整轮挂起回归，见 §5），全部对应用例文件与 AC 的映射见 [细节报告 §2](long-session-reliability/test-report.md)。

## 1. 端到端观测与「工具调用是否合适」

本机最初没有 Docker 也没有 WSL 发行版，真实 Langfuse 栈无法启动。为了让用户要求的「用 Langfuse 看测试效果、看工具调用是否合适」在本机可执行，先交付一个 Langfuse 兼容接收端 `scripts/langfuse/local-receiver.mjs`：实现健康检查、OTLP JSON 摄入（`/api/public/otel/v1/traces`，Basic 认证）与 v2 observations 回查，SP004 的 `query-traces.mjs` / `verify-agent.mjs` 未改一行即可使用。启动与端点见 `ops/langfuse/README.md` 第 8 节，命令为 `npm run langfuse:init` → `npm run langfuse:receiver` → `npm run langfuse:observe`。后期按用户要求装好 WSL2 + Docker Engine 后，真实模型回合改投真实 Langfuse 4.78.0（§1 下文）；兼容接收端保留给无 Docker 的机器与 CI。

已实测的接收端行为：`GET /api/public/health` 返回 `{"status":"OK","version":"local-receiver"}`；未鉴权 `GET /api/public/v2/observations` 返回 401；观测按 span 落盘 `.runtime/langfuse/local-receiver/`，重启不丢（重启后回查 `meta.totalItems=103`）。

浏览器查看：启动接收端后打开 <http://127.0.0.1:3000/>，即可按 trace 查看观测树（`agent.run` → `model.request` / `tool.<Name>`）、级别着色、耗时与 input/output，支持过滤与自动刷新；数据源是同进程的 `GET /ui/observations`。

真实栈（2026-11-19 补齐）：按用户要求在 WSL2 发行版内装 Docker Engine（不是桌面端 Docker），`ops/langfuse/compose.yaml` 起 `langfuse/langfuse:4.78.0` + Postgres 16 + ClickHouse 26.3.62.3 + Redis + MinIO 六容器，`GET /api/public/health` ⇒ `{"status":"OK","version":"4.78.0"}`，带 Basic 的 `/api/public/projects` 返回项目 `budingx-agent`。因为模型额度仍是 402，用 `scripts/langfuse/stack-smoke.mjs` 走**生产导出器** `OtlpExporter.sendBatch` 投递合成 trace 再回查：`count:3, rootCount:1, hierarchyOk:true, toolErrorVisible:true, modelPresent:true, sessionConsistent:true, ok:true`，落盘 `.runtime/langfuse/stack-smoke.json`。这说明上报与查询链路对真实 Langfuse 服务端成立，只剩真实模型回合这一项待额度。

登录凭据对齐（同日补）：真实栈首次初始化时 `npm run langfuse:init` 随机生成了管理员密码与项目 Key，与仓库根 `.env.e2e.local` 里那套不一致，所以用该文件的密码登不进 UI、用它的 Key 查 `/api/public/projects` 也是 401。按用户要求「按这个账号密码去改，不要改账号密码」，把 `local.env` 的 `LANGFUSE_INIT_USER_*`/`LANGFUSE_INIT_PROJECT_*` 改成 `.env.e2e.local` 的四个值，`down -v` 重建数据卷重新初始化；现在 `npm run langfuse:login` ⇒ `{csrfOk:true, callbackStatus:200, sessionEmail:"admin@budingx.local", ok:true}`，`npm run langfuse:smoke` ⇒ `ok:true`。为防复发，`init-local.mjs` 改为检测到 `.env.e2e.local` 就复用它这四个值（新增 `e2eCredentials` 与对应用例），并新增 `scripts/langfuse/login-check.mjs`（`npm run langfuse:login`）把「能不能登录」变成一条命令可验。

真实模型侧的关键结论（额度恢复后于 2026-11-20 完成复跑）：

| 场景 | 观测结论 | 结果 |
| --- | --- | --- |
| tool-success（真实模型，复跑） | `agent.run` 唯一根，`model.request`、`tool.Read`、`model.request` 层级与工具名全对；1 次 Read，参数 `{"path":"facts.txt"}`，结果可见；终态 completed，用量 1228 | PASS |
| tool-error（真实模型，复跑） | 5 次 `tool.Read` 均为 ERROR，模型依次换 `data/`、`text/`、`docs/`、`./` 路径；第 5 次触发两级空转熔断，终态 error + `BUDINGX_CORE_010`（设计内的显式停机），用量 1362 | PASS |
| 工具调用质量判读 | 次数预算、参数包含目标文件、重复参数检测、模型用量/耗时四项判读全部通过 | PASS |

复跑第一次暴露了两个真实观测缺陷，均由 Langfuse 数据直接指出并已修复：

1. **模型观测没有用量**：provider 从未请求 `stream_options.include_usage`，也从不解析 `payload.usage`，所以真实端点 tokens=0、成本不可见。修复：`src/provider/openai.ts` 流式请求显式带 `stream_options:{include_usage:true}`，解析流末尾 usage 帧并随 `message_completed` 返回；端点若因此回 400，自动去掉该字段重试一次。修复后真实 trace 的 `model.request` 分别显示 653/588 tokens。
2. **工具观测没有输入/输出**：`src/core/session.ts` 只给根观测与 `model.request` 写 payload，`tool.<Name>` 从不写，Langfuse 里无法判断参数是否合适。修复：dispatch 时写 `input`，`pushToolResult` 时先写 `output` 再结束观测。修复后可直接看到 `in: {"path":"facts.txt"}`、`out: "1→alpha…"`。

第一次判读还把 tool-error 的期望写成「终态不得为 error」，与 SP005 设计冲突——空转熔断本来就是显式失败停机。判读改为：失败场景允许 completed（模型如实汇报）或 error + `BUDINGX_CORE_010`（熔断停机），其它错误码仍失败；次数上限取自 `MAX_TOOL_FAILURE_STREAK`（5）而不是硬编码 2，避免判读与产品常量漂移。

额度未恢复期间，以本地脚本化 OpenAI 兼容端点复现同一条链路（真实 HTTP 请求、真实解析、真实工具执行、真实追踪上报、真实接收端回查），`scripts/langfuse/sp005-observation.e2e.test.mjs` 3/3 通过，覆盖 OB-02/OB-03 与 FR-09。

## 2. 42 条 AC 回填

AC 区间：CB-01…07（7）、SR-01…11（11）、FR-01…09（9）、PM-01…08（8）、OB-01…04（4）、EV-01…03（3），共 **42 条**。验证层：L0 纯逻辑/契约、L1 真实进程或真实 HTTP、L2 端到端。

| 分组 | AC | 结论 | 主要证据 |
| --- | --- | --- | --- |
| context-budget | CB-01…07 | 7/7 PASS | `src/core/test/context-budget.test.mjs`(11)、`context-budget.e2e.test.mjs`(3，真实请求体) |
| session-recovery | SR-01…11 | 11/11 PASS | `src/storage/test/session-transcript.test.mjs`(12)、`session-recovery.e2e.test.mjs`(4，真实子进程) |
| failure-recovery | FR-01…09 | 9/9 PASS | `src/core/test/failure-recovery.test.mjs`(8)、`tool-loop-breaker.test.mjs`(4)、`session-persistence.test.mjs`(11) |
| project-memory | PM-01…08 | 8/8 PASS | `src/storage/test/project-memory.test.mjs`(12)、`src/tui/test/sp005-commands.test.mjs`(14) |
| 观测 | OB-01…04 | 4/4 PASS | `scripts/langfuse/local-receiver.test.mjs`(3)、`sp005-observation.test.mjs`(16)、`sp005-observation.e2e.test.mjs`(3)、`stack-smoke.test.mjs`(5) + 真实栈 `npm run langfuse:smoke` 四项判定全 true + 真实模型回合 `npm run langfuse:observe`（tool-success/tool-error 均 PASS） |
| 端到端与交付 | EV-01…03 | 3/3 PASS | 本报告 §0、§1；`npm test` + `npm run merge:gate`；真实模型两场景观测回查；失败原因可在转录与终态错误中定位 |

逐条证据（CB/SR/FR/PM/OB/EV 每一行）见 [细节报告 §3](long-session-reliability/test-report.md)。

## 3. 交付物与文档同步

| 类别 | 产物 |
| --- | --- |
| 产品代码 | `src/core/context-budget.ts`、`transcript.ts`、`session-persistence.ts`、`session.ts` 接线；`src/storage/{private-file,session-transcript,session-store,project-memory}.ts`、`atomic.ts`（`writeTextAtomic`） |
| 命令面 | `/sessions`、`/resume <id>`、`/context`、`/memory`（`src/tui/commands.ts`、`runtime.ts`） |
| 观测 | `scripts/langfuse/local-receiver.mjs`、`local-ui.html`/`build-ui.mjs`、`sp005-observation.mjs`、`stack-smoke.mjs` 与配套测试；`ops/langfuse/README.md` 第 8 节（兼容接收端）与第 9 节（WSL2 内真实栈）；`package.json` 新增 `langfuse:init`/`langfuse:receiver`/`langfuse:ui`/`langfuse:observe`/`langfuse:smoke` |
| 文档 | `PRODUCT.md` 5.5 节与已知限制、`docs/iteration-plan.md` SP005 行、`docs/agent-capability-matrix.md` 五行能力状态、本轮需求/设计/计划/STATUS |

## 4. 未验证项与恢复条件

| 项 | 状态 | 恢复条件 | 恢复动作 |
| --- | --- | --- | --- |
| 真实模型长会话压缩（超预算后的压缩回合） | UNVERIFIED | 需要用真实模型填满上下文预算才算真实压缩；当前以 `context-budget.e2e.test.mjs` 的真实 HTTP 请求体证明压缩内容，真实模型侧未跑 | `npm run langfuse:observe` 增加长会话场景（多轮填充至触发压缩）后回填 [细节报告 §4](long-session-reliability/test-report.md) 与本报告 §1 |
| TUI 长会话的像素级观感（`/context`、会话选择器） | UNVERIFIED | SP006 可视化验收 | 终端快照 + 按键回放 |

以上两项不影响本轮代码层验收结论：链路、协议、隔离、原子写与失败语义均有 L0/L1 证据；真实模型 tool-success / tool-error 两场景已在真实 Langfuse 服务端回查通过（§1）；长会话压缩由真实 HTTP 请求体证据覆盖，仅缺真实模型的自然触发。

## 5. 风险与剩余

- 整轮 `npm test` 偶发挂起已修复：`src/exec/background.ts` 终态后释放子进程 stdout/stderr 读端（被终止的孙进程仍持有写端时句柄不收敛，`node --test` 子进程会一直等事件循环清空，实测卡住 12 分钟），新增 `src/exec/test/background.test.mjs` 的 `CE-07/R-05` 用例；修复后全量 `npm test` 为 `EXIT=0`。
- 压缩默认阈值按模型上下文上限的 85% 触发、60% 目标；模型上下文上限变化时需重新校准（由 `contextBudget.maxTokens` 注入）。
- 转录与记忆写入失败时回合结果仍留在内存，进程退出即丢失——这属于「明确报错」而非「静默成功」，错误码 `BUDINGX_STORAGE_005`。
- 工具空转熔断是启发式（精确签名 3 次 / 同工具同错误码 5 次）；若某工具在多参数下确实可恢复，可能被提前终止，阈值后续可依观测调整。
- 兼容接收端不是 Langfuse 本体：只有只读查看页，无 ClickHouse、无登录与项目管理；保留给无 Docker 的机器与 CI，本机真实栈已就绪（§1），两者互斥占用 3000 端口。
- Langfuse 初始化凭据只在数据库为空时生效：`LANGFUSE_INIT_*` 改动后必须 `down -v` 重建才会生效，直接重启容器不会改库里的账号与项目 Key；本机已用 `npm run langfuse:login` 与 `npm run langfuse:smoke` 双检。

## 6. 授权与集成状态

- 启动与端到端测试授权：用户 2026-11-19「开始SP005，做完后跑端到端的测试……你在本地搭好langfuse的监测」。
- 合入约束：用户 2026-11-19「测试完成后待我决定后再合入master分支」→ 该约束在测试通过后生效，用户于 2026-11-20「合入master，并且停止容器」授权合入，合并提交 `293a337`；随后「合完推送远端，完成发布前的准备工作，到时我直接点发布即可」授权推送与发布准备。master 与功能分支均已推送远端。
- 发布准备：0.5.0 版本号、发布台账 `prepared` 记录和发行说明已在触发前就绪。维护者随后手动触发 GitHub Actions，正式发布证据见 §8。
- 发布预演：本地 `npm run publish -- --dry-run --expected-version 0.5.0 --tag latest` 通过打包、隔离安装、命令入口版本与安装态 smoke，报告为 `state=verified-local`。
- 交付记录：本报告、[细节报告](long-session-reliability/test-report.md)、[STATUS](long-session-reliability/STATUS.md) 与 [requirements-summary](requirements-summary.md) 同步维护。

## 7. 0.5.0 发布预检修复自审（2026-11-20）

[发布运行 #19](https://github.com/Limingyang01/budingx-next/actions/runs/44650273279) 的 Windows 预检中，Langfuse 初始化的 8 项测试因 DACL 校验漏读内置管理员的 `LA` 别名而失败。改为直接读取 Windows DACL 中的数字 SID，也覆盖 `AU` 等宽泛主体的别名。由用户手动触发正式发布。

| 验收项 | 结论 | 验证 |
| --- | --- | --- |
| 读取 `LA` 对应的内置管理员 SID | PASS | Windows 临时文件真实 DACL，含空格、括号及引号的文件名 |
| 拒绝显式授予 `AU` 访问 | PASS | Windows 临时文件授予 `S-1-5-11` 后，初始化权限校验拒绝该授权 |
| 保持现有初始化行为 | PASS | `node --test scripts/langfuse/init-local.test.mjs` 在仓库根执行，Windows 12 项通过，包括目录和文件权限、重复初始化与不完整配置保护 |
| 托管发布验证 | PASS | 运行 #20 的 Windows 与 Ubuntu 验证通过，见 §8 |

两条新增断言在旧代码上均失败，修复后均通过。自审覆盖初始化脚本、回归测试、本报告及 [产品说明书](../../PRODUCT.md) 的 Langfuse 权限描述。变更范围限于开发初始化工具，无依赖、配置迁移、凭据或制品变动。Windows 测试使用临时文件的真实 ACL，产品发布预检另行验证制品。

## 8. 0.5.0 正式发布回执（2026-11-20）

- [GitHub Actions #20](https://github.com/Limingyang01/budingx-next/actions/runs/44654008000) 基于 `751ba3b`，Windows、Ubuntu、OIDC 发布和发布后的安装验证均通过。npm 官方源确认版本 0.5.0 已公开且 `latest` 指向 0.5.0。
- 官方包独立安装后的 CLI 版本为 0.5.0，本地 HTTP 流式冒烟通过（1 次 fixture 请求）。已核验 53 个包的 registry 签名和 7 个包的 attestations。公开制品的 SHA-512 与 npm 元数据、独立安装锁和 provenance 一致，provenance 指向同一源码 SHA、工作流及运行。
- Actions 原始回执需要登录才能下载。证据来源已登记于[发布台账](../../release-ledger.json)和[发行说明](../../release-notes/v0.5.0.md)。真实模型长会话压缩和 TUI 观感的恢复条件见 §4。

## 9. 0.5.1 复审修复（2026-11-20）

0.5.0 发布后对 SP005 代码做独立复审。评审覆盖上下文压缩、会话持久化与记忆、TUI 命令与工具熔断、验收证据四个方向；每条关键结论都在隔离构建产物上用探针脚本或并发进程独立复现，再进入修复。修复分支 `feature/SP005/fix-0.5.1`，版本 0.5.1（尚未上传 npm）。

### 9.1 修复项与证据

| 编号 | 缺陷 | 修复 | 证据 |
| --- | --- | --- | --- |
| H1 | 写锁「先检查再写」，并发下多个进程同时持锁（实测 8 进程 6 个成功） | 改为 O_EXCL 排他创建 | `sp005-review-storage.test.mjs`：并发 6 子进程恰好 1 个获取 |
| H2 | `release()` 无条件删锁，非持有者可删别人的锁 | 释放前核对 pid，仅创建者可删 | 同上：非持有者释放后锁仍在，第三方无法获取 |
| H3 | 记忆正文含 `## ` 截断条目并伪造新条目；标题换行可注入 | 正文结构行转义、标题压单行并限长 | 同上：正文含 `## ` 与 `- created:` 往返一致 |
| H4 | 保留项超预算仍返回「压缩成功」并下发超限请求 | 保留项按预算裁剪；仍超预算明确提示 | `sp005-review-compaction.test.mjs`：保留项 token ≤ floor 且 `withinBudget=true` |
| H5 | 压缩不写转录，恢复退回压缩前历史 | 新增 `compaction` 转录记录（顺序/合成消息/丢弃 id），恢复时重放 | 同上：`messagesFromRecords` 重放得到压缩后顺序 |
| M1 | 凭据 `键: 值` 规则误拒正常笔记（8 例） | 仅拒绝具密钥形状的值，保留特征模式 | `sp005-review-storage.test.mjs` 允许/拒绝两组 |
| M2 | 损坏检测不可达，PM-06 声称的 `.bak` 未发生 | 无条目但有内容判损坏，保留原件 + `.bak` + 拒绝写入 | 同上：真实垃圾文件 → corrupt + `.bak` + 原文件不变 |
| M3 | `/context` 预留额与阈值和会话不一致 | 两侧共用 `normalizeBudget`/`triggerTokens` | `sp005-review-compaction.test.mjs` |
| M4 | 熔断计数跨回合累积；换键序可绕过 | 每回合重置；签名按稳定 JSON 序列化 | `sp005-review-breaker.test.mjs` 两条 |
| M5 | 恢复权限不升权：降档函数生产路径从未调用 | `/resume` 应用记录模式，绝不升权 | `sp005-review-compaction.test.mjs` SR-10 |
| M6 | `/memory` 缺分隔符把整串当标题 | 显式检查冒号缺失并给出用法 | `sp005-review-commands.test.mjs` |
| M7 | 原子写改名后才收紧权限；`writeJsonAtomic` 从不收紧 | 临时文件先 0600 + ACL 再改名 | `sp005-review-storage.test.mjs`（POSIX 断言 0600）；本机 Windows 实测 `writeJsonAtomic` 产物 DACL 仅当前用户（`…\Leo.Li:(F)`），无继承的 SYSTEM/Administrators/Users |

### 9.2 未修复的限制

- 预算过紧、历史已裁到只剩当前消息时，强制压缩无法再生效：此时明确报 `context_overflow` 并终止回合，不假装重试（FR-08 的实际边界）。
- 恢复后的 `needs_review` 是提示而不是闸门：存储层不重放，但模型若在后续回合自行重发同一操作，当前版本不会二次拦截。

### 9.3 证据口径修正

本报告 §2 与 `long-session-reliability/test-report.md` 中 PM-06、SR-10 两条此前的 PASS 依据不足：PM-06 的「损坏文件」其实是可正常解析的条目，且从未断言 `.bak`；SR-10 只测了生产路径不会调用的函数。两条现已由 0.5.1 的真实用例覆盖（见 9.1），原表格保留但以本节为准。

## 10. 0.5.1 正式发布回执（2026-11-20）

- [GitHub Actions #21](https://github.com/Limingyang01/budingx-next/actions/runs/44658158215) 基于源码 `9903776`，Ubuntu、Windows、OIDC 发布和发布后的安装验证均通过。npm 官方源确认版本 0.5.1 已公开且 `latest` 指向 0.5.1。
- 官方包独立安装后的 CLI 版本为 0.5.1，本地 HTTP 流式冒烟通过（1 次 fixture 请求，退出码 0）。已核验 53 个包的 registry 签名和 7 个包的 attestations。公开 tarball 含 98 个文件，实测 SHA-512 与 npm 元数据、安装锁和 provenance subject 摘要一致，provenance 指向同一源码 SHA、`master` 分支、工作流 `.github/workflows/publish-tui.yml` 与运行 #21。
- Actions 原始回执需要登录才能下载，未取得；台账按公开运行结果、已验签的 npm provenance 和官方包独立安装结果登记（`ciArtifactDownloaded: false`）。证据来源已登记于[发布台账](../../release-ledger.json)和[发行说明](../../release-notes/v0.5.1.md)。真实模型长会话压缩和 TUI 观感的恢复条件见 §4。

## 11. 0.5.2 长会话渲染优化与上下文可见性（2026-11-20）

用户报告「长会话经常卡顿卡死」。在真实渲染管线（真实 Ink + 真实 Session + 伪终端流）上复现并修复，三条根因与实测见 [当前状态 §SP005 长会话渲染优化](../../docs/current-status.md)。

- 根因 1：流式片段每帧全文重排（20k 字符 20 片段 273ms）→ 改为累积原文 + 增量解析。
- 根因 2：`staticLines`/`liveLines` 死字段每帧复制 → 删除。
- 根因 3：虚拟列表预渲染过小、无单帧挂载上限、resize 清空高度缓存 → 按参考机制重写（80 行预渲染、25 条/帧、300 条上限、缓存缩放）。
- 另修：流式片段按帧合并；共享分词器；测量仅在高度变化时重排。
- 实测：600 条历史同一场景 1806ms → 997ms；2000 条历史 + 24k 字符流式最差帧间隔 51ms，无秒级冻结帧。

同版新增：状态栏常驻上下文用量（真实 usage 优先、标注估算、可配窗口百分比与告警色）与推理强度 `⊙ … · /effort`；新增 `/effort` 命令；`/context` 在未配置预算时也报已用 token；交互式 TUI 默认开启会话持久化，使四个 SP005 命令真正可用。

验证：新增 `long-session-render.test.mjs`（6 项）、`sp0052-status.test.mjs`（2 项）、`sp0052-long-session.test.mjs`（压测）、`sp0052-e2e.test.mjs`（真实 CLI 子进程 + 本地流式服务，断言内容完整、effort 下发、退出码 0）。

## 12. 0.5.2 正式发布回执（2026-11-20）

- [GitHub Actions #22](https://github.com/Limingyang01/budingx-next/actions/runs/44666668683) 基于源码 `1e7f33c`，Ubuntu、Windows、OIDC 发布与发布后安装验证均通过。npm 官方源确认 0.5.2 已公开且 `latest=0.5.2`。
- 官方 tarball 195872 字节 / 98 个文件，实测 SHA-512 与 npm 元数据、provenance subject 完全一致（`sha512-ScKp…YKA==`）。安装后 CLI 返回 0.5.2；本地 HTTP 流式冒烟通过（1 次请求、20 个片段全部到达、`reasoning_effort=high` 按配置下发、退出码 0）。provenance 指向 `master`、`.github/workflows/publish-tui.yml` 与运行 #22。
- 发布后约 1 分钟内部分 CDN 边缘对不带查询串的 tarball URL 返回 404（元数据已先可见），加缓存绕过参数后稳定 200，约 3 分钟后恢复正常；最终制品 integrity 与 npm 记录一致，属传播延迟而非制品缺陷。
- Actions 原始回执需登录下载，未取得；台账按公开运行结果、已验签的 npm provenance 与官方制品独立安装结果登记（`ciArtifactDownloaded: false`）。

## 13. 0.5.3 工具与工作区会话回归（2026-11-20）

- **会话隔离 PASS**。两个不同路径使用相同目录名。切到新目录后列表不显示旧会话，直接恢复会被拒绝，随后发送「继续」的 HTTP 请求没有旧工程的消息。回原目录可以恢复并继续。归属未知的旧转录被保留。
- **追问与计划 PASS**。伪 TTY 覆盖勾选、汇总、返回修改、其他答案、漏答、备注和取消。计划用本地 OpenAI 兼容端点验证专用草稿、一次审批、编辑后的批准正文以及原工具调用 ID。
- **文件与 Shell PASS**。工作区测试 108 项通过。Windows Shell 与运行时聚焦测试 91 项通过，Ubuntu WSL2 的 Shell 定向测试 3 项通过。后台执行使用测试后端，生产隔离未验证。
- **搜索协议 PASS**。本地模型端点和搜索响应 fixture 覆盖无密钥 Bing、有密钥 Tavily、审批、域名过滤、取消、来源输出和原工具调用 ID。Bing 区域跳转只允许一次至官方 `cn.bing.com/search`，拒绝第三方跳转及非 RSS 响应。编译后的工具对 Bing 公共端点执行一次真实无密钥查询，返回 5 条来源。
- **思考强度与状态栏 PASS**。真实 Ink 帧验证 `/effort` 菜单、取消、中文低中高和紧邻的 `84k/256k tokens (32.8%)`。本地模型端点确认菜单选高与命令切低之后，下一次请求分别收到 `high` 和 `low`。
- **参考实现抽样 PASS**。用 TypeScript AST 提取文件工具、Shell、计划、追问、搜索和会话恢复所涉文件中 162 个与改动相交的代码块，每块至少 40 个非注释叶令牌。与参考实现的 1,413 个块比较原令牌和规范化语法形态，均无整块命中。抽样记录只覆盖比较范围。
- **发布预演 PASS**。Windows 隔离源码副本执行锁定安装和 `CI=true npm run publish -- --dry-run --expected-version 0.5.3 --tag latest`。工具测试首轮发现依赖外层 Git 仓库，改为测试自建仓库后重跑通过。包含思考强度与 Bing 的最终预演运行 760 项产品测试，759 通过、1 项仅 POSIX 生效而跳过。全套 884 项，883 通过、0 失败。制品有 99 个文件，SHA-512 与回执一致，隔离安装返回 `0.5.3`，本地 HTTP 流式冒烟通过。回执位于 `artifacts/release/0.5.3-1795147005980/report.json`。`spec:check`、`skills:check` 和 `git diff --check` 均通过。仓库未配置专用 formatter。

### 未验证项与恢复条件

- **UNVERIFIED**。取得实际 Tavily 密钥并获准发起查询后验证 live 搜索。原生终端交互在实际 Windows Terminal 和目标平台复测。
- **UNVERIFIED**。普通 Bash 和 PowerShell 仍需生产执行隔离后端及目标平台的真实隔离验证。图片内容、PDF 页、Notebook 图像和完整 ripgrep 方言仍有差距。
## 14. 0.5.3 正式发布回执（2026-11-20）

- **PASS**。[GitHub Actions #23](https://github.com/Limingyang01/budingx-next/actions/runs/44682798887) 以 `16f5e0c9b9c2cff9a427863bda0071427419df66` 为源码，Windows、Ubuntu 和 OIDC 发布任务均成功。npm 官方源确认 `latest=0.5.3`，发布身份为 GitHub Trusted Publisher。
- **PASS**。公开 tarball 的 SHA-512 与 registry integrity 和 provenance subject 一致。独立安装后的 npm 命令入口返回 0.5.3，本地 HTTP 流式冒烟通过 1 次请求。签名审计验证 53 个包的 registry 签名和 7 个包的 attestations。
- **回执访问**。GitHub 原始 artifact 下载返回 HTTP 401。台账按公开运行、已验证的 npm provenance 与独立安装结果登记。见 [发行说明](../../release-notes/v0.5.3.md)和 [发布台账](../../release-ledger.json)。

## 13. 0.5.4 联网搜索审批修复（2026-11-20）

用户报告完全权限档位下 `WebSearch` 仍弹审批、审批卡只有 1/3 选项。三处修复与证据：

| 项 | 修复 | 证据 |
| --- | --- | --- |
| 出网无条件强制审批 | 改为 `network` 能力，按档位判定 | `network-policy.test.mjs`：完全权限 allow、工作区修改 ask 且可记住、仅可查看 ask |
| `approved` 仅审批通道置真 | 调用被授权执行即置真（含档位自动放行） | `sp0054-network-approval.test.mjs`：完全权限零审批完成、工作区修改恰一次审批 |
| 审批卡 1/3 跳号 | 不可记住时显示 1/2，按键一致 | `sp0054-approval-options.test.mjs`：`.git` 硬审批显示 `1 允许一次 · 2 拒绝`，按 2 进入拒绝 |

既有 `web-search.test.mjs`（含「出网前需授权」断言）保持通过；删除类工具硬性审批不受影响。全量单测 767 / 766 通过 / 0 失败 / 1 跳过。

## 14. 0.5.4 命令执行与长会话显示修复（2026-11-20）

用户报告：Bash 用不了、提问卡回答后不消失、重试提示堆叠占位、时长只显示总秒数、流式措辞。逐项修复与证据：

| 项 | 修复 | 证据 |
| --- | --- | --- |
| Bash 不可用 | 对齐参考实现：权限审批为安全控制、沙箱可选；无后端时宿主信任执行 | `sandbox-policy.test.mjs` 宿主信任 4 例；`runtime.test.mjs` 只读免审/执行需审批真实运行；`plan/host.test.mjs` 命令真实启动 |
| 追问卡不收起 | tool_result/turn_finalized 收起 question 卡 | `sp0054-display.test.mjs`、`sp004-cards.test.mjs` T15-8 |
| 重试提示堆叠/常驻 | 同代码只留最新、回合结束收起过程性提示 | `sp0054-display.test.mjs` |
| 时长格式 | formatDuration 小时/分钟/秒 | `sp0054-display.test.mjs` |
| 流式措辞 | 请求/流式统一「正在思考…」 | `sp0054-status-wording.test.mjs`（真实 Ink 帧） |

全量 `npm test` 通过（unit 778 项 / 0 失败 / 1 跳过，跳过项仅 POSIX 生效）；spec/skills/模块边界通过。命令执行默认无 OS 隔离的安全边界已在 PRODUCT.md 与发行说明明确标注。

## 15. 0.5.4 显示压缩、模式轮播与 Git 白名单（2026-11-20）

| 项 | 修复 | 证据 |
| --- | --- | --- |
| 底部占据行数过多 | 模式/上下文/推理强度/快捷键合并为一行；删除单独「可获准的写入免审批」行与独立上下文行 | `sp0054-compact-footer.test.mjs` |
| Shift+Tab 无法回到仅可查看 | 恢复三档完整轮播；徽标「写入锁定」更名「仅可查看」 | `policy.test.mjs`、`approval-tiers.test.mjs`、`sp0054-git-and-modes.test.mjs` |
| 全自动下 Git 命令被「不在只读白名单」拒绝 | 移除工具层白名单硬拦，Git 命令与其它命令一致按权限档位审批 | `tools.test.mjs` T5-5、`sp0054-git-and-modes.test.mjs` |

全量 `npm test` 通过（782 项 / 0 失败 / 1 跳过）。

## 16. 0.5.4 长会话崩溃、Langfuse、上下文占比与命令面（2026-11-20）

| 项 | 修复 | 证据 |
| --- | --- | --- |
| 长会话崩溃 Maximum update depth exceeded | Ink useBoxMetrics 对内容盒的无依赖 effect 与虚拟列表间距互相驱动形成同步更新链；改为「布局后手动测高 + 宏任务合并 setState」，逐条消息只测高且高度不变不上报 | stress-loop.test.mjs（80 回合 + 两次 resize）、screen-e2e.test.mjs 滚动用例 |
| Langfuse 启动告警暴露给用户 | 观测状态只进内部 diagnostics，默认不启用、不打印；仅开发环境显式开启 | sp0054-langfuse-silent.test.mjs |
| 上下文只显示 token 数 | 改为「饼图字形 + 百分比」，只用 Provider 真实 inputTokens，不使用估算；窗口缺省 200k | sp0052-status.test.mjs、sp0052-long-session.test.mjs |
| /config /model 出现在命令面 | 从 /help 与 / 补全移除，开关分支移除，模型切换统一 /models | commands.test.mjs、commands-zh.test.mjs、app.test.mjs、cli.test.mjs |
| /rules 只是纯文本命令 | 参照 /models 增加交互管理面板（↑↓/a/d/Esc），管道模式保留列表 | sp0054-rules-manager.test.mjs |
