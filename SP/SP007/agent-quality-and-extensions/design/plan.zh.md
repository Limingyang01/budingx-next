# SP007 实施计划 — agent-quality-and-extensions

设计：design.zh.md（自审通过）｜ 分支：feature/SP007/agent-quality-and-extensions（基线 master 4705232）
cwd：仓库根（D:\my_project\budingx-next）｜ 构建：npm run build（tsc -p src/tui/tsconfig.json）
单测：node --test src/<mod>/test/<file>.test.mjs ｜ 全量：npm run test:unit ｜ 门禁：npm run merge:gate
纪律：每任务先 RED（新用例失败证明缺口）后 GREEN（实现＋复测）；阶段完成中文本地提交；
bug 立即修复复测；缺凭据/平台记 UNVERIFIED。本轮止于推送功能分支，不合入 master（m00001）。

## T1 契约扩展（设计 §4.7；AC MM-05/07、PC-02、SA-13、RD-16 基础）
- 路径：src/core/events.ts（image 块、agent_* 事件、NoticeCode 四新增）、src/core/tools.ts
  （concurrencySafe?）、src/core/provider.ts（ApiContentPart、content 联合、TurnSnapshot.capabilities.vision?）、
  src/core/normalize.ts（user 图片 parts；纯文本路径不变）、src/core/transcript.ts（message.model?）、
  src/storage/config-store.ts（protocol?/vision?）、src/storage/profiles.ts（ResolvedConfig.protocol、
  createProfile/updateProfile/selectProfile 传递）。
- Consumes：现有契约（§2）。Produces：T2/T4/T5/T6/T8/T9 消费的新契约。
- 测试：src/core/test/image-blocks.test.mjs——RED：normalizeForApi 含 image 块用例失败（类型/行为缺）；
  GREEN：user→parts（text 前图后）、纯文本旧路径逐字节不变、context 包裹不变、悬空 tool 合成不变；
  旧档案（无 protocol/vision）读取缺省 openai/undefined。
- 命令：npm run build && node --test src/core/test/image-blocks.test.mjs

## T2 Anthropic 适配器（§4.3；AC PC-01/04/06、MM-07/08 协议侧）
- 路径：src/provider/anthropic.ts（createAnthropicProvider/probeAnthropic/discoverModelsAnthropic）、
  src/provider/image-errors.ts（isImageUnsupportedError）、src/provider/openai.ts
  （导出 backoffDelay/parseRetryAfter；请求体 content parts 直传）。
- Consumes：T1 契约、SseParser、ProviderLimits。Produces：runtime 协议分支、live 双协议。
- 测试：src/provider/test/anthropic.test.mjs＋anthropic-fixtures.test.mjs＋image-errors.test.mjs——
  RED：fake fetch SSE 帧→ProviderEvent 映射用例失败；GREEN：请求形状（system 顶层/x-api-key/
  anthropic-version/max_tokens 缺省 8192/tools input_schema/tool_result→user 块/image data URI→source）、
  流式碎片/多工具/input_json 累加/finish 与 usage 分帧合并/错误分类/重试上限/retry-after/401 不重试/
  取消/thinking 400 去 thinking 重试一次/上下文溢出分类；image-errors 特征匹配与误报排除。
- 命令：node --test src/provider/test/anthropic.test.mjs src/provider/test/anthropic-fixtures.test.mjs src/provider/test/image-errors.test.mjs

## T3 代理定义加载（§4.1；AC SA-01/02、RD-11 代理警告源）
- 路径：src/core/agent-definitions.ts（loadAgentDefinitions/内置三代理/saveAgentFile/deleteAgentFile/
  invalidateAgentCache/8 色常量）。
- Consumes：yaml 依赖、paths.dataRoot。Produces：T4 spawn、T8 面板、T9 doctor。
- 测试：src/core/test/agent-definitions.test.mjs——RED：加载/覆盖/校验用例失败；GREEN：
  临时 home＋项目目录树（cwd 向上至 git 根）覆盖序 built-in→user→project；frontmatter 全字段解析；
  name/description 缺失跳过记 warning；未支持字段记 warning；tools 缺省全部；'wx' 防覆盖；
  写后缓存失效；内置禁表（Explore/Plan 禁 Write/Edit/Bash/PowerShell/Agent/AskUserQuestion/
  EnterPlanMode/ExitPlanMode）。
