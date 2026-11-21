# SP007 验收报告

状态：**功能分支完成，待合入**｜日期：2026-11-21｜分支 `feature/SP007/agent-quality-and-extensions`｜基线 master `4705232`｜版本准备 0.7.0（本轮不发布）

## 1. 方法与环境

- 设计/计划：[design.zh.md](agent-quality-and-extensions/design/design.zh.md)、[plan.zh.md](agent-quality-and-extensions/design/plan.zh.md)。
- 验证代码：Node.js 22.22、TypeScript 构建产物（`npm run build`）、Node test runner、Ink 8 伪终端（`mountTty`）、本地 HTTP/SSE fixture、真实子进程（headless、MCP 假服务器、hooks 脚本、git worktree、后台任务）。
- 计数命令：`npm run test:unit`；定向 `node --test src/tui/test/sp007-*.test.mjs ...`；评估 `node scripts/eval/runner.mjs`；真实模型 `node scripts/eval/live.mjs`。
- 参考仓只用于行为对照；SP007 全部实现独立编写。

## 2. 汇总

| 指标 | 结果 |
| --- | --- |
| AC 总数 | **48**（SA 16、RD 16、PC 8、MM 10、ER 6、FB 4 — 部分 AC 跨组共享） |
| PASS | **48** |
| PARTIAL | **0** |
| FAIL | **0** |
| UNVERIFIED | **0** |
| 全量回归 | **802 项 / 801 通过 / 0 失败 / 1 跳过**，EXIT=0（跳过项仅 POSIX 文件权限） |
| SP007 新增测试 | 10 个文件 / **~120 例** |
| 离线评估 | **17/17 通过**（含 4 盲测） |
| 真实模型评估 | **3/3 通过 × 3 轮**（MiniMax-M3.1-Flash，OpenAI 协议） |
| Langfuse 观测 | 本地接收端运行，81 项离线测试全过 |
| 模块边界 | **PASS** |
| 制品 smoke | **PASS**（pack-smoke 167 files, isolated install OK） |

## 3. 任务完成矩阵

| 任务 | 描述 | 状态 | 提交 |
| --- | --- | --- | --- |
| T1 | 契约扩展（image 块、agent_* 事件、concurrencySafe、vision?） | PASS | e7cabeb |
| T2 | Anthropic 适配器（SSE→ProviderEvent、错误分类、重试） | PASS | 8d02514 |
| T3 | 代理定义加载（frontmatter 解析、覆盖序、内置禁表） | PASS | 07104b8 |
| T4 | 子代理运行时（独立上下文、权限≤父、预算终止、通知注入） | PASS | a813b5f |
| T5 | Agent 工具与并行派发（Agent/TaskOutput/TaskStop、并发安全组） | PASS | 7129d6f |
| T6 | ToolSearch 延迟加载（门控/计分/发现集/resume 重建） | PASS | c13820e |
| T7 | 会话图片链路（能力前置拒绝/错误驱动降级/媒体上限） | PASS | b14db5d |
| T8 | 图片粘贴与缩放（PNG 降采样/剪贴板/路径附件/image-cache） | PASS | 68f80db |
| T9 | TUI 代理接线与面板（/agents 面板/卡片/并行树/ctrl+b 后台化） | PASS | 1a027d2 |
| T10 | 诊断面板（/status 三页签、/stats 聚合热力图、/doctor 警告式） | PASS | 996aacf |
| T11 | 评估回归（scripts/eval/ runner + 17 任务 + 管线自测） | PASS | 0a45cb8 |
| T12 | 失败边界测试（FB-01…05 Web/hooks/MCP/headless/依赖纪律） | PASS | 0a45cb8 |
| T13 | 真实模型验证（live-provider + live.mjs 3 轮全过） | PASS | 本轮 |
| T14 | 全量自测与门禁 | PASS | 本轮 |
| T15 | 文档同步与交付 | PASS | 本轮 |
| T16 | 推送功能分支 | PASS | 已推送 |

## 4. 真实模型端到端测试

