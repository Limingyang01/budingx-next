# Git 与工作树安全 状态

状态：**已合入 master（合并提交 `fdfdae8`），已随 [0.4.0](../../../release-notes/v0.4.0.md) 发布**（T6–T9、T23、T25 完成；GW-01…09 已回填）。

## 当前范围与依据

- [需求 v0.3](requirements.md) · [设计 v1.3](../design/design.zh.md) · [计划 v1.3](../design/plan.zh.md) · [验收报告](../test-report.md)。
- 授权提示显示目标分支、HEAD、补丁与提交信息。Git 写操作统一走受控入口。真实仓库 fixture 检查索引、文件、ref 和实际提交树。
- 文档起点 `363d1eb`，本地 master 核对点 `5b0e7cc`，参考 TUI `b5c9be8`。

## 进度与验收

需求、设计、计划 v1.3 已确认放行（用户 2026-11-18「继续开发SP004」）。T6–T9、T23、T25 全部完成并逐任务红绿取证：`npm test` 615/615 通过（unit 572），`npm run test:checks`、`spec:check`、`skills:check` 通过。GW-01…09 逐条映射到实际用例与计数，见[验收报告](../test-report.md) §4。提交经专用 worktree + 临时索引构造核准树，失败不覆盖 ref；删除 worktree 需宿主单次授权与残留计数。

## 2026-11-19 实施完成提交

- 30 个本地提交（HEAD `1f166fb`），分支 `feature/SP004/real-coding-task`；未合入 master，等待 `npm run merge:gate` GREEN 后按 buding-merge 规程合入并推送。
- 每个任务的 RED/GREEN 证据、缺陷定位与 Ruling 记在[实施计划](../design/plan.zh.md)对应任务的「完成事实」与本地执行台账 `.superpowers/sdd/plan.zh/progress.md`（不跟踪进仓）。

## 2026-11-19 T25 补记（合入后）

- 按设计 §7.3/§8 补齐 `EnterWorktree {name?}` / `ExitWorktree {action, discard_changes?}` 工具表面：`src/git/tools.ts`（会话级状态、参数严格校验、默认 keep、remove 需 `ToolContext.approved` 与 `discard_changes`），`src/git/test/tools.test.mjs` 8 项协议级用例（含真实仓库 fixture 与 Session 级强制审批）。
- 新增 `ToolHandler.mandatoryApproval` 与 `ToolContext.approved`：不可逆删除在全自动档位、会话记忆允许下仍必须经宿主审批（不复用 `requiresApproval`，避免破坏 SP003「本会话允许」语义）。
- RED：移除工具面 → 模块缺失 0/1；仅移除强制审批分支 → 8 项中 T25-8 失败。GREEN 8/8，全量 615/615。
- 限制：工具面未接入生产 runtime（进入隔离工作树后命令与文件工具仍需会话 cwd 重绑定，属 SP005），验收报告 §5 记 UNVERIFIED。

## 2026-11-18 还原度对齐提交

- 本次对齐提交（规划与文档对齐，无产品代码）；交叉验证门禁 GREEN，全量 375 项自动化通过。
- **推送已执行**：合并 master 后提交 `8438f1f` 已推送至 `origin/feature/SP004/real-coding-task`，远端 SHA `8438f1fe231acc4c0fad0117c7e833a65e0d7993` 与本地一致（`git ls-remote` 核对）。推送需先配置 Git 凭据助手——本机 Git 自带 `git-credential-manager.exe`，Windows 凭据管理器已存有 GitHub 凭据；配置 `credential.helper` 指向该可执行文件（带空格路径须用 `!"..."` 形式包裹）后推送成功。
- 详见[迭代汇总的提交与推送记录](../requirements-summary.md)。
