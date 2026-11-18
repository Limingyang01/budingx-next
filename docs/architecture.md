# 架构方向与 SP002 实况

当前状态：SP002 的「模型与会话闭环」已按 [SP002 设计](../SP/SP002/design/design.zh.md) 落地（设计 v0.3 approved，2026-11-16），下列边界已成为**已实现事实**；其后各层仍是草案。

## 稳定的逻辑边界

```text
TUI / Desktop / VS Code / future Mobile
                  ↓
     自有应用用例、会话调用与业务事件
                  ↓
            自有 Agent Core
         ↙         ↓          ↘
     模型适配器  工具执行/审批  会话与配置仓库
```

各端不依赖某个常驻进程，可以拥有自己的实例并复用相同核心；共享持久化与活动执行分开，避免多个写者竞争一个会话。**路线图 r8 当前只交付 TUI。SP008 以轻量客户端验证共享与传输入口；其他宿主如需排期，复用 Core 和公开数据边界。**

## SP002 已实现的模块拓扑

```text
src/
  core/        # 事件契约、会话与回合状态机、工具回合、输入队列、消息规范化
  provider/    # OpenAI 兼容适配：SSE 分帧、tool_calls 碎片、错误分类、重试、取消、probe
  storage/     # ~/.budingx 配置与凭据仓库、模型档案、三源合并
  tui/         # Ink 对话界面、渲染 reducer、多行编辑器、审批卡、CLI 入口
```

依赖方向：`tui → core ← provider`、`tui → core ← storage`；core 不 import 其余三者，core/provider/storage 不依赖 UI 或终端库，core 额外不依赖 IO 模块。该边界由 `scripts/checks/module-boundaries.mjs` 在 `npm test` 内强制。

Core 拥有的行为：会话与回合状态机（`idle/requesting/streaming/tool_running/awaiting_approval/cancelling`）、每回合至多一个终态、每回合一次的 `TurnSnapshot` 冻结、执行中输入的 FIFO 队列与双注入边界、取消与 auto-restore、审批最小闭环。Core 通过类型化 `SessionEvent` 对外暴露，事件形状与 UI 无关且可 JSON 序列化。

Provider 只做协议适配：把厂商流翻译成 Core 的 `ProviderEvent`，把错误归入稳定类别并给出机读错误码；它不决定换模型，也不拥有会话状态。Storage 是 `~/.budingx` 的唯一读写方，凭据与档案按 `(id, 主机)` 双键绑定。

## 仍待设计的责任

| 部分 | 建议责任 |
| --- | --- |
| 工具实现与权限 | 输入验证、工作区边界、预览/审批、执行、取消及输出上限（SP003/SP004） |
| 持久化与恢复 | 会话转录持久化、schema、恢复与并发所有权（SP005） |
| 宿主契约 | 进程内/stdio/WS 传输，供 TUI 与未来恢复各端复用（SP006；多端入口验证 SP008） |
| 协议扩展 | 其他模型协议、多模态、跨 Provider 能力矩阵（SP007） |
| 多端共享边界（入口） | 共享模型库与会话存储、并发写保护（SP008，轻量测试客户端验证） |
| 未来 Gateway | 认证、workspace 授权、请求幂等和断线事件恢复；不依赖桌面 UI 开启（范围外的宿主示例，通用传输契约由 SP008 验证） |

系统提示词、业务类型和事件合同独立编写，未复制任何旧 SDK 类型，未把旧应用层接口改名作为新协议。

## 用户数据边界（USER_CONFIRMED）

统一根为 `~/.budingx`，通过 Node `os.homedir()` 解析当前用户 home，不硬编码用户、电脑名称、盘符或 cwd。配置在 `~/.budingx/config.json`，凭据单独存放在 `~/.budingx/credentials.json`，二者分离以便导出普通配置时不含 key。禁止回退、写入或自动导入 `~/.claude` 数据。bootstrap 只使用显式参数/BUDINGX_* 环境变量；SP002 起模型档案可持久化在该根下。

协议/存储 schema 版本独立演进并提供迁移，不能用 npm 版本代替数据版本。
