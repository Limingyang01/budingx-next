# 当前状态

截至 2026-11-21，**npm `latest` 为 0.7.0**（Agent 质量与扩展，SP007）。SP007 **已完成实施与验收，于 2026-11-21 经交叉验证门禁 GREEN 后合入 master（合并提交 `ee9118e`），并由 [GitHub Actions 运行 #27](https://github.com/Limingyang01/budingx-next/actions/runs/44921288352)（源码 `a8628b5`）完成 Windows、Linux 验证与 OIDC 发布**。本版补齐子代理执行、多模态上下文（图片附件）、第二供应商协议、运行时诊断面板与评估回归，并修复图片粘贴相关用户可见缺陷。0.6.0（TUI 对齐与扩展，SP006）此前已完成实施与验收并发布，见 [0.6.0 发行说明](../release-notes/v0.6.0.md)。

[运行 #25–#27](https://github.com/Limingyang01/budingx-next/actions/runs/44921288352) 以源码 `a8628b5` 完成 Ubuntu、Windows 验证及 OIDC 发布 0.7.0。官方制品 SHA-512、来源证明（attestation）、签名与独立安装均已核对；CI 回执 artifact 需登录未取得，台账据此登记并标注证据缺口。见 [0.7.0 发行说明](../release-notes/v0.7.0.md)、[发布台账](../release-ledger.json)及 [SP007 验收报告](../SP/SP007/test-report.md)。可选本机 Langfuse 观测默认关闭。
## SP007 · Agent 质量与扩展（交付完成，0.7.0 已发布）

SP007 功能分支 `feature/SP007/agent-quality-and-extensions`（及用户反馈后的补丁分支 `feature/SP007/image-command`）已完成 19 个任务（含图片端到端补测与 `/image` 终端无关附件入口）并通过交叉验证门禁 GREEN；经用户 2026-11-21 授权（m02028）合入 master 并推送，源码 `a8628b5` 已由 [GitHub Actions 运行 #27](https://github.com/Limingyang01/budingx-next/actions/runs/44921288352) 完成 Windows、Linux 验证与 OIDC 发布，npm `latest` = 0.7.0。

### 已完成

- **子代理执行**：Agent/TaskOutput/TaskStop 工具、独立上下文、权限≤父、预算终止、通知注入、`/agents` 面板与向导、代理卡片与并行树、ctrl+b 后台化、`/tasks` Agents 分组
- **多模态上下文**：图片粘贴（alt+v）、PNG 降采样、路径附件、image-cache、能力前置拒绝、错误驱动降级、媒体上限
- **Anthropic 适配器**：SSE→ProviderEvent、system 顶层/x-api-key/anthropic-version、thinking 400 重试、错误分类
- **ToolSearch 延迟加载**：auto 阈值门控、计分权重、发现集 resume 重建、压缩快照
- **运行时诊断**：`/status` 三页签、`/stats` 热力图/streak/折线、`/doctor` 警告式分区、零网络断言
- **评估回归**：`scripts/eval/` 离线 runner（17 任务/4 盲测/18 种断言/预算帽/失败分类）、live.mjs opt-in
- **失败边界**：Web/hooks/MCP/headless/依赖纪律测试
- **真实模型验证**：MiniMax-M3.1-Flash 3 轮 × 3 任务全过（含 Langfuse 本地接收端监管轮）
- **PowerShell 兼容性修复**：所有 PowerShell 调用添加 -NonInteractive + windowsHide
- **图片端到端补测（用户反馈后）**：修复 4 个真实缺陷——中文紧贴图片路径导致整轮消息被阻塞、未超限的调色板/灰度/16-bit/隔行 PNG 被拒、剪贴板只有图片时 ctrl+v 无反应、图片读取失败吞掉输入正文；新增 `scripts/eval/live-image.mjs` 与 `src/tui/test/sp007-image-ui.test.mjs`，真实模型 6 种形态（路径/alt+v/ctrl+v/JPEG/多图/9000px 缩放）识图 PASS

### 验证结果

| 指标 | 结果 |
| --- | --- |
| 全量单元测试 | 1128 项 / 1127 通过 / 0 失败 / 1 跳过（POSIX 专属） |
| 模块边界检查 | PASS |
| 交叉验证门禁 | **GATE GREEN**（npm test + spec:check + skills:check + pack-smoke 全过） |
| 离线评估 | 17/17 通过 |
| 真实模型评估 | 3/3 × 3 轮通过；Langfuse 监管轮 3/3 |
| 真实模型识图 | 6 种形态全 PASS（MiniMax-M3.1-Flash） |
| Langfuse 离线测试 | 81/81 通过 |
| 制品 smoke | PASS |

### 待办

- Anthropic 真实端点凭据验证（需用户提供密钥）——当前 UNVERIFIED
- 团队协作、浏览器自动化、Computer Use、定时调度、多端宿主不在 SP007 范围（后续 SP 承接）



## SP008 · 多端架构入口与共享边界（已合入 master，0.8.0 已准备待发布）

SP008 功能分支 `feature/SP008/host-contract`（基线 master `a8628b5`）已完成 T1–T17：通用宿主契约（进程内/stdio/WS）、活动会话归属与崩溃接管、共享配置/历史并发安全、`budingx serve` 入口与轻量测试客户端。按用户 2026-11-22 授权（m02815）**已合入 master**（合并提交 `1d1ec9f`，同时清理误入仓库的 Windows 缓存二进制并加入 `.gitignore`），并按 minor 规则准备 0.8.0（`src/tui/package.json` = 0.8.0，台账 prepared）。维护者首次触发发布（run 45003613733）时 ubuntu-24.04 验证作业因一处**测试取样竞态**失败（`sp008-shared-history` 只读恢复用例，非产品缺陷），已修复（提交 `37a4cfd`）并在 ubuntu-24.04 + Node 24 复跑全量单测 **1242 项 / 1240 通过 / 0 失败 / 2 跳过**；修复后 master 门禁再次 GREEN，master 已推送远端（`37a4cfd`，远端 SHA 核对一致）。**实际 npm 发布由维护者对 master 重新触发发布工作流**，发布前 npm `latest` 仍为 0.7.0。

### 已完成

- **宿主契约**：版本化 hello/identity（`scope=local`）、NDJSON 请求/响应、稳定错误码、事件 seq、审批往返与 120s 超时 deny、`needsReview`/`warnings` 恢复视图
- **三种传输**：进程内、stdio（stdin EOF 关闭）、WebSocket（仅回环 + Bearer 令牌、RFC6455 帧、1 MiB 上限、ping/pong/close）
- **`budingx serve`**：`--transport stdio|ws`、`--session`、`--takeover`、`--token`/`BUDINGX_HOST_TOKEN`、`--host/--port`、`--home`；owner/observer 角色与 writer lock
- **共享数据**：`ConfigStore.update` 锁内重读-改-写、活锁超时 `BUDINGX_STORAGE_006`、陈旧锁清理；transcript 并发尾行不误判损坏；凭据继续按 `(id,host)` 作用域
- **归属与恢复**：第二进程 observer 只读、写请求 `HOST_SESSION_003`；活 owner 拒绝 takeover，SIGKILL 后显式 `--takeover`；接管不重放工具、标出需复核步骤
- **扩展装配（复测）**：`serve` owner 与交互入口一致装配 `~/.budingx/mcp.json` 与 `hooks.json`；MCP 工具经审批执行、hooks 阻断/拒绝/放行生效；observer 不启动扩展；关闭时回收 MCP 子进程
- **扩展矩阵**：hooks 八事件全覆盖、`updatedInput` 改写入参、`additionalContext` 注入模型上下文、hook `ask` 回到人工审批、多 MCP 服务器隔离、MCP 工具 `isError`、MCP 服务器崩溃、连接失败只告警 —— 全部经真实进程验证通过
- **测试加固（T17）**：WS 服务端帧级分支、HostClient 错误分支、协议校验文案、serve 参数/退出码、owner 打断活动回合、history.limit 截断、ws-client 连接失败路径全部补齐；修复 interrupt 空闲语义、WS 客户端首帧竞争、空端口静默接受三处缺陷；`test:unit` 纳入 transport 测试
- **发布链路修复**：首次发布在 ubuntu-24.04 因 `sp008-shared-history` 只读恢复用例的并发取样竞态失败（restore 经核实纯只读，竞态在测试取样窗口）；改为等半行落盘并进入暂停后再取样，Linux 复验全量单测 0 失败；仅改测试、制品内容不变（提交 `37a4cfd`）

### 验证结果

| 指标 | 结果 |
| --- | --- |
| SP008 定向套件 | 113/113 通过，0 失败，0 跳过 |
| 全量回归 | 1241 项 / 1240 通过 / 0 失败 / 1 跳过（既有 POSIX 权限用例；T17 起含 transport 测试） |
| 多轮端到端 | 3 轮 × 23 例全部通过；最终 HEAD 再复跑 3 轮 × 23 例全部通过；扩展矩阵再 3 轮 × 11 例全部通过；T17 加固再 3 轮 × 42 例全部通过（真实 stdio/WS 进程、并发、崩溃恢复、自模拟 MCP/hooks） |
| 模块边界 | PASS（`src/host` 禁 import tui/UI） |
| AST 复核 | PASS（17/17 文件映射，命中 0） |
| 交叉验证门禁 | **GATE GREEN**（2026-11-22，`npm test`/`spec:check`/`skills:check`/`pack-smoke` 全通过；扩展复测后 HEAD `abbdcb1` 再次 GREEN；扩展矩阵后 HEAD `9f7f00b` 再次 GREEN；T17 加固后 HEAD `c47e224` 再次 GREEN；最终 HEAD `60d1688` 再次 GREEN，25 commits / 56 files） |

### 已知限制

- 同机共享不等于跨设备同步；observer 跨进程只能读持久化历史，无实时事件、无事件重放
- WS 仅 `ws://` 回环，不支持 `wss://`/TLS/公网监听；令牌必须显式提供
- `serve` 已装配 MCP/hooks，但无 `/mcp`、`/hooks` 交互面板；扩展配置启动时读取一次，修改后需重启；MCP 连接失败只告警不阻断启动
- SIGTERM 优雅退出的 OS 信号投递在 Windows 无法验证（强制终止后由 `--takeover` 恢复）；恢复条件见 [SP008 验收报告](../SP/SP008/test-report.md)

### 待办

- 维护者对 master（`37a4cfd`）**重新触发** [Publish TUI to npm](github-actions-npm.md) 发布 0.8.0（首次尝试因 Linux 测试竞态失败，已修复），并按 [Actions 发布回执](versioning.md#actions-发布回执) 导入 registry 回执、把台账置为 published
- 如需补齐 SIGTERM 证据，在 Linux/macOS 运行 stdio serve 后发 SIGTERM

## 已有

- 用户创建的 Git 仓库，主线 master；首个提交 f3c4675 已推送，GitHub API 已核对远端 SHA。
- 项目协作约定、产品目标、独立开发边界和架构方向草案。
- 6 个适配本仓的项目流程技能（含版本准备），以及 MIT 许可的 15 个 Superpowers 开发技能；第三方开发技能单独登记。
- 面向 `.agents`、`.claude`、`.budingx` 的发现入口和维护脚本。
- 用于维护的私有 package.json；其 `0.0.0` 不是产品发布版本。
- TUI 0.3.6 为历史发布版本，覆盖 SP002／SP003 的长会话滚动、工具状态、转录搜索与审批记忆。详见 [0.3.6 发行说明](../release-notes/v0.3.6.md)。
- 实际 Node/TypeScript 构建、测试、版本准备与发布编排，实际 tarball 隔离安装 smoke 已通过。
- **SP002 新增**：`src/core`（事件契约、会话/回合状态机、工具回合、输入队列、消息规范化）、`src/provider`（OpenAI 兼容流解析、tool_calls 碎片、错误分类、有界重试、取消、连通探测）、`src/storage`（`~/.budingx` 配置与凭据仓库、模型档案 CRUD、三源合并）、`src/tui` 的 Ink 8 对话界面（渲染 reducer、多行编辑器、审批卡、双中断与排队）。
- **SP003 新增（已合入 master `598fb89`）**：`src/workspace`（路径边界与忽略规则、Read/Write/Edit/Glob/Grep、行级 diff、检查点撤销、三模式策略与规则、`@` 上下文）、`src/core` 的权限端口与策略判定接线、`src/storage/permissions.ts`（`~/.budingx/permissions.json`）、TUI 侧审批三档与拒绝反馈、模式徽标与 Shift+Tab 轮播、diff 两级对话框与多源切换、`@`/`/` 统一补全。
- **SP005 实施产物（已合入 master `293a337`，随 0.5.0 发布；0.5.1 复审修复见下文专节）**：`src/core/context-budget.ts`（预算核算、确定性压缩与保留项）、`transcript.ts`/`session-persistence.ts`（转录端口与失败语义）、`src/storage/{private-file,session-transcript,session-store,project-memory}.ts`（`~/.budingx/sessions`、`~/.budingx/memory` 原子持久化与写入锁）、两级工具空转熔断，以及 `/sessions`、`/resume`、`/context`、`/memory` 四个命令；42 条 AC 与证据见 [SP005 验收报告](../SP/SP005/test-report.md) 与[逐条细节](../SP/SP005/long-session-reliability/test-report.md)。
- **SP006 实施产物（已合入 master，合并提交 `601ac7e`，基线 `dc94731`）**：四区骨架/帧缓冲差分/冻结缓存/8 上下文键位/状态栏外部命令；项目指令分层发现、技能两源、stdio MCP、八事件 hooks、WebFetch 安全抓取、无头 stream-json；命令注册表三型与 /init /btw /worktree /tasks /mcp /skills /export；用户检查反馈修复四处（命令卡片完成后不消失且单次调用只占一行、`/resume` 恢复后历史回到消息区可见并切换会话身份、恢复排版碎片列改为单条消息、输入框续问建议改由模型按上下文生成），以及真实模型端到端测试暴露的三处修复（建议允许自然追问形态、退化终端多行命令输出按正文块显示、`/undo` 无可撤销改动时按界面语言提示）；0.6.0 制品 smoke 与 AST 复核 PASS。69 条 AC 全部 PASS，全量单测 927 项 / 926 通过 / 0 失败 / 0 取消 / 1 跳过；真实模型端到端累计 57 项通过（无头事件流、交互 TUI 首屏与流式 18 项、全命令面 25 项、智能体关键流程 14 项）。证据见 [SP006 验收报告](../SP/SP006/test-report.md) 与[迭代汇总](../SP/SP006/requirements-summary.md)。
- **SP004 实施产物（随 0.4.0 发布）**：`SP/SP004/` 迭代汇总与四份需求（command-execution / coding-task-loop / git-worktree-safety / task-planning，共 48 条 AC）、[设计 v1.3](../SP/SP004/design/design.zh.md)、[计划 v1.3](../SP/SP004/design/plan.zh.md)（T1–T24 全部完成事实）与[验收报告](../SP/SP004/test-report.md)（48 条 AC 逐条证据、45 PASS + 4 项环境相关 UNVERIFIED）。已新增 `src/exec`（命令执行/后台任务/沙箱声明层）、`src/git`（Git 状态/worktree/受控提交）、`src/plan`（计划、持久化与审批）；`core` 只新增纯端口与状态机。发布范围及后续验证见 [SP004 迭代汇总](../SP/SP004/requirements-summary.md)。

## 未实现

**SP004 已发布**。0.5.4 起普通命令按权限档位「宿主信任执行」（对齐参考实现：权限审批为安全控制、沙箱可选），默认无 OS 级隔离；配置已验收隔离后端时在隔离中执行。完成证据闸门和 worktree 工具面尚未接入生产 runtime。仍全部未实现的有：Computer Use、团队、浏览器和调度；Desktop、VS Code、远程/H5 和 IM 已移出当前 SP。SP005 的转录持久化与恢复已完成实施、代码层验收与门禁 GREEN，并已合入 master（`293a337`）与推送；真实模型端到端两场景经本地 Langfuse 4.78.0 回查 PASS（tool-success / tool-error + 熔断停机）。0.5.0 起的 SP005 变更均已发布至 0.5.3；真实模型的长会话压缩场景仍为 UNVERIFIED。

首发使用 Node.js >=22.18、TypeScript 和 Node test runner，当前真实命令见 package.json 与 [开发指南](development.md)。禁止引入 Bun；不能把旧项目版本 0.5.0、旧测试成绩或 Git 发布状态当作本仓事实。

用户 2026-11-16 确认参考实现定位：本仓设计与主要核心逻辑必须严格参考本地 `budingWorkerSpace` 参考项目（文档不写死绝对路径，位置以用户环境为准），重点参考其 TUI 命令设计、Agent 主循环与核心工具；设计文档、计划文档和真实开发全程对照该参考，不允许脱离参考开发，允许优化但核心逻辑不得背离、使用体验不得下降；按「读机制、不抄代码」独立编写实现并对齐效果。该参考仓无 LICENSE 声明，本仓制品保持自有 MIT 独立可发布、不嵌入参考代码；细则见 [独立实现与复用边界](independent-development.md)。

用户已授权简易 TUI 验证后发布 npm，并确认 MIT；0.1.0、0.1.1 是历史已发布版本；0.2.0、0.3.0、0.3.1、0.3.2、0.3.4、0.3.5、0.3.6 和 0.4.0 为历史已发布版本，SP005 的 0.5.0–0.5.3 均已发布。发布状态及 integrity 见[发布台账](../release-ledger.json)。没有读取旧用户配置或凭据。用户数据统一通过当前用户 home 解析为 ~/.budingx，禁止使用 ~/.claude。

## SP002 交付现状（等待验收）

- 设计 [v0.3 approved](../SP/SP002/design/design.zh.md)（用户 2026-11-16「我批准了设计」），批准覆盖计划/实现/测试/交付与各阶段本地提交，**不含**验收、推送、npm 发布与远端操作。
- 实施计划 [plan.zh.md](../SP/SP002/design/plan.zh.md)；逐条 AC 证据见 [验证报告](../SP/SP002/test-report.md)。
- 本地门禁：技能 9、规格 7、产品单元 118、发布 16，合计 150 项全部通过；模块边界检查通过；`npm pack` 33 文件、仓库外隔离安装与真实 HTTP 流式请求冒烟通过。
- 2026-11-17 交付后补充：首屏对照参考仓 LogoV2 布局机制独立重绘（紫 `#af87ff` 圆角双栏欢迎框、<70 列紧凑、配置后精简横幅、老终端纯 ASCII 兜底），交互面文案中文化（ASCII 兜底与管道机器面保持英文）；证据见 [SP002 验证报告 §10–§11](../SP/SP002/test-report.md)。
- 2026-11-17 启动**剩余 SP 参考复刻全面排查**（用户指示）：[排查文档 r1 draft](reference-tui-replication-audit.md) 已建立 CAP→SP 基线映射、12 条独立实现周旋总则与 4 项 manifest v2 缺口提议；4 路只读盘点回填中，待用户审阅后并入路线图 r5。不授权开发。
- 2026-11-17 交付后复验修正一处真实缺陷：队列自动起新回合的定时器曾被 `unref()`，导致排队输入在空闲时不自动起新回合（SL-05）。已修复并复测，详见 [SP002 验证报告 §7](../SP/SP002/test-report.md)。
- 面向使用者的产品事实入口为根目录 [产品说明书](../PRODUCT.md)：产品版本号、按迭代归类的功能表、使用说明、已知限制与版本历史；产品变更须同步更新它。
- **验证边界**：PS-08 已在一个用户授权服务验证五项；其他型号/服务未测。Windows Terminal/ConHost 的真实 IME、鼠标及观感仍为 UNVERIFIED，恢复条件为执行报告 §5 的人工清单。
- 产品版本 **0.2.0 已发布**，当时 npm latest=0.2.0。维护者触发运行 #7 后完成 Windows/Linux 验证和 OIDC 上传；公开 provenance 与官方安装/签名均核验通过，见 [发行说明](../release-notes/v0.2.0.md)。


## 2026-11-18 TUI 还原度对齐（规划变更，非产品代码）

用户指示：已做 3 个 SP，功能还原不理想，要针对旧仓 buding-worker-space 还原功能——除部分特色化功能调整外，**能力要相同，TUI 的布局、UI、交互都要还原**。

**结论：SP 驱动开发的路线、编号、依赖与各轮出口门槛均不变**；还原度作为 SP001–SP016 的**横向约束**落地，本次只改规划与文档，不含产品代码。

本次变更：

- 新增 [TUI 还原度差距基线](tui-fidelity-gap-baseline.md)：只读盘点出参考仓约 16.7 万行 / 2360 个源文件 vs 本仓约 9 千行 / 130 个源文件的规模差（约 18×），判定差距在**缺一层结构**而非缺功能点；给出分层差距、四条落地机制（渲染层受控扩展 / 键位系统自写 / 命令注册表三型契约 / 工具与主循环自写）、P0–P3 优先级与还原度可比口径。
- [路线图](iteration-plan.md) 升 **r9**：新增「TUI 还原度要求」节；SP006 加 **P0 骨架**出口、SP015 加 **P1 命令与工具面**出口、SP016 加**覆盖率公布**出口；明确 P0 未过不进入 P1。
- [能力矩阵](agent-capability-matrix.md)：原「TUI 交互」行拆为「TUI 交互（可用性）」与新增「TUI 还原度（结构等价）」两行——**功能 smoke 通过不等于还原度达标**，二者不可互相顶替。
- [能力清单 v1.4](../SP/SP001/capability-baseline/capability-manifest.md)：新增 6 个 CAP ID（必交 +2：CAP-L1-30 消息折叠汇总、CAP-L4-26 结构还原度基线与覆盖率判定；建议 +4：CAP-L1-28 设置面板、CAP-L1-29 转录模式、CAP-L4-24 无头审批桥、CAP-L4-25 OSC52 复制），**不改 v1 已发布行语义**；覆盖度分母 47 → **49**。
- SP004 文档全套对齐（需求汇总 / 设计 v1.2 §9.7 / 计划 v1.2 / 四份需求 / 四份 STATUS）：明确本轮在还原度上只负责 **L3 能力面与卡片表现**，卡片须随能力同步交付；**不得预支 SP006 P0**（不改四区骨架、不在 src/tui/render 引入虚拟列表/冻结缓存/帧缓冲差分/上下文键位）；权限模式仍三档、不复制参考仓源码。

未变动的边界：权限模式固定三档（不还原参考仓七模式）；SP001 决定 3「读机制、不抄代码」；O5=B 效果口径（自有测量 + 能力清单覆盖度，禁用「已对齐/同等效果」措辞）；Vim / 鼠标选区 / 备用屏为可选预算项，不进 P0/P1 门槛。

本次变更**不授权任何开发**；SP004 实施已于 2026-11-18 获用户放行。

## SP005 复审修复合入回执（2026-11-20）

源/目标固定：`feature/SP005/fix-0.5.1`（HEAD `16f445b`）→ `master`（原 `0fe6e3c`），merge-base `0fe6e3c`，`--no-ff` 合并提交 `5ff99b5`，ancestry 证明通过。前置门禁 `npm run merge:gate` GREEN（`artifacts/merge-gate/feature-SP005-fix-0.5.1-2026-11-20T01-54-57-677Z.md`：outgoing 3 提交 29 文件、禁带路径违规 0、报告 FAIL 行 0；`npm test`、`spec:check`、`skills:check`、`pack-smoke` 退出码均为 0）。合入后复验：`npm run build` 无错误；SP005 相关套件 41 项 40 通过 / 0 失败 / 1 跳过（仅 POSIX 生效的文件权限断言）；`spec:check` 与 `skills:check` 通过。推送：`origin/master` `0fe6e3c..5ff99b5`、`origin/feature/SP005/fix-0.5.1` 新分支；`git ls-remote` 与本地一致。未执行：打 tag、npm 发布（由维护者在 Actions 手动触发）、分支删除。

0.5.1 已通过 OIDC 发布，回执见 [0.5.1 发行说明](../release-notes/v0.5.1.md) 与 §10。


## SP005 长会话优化（0.5.2）合入回执（2026-11-20）

源/目标固定：`feature/SP005/fix-0.5.2`（HEAD `dabbafa`）→ `master`（原 `8ca8930`），`--no-ff` 合并提交 `7d21432`。前置门禁 `npm run merge:gate` GREEN（`artifacts/merge-gate/feature-SP005-fix-0.5.2-2026-11-20T03-06-12-062Z.md`：`npm test`、`spec:check`、`skills:check`、`pack-smoke` 退出码均为 0）。全量单测 706 项 / 705 通过 / 0 失败 / 1 跳过（跳过项仅 POSIX 生效）。推送：`origin/master` `8ca8930..7d21432`；首次推送因 GitHub 连接中断失败，重试后成功，`git ls-remote` 与本地一致。

0.5.2 已通过 OIDC 发布，发布时 npm `latest` 指向 0.5.2。发布回执见 [0.5.2 发行说明](../release-notes/v0.5.2.md)。

## SP005 0.5.4 命令执行与显示修复合入回执（2026-11-20）

源/目标：`feature/SP005/fix-0.5.4-exec-display`（HEAD `306f23e`）→ `master`（原 `36cadbc`），`--no-ff` 合并提交 `df43e34`。前置门禁 `npm run merge:gate` GREEN（`artifacts/merge-gate/feature-SP005-fix-0.5.4-exec-display-2026-11-20T06-46-18-293Z.md`：npm test / spec:check / skills:check / pack-smoke 退出码均 0）。全量单测 778 项 / 0 失败 / 1 跳过。0.5.4 仍为 prepared（含联网搜索审批 + 命令执行 + 显示修复），待维护者触发发布。


## SP005 联网搜索审批修复（0.5.4）合入回执（2026-11-20）

源/目标：`feature/SP005/fix-0.5.4`（HEAD `5903cfb`）→ `master`（原 `eed5c80`），`--no-ff` 合并提交 `19b692b`。前置门禁 `npm run merge:gate` GREEN（`artifacts/merge-gate/feature-SP005-fix-0.5.4-2026-11-20T06-04-23-233Z.md`：npm test / spec:check / skills:check / pack-smoke 退出码均 0）。全量单测 767 项 / 766 通过 / 0 失败 / 1 跳过。推送 `origin/master` `eed5c80..19b692b`，`git ls-remote` 与本地一致。0.5.4 已准备（台账 prepared），待维护者触发发布。

## SP005 长会话渲染优化（0.5.2，2026-11-20）

用户报告「长会话经常卡顿卡死」。定位与修复如下，均以真实渲染管线（真实 Ink + 真实 Session + 伪终端流）测量。

### 根因（三条，全部实测）

1. **流式输出每帧全文重排（平方级）**：`text_delta` 每次都把整段回答重新分词折行。20k 字符时 20 个片段耗时 **273ms**；长回答越长越慢。
2. **无人消费的中间数据每帧复制**：`staticLines`/`liveLines` 在渲染层早已没有消费者，但 reducer 仍逐片段复制，长会话下纯属浪费。
3. **虚拟列表参数过于保守**：上下预渲染仅 10 行、无单帧挂载上限，滚动到新区域时会一次性挂载大量消息；宽度变化时高度缓存被整体清空，导致整屏重测量。

参考实现（本机 `budingWorkerSpace`）的对应机制：`OVERSCAN_ROWS = 80`、`MAX_MOUNTED_ITEMS = 300`、`SLIDE_STEP = 25`、高度缓存跨 resize 按比例缩放、滚动量化避免每次滚轮都触发完整提交。本版按其机制独立重写，未搬运源码。

### 修复

- 流式增量只累积原文；渲染按「已完成段落 + 末尾段落」增量解析 markdown，已完成段落的 token 复用；流式消息对象用 `useMemo` 保持身份，让记忆化与缓存真正生效。
- 删除 `staticLines`/`liveLines` 两个死字段及其逐帧复制。
- 虚拟列表：预渲染 80 行、单帧新增上限 25 条、总挂载上限 300 条、高度缓存跨 resize 按比例缩放。
- 流式片段按帧合并（16ms），非文本事件先结算缓冲，顺序不变。
- 共享 `Intl.Segmenter`；测量回调只在高度真正变化时才触发重排。

### 实测（修复前 → 修复后）

| 场景 | 0.5.1 | 0.5.2 |
| --- | --- | --- |
| 600 条历史 + 60 片段 × 400 字符 | 1806ms | 997ms |
| 2000 条历史 + 同场景 | 1837ms | ~1000ms |
| 2000 条历史 + 24k 字符流式，最差帧间隔 | 未测（长回答可达秒级） | **51ms** |
| reducer 处理 20k liveText 的 20 个片段 | 273ms | 0ms |

长会话规模（300 → 2000 条）对流式耗时不再有可见影响；失败帧（>1s）为 0。

### 同版新增可见性

- 状态栏常驻上下文用量（优先取模型真实 usage，缺失标注「估算」；配置 `BUDINGX_CONTEXT_WINDOW` 后显示百分比，80% 变黄、95% 变红）。
- 状态栏常驻推理强度 `⊙ low|medium|high · /effort`，并新增 `/effort` 命令；未显式设置时不下发 `reasoning_effort`，服务端拒绝时自动退让后重试。
- 交互式 TUI 默认开启会话持久化，使 `/sessions` `/resume` `/context` `/memory` 真正可用（此前运行时未开启，命令无数据源）。

## SP005 复审修复（0.5.1，2026-11-20）

0.5.0 发布后对 SP005 代码做了独立复审（4 路并行评审 + 对每条关键结论的独立复现），发现并修复了一批缺陷。修复分支 `feature/SP005/fix-0.5.1` 基于 0.5.0 发布提交之上的 master 最新提交，版本 **0.5.1 已发布**（[发行说明](../release-notes/v0.5.1.md)，[运行 #21](https://github.com/Limingyang01/budingx-next/actions/runs/44658158215)，源码 `9903776`），npm `latest` 已核对。

已修复（每条都有新增回归用例）：

- **写入锁互斥**：0.5.0 的「先检查再写」两步在并发下失效（实测 8 个进程有 6 个同时「持锁」）。改为 O_EXCL 排他创建；释放时核对 pid，只有创建者能删锁。
- **记忆文件往返**：正文里的 `## ` 行会截断条目并伪造新条目；标题换行可注入条目。改为正文结构行转义 + 标题压成单行。
- **真实损坏检测与备份**：0.5.0 的 corrupt 分支不可达、"保留原件 + `.bak`" 实际未发生。现在无法解析出条目但存在内容的文件会保留原件、旁存 `.bak`、拒绝写入并报出原因。
- **凭据误判**：`password: none`、`token: not configured` 等正常笔记此前被拒写；现在仅拒绝具真实密钥形状的值，`sk-`/`ghp_`/`AKIA`/`Bearer`/PEM 仍拒绝。
- **压缩预算**：保留项超预算时不再返回「压缩成功」并把超限请求下发；保留项按预算裁剪。
- **压缩持久化**：压缩结果写入可重放的转录记录（顺序、合成消息、被丢弃 id），`/resume` 恢复压缩后的历史，不再把压缩静默撤销。
- **预算阈值统一**：`/context` 与会话循环读同一处 `normalizeBudget`/`triggerTokens`，不再出现展示值与实际行为不一致。
- **熔断计数按回合重置**，工具签名按稳定 JSON 序列化，换键序不再能绕过。
- **恢复权限不升权**：`/resume` 应用会话记录的权限模式；此前降档函数在生产路径从未被调用。
- **`/memory` 缺分隔符**时给出用法提示，不再把整串当标题。
- **原子写先收紧权限再改名**；`writeJsonAtomic` 也不再留下继承 ACL 的文件。

未修复、已如实记录的限制：预算过紧且历史已裁到只剩当前消息时，强制压缩无法再生效，会明确报错终止；恢复后的「需核对」仍是提示，模型自行重发同一操作不会被二次拦截。两项均已写入产品说明书的限制表与 0.5.1 发行说明。

## 验证范围

历史迁移验证见 [迁移记录](migration/README.md)。0.2.0 延续 CLI 子进程及制品隔离安装验证；一个真实外部服务已有五项回执，见 SP002 报告 §16。历史版本的 UNVERIFIED 不作为当前结论。

当前有效规划为 [路线图 r8](iteration-plan.md)（SP001–SP016，TUI 单端及通用宿主契约），配套 [能力矩阵](agent-capability-matrix.md)、[高级功能计划](advanced-capabilities-plan.md)、[npm 发布方案](npm-release-plan.md)与 [版本规范](versioning.md)。bootstrap 是单独授权的简易首发。

SP001 **仅限规格且已验收**（用户 2026-11-16 验收通过，设计 v1 批准）：已产出 [能力基线、核心边界与发布范围](../SP/SP001/requirements-summary.md)（能力清单 v1 共 85 项、必交 53 项；核心边界与不变量；评测集规格与任务清单；发布范围与待决项）。本轮**不含产品代码**；47 条 AC 已逐条走查：46 PASS / 1 NOT_APPLICABLE。用户同日拍板：**O1=A** 完整 Agent 制品沿用 npm `budingx` 同名（发布轮须提供破坏性升级/迁移说明）；**O2=A** 只声明 Windows 已验证，macOS/Linux 于 SP009 后逐个验证；**O5=B** 不采集原产品效果基线——对照基线只做**静态盘点**、不运行原 Agent，效果对比永久采用「自有能力测量 + 能力清单覆盖度」口径，5 个百分点非劣门槛废除，「已对齐」措辞永久禁止。

## 发布方式调整

已新增 [publish-tui 工作流](../.github/workflows/publish-tui.yml)及[账号/操作指南](github-actions-npm.md)：Windows/Linux dry-run 门禁、master 手动触发、npm OIDC、只读 GitHub 内容权限、artifact 回执和 release:sync。0.1.0 首发与官方源隔离安装、Windows/Linux 的 GitHub 运行 #3 及 npm Trusted Publisher 均已核实；0.1.0 台账为 published。[运行 #6](https://github.com/Limingyang01/budingx-next/actions/runs/43826550093) 从 49857ad 完成 Windows/Linux 验证及 0.1.1 真实 OIDC 发布；npm 公开元数据标记 GitHub Trusted Publisher，provenance 对应同一源码与运行。官方包本机隔离安装、npm shim、HTTP 流式 smoke 及 registry signature/attestation 验证通过。GitHub environment 已限制 master 分支。首发不再要求在非个人电脑上绑定本机凭据。

SP002 的制品布局已变更（bin 由 `dist/cli.js` 改为 `dist/tui/cli.js`，新增四个编译模块），发布轮须按 O1=A 提供破坏性升级/迁移说明。

## 2026-11-17 e2e 与真实 Provider 补证据

真实 Provider 的 PS-08 四场景已通过，累计 9 次请求（用户授权最多 12 次、5 美元）；已修复 clear 未清可见内容及工具 schema 遗失导致真实 HTTP 400。证据见 [SP002 验证报告 §16](../SP/SP002/test-report.md#16-真实模型与扩展端到端验证2026-11-17)。较早段落中的 live UNVERIFIED 保留历史身份，以本节最新回执为准。真实 Windows Terminal/ConHost IME/观感仍 UNVERIFIED；实际账单未读取。真实 .env.e2e.local 被忽略且不提交。

本地集成更新：e2e 修复及验证提交 `e06ddaf` 经交叉验证 GREEN 后已合入 `master`，合并提交 `ffdb7ba`。真实 Provider 5 项与 197 项自动化通过；未推送/发布，真终端 IME 人工仍待验证。更早的待合入记录为历史状态。

0.2.0 发布前补充：已修复伪 TTY 在 CI 中被 Ink 自动切为非交互的问题；CI=true 的完整发布预演 203 项通过，31 文件制品与此前 integrity 一致，已合入 master。版本为 prepared，维护者自行触发 master 的发布工作流，未上传 npm。

## 2026-11-17 规划调整（路线图 r6，历史记录）

用户决定：当前交付路线只做 TUI 单端；SP008（Desktop）、SP009（VS Code）、SP016（远程/H5）、SP017（IM 基础与 Telegram/飞书）、SP018（微信/钉钉）**暂缓（DEFERRED）**，编号保留不回收、移出当前依赖与验收分母，恢复须用户另行决定；**多端架构入口保留**（宿主契约/传输边界/共享模型与历史，SP010 改契约轮以轻量测试客户端验证）。TUI 权限模式固定三种：**仅可查看 / 工作区内修改 / 完全权限**（当时 SP003 已发布，SP004 尚未发布）。团队/浏览器/Computer Use/定时任务仍必交。

同步落地：[能力清单 v1.1](../SP/SP001/capability-baseline/capability-manifest.md) 6 项必交改暂缓、覆盖度分母 53→47；[任务清单](../SP/SP001/evaluation-suite/task-inventory.md) REM/IM 11 题批注暂缓（SP020 开轮前 inventory v2 补齐配额）；spec 门禁 MUST_KEEP/MUST_DEFER 双向保护；矩阵 r3、高级能力计划、npm 方案 r4、product-brief、architecture、repository-layout、SP/README、PRODUCT.md v1.3 与本文件同步。本次规划调整的提交、合入 master 与推送已获用户授权（推送遇网络波动可重试）；验证记录见 [规划变更验证报告](requirements/tui-first-planning/test-report.md)。不因此授权任何暂缓轮开发或发布。

集成回执：merge:gate 两次 GREEN 后合入 master（合并提交 99b50ee，ancestry 证明通过）；推送前两次网络波动失败、第 3 次成功，ls-remote 核对一致；合入后 master 复跑 npm test 206 项 0 失败＋spec:check＋skills:check＋pack-smoke PASS。回执收口提交见验证报告 §4 追加行。

## SP004 合入回执（2026-11-19）

源/目标固定：`feature/SP004/real-coding-task`（HEAD `868eae6`）→ `master`（原 `5b0e7cc`），merge-base `e808679`，`--no-ff` 合并提交 `fdfdae8`，ancestry 证明通过。前置门禁 `npm run merge:gate` GREEN（`artifacts/merge-gate/feature-SP004-real-coding-task-2026-11-18T16-16-59-047Z.md`：outgoing 31 提交 91 文件、禁带路径违规 0、FAIL 行 0、UNVERIFIED 9 行且恢复条件节存在；`npm test`/`spec:check`/`skills:check`/`pack-smoke` 退出码 0）。合并时 `PRODUCT.md` 与 `docs/current-status.md` 因 master 已发布 0.3.6 出现文本冲突，按「保留已发布事实 + SP004 现状」人工解决，无代码冲突。合入后复验：`npm test` 0 失败、`CI=true npm test` 0 失败、`spec:check`/`skills:check`/`release` 17 项通过。推送：`origin/master` `5b0e7cc..1460fa3`、`origin/feature/SP004/real-coding-task` `da5bed1..868eae6`，`git ls-remote` 核对与本地一致（master `1460fa325dfc03f3088b6c209879b9a2965eeaee`）。未执行：打 tag、npm 发布、分支删除。合入后补记：T25 按设计 §7.3/§8 补齐 `EnterWorktree`/`ExitWorktree` 工具表面与删除强制审批（`a76c815`，全量 615/615），并新增 `SP/SP004/reference-parity.md` 记录参考 TUI（`b5c9be8`）对照；工具面未接入生产会话，限制与恢复条件见验收报告 §5。

## 0.2.0 正式发布完成（2026-11-17）

维护者触发运行 #7，Windows/Linux 验证及 npm OIDC 发布成功；publishedAt=2026-11-17T09:29:30.139Z，latest=0.2.0，source=6ed77d8a93335f8b261493e1fa4f0994ce4bc7bd。官方安装、shim 版本和 HTTP smoke 通过；46 registry signatures、5 attestations 核验通过；来源匹配本次 run/源码。原始 CI artifact 下载要求认证，未取得，使用公开 provenance 与独立安装证据；ledger 已 published。早前 prepared 状态为历史快照，真终端人工未验证保持不变。

## 0.6.0 正式发布完成（2026-11-21）

维护者触发运行 #26（源码 `4a63ead`），`Verify (windows-latest)`、`Verify (ubuntu-24.04)` 与 `Publish verified TUI using npm OIDC` 三个作业全部 success；publishedAt=2026-11-21T05:28:07.658Z，latest=0.6.0。官方 registry integrity `sha512-0l2764oBC/Go3E0DqIxHM6Lx06Z8kD7daa8Lxk6fTXrBrLFl7vSyhgfocKhYJ7MGKVSvhYFhRR1ML2rt8aHSDg==`，attestation 与 provenance（`pkg:npm/budingx@0.6.0`，digest `sha256:d25dbeb8…d20e`）核验通过，身份为 GitHub Trusted Publisher。本机从官方 registry 隔离安装 0.6.0 成功，`--version` 与 `--prompt --output-format json` 复验通过，制品内无用户数据。原始 CI artifact 下载要求认证，未取得，使用公开 provenance 与独立安装证据；ledger 已 published，`ciArtifactDownloaded: false`。首次运行 #25（源码 `a9c71d2`）曾在 Windows 验证作业失败并被跳过，未发生部分上传，根因为 Node 22 事件循环排空导致的建议超时用例被取消（已修复于 `d97ffc3`）与 Windows 高并发下的既有 flaky（已加 `--test-concurrency=4` 上限于 `52a4b62`）。

## 0.7.0 正式发布完成（2026-11-21）

维护者触发运行 #27（源码 `a8628b5`），`Verify (windows-latest)`、`Verify (ubuntu-24.04)` 与 `Publish verified TUI using npm OIDC` 三个作业全部 success；publishedAt=2026-11-21T15:58:10.709Z，latest=0.7.0。官方 registry integrity `sha512-LfvAmRL2gZel3FkN/Ct7pLZbaLzoT1FPvAwseMGditpPbBzlzX5Aet5YmWDwd9kTmKFJvOAfyOFCS+ZJ6F+UqQ==`，167 files，shasum `e4961b6eba8e1b253cc3bd7f3c7ae8221b2c9071`；2 条 attestation（npm publish + SLSA provenance）核验通过，provenance 指向 master@`a8628b5` 与本次 invocationId，身份为 GitHub Trusted Publisher。本机从官方 registry 隔离安装 0.7.0 成功，`--version` 输出 0.7.0，`npm audit signatures` 53 包签名、7 条 attestation 核验通过，制品内无用户数据。原始 CI artifact 下载要求认证，未取得，使用公开 provenance 与独立安装证据；ledger 已 published，`ciArtifactDownloaded: false`。SP007 功能分支 `feature/SP007/agent-quality-and-extensions` 与 `feature/SP007/image-command` 已合入 master（`ee9118e`），0.7.0 不可重复上传。