- 命令：node --test src/core/test/agent-definitions.test.mjs

## T4 子代理运行时（§4.1；AC SA-03…10/14/16）
- 路径：src/core/agent-runtime.ts（createAgentRegistry/spawn/background/stop/taskOutput/通知收集）、
  src/core/session.ts（enqueueNotification、ActiveTurn 存 snapshot、recordMessage 写 model、
  perf 采集＋performance() getter、buildRequest 消费 toolSearch 端口预留）。
- Consumes：T1/T3、Session、createPermissionPolicy、createSessionTranscript 形状。
- 测试：src/core/test/agent-runtime.test.mjs——RED：fake provider 子会话用例失败；GREEN：
  独立上下文（父历史不可见）；工具裁剪；权限≤父（min 模式＋deny 继承＋remember 隔离）；
  sync 审批转发父网关（串行队列）；background 自动 deny；maxTurns/token 预算终止可见；
  父取消→sync 子中止、background 子存活；stop 抑制通知；结果=最后 assistant 文本＋usage 尾注＋
  100000 截断；失败/取消 isError 稳定码；sidechain JSONL 落盘；终态 <task-notification> 注入
  queue（notified 防重）；background(callId) 即返 async_launched 子继续；并发闸 10 等待。
- 命令：node --test src/core/test/agent-runtime.test.mjs

## T5 Agent 工具与并行派发（§4.1；AC SA-03/05/08/09/10/15）
- 路径：src/core/agent-tools.ts（Agent/TaskOutput/TaskStop）、src/core/session.ts
  （dispatchTools 连续 concurrencySafe Agent 组并行、Unknown tool 延迟池引导预留）。
- Consumes：T4 registry。Produces：T8 runtime 接线。
- 测试：src/core/test/agent-tools.test.mjs——RED：工具形状/派发用例失败；GREEN：入参 schema、
  未知类型报错列可用、省略类型→general-purpose、sync 结果/async 即返、TaskOutput block/timeout≤600000、
  TaskStop 状态、并行组结果按原序、组内取消、非 Agent 工具仍顺序（回归）。
- 命令：node --test src/core/test/agent-tools.test.mjs

## T6 ToolSearch（§4.2；AC RD-12/13/14）
- 路径：src/core/tool-search.ts、src/core/session.ts（buildRequest filter＋notice、
  compactIfNeeded 快照 preserved tool_state、dispatchTools Unknown tool 引导）。
- Consumes：T1、estimateTokens。Produces：T8 runtime 门控接线。
- 测试：src/core/test/tool-search.test.mjs——RED：select/计分/门控用例失败；GREEN：
  select 直选大小写不敏感 no-op、裸名 fast path、mcp__ 前缀、+词必需、计分权重 12/10/6/5/4/3/2、
  max_results 默认 5、无匹配文案、pending 提示、发现集标记扫描（resume）、压缩快照、
  公告排序池变更新、断连移除、auto 阈值 10%（500/工具开销）、off/standard/无延迟池禁用、
  失败引导文案。
- 命令：node --test src/core/test/tool-search.test.mjs

## T7 会话图片链路（§4.4；AC MM-07/08/09/10、PC-05）
- 路径：src/core/session.ts（SubmitOptions.images、userMessage image 块、vision false 前置拒绝、
  buildRequest 媒体上限 100 丢最旧＋notice、bad_request 拒图→剥离最近 user 图片→重试一次→
  image_error）、src/core/session.ts dispatchTools JSON 错误文案 '<tool_use_error>InputValidationError…'。
- Consumes：T1/T2 image-errors。
- 测试：src/core/test/session-images.test.mjs——RED：拒图降级/上限用例失败；GREEN：
  vision false 拒绝不发请求、未知 vision 发送、拒图错误剥离重试成功 notice image_downgraded、
  再失败 image_error、后续轮无图、>100 丢最旧＋提示、纯文本回归不变、错误参数回灌自纠不中断。
