# Provider 流式与工具调用 · provider-streaming

状态：APPROVED（v0.1 用户 2026-11-16 会话「批准」）｜迭代：SP002｜来源身份：USER_CONFIRMED（未指定服务→通用设计）+ 路线图（USER_CONFIRMED 名称与出口）+ MODEL_PROPOSED（AC 切分）

## 来源与目标

- USER_CONFIRMED（2026-11-16）：用户「没有指定哪家服务」→ 按 OpenAI 兼容接口通用设计（base URL + key + 模型名），不绑定厂商。「live 证据延后到验收时提供凭据」是 Agent 转述的默认处理，用户未反对。
- 路线图 SP002 出口（USER_CONFIRMED）：「真实模型配置与流式交互、工具回合、取消和错误有证据」。
- 能力矩阵「Provider 运行行为」行（USER_CONFIRMED 范围）：流式碎片/中断、多个工具调用、错误参数、上下文上限、限流/网络错误、重试和取消有 fixture + 真实模型证据；**不能无界重试或静默换模型**。
- SP001 交接：一次明确迁移 `src/tui` 现有 SSE 分帧与错误归一（core-boundaries AC-12）；I-01 检查（依赖白名单 + lint）由本轮落地（AC-02 指派）。
- 机制参考（行为级，不抄代码）：[旧仓机制盘点](../attachments/old-repo-mechanism-inventory.md) §1 的回合续跑信号、重试可见事件、孤儿消息 tombstone、显式 fallback 决策。

## 范围与非目标

**范围**：provider 从 CLI 迁出为独立模块（目录以获批设计为准，服务层）；沿用并扩展现有 `streamChat` 的 SSE 分帧、HTTPS/loopback 校验、大小与超时限制；新增 `tool_calls` 跨事件碎片组装与调用列表产出；错误分类（稳定错误类别 + 机读码）；有界重试（尊重 Retry-After，重试以事件上报）；AbortSignal 取消传播；可配置限额。
**非目标**：真实工具实现（SP003/SP004）；Anthropic 等其他协议与跨 Provider 能力矩阵（SP007）；多模态（SP007）；fallback 模型的**决策**（属会话层，本层只提供机制）；live 运行（凭据 OPEN，见 PS-08）。

## 验收条件

| AC ID | 输入 / 动作 | 可观察结果 | 验证方式 |
| --- | --- | --- | --- |
| PS-01 | 录制流 fixture：事件任意 TCP 分片、CRLF、多行 data、注释行、`[DONE]` | 解析出与现 `src/tui` 等价的文本流；迁移不减少既有行为回归 | Node test runner（node --test）fixture（v0.2 勘误：统一 node --test，非 Vitest） |
| PS-02 | fixture：多个并行 tool_calls、arguments 跨事件、缺 index、非法 JSON | 组装出完整调用列表（id/name/arguments）；非法参数归一为结构化错误项；进程不崩 | fixture + 单测 |
| PS-03 | 401/403/404/429/5xx/网络失败/超时/流截断/非法事件/上下文超限各构造一次 | 各自独立错误类别与用户可读 message + 稳定机读错误码；任何消息与日志不含 key 明文 | 单测 + 断言输出 |
| PS-04 | fixture：429 带/不带 Retry-After、连续 5xx | 指数退避重试、等待尊重 Retry-After、次数达上限后明确失败；每次重试发出可见事件；**无静默换模型**（provider 层无此能力路径） | 假时钟单测 |
| PS-05 | 流式中途 abort | 有界时间内 fetch/reader 终止；错误类别为 cancelled；无未处理 rejection；不产生半解析事件泄漏给上层 | 单测 |
| PS-06 | 超限输入：单事件超大、响应超长、慢流 | 各限额触发明确错误；限额可配置，默认值有文档 | 单测 |
| PS-07 | 运行依赖白名单 + lint 检查（本 AC 落地检查脚本） | provider 模块无 UI/终端库 import；厂商响应类型不出 provider 边界，上抛自有事件/delta 类型；检查在 `npm test` 内可失败 | 脚本 + CI 可见 |
| PS-08 | 用户提供任一真实服务凭据与预算后执行验收 | 真实服务完成：流式一轮、含 tool_calls 回合一次、手动取消一次、错误（错误 key 或断网）一次；记入 test-report | live；**无凭据则 UNVERIFIED**，恢复条件=验收时补 |

## 依赖、风险与开放问题

- 依赖：设计定 provider 模块目录与事件类型名（与 session-lifecycle 契约对齐）；`src/tui` 迁移不得破坏已发布 0.1.1 行为（先补行为回归再动刀）。
- 风险：OpenAI 兼容网关对 tool_calls 流式实现参差（如 reasoning 字段、无 index 碎片）→ 以宽容解析 + 显式错误处理，差异登记到能力矩阵「Provider 运行行为」。
- OPEN：live 凭据与费用预算（验收时由用户提供）。

## 批准与变更

- 本文 v0.1 已获用户批准（2026-11-16 会话答复「批准」，对应 Agent 提议「批准，进设计」）；**设计、实施、提交、发布仍未授权**。
- 变更记录见 [STATUS](STATUS.md)。
