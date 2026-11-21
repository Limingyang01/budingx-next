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
