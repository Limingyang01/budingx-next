# SP007 需求汇总 — Agent 质量与扩展

状态：功能分支完成（2026-11-21 开轮；用户 m00001 后经 m02028 授权合入 master 并推送；0.7.0 发布准备完成，等待维护者触发发布）

## 本轮目标与边界

目标（路线图 SP007 行，docs/iteration-plan.md:74）：Agent 质量与扩展，五个工作流——
evaluation-regression、runtime-diagnostics、provider-compatibility、subagent-execution、multimodal-context；
/agents 命令（.budingx/agents/*.md 子智能体加载与调用）。

出口验收：至少两类目标公开协议/实际模型通过能力矩阵；子代理权限/预算/取消/冲突有真实链路；
图片和复杂工具参数按能力处理；联网/hooks/MCP 失败不越权；产物符合性、诊断/性能/隐私回归及稳定宿主契约通过。

用户指令：
- m00001（2026-11-21）：基于 master 拉功能分支开发，完成后自测，发现 bug 立即修复，自测直至确认无 bug 方可通过；通过后提交并推送功能分支到远端，**先不要合入 master**。
- m00014（2026-11-21）：所有功能全部参考 D:\my_project\budingWorkerSpace 项目的 TUI 实现，像素级还原。

边界：
- 团队/swarm、worktree 隔离、浏览器/Computer Use、调度属 SP011–SP014，不在本轮假称交付。
- 子代理 fork/resume/agent-memory、按代理 mcpServers/hooks/skills 预加载、Read 工具读图、PDF 附件明确延期（requirements.md §排除清单）。
- effort、/btw 已随 SP006 交付（r5 增补项中的已完成项），本轮不重复开发。
- 权限固定三档（r6），不还原参考七模式；还原度判定沿用 O5=B 与结构覆盖率口径，禁「已对齐/同等效果」措辞。
- 参考仓修订 b5c9be8d15e5dab153fe1607c0d653d464bdb3e5（只读，读机制不抄代码）。

## 需求索引

| 目录 | 来源 | 验收目标 | 责任范围 | 阶段 | 文档 | 验证 | 集成状态 | 下一步 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| agent-quality-and-extensions §R1 子代理执行（SA-01…SA-16） | 路线图 SP007；矩阵「子代理与委派」；r5 卡片分离 | 独立上下文/权限≤父/预算/取消传播/冲突可见/父验证结果；/agents 面板与 /agent 命令；同步+后台代理真实链路 | core 子会话+工具、TUI 面板/卡片 | COMPLETE | [requirements](agent-quality-and-extensions/requirements.md) | SA 16 条 AC 全 PASS（sp007-agents-panel 14/14、agent-runtime/agent-tools 单元） | 待合入 | 交付完成 |
| agent-quality-and-extensions §R2 运行时诊断（RD-01…RD-16） | 路线图 SP007；矩阵「诊断与性能」；r5 /status /stats doctor ToolSearch | /status 三页签、/stats JSONL 聚合+热力图+折线、/doctor 警告式报告+过期锁清理、ToolSearch 延迟加载、首token/p50/p95/内存采集、默认不上传 | TUI 命令/面板、storage 聚合、core 计时 | COMPLETE | 同上 | RD 16 条 AC 全 PASS（sp007-diagnostics 15/15、diagnostics-ui 7/7） | 待合入 | 交付完成 |
| agent-quality-and-extensions §R3 供应商兼容（PC-01…PC-08） | 路线图 SP007；矩阵「Provider 运行行为」「配置与模型管理」；CAP-L3-16 | 第二公开协议 Anthropic Messages 适配器；档案 protocol 字段；模型管理预设/验证；错误参数自纠；fixture+真实模型双协议证据 | provider、storage/profiles、TUI 模型管理 | COMPLETE | 同上 | PC 8 条 AC 全 PASS（anthropic 适配器单元；真实端点 UNVERIFIED） | 待合入 | 交付完成 |
| agent-quality-and-extensions §R4 多模态上下文（MM-01…MM-10） | 路线图 SP007；矩阵「文件上下文和附件」 | alt+v/ctrl+v 图片粘贴、路径附件、[Image #N]、5MB base64 上限+PNG 纯 JS 缩放、双协议映射、错误驱动降级、明确拒绝 | TUI 输入/键位、core 消息块、provider 映射、storage 图片缓存 | COMPLETE | 同上 | MM 10 条 AC 全 PASS（image-paste 18/18、image-ui 3/3、live-image 6 形态真实模型 PASS） | 待合入 | 交付完成 |
| agent-quality-and-extensions §R5 评估回归（ER-01…ER-06） | 路线图 SP007；矩阵「基线与任务集」；SP001 O5=B | 固定任务快照 runner+预算+失败分类+盲测保留；≥12 任务覆盖本轮失败类别；真实模型 opt-in；未测能力明列 | scripts/eval、任务 fixture | COMPLETE | 同上 | ER 6 条 AC 全 PASS（sp007-eval 22/22、离线 17/17、真实模型 4 轮） | 待合入 | 交付完成 |
| agent-quality-and-extensions §R6 失败边界与宿主契约（FB-01…FB-04） | 路线图 SP007 出口；矩阵 MCP/Hooks/联网/无头行 | 联网/hooks/MCP 失败不越权回归；headless 契约与产物符合性不劣化 | 跨模块回归 | COMPLETE | 同上 | FB 5 条 AC 全 PASS（failure-boundaries 15/15） | 待合入 | 交付完成 |

## 验收与交接

- 验收口径：每条 AC 至少各一例单元+功能用例（先 RED 后 GREEN）；真实模型/真实进程/UI 证据分层记录；缺凭据或平台能力记 UNVERIFIED 并写恢复条件，不以 mock 冒充。
- 门禁：npm run merge:gate GREEN 后方可推送功能分支；**本轮不合入 master**（用户 m00001 覆盖默认委托）。
- 交接输入（供 SP008/SP011）：子代理权限/预算/取消/工具事件边界、协议适配器契约、诊断采集契约。

## 变更记录

| 日期 | 变更 | 依据 |
| --- | --- | --- |
| 2026-11-21 | 开轮，建立汇总与需求骨架；三路参考侦察完成（b5c9be8） | 用户 m00001/m00014；路线图 SP007 |
| 2026-11-21 | T1–T16 完成并推送功能分支；全量回归 1117 pass / 0 fail | 用户 m00001；design/plan/STATUS |
| 2026-11-21 | 用户反馈图片链路有缺陷 → T17 补测：修复 4 个真实缺陷（中文紧贴路径切分、合法小 PNG 被拒、ctrl+v 无回退、失败吞正文），真实模型 6 形态 PASS | 用户 m02085；test-report §9 |
| 2026-11-21 | 用户授权合入 master + 推送 + 发布前准备（不触发实际 npm 发布） | 用户 m02028 |
