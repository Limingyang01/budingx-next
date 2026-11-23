# SP009 · TUI 独立交付和 npm 发布工程 — STATUS

## 1. 当前有效范围

- 迭代：SP009（用户 2026-11-23 `/buding-sdd 开始SP009` 确认开轮）。
- 需求 slug：`tui-delivery-and-npm-release`；对应路线图功能目录 `tui-distribution`、`upgrade-compatibility`、`npm-publish-pipeline`。
- 有效文档版本：见第 4 节「文件版本」。
- AC：22 条（TD-01–TD-06、UC-01–UC-05、NP-01–NP-10），见 [requirements.md](requirements.md)。
- 分支：`feature/SP009/tui-distribution-and-npm-release`（基线 master `39b8665`）。

## 2. 阶段清单

| 阶段 | 状态 | 说明 |
| --- | --- | --- |
| 需求与状态 | ✅ 完成 | requirements.md 建立；路线图/npm 方案/参考仓机制事实已核对 |
| 事实、来源与边界 | ✅ 完成 | 已核对真实 `package.json` 脚本、`scripts/release/*`、发布台账、CI 工作流、参考仓发布/迁移机制 |
| 正式设计 | ✅ 完成（Agent 自审通过） | [design/design.zh.md](design/design.zh.md) |
| 实施计划 | ✅ 完成（同版自审结论沿用） | [design/plan.zh.md](design/plan.zh.md) |
| 实施 | ⏳ 待做 | 见计划 T1–T12 |
| 测试收口 | ⏳ 待做 | 每条 AC 至少 1 个单元用例 + 1 个功能用例 |
| 交付与恢复 | ⏳ 待做 | 门禁 GREEN → 合入 master → 推送 → 发布前准备 |

## 3. 授权与边界（批准来源）

| 项 | 来源 | 允许的动作 |
| --- | --- | --- |
| 开发授权 | 用户 2026-11-23 `/buding-sdd 开始SP009` | 按正式 SDD 开发 SP009 全部内容 |
| 审查与集成委托 | AGENTS.md「审查与集成委托（USER_CONFIRMED，2026-11-17）」 | Agent 自审；从 master 建 feature 分支；各阶段中文本地提交；门禁 GREEN 后自主合入 master 并自主推送；发布前准备（版本 bump、文档同步、dry-run） |
| 不在委托内 | AGENTS.md 同节 | 打标签、npm 实际发布触发、远端设置、分支/worktree 删除 —— 需单独授权 |

## 4. 文件版本

| 文件 | 版本/哈希 | 备注 |
| --- | --- | --- |
| `SP/SP009/tui-delivery-and-npm-release/requirements.md` | 本轮首版（见 `git log`） | AC 与边界唯一来源 |
| `SP/SP009/tui-delivery-and-npm-release/design/design.zh.md` | v1（本轮首版） | 唯一中文设计正本 |
| `SP/SP009/tui-delivery-and-npm-release/design/plan.zh.md` | v1（本轮首版） | 唯一中文计划正本 |

## 5. 任务与证据（实施后回填）

> 尚未实施，本节保持空白；每完成一个任务即回填「任务 → 文件 → cwd/命令 → 实际数量与结果 → 证据」。

## 6. 提交、合并与推送记录

| 动作 | 结果 | SHA / 说明 |
| --- | --- | --- |
| 功能分支创建 | 已执行 | `feature/SP009/tui-distribution-and-npm-release`，基线 master `39b8665` |
| 阶段本地提交 | 待执行 | 提交说明使用中文 |
| 合入 master | 待执行 | 需 `npm run merge:gate` GREEN |
| 推送远端 | 待执行 | 合入后自主推送并记录远端 SHA |
