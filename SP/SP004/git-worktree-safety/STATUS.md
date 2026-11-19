# Git 与工作树安全 状态

状态：**审查修复已验证，等待用户复审 SP004 功能分支**。

## 当前范围与依据

- [需求 v0.3](requirements.md) · [设计 v1.3](../design/design.zh.md) · [计划 v1.3](../design/plan.zh.md) · [验收报告](../test-report.md)。
- 授权提示显示目标分支、HEAD、补丁与提交信息。Git 写操作统一走受控入口。真实仓库 fixture 检查索引、文件、ref 和实际提交树。
- 文档起点 `363d1eb`，本地 master 核对点 `5b0e7cc`，参考 TUI `b5c9be8`。

## 进度与验收

正式 TUI 注册 Git 状态、专用 worktree 进出与受控提交。临时仓覆盖审批后漂移、索引同步、一次性授权、原工作区保护与 CRLF。 证据见[验收报告](../test-report.md)。

## 2026-11-19 实施完成提交

- `feature/SP004/real-coding-task` 为本次唯一推送目标，master 等待用户复审。
- 每个任务的 RED/GREEN 证据、缺陷定位与 Ruling 记在[实施计划](../design/plan.zh.md)对应任务的「完成事实」与本地执行台账 `.superpowers/sdd/plan.zh/progress.md`（不跟踪进仓）。

## 2026-11-18 还原度对齐提交

- 本次对齐提交（规划与文档对齐，无产品代码）；交叉验证门禁 GREEN，全量 375 项自动化通过。
- **推送已执行**：合并 master 后提交 `8438f1f` 已推送至 `origin/feature/SP004/real-coding-task`，远端 SHA `8438f1fe231acc4c0fad0117c7e833a65e0d7993` 与本地一致（`git ls-remote` 核对）。推送需先配置 Git 凭据助手——本机 Git 自带 `git-credential-manager.exe`，Windows 凭据管理器已存有 GitHub 凭据；配置 `credential.helper` 指向该可执行文件（带空格路径须用 `!"..."` 形式包裹）后推送成功。
- 详见[迭代汇总的提交与推送记录](../requirements-summary.md)。
