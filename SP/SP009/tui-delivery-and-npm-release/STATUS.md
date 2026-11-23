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
| 实施 | ✅ 完成 | T1–T14 全部落地（发布编排/判定/生命周期/版本检查/恢复命令/技能显示/导出选择） |
| 测试收口 | ✅ 完成 | 全量单测 1250 / 1249 通过 / 0 失败 / 1 跳过；发布工具 56/56；定向 TUI 7/7 |
| 交付与恢复 | ⏳ 进行中 | 门禁 GREEN → 合入 master → 推送 → 发布前准备 |

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

## 5. 任务与证据

| 任务 | 文件 | 实际结果 |
| --- | --- | --- |
| T1 发布判定层 | `scripts/release/pipeline.mjs` + `pipeline.test.mjs` | 19/19 通过（通道规则、失败分类、发行说明结构、上传结果判定） |
| T2 发布编排 | `scripts/release/publish-core.mjs`、`publish.mjs` + `publish.test.mjs` | 8/8 通过（dry-run 无副作用、门禁失败、同版本拒绝、E403 分类、回执不确定、完整发布、说明缺小节、预发布 latest） |
| T3 npm 调用注入 | `scripts/release/process.mjs` | 统一 `--cache`（置于 `--` 之前）、npm CLI 兜底定位；真实门禁验证 |
| T4 生命周期门禁 | `scripts/release/lifecycle.mjs` + `lifecycle.test.mjs` | install/upgrade 真实执行 PASS；3/3 夹具单测 |
| T5 生命周期入口 | `package.json` `test:install`/`test:upgrade` | 两条命令均 0 退出 |
| T6 上传结果判定 | `scripts/release/resolve.mjs` + `resolve.test.mjs` | 5/5 通过（只读、四种结论与退出码） |
| T7 版本一致性 | `scripts/release/version-check.mjs` + `version-check.test.mjs` + `version:check` | 9/9 通过；真实仓库抓到并修复 `PRODUCT.md` 0.7.0/0.8.0 漂移 |
| T8 发行说明骨架 | `scripts/release/version.mjs` + `version.test.mjs` | 草稿含五小节；6/6 通过 |
| T9 CI 同源 | `scripts/release/workflow.test.mjs`、`options.mjs` | 4/4 通过 |
| T10 文档同步 | `PRODUCT.md`、`src/tui/README.md`、`docs/npm-release-plan.md`、`docs/github-actions-npm.md`、`docs/current-status.md`、`docs/iteration-plan.md`、`.gitignore` | 已完成；`version:check` PASS |
| T11 测试收口 | 各 `*.test.mjs` | 全量 1250/1249/0/1；发布工具 56/56；定向 TUI 7/7 |
| T16（用户报缺陷） | `src/workspace/paths.ts`、`src/workspace/policy.ts`、`src/tui/runtime.ts` + 两个测试 | 全自动档位不再被工作区边界拦截；另两档与地板规则不变；策略 11/11、读取 11/11 |
| T12–T14（用户追加） | 技能显示与导出选择实现 + `sp009-*.test.mjs` | 技能 3/3、导出 4/4 通过；`/export` 非交互保持旧行为（回归修复 1 处） |

## 6. 提交、合并与推送记录

| 动作 | 结果 | SHA / 说明 |
| --- | --- | --- |
| 功能分支创建 | 已执行 | `feature/SP009/tui-distribution-and-npm-release`，基线 master `39b8665` |
| 阶段本地提交 | 待执行 | 提交说明使用中文 |
| 合入 master | 待执行 | 需 `npm run merge:gate` GREEN |
| 推送远端 | 待执行 | 合入后自主推送并记录远端 SHA |
