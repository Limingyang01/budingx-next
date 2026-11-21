# STATUS — SP007 agent-quality-and-extensions

- 生命周期：**功能分支完成**（T1–T16 全部完成，已推送远端，待合入 master）
- 更新：2026-11-21（T13–T16 完成）
- 分支：feature/SP007/agent-quality-and-extensions（基线 master 4705232）
- 提交链：a6466a4 开轮文档 → edf3835 计划 → e7cabeb T1 → 8d02514 T2 → 07104b8 T3 → a813b5f T4 → 7129d6f T5 → c13820e T6 → b14db5d T7 → 68f80db T8 → 1a027d2 T9 → 996aacf T10 → 0a45cb8 T11+T12 → a8da8e0 STATUS → （T13–T16 本轮提交待 push）
- 需求：requirements.md（60 AC：SA×16 / RD×16 / PC×8 / MM×10 / ER×6 / FB×4）
- 设计：design/design.zh.md（自审 PASS，含 D1–D14 偏离登记）；计划：design/plan.zh.md（T1–T16）
- 验证（T13–T16 最终）：全量单元测试 **802 项 / 801 通过 / 0 失败 / 1 跳过**（POSIX）；模块边界 PASS；交叉验证门禁 **GATE GREEN**（npm test + spec:check + skills:check + pack-smoke 全过）；离线评估 **17/17 通过**（含 4 盲测）；真实模型评估 **3/3 × 3 轮通过**（MiniMax-M3.1-Flash OpenAI 协议）；Langfuse 本地接收端监管轮 3/3 通过；Langfuse 离线测试 81/81；制品 smoke PASS（167 files, isolated install OK）；PowerShell 兼容性修复后 image-paste 14/14、diagnostics 15/15、diagnostics-ui 7/7 全过
- 参考：budingWorkerSpace b5c9be8（只读）；三份侦察报告已固化入需求（R1 子代理 / R2 诊断 / R3+R4 供应商与多模态）
- 关键决策：第二协议=Anthropic Messages 直连适配器（D1）；PNG 纯 JS zlib 缩放不引 sharp；ToolSearch 客户端发现集替代 tool_reference beta；
  /doctor 警告式（修正 r5「Fix 屏」措辞）；单目录承载五工作流（沿用 SP006 先例）；
  D13 frontmatter 手写平铺解析（yaml 不在产品依赖白名单）；D14 定义 IO 落 src/tui/agents.ts、子政策/sidechain 经端口注入 core（core 禁 IO）
