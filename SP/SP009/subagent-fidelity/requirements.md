# SP009 追加 · subagent-fidelity — 需求（0.9.1）

状态：正式 SDD（Agent 自审对象）。来源：用户 2026-11-23 截图反馈——「在使用子agent的时候出现预算限制而中断，并且会将不属于用户信息的内容展示出来，也需要修复到0.9.1中；修复方式一样参考 D:\extra_project\buding-worker-space 的 tui 的子agent 的功能」。

关联：[loop-context-fidelity LF-03](../loop-context-fidelity/requirements.md)（子代理无默认预算）。

## 1. 目标与 AC

- **SF-01（U+F）**：后台子代理终态通知按**系统消息**渲染：转录里出现一行简洁通知（`子代理「desc」已结束（status）`），**不得**把原始 `<task-notification>…</task-notification>` XML 当作「用户输入」紫块展示。
- **SF-02（U）**：队列预览使用简洁通知文本，不显示 XML 首行。
- **SF-03（U+F）**：通知 XML 仍然送达模型上下文（模型需要知道后台任务已结束），只是不在 UI 上原样展示。
- **SF-04（U+F）**：通知在「空闲自动开回合」与「回合内注入」两条路径都按系统消息渲染；现有的 `agent_notification` 一行提示保留。
- **SF-05（U）**：任务完成/取消/失败（含 cancelled、budget 仅显式设置时）都走同一渲染规则。

## 2. 参考机制对照（只读事实）

| 参考仓 | 本仓 0.9.1 落地 |
| --- | --- |
| `task-notification` 作为 `isMeta` 消息注入模型上下文，UI 渲染为系统通知卡片而非用户输入 | 事件新增 `notification`/`display` 字段，reducer 把通知回合/注入渲染为 `meta` 系统行，XML 仅进模型上下文 |
| 子代理默认无 maxTurns、无 token 预算（常规子代理） | 见 LF-03：默认无迭代/预算上限，显式配置才启用 |

## 3. 边界

- 不改 `agent_*` 生命周期事件与卡片渲染（SP007 已验收）。
- 不改通知进入模型上下文的 XML 形状（模型契约）。
- 不改 token 预算的显式启用路径（保留能力）。
