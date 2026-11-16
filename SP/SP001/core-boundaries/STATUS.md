# 核心边界与架构不变量 状态

生命周期：ACCEPTED（用户 2026-11-16 验收通过；规格轮，产品零实现）｜更新：2026-11-16｜负责人：待指定

## 当前范围与依据

- 需求/AC：[requirements.md](requirements.md) v1（AC-01…AC-13，均为 MODEL_PROPOSED）
- 设计/计划：[design.zh.md](../design/design.zh.md) v1 **approved** §3.2（用户 2026-11-16 批准）／ [design.en.md](../design/design.en.md) v1 approved §3.2；[plan.zh.md](../design/plan.zh.md) v1 ／ [plan.en.md](../design/plan.en.md) v1（已执行完毕）
- 基线：仓库 HEAD `2ced5e4`；`src/` 下目前只有 `tui/` 一个模块，**尚无** `core/`、`provider/`、`tools/`、`storage/`、`host/`
- 相关既有文档：`docs/architecture.md`（逻辑边界草案，DRAFT）、`docs/repository-layout.md`
- 当前批准范围：**仅规格**。用户 2026-11-16 批准本轮交付规格，并确认「Core 零框架，TUI 层允许 MIT 终端框架」与「基于 node，不要依赖于 bun」；未批准实现、提交、合并、推送或发布

## 进度

- 已完成：
  - 四层责任到目录的映射（`src/{core,provider,tools,storage,host,tui}`）
  - 不变量 I-01…I-12，每条含规则文本与落地检查方式
  - 五类契约方向表（定义方 / 消费方 / 失败责任），只定责任不定字段
  - 端无关与可取消的最低要求
  - 本仓复用清单（`src/tui` 的 config / provider / cli 三处）
  - 禁止迁入清单（旧仓 Agent 循环、提示词、SDK 类型、全局状态、bundle）
  - T-003 步骤 1 执行完毕：`docs/repository-layout.md` 已与 §3.2 蓝图对齐，归一了 `providers/`→`provider/`、`protocol/`→`host/`，并登记后续迭代模块名（desktop/vscode/gateway/adapters/scheduler/mobile），避免后续改名
- 待做：
  - 无本轮待做；I-01/I-09 的可执行检查（依赖白名单 + lint）由 SP002 落地
- 阻塞/恢复条件：
  - OPEN-01：Core 是否独立成 npm 包（默认同仓 `src/core` 目录，SP002 确认）
  - OPEN-02：跨端共享存储的并发模型（默认会话级单写者 + 其他端只读观察，SP010 落地）
  - OPEN-03：终端 UI 框架具体选型与 MIT 许可确认（SP002 决定，未确认前不得进入依赖）
  - 风险：若不把 I-01/I-09 落成可执行检查（依赖白名单 + lint），数轮后必然被打破 → 由 SP002 承担

## 验证与验收

状态：**PASS 13 / FAIL 0 / UNVERIFIED 0**（本需求共 13 条 AC）。

逐条走查记录见 [SP001 验证报告](../test-report.md)；本需求条目位于该报告的「结果 · AC 逐条走查」对应小节。验证层级分「门禁」（由 `npm run spec:check` 自动判定）与「人工」（对产物逐条核对，规格类 AC 的既定方式）。

- 门禁命令：`npm run spec:check`（exit 0）、`npm run spec:test`（7 项通过）、`npm test`（全量 44 项通过：skills 9 / spec 7 / tui 12 / release 16），cwd 均为仓库根。
- 未验证项与恢复条件见验证报告「缺口与结论」。
- 范围提醒：本轮是**规格轮**，PASS 指规格条款被满足，**不代表任何产品能力已实现**。

## 集成与发布

提交、合并、推送、产品发布：**均未执行**。

## 交接与历史

- 下一位 Agent 先读：[requirements.md](requirements.md)、[design.zh.md](../design/design.zh.md) §3.2、[docs/architecture.md](../../../docs/architecture.md)。
- 最早未完成步骤：无；本轮已验收，下一步为 SP002（需用户授权启动）。
- 剩余风险：Core 零框架若无强制检查会被打破；边界过细会产生大量接口层（本轮按四层 + 四个契约方向保持最小）。
- 批准历史：2026-11-16 用户确认「Core 零框架、TUI 层允许 MIT 终端框架」与 Node-only；同轮批准本轮交付规格；同日第二批：验收通过（转 ACCEPTED）、设计 v1 批准；门禁复跑用户确认暂不执行。未批准实现与任何 Git 动作。
