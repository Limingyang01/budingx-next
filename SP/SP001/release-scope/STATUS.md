# 发布范围与运行条件 状态

生命周期：ACCEPTED（用户 2026-11-16 验收通过；规格轮，未执行任何发布）｜更新：2026-11-16｜负责人：待指定

## 当前范围与依据

- 需求/AC：[requirements.md](requirements.md) v1（AC-01…AC-12，均为 MODEL_PROPOSED）
- 设计/计划：[design.zh.md](../design/design.zh.md) v1 **approved** §3.4（用户 2026-11-16 批准）／ [design.en.md](../design/design.en.md) v1 approved §3.4；[plan.zh.md](../design/plan.zh.md) v1 ／ [plan.en.md](../design/plan.en.md) v1（已执行完毕）
- 基线：仓库 HEAD `2ced5e4`；已发布事实为 npm `budingx` 0.1.0 / 0.1.1（public，MIT，GitHub Actions + Trusted Publishing 首发，`latest` → 0.1.1），台账 `release-ledger.json`
- 相关既有文档：`docs/npm-release-plan.md`、`docs/versioning.md`、`skills/buding-npm-release`、`.github/workflows/publish-tui.yml`
- 当前批准范围：**仅规格**。用户 2026-11-16 批准本轮交付规格并追加「基于 node，不要依赖于 bun」；**未批准发布、改版本、推标签、提交、合并、推送或远端设置变更**

## 进度

- 已完成：
  - 发布范围表（形态 / 包名 / 平台 / 运行条件 / 凭据 / 用户数据 / 许可 / 授权 / 回执 / 制品独立性）
  - 三态平台矩阵（当前只声明 Windows 已验证）
  - 发布节奏（SP006 骨架 → SP009 一键发布 → SP015 制品复验 → SP016 验收）
  - 四条待决项登记，每条含影响、默认处理与决策人
  - T-004 步骤 1–11 逐条执行完毕：制品形态、包名策略、三态平台矩阵、运行条件、凭据与用户数据边界、许可要求、授权与回执要求均已写入设计 §3.4
- 待做：
  - 无本轮待做；OPEN-03/OPEN-04 留待 SP006 处理账号归属，其他端分发属于范围外
- 阻塞/恢复条件：
  - OPEN-01（**包名策略**）—— **已决（用户 2026-11-16，选 A）**：完整 Agent 制品沿用 `budingx` 同名；预览版用户将收到破坏性升级，SP006/SP009 必须提供升级/迁移说明并把关 `latest` 升级路径
  - OPEN-02（**平台范围**）—— **已决（用户 2026-11-16，选 A，维持默认）**：只声明 Windows 已验证；macOS/Linux 在 SP009 打包工程后逐个验证
  - OPEN-03（**发布账号与签名归属**，决策人：用户）：默认沿用现有 GitHub Actions + Trusted Publishing 路径与现有账号，不新增发布方
  - OPEN-04（**桌面/扩展分发渠道**，决策人：用户）：默认只保证可安装制品，不承诺应用商店上架
  - 风险：当前已发布的 0.1.1 是 bootstrap 预览，**不得**用作「达到原 Agent 水平」的证据

## 验证与验收

状态：**PASS 12 / FAIL 0 / UNVERIFIED 0**（本需求共 12 条 AC）。

逐条走查记录见 [SP001 验证报告](../test-report.md)；本需求条目位于该报告的「结果 · AC 逐条走查」对应小节。验证层级分「门禁」（由 `npm run spec:check` 自动判定）与「人工」（对产物逐条核对，规格类 AC 的既定方式）。

- 门禁命令：`npm run spec:check`（exit 0）、`npm run spec:test`（7 项通过）、`npm test`（全量 44 项通过：skills 9 / spec 7 / tui 12 / release 16），cwd 均为仓库根。
- 未验证项与恢复条件见验证报告「缺口与结论」。
- 范围提醒：本轮是**规格轮**，PASS 指规格条款被满足，**不代表任何产品能力已实现**。

## 集成与发布

提交、合并、推送、产品发布：**均未执行**。产品版本未变更，仍为 `src/tui/package.json` 的 0.1.1；未打标签、未改远端。

## 交接与历史

- 下一位 Agent 先读：[requirements.md](requirements.md)、[design.zh.md](../design/design.zh.md) §3.4、[docs/npm-release-plan.md](../../../docs/npm-release-plan.md)。
- 最早未完成步骤：无；本轮已验收，OPEN-01/02 已拍板。发布动作仍待各轮单独授权。
- 剩余风险：包名冲突未决前若误发布，会覆盖已安装的预览版（R5）。
- 批准历史：2026-11-16 用户批准本轮交付规格；Node-only 追加确认；同日第二批：验收通过（转 ACCEPTED）、设计 v1 批准、OPEN-01=A（沿用 `budingx` 同名）、OPEN-02=A（Windows 先行）；门禁复跑用户确认暂不执行。发布动作仍需单独授权。