- 用户指令：m00001 开发自测至无 bug→提交推送功能分支、**不合入 master**；m00014 像素级参考参考仓 TUI
- 阻塞：无（真实模型凭据 .env.e2e.local 在位；缺项将记 UNVERIFIED）
- 已完成模块：
  - T1 契约：events 图片块/agent_* 事件/NoticeCode、provider ApiContentPart、tools concurrencySafe、normalize 图片 parts、transcript model、config protocol/vision
  - T2 provider/anthropic.ts（createAnthropicProvider/probeAnthropic/discoverModelsAnthropic）＋image-errors.ts
  - T3 core/agent-definitions.ts（纯解析/内置三代理/序列化）＋tui/agents.ts（目录 IO/缓存/save/delete）
  - T4 core/agent-runtime.ts（createAgentRegistry 并发闸/权限上限/预算/取消/后台通知）＋session 性能采集/通知队列
  - T5 core/agent-tools.ts（Agent/TaskOutput/TaskStop）＋session dispatchTools 连续并发安全组并行（dispatchOne 抽取，结果按原序回灌）
  - T6 core/tool-search.ts（门控 off/auto/auto:N/standard、计分 12/10/6/5/4/3/2、select/裸名/前缀/关键词、发现集 scanHistory resume 重建、压缩 tool_state 快照）＋session buildRequest filter/notice/失败引导
  - T7 会话图片链路：SubmitOptions.images→userMessage image 块；vision===false 前置拒绝 notice image_rejected 不发请求；vision 未知错误驱动降级（剥离最近 user 图片→notice image_downgraded→无图重试一次→再失败 image_error）；buildRequest 媒体上限 100 丢最旧＋可见 notice；PC-05 非法 JSON 以 <tool_use_error>InputValidationError 回灌；isImageUnsupportedError 移 core/image-errors.ts（provider re-export，core 禁 import provider）
  - T8 图片粘贴与缩放：tui/image-resize.ts（PNG 纯 JS zlib 解码/unfilter 0-4/双线性降采样/filter0 编码，8-bit RGB/RGBA 非隔行，调色板/16-bit/隔行/灰度拒绝，级联 8000→2048→1568 目标 raw≤3.75MB/base64≤5MB，非 PNG 超限拒绝）；tui/image-paste.ts（Windows PowerShell Get-Clipboard 临时 PNG fire-and-forget 删＋Linux/macOS 尽力而为＋路径 token 识别去引号还原双反斜杠＋readImageFile 失败明确报错）；storage/image-cache.ts（~/.budingx/image-cache/<sid>/<id>.<ext> 私有 0o700/0o600＋LRU 200 淘汰＋file:// url）；paths.imageCacheDir；keybindings 平台分支 IMAGE_PASTE_KEY（Win alt+v/其他 ctrl+v）chat:imagePaste＋ctrl+b agent.background
  - T9 TUI 代理接线：runtime（provider 协议分支/resolveSnapshot vision/ToolSearch 门控/agent registry/imageCache/AgentRuntime.agents·toolSearch·imageCache）＋storage createSubagentTranscript（sidechain）＋commands（openAgents 等 outcome、builtin-agents /agents local-jsx·/agent prompt、index 注册）＋render/agent-card.ts（8 色/最后3条/Done/ctrl+b/并行树）＋agents.ts listAgentEntries（overridden）＋agents-menu.tsx（list→view/edit/delete＋Manual 向导 wx）＋app.tsx（COMMAND_NAMES 补全导出/AgentsMenu 模态/agent_* 卡片/submitPrompt 图片附件/imagePaste·ctrl+b 键/卡片渲染）＋cli.ts（agents surface·imageCache）＋/tasks Agents 分组
  - T10 诊断面板：tui/diagnostics/{heatmap,ansi-chart,doctor-warnings,status-report,stats,doctor}.ts（纯逻辑：UTC 日键热力图 5 档/折线图+ANSI 截图/阈值 40k 字符·15k token·25k token/状态字段不显权限模式+凭据只显来源/JSONL 按模型按日聚合+子代理单计 token+stats-cache version1 今天实时 7d·30d 绕过缓存/doctor 警告式分区+24h 临时产物清理）＋status-dialog.tsx（Status/Config/Usage 三页签）＋stats-dialog.tsx（Overview 热力图/Models 折线，r 范围循环，Ctrl+S ANSI 截图复制）＋doctor-dialog.tsx（Warning/Fix 分区）＋commands/builtin-diagnostics.ts（/status /stats /doctor local-jsx immediate，无 supportsNonInteractive）＋diagnostics/port.ts（宿主事实→端口：runtime/config/mcp/agents/keybindings/instructions，rg 探测，Windows Set-Clipboard）＋app.tsx 模态接线＋cli.ts 端口接线＋core/transcript.ts message 记录增 usage（/stats 按模型聚合）
- T11 评估回归（scripts/eval/）：lib/{util,tasks,checks,scenarios,runner-core,report}.mjs＋runner.mjs（离线 CLI）＋live.mjs（真实模型 opt-in）＋tasks.json（17 条：14 SP007-EVAL + 3 SP001 回归子集，4 盲测）＋fixtures/（5 组夹具）；18 种断言类型；wrapProvider 预算帽强制；classifyFailure 失败分类；报告 summary.json+md 含分组/失败分类/ER-05 未测能力清单/盲测脱敏；src/tui/test/sp007-eval.test.mjs 22 项管线自测全绿；离线 runner 17/17 通过
- T12 失败边界测试（src/tui/test/sp007-failure-boundaries.test.mjs）：FB-01 WebSearch/WebFetch 失败权限不变、FB-02 hooks 超时/非零/递归防护、FB-03 MCP 断线/超时/取消/输出上限+公告移除、FB-04 headless stream-json 形状/终态/退出码/agent_* 不输出、FB-05 依赖纪律；15 项全绿
- 回归修复：sp006-command-registry.test.mjs EXTENDED 数组补入 SP007 新增 5 条命令（status/stats/doctor/agents/agent）
- 下一步：T13 真实模型能力矩阵（live-provider anthropic 协议扩展）
- 验证汇总：全量测试 1113 pass / 0 fail / 1 skip（POSIX）；模块边界检查通过
- 清理待办：侦察副产品 .recon-b1.md/.recon-b2.md/undefined/ 已被子代理自行清理（工作区干净）