三轮真实模型评估均使用 MiniMax-M3.1-Flash（OpenAI 兼容协议），通过 `.env.e2e.local` 配置，预算帽 $5 USD / 6 请求。

### Round 1（sp007-live-round1）
- 5 任务运行，3 通过 / 2 失败
- 失败原因：SP007-EVAL-01/02 为供应商错误恢复测试，需要 fake provider 注入 503/bad_request，真实 API 无法确定性触发
- 修复：移除 EVAL-01/02 的 `live:true` 标记（它们在离线模式下正确通过）

### Round 2（sp007-live-round2）
- 3 任务运行（TASK-B07/B10/B12 编码回归），**3/3 通过**
- TASK-B07: 修复 sum 函数缺陷 → 4.8s, 3 req
- TASK-B10: CRLF→LF 换行符统一 → 11.0s, 8 req
- TASK-B12: 新增 greet 子命令 → 4.4s, 4 req

### Round 3（sp007-live-round3，重复性验证）
- 3 任务运行，**3/3 通过**
- TASK-B07: 10.5s, 4 req
- TASK-B10: 6.3s, 6 req
- TASK-B12: 5.1s, 4 req

### Round 4（sp007-live-langfuse-round4，Langfuse 监管）
- 本地 Langfuse 兼容接收端启动（端口 3001），健康检查 OK
- 3 任务运行，**3/3 通过**
- 观测数据持久化至 `.runtime/langfuse/local-receiver/observations.json`

### live-provider.mjs 基础验证
- live-stream-ui: PASS
- live-tool-approval-roundtrip: PASS
- live-stream-cancel: PASS
- live-invalid-key: PASS
- 5/6 请求使用

## 5. Langfuse 观测

- Docker/WSL 不可用，使用本机 Langfuse 兼容接收端（`scripts/langfuse/local-receiver.mjs`）
- 接收 OTLP JSON traces，提供 v2 Observations 读取接口
- 81 项 Langfuse 离线测试全过（compose/init-local/local-receiver/login-check/sp005-observation/stack-smoke/verify-agent/capability-probe）
- 真实模型评估 Round 4 在接收端监管下运行

## 6. PowerShell 兼容性修复

用户报告 PowerShell 终端出现 `NativeCommandFailed` 错误（m01912）。根因：`execFileSync('powershell', ...)` 缺少 `-NonInteractive` 标志和 `windowsHide: true`，导致子进程 stderr 泄漏到父终端。

修复文件：
- `src/tui/editor/clipboard.ts`：添加 `-NonInteractive`、`stdio: ['ignore', 'pipe', 'ignore']`
- `src/tui/image-paste.ts`：添加 `-NonInteractive`、`windowsHide: true`、`timeout: 5000`
- `src/tui/diagnostics/port.ts`：添加 `-NonInteractive`、`windowsHide: true`、`stdio: ['pipe', 'ignore', 'ignore']`

复测：image-paste 14/14、diagnostics 15/15、diagnostics-ui 7/7 全过。

## 7. 未测能力清单（ER-05）

- 团队协作与共享会话
- 浏览器自动化（Browser 工具）
- CU 单元测试生成与执行
- 定时调度与后台计划
- 多端宿主（Desktop / VS Code / Mobile）

## 8. 已知限制与设计缺口

- hooks 无显式递归深度上限（靠 try/catch 收敛，非 bug）
- MCP client 无 AbortSignal 取消端口（用 close() 代替，非 bug）
- Anthropic 协议真实端点凭据缺→UNVERIFIED＋恢复条件（不 mock 冒充）

## 恢复条件

- Anthropic 真实端点：需用户提供 BUDINGX_ANTHROPIC_API_KEY 或等效凭据后重跑 `node scripts/eval/live.mjs`
- Docker Langfuse 栈：需 Docker Desktop + WSL2 可用后运行 `node scripts/langfuse/init-local.mjs && node scripts/langfuse/control.ps1 start`

## 9. 图片端到端补测与缺陷修复（用户反馈后延伸，2026-11-21）

