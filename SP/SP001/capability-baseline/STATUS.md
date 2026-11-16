# 能力盘点与基线 状态

生命周期：ACCEPTED（用户 2026-11-16 验收通过；规格轮，产品零实现）｜更新：2026-11-16｜负责人：待指定

## 当前范围与依据

- 需求/AC：[requirements.md](requirements.md) v1（AC-01…AC-10，均为 MODEL_PROPOSED）
- 核心产物：[capability-manifest.md](capability-manifest.md) v1（85 项；必交 53 / 建议 22 / 可选 9 / 范围外 1）
- 设计/计划：[design.zh.md](../design/design.zh.md) v1 **approved**（用户 2026-11-16 批准）／ [design.en.md](../design/design.en.md) v1 approved（英文为执行依据）；[plan.zh.md](../design/plan.zh.md) v1 ／ [plan.en.md](../design/plan.en.md) v1（已执行完毕）
- 基线：仓库 HEAD `2ced5e4`（`feat : npm release package workflow`）；工作区有用户既有未提交改动，未触碰。对照基线为 `D:\extra_project\buding-worker-space`（`budingx` 0.5.0，私有未开源），只读盘点，未读取源码内容 / `.env` / 聊天历史，未运行，未写入
- 当前批准范围：**仅规格**。用户 2026-11-16 批准本轮交付规格，未批准实现、提交、合并、推送、发布或建分支

## 进度

- 已完成：
  - 对照基线只读盘点：入口与运行形态、TUI 交互面（命令 92 目录 + 20 散文件、组件 423 文件、键位 20 个上下文块、Vim 模块）、工具面（58 工具目录）、权限（7 模式）、Hook（28 事件 × 4 处理器）、持久化（JSONL + 11 项迁移）、无头输出（text/json/stream-json）、多端形态、规模统计（`src/` 2,360 文件 / 602,826 行；TUI 可交互层约 871 文件 / 16.6 万行）
  - 能力清单 v1 定稿，四层 85 项，含来源与处理决定表
  - T-001 步骤 1–10 逐条执行完毕：清单经脚本实算复核，**初稿统计为目测估计（87/48），已按实算值修正为 85/53**；修正同步到设计、计划、汇总与仓库文档
  - 新增 `npm run spec:check` / `spec:test` 门禁，把「必交能力被静默降级」从「无测试会失败」变成有可执行拦截
  - 用户授权原话登记（四项决定 + Node-only 追加）
- 待做：
  - 无本轮待做；OPEN-01/03 留待后续轮次按默认处理
- 阻塞/恢复条件：
  - 本轮**无原产品效果基线**（用户选择静态盘点，不运行旧 Agent）。**用户决议（2026-11-16，O5=B）：不授权采集原产品效果基线**；效果对比永久采用「自有能力测量 + 能力清单覆盖度」口径，原恢复条件（单独授权 + 凭据 + 版本固定）失效
  - OPEN-01：`建议`/`可选` 项是否升格为 `必交`（默认不升格，升格需用户确认）
  - OPEN-02：原产品效果基线的采集授权与时点 —— **已决（O5=B，不授权采集）**
  - OPEN-03：是否记录原产品的具体 commit 作为可追溯锚点（本轮未采集旧仓 Git 历史；O5=B 后无对照需求，维持现状）

## 验证与验收

状态：**PASS 9 / FAIL 0 / UNVERIFIED 0**（本需求共 10 条 AC）。

逐条走查记录见 [SP001 验证报告](../test-report.md)；本需求条目位于该报告的「结果 · AC 逐条走查」对应小节。验证层级分「门禁」（由 `npm run spec:check` 自动判定）与「人工」（对产物逐条核对，规格类 AC 的既定方式）。

- 门禁命令：`npm run spec:check`（exit 0）、`npm run spec:test`（7 项通过）、`npm test`（全量 44 项通过：skills 9 / spec 7 / tui 12 / release 16），cwd 均为仓库根。
- 未验证项与恢复条件见验证报告「缺口与结论」。
- 范围提醒：本轮是**规格轮**，PASS 指规格条款被满足，**不代表任何产品能力已实现**。

## 集成与发布

提交、合并、推送、产品发布：**均未执行**。工作区保持用户既有改动，未 stage、未 commit、未 push、未改动远端。

## 交接与历史

- 下一位 Agent 先读：[requirements.md](requirements.md)、[capability-manifest.md](capability-manifest.md)、[design.zh.md](../design/design.zh.md) §3.1 与 §3.5。
- 最早未完成步骤：无；本轮已验收，下一步为 SP002（需用户授权启动）。
- 剩余风险：清单粒度与实现粒度不匹配（R6）；静态盘点无法发现「有但不可用」的能力（R7，由评测集与真实进程 smoke 兜底）。
- 批准历史：2026-11-16 用户批准本轮交付规格与四项取证/技术决定；同日第二批：验收通过（转 ACCEPTED）、设计 v1 批准、O1=A（包名沿用）、O2=A（Windows 先行）、O5=B（不采集原产品基线）；门禁复跑用户确认暂不执行（本轮改动为纯文档）。未批准实现与任何 Git 动作。