## T13–T16 完成记录（2026-11-21）

### T13 真实模型验证
- live-provider.mjs 基础验证 4/4 PASS（stream-ui/tool-approval/cancel/invalid-key），5/6 请求
- eval/live.mjs Round 1：5 任务 3 通过 2 失败（EVAL-01/02 供应商恢复测试需 fake provider，移除 live:true）
- eval/live.mjs Round 2：3 任务 **3/3 通过**（TASK-B07/B10/B12 编码回归）
- eval/live.mjs Round 3（重复性）：3 任务 **3/3 通过**
- eval/live.mjs Round 4（Langfuse 监管）：本地接收端启动，3 任务 **3/3 通过**
- 修复：live.mjs import 路径 '../src/tui/dist/' → '../../src/tui/dist/'
- 修复：tasks.json EVAL-01/02 移除 live:true（离线模式正确通过，真实 API 无法确定性触发错误）

### T14 全量自测与门禁
- npm run test:unit：802 项 801 pass 0 fail 1 skip
- node scripts/checks/module-boundaries.mjs：PASS
- node scripts/skills/sync-entries.mjs --check：PASS
- node scripts/spec/check-spec.mjs：PASS
- node scripts/release/pack-smoke.mjs：PASS（167 files, isolated install OK）
- node scripts/merge/cross-validate.mjs：**GATE GREEN**
- Langfuse 离线测试 81/81、release 测试 17/17、merge 测试 9/9（创建 test-report.md 后修复）

### T15 文档同步与交付
- SP/SP007/test-report.md 创建（48 AC 全 PASS、验证矩阵、真实模型 4 轮记录、Langfuse 观测、PowerShell 修复、未测清单、恢复条件）
- PRODUCT.md 更新（v1.23、SP007 功能表、§5.8 详细说明、版本历史 0.7.0 准备中、图片多模态限制更新）
- docs/current-status.md 更新（SP007 功能分支完成段落、验证结果表、待办）
- docs/iteration-plan.md 更新（SP007 状态→功能分支完成）
- PowerShell 兼容性修复：editor/clipboard.ts、image-paste.ts、diagnostics/port.ts 添加 -NonInteractive + windowsHide

### T16 推送功能分支
- 首次推送已完成（a8da8e0）
- T13–T16 变更待提交后再次推送
- **未合入 master**（遵循 m00001 用户指令）

## T17 图片端到端补测与缺陷修复（2026-11-21，用户 m02085）

- 新增 scripts/eval/live-image.mjs（opt-in，不进 npm test）：真实 Ink App + 真实 provider + 真实文件/剪贴板，支持 --mode path|clipboard|ctrlv 与可重复 --image。
- 修复 4 个真实缺陷：D1 中文紧贴路径 token 切分（整轮消息被阻塞）；D2 未超限的调色板/灰度/16-bit/隔行 PNG 被拒；D3 剪贴板只有图片时 ctrl+v 无反应；D4 图片读取失败吞掉输入正文。
- 新增 src/tui/test/sp007-image-ui.test.mjs（3 项，真实 Ink）：附件 data URI 形状、失败不发起请求且保留正文、同路径只附件一次；均已验证修复前失败/修复后通过。
- sp007-image-paste.test.mjs 15→18 项（4 种 PNG 变体直通、超限明确拒绝、损坏 PNG 明确拒绝）。
- 真实模型（MiniMax-M3.1-Flash）6 种形态 PASS：path、alt+v、ctrl+v 回退、JPEG、多图、9000px 级联缩放。
- 全量回归：npm run test:unit 1117→1120 pass / 0 fail / 1 skip；模块边界 PASS。
- 文档同步：PRODUCT.md §5.8 增补小图直通/ctrl+v 回退/正文保留；本文件与 test-report.md §9 记录证据。