- 命令：node --test src/core/test/session-images.test.mjs

## T8 图片粘贴与缩放（§4.4；AC MM-01…06）
- 路径：src/tui/image-paste.ts、src/tui/image-resize.ts、src/storage/image-cache.ts、
  src/tui/keybindings/defaults.ts（平台分支 chat:imagePaste）、src/storage/paths.ts（imageCacheDir）。
- Consumes：T1。Produces：T9 app 接线。
- 测试：src/tui/test/sp007-image-paste.test.mjs——RED：缩放/缓存/键位用例失败；GREEN：
  PNG 8-bit RGB/RGBA 降采样级联（fixture 生成→尺寸/base64 上限断言）、滤波 0-4 往返、
  调色板/16-bit/隔行拒绝、非 PNG 超限拒绝、5MB/8000px 阈值、路径识别正则（引号/反斜杠转义）、
  image-cache 落盘＋200 淘汰＋私有权限、键位平台分支＋保留键校验；
  功能：Windows 剪贴板有图/无图真实 PowerShell 往返（无图环境记 UNVERIFIED）。
- 命令：node --test src/tui/test/sp007-image-paste.test.mjs

## T9 TUI 代理接线与面板（§4.1/§4.7；AC SA-11…15、SA-16 宿主侧）
- 路径：src/tui/runtime.ts（registry＋agent 工具 push＋ToolSearch 门控＋协议分支 provider()＋
  resolveSnapshot vision＋enqueueNotification 接线）、src/tui/agents-menu.tsx、
  src/tui/commands/builtin-agents.ts（/agents local-jsx、/agent prompt）、
  src/tui/commands/types.ts（openAgents/openStatus/openStats/openDoctor）、
  src/tui/commands/index.ts、src/tui/app.tsx（模态消费＋COMMAND_NAMES 补全＋pastedContents＋
  imagePaste 键位＋ctrl+b agent.background＋[Image #N] 输入占位）、
  src/tui/render/agent-card.ts＋render/transcript.tsx（卡片/并行树/ctrl+o 展开）、
  src/tui/tasks.ts＋/tasks 面板 Agents 分组（x/ctrl+x）。
- Consumes：T3–T8。
- 测试：src/tui/test/sp007-agents-panel.test.mjs（mount-tty/ink testing）——RED：面板/卡片用例失败；
  GREEN：/agents 列表来源标签/覆盖 dim/内置不可编辑、向导落盘 'wx'、退出变更汇总、
  卡片 Initializing/最后 3 条/Done 计数/8 色/ctrl+b 提示/并行树、/agent 缺参用法、
  headless 不注册面板命令且 Agent 工具可用、COMMAND_NAMES 含全部注册名。
- 命令：node --test src/tui/test/sp007-agents-panel.test.mjs

## T10 诊断面板（§4.2；AC RD-01…11/15/16）
- 路径：src/tui/diagnostics/{status-report,status-dialog,stats,stats-dialog,doctor,doctor-dialog,
  doctor-warnings,heatmap,ansi-chart}.ts(x)、src/tui/commands/builtin-diagnostics.ts
  （/status /stats /doctor local-jsx）、app.tsx 模态接线。
- Consumes：T1 model 字段、T4 performance()、T3 warnings、estimateTokens。
- 测试：src/tui/test/sp007-diagnostics.test.mjs——RED：聚合/缓存/报告用例失败；GREEN：
  临时 home 双会话＋subagent 转录聚合（subagent 计 token 不计会话、旧转录 unknown 桶）、
  缓存版本重算/今天实时/7d30d 绕过、热力图/streak/折线尺寸公式、r/Tab/Esc/Ctrl+S（Windows 真实
  剪贴板，失败明确提示）、status 字段集（不显权限模式、MCP 计数、来源链、RSS/p50/p95）、
  doctor 警告式分区/阈值 40k/15k/25k/不可达规则/临时产物清理计数、零网络断言（fetch 监视）、
  凭据脱敏、两 home 隔离。
- 命令：node --test src/tui/test/sp007-diagnostics.test.mjs

## T11 评估回归（§4.5；AC ER-01…06）
- 路径：scripts/eval/{runner.mjs,live.mjs,tasks.json,fixtures/}、src/tui/test/sp007-eval.test.mjs。
- Consumes：agent-fixture 范式、live-provider 范式、T2–T10 能力。
- 测试：RED：runner 断言/预算用例失败；GREEN：≥12 任务（≥3 blind）离线保护用例全过、
  失败分类、预算帽强制、报告 JSON＋md 形状、未测清单、live opt-in 不进 npm test。
- 命令：node --test src/tui/test/sp007-eval.test.mjs && node scripts/eval/runner.mjs

## T12 失败边界与宿主契约（§4.6；AC FB-01…04）
- 路径：src/tui/test/sp007-failure-boundaries.test.mjs（新增）；必要时修 src/tui/headless.ts。
- GREEN：Web 失败权限不变、hooks 超时/崩溃/递归、MCP 断线/超时/取消/上限＋公告移除、
  headless stream-json 形状/终态/退出码回归、agent_* 不输出、npm pack dry-run 产物符合、
  无新增运行时依赖（package.json diff 断言）。
- 命令：node --test src/tui/test/sp007-failure-boundaries.test.mjs && npm pack --dry-run

## T13 真实模型验证（§4.3/§4.5；AC PC-07、ER-04）
- 路径：scripts/testing/live-provider.mjs（--protocol anthropic/BUDINGX_ANTHROPIC_*）、
  scripts/eval/live.mjs 运行；证据 artifacts/quality-runs/SP007/…（gitignore）。
- OpenAI 兼容：.env.e2e.local 在位→流式＋工具回合＋取消＋评估真实跑；
  Anthropic 兼容端点凭据若缺→UNVERIFIED＋恢复条件（不 mock 冒充）。
- 命令：node scripts/testing/live-provider.mjs [--protocol anthropic] && node scripts/eval/live.mjs

## T14 全量自测与门禁（AC 全部）
- npm run test:unit（全量）→ npm test（含 skills/spec/checks/langfuse/release/merge）→
  npm run merge:gate（交叉验证，本轮只跑不合入）；RED 即修直至全 GREEN；
  每 AC 单元＋功能证据入 test-report.md（PASS/FAIL/UNVERIFIED 分层）。
- 命令：npm run test:unit && npm test && npm run merge:gate

## T15 文档同步与交付（AGENTS.md 产品说明书纪律）
- PRODUCT.md（新功能表/使用说明/限制/版本历史 minor 0.7.0 准备——本轮不发布，版本号以
  src/tui/package.json 为准按 versioning 规范 bump）、docs/iteration-plan.md（SP007 状态）、
  docs/current-status.md、docs/agent-capability-matrix.md（CAP 证据列）、
  docs/independent-development.md＋THIRD-PARTY-NOTICES.md（cc-switch MIT 线索：仅机制参考未嵌入）、
  SP/SP007/…/test-report.md＋STATUS.md＋requirements-summary.md（ACCEPTED/验证/交接）。
- 提交：中文说明，阶段提交已随 T1–T14；交付提交含文档与证据索引。

## T16 推送功能分支（m00001 授权；不合入 master）
- git push -u origin feature/SP007/agent-quality-and-extensions；核对远端回执；
  不 merge、不打标签、不发布。

## AC→任务映射
SA-01/02→T3；SA-03…10→T4/T5；SA-11…15→T9；SA-16→T9/T12。
RD-01…11/15/16→T10（RD-16 采集 T4）；RD-12…14→T6。
PC-01/04/06→T2；PC-02/03/08→T1/T9；PC-05→T7；PC-07→T13。
MM-01…06→T8/T9；MM-07…10→T1/T2/T7。
ER-01…06→T11（ER-04→T13）。FB-01…04→T12。
每 AC 单元＋功能各≥1 例；RED→GREEN 顺序强制；UNVERIFIED 须恢复条件。