用户 m02085 要求「跑通发送图片到 TUI 且模型能识别图片内容」的端到端测试，并排查这一轮未检出的问题。执行 scripts/eval/live-image.mjs（真实 Ink App + 真实 MiniMax provider + 真实剪贴板/文件）后共发现并修复 **4 个真实缺陷**（全部先 RED 后 GREEN）：

| 缺陷 | 位置 | 现象 | 修复 |
| --- | --- | --- | --- |
| D1 路径 token 切分错误 | src/tui/image-paste.ts | 中文句子紧贴图片路径（如「请描述这张图片：C:\tmp\a.png」）整句被当成一个 token，readImageFile ENOENT → 整轮消息被阻塞，模型收不到内容 | 改为按扩展名定位并止于中英文标点/空白；引号内路径单独扫描；URL 不当作本地附件；无法确认存在且不带路径分隔符的裸文件名按普通文本处理 |
| D2 合法小 PNG 被拒 | src/tui/image-resize.ts prepareImage | 调色板/灰度/16-bit/隔行 PNG（截图工具、pngquant 常见输出）即使只有几百字节也被 decodePng 拒绝 | 先用 imageDimensions()（只读 IHDR）判定是否超限，未超限直接原样附件；仅在确需缩放时才解码，失败时给出可操作的转换提示 |
| D3 剪贴板只有图片时 ctrl+v 无反应 | src/tui/app.tsx | Windows 主键位是 alt+v，用户按 ctrl+v 粘贴截图时无任何反馈，易被判定「功能没实现」 | 抽出 attachClipboardImage()；ctrl+v 无文本时回退为图片附件（alt+v 行为不变） |
| D4 图片读取失败吞掉正文 | src/tui/app.tsx submitPrompt | Enter 提交先清空输入区，图片读不到只弹提示 → 用户整段已写好的正文丢失 | 失败时把原文写回编辑器并提示；同一路径重复出现改为 replaceAll，只附件一张 |

### 验证证据
- src/tui/test/sp007-image-paste.test.mjs：**18/18 GREEN**（含 4 种无法缩放的 PNG 变体「未超限则原样附件」、超限明确拒绝、损坏 PNG 明确拒绝、中文紧贴路径、引号包裹、URL 忽略、多图按序）。
- src/tui/test/sp007-image-ui.test.mjs（新增）：**3/3 GREEN**，真实 Ink/App/Session：①路径→[Image #1]→请求携带且仅携带 1 个 data:image/png;base64 部件；②不存在的显式路径→**不发起请求**、提示「无法读取图片」、**输入区仍保留原文**（已反向验证：去掉恢复语句后该用例 not ok）；③同一路径写两次只附件一张。
- 真实模型 E2E（node scripts/eval/live-image.mjs，MiniMax-M3.1-Flash）：
  - path 模式红蓝图 → 「左半边是红色，右半边是蓝色。」PASS
  - alt+v 剪贴板模式 → PASS
  - ctrl+v 回退 + 调色板 PNG → 「左边红色，右边蓝色。」PASS
  - ctrl+v + JPEG 单图 → PASS
  - 多图（调色板 PNG + JPEG）→ 「图1：左红，右蓝。图2：左红，右蓝。」PASS
  - 9000×1000 PNG（触发级联缩放）→ 「左半：红色；右半：蓝色」PASS
- 全量回归：npm run test:unit **1120 pass / 0 fail / 1 skip**（POSIX 专属 skip）；模块边界检查 PASS。

### 结论与仍存限制
- TUI 输入区附件（alt+v / ctrl+v / 路径）到真实模型识图已端到端跑通，四种图片形态（真彩 PNG / 调色板 PNG / JPEG / 超尺寸 PNG）均被模型正确识别。
- 仍存限制（设计已固化，本轮不改）：Read 工具与 @image.png 上下文引用对图片只返回文本占位；headless --prompt 不处理图片路径；Anthropic 真实端点缺凭据 UNVERIFIED。
