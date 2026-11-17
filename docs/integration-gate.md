# 集成门禁与自审流程（交叉验证自动化）

状态：USER_CONFIRMED 流程（2026-11-17 委托）｜更新：2026-11-17｜配套：[AGENTS.md](../AGENTS.md)、[buding-merge](../skills/buding-merge/SKILL.md)、[buding-sdd](../skills/buding-sdd/SKILL.md)

## 1. 授权与责任划分

用户 2026-11-17 委托（原话要点：「之后不需要人工审查，交给你自行审查，我只负责 master 分支的结果即可，功能分支需要由你严格把控功能以及需求以及 bug 的修复，交叉验证完成后才允许合入 master 分支，以后需要自动化」）：

- **取消常规人工审查**：设计、需求、实现与 bug 修复由 Agent 自审承担；用户只验收 master 结果。
- **功能分支质量责任在 Agent**：功能符合需求、AC 有证据、bug 先 RED 后修复复绿。
- **合入 master 的唯一前置**：交叉验证门禁 GREEN + 自审记录留存；RED 禁止合入。
- **不在委托内**（仍单独授权）：push、npm 发布、远端设置、打标签、分支/worktree 删除。
- 委托长期有效，覆盖后续全部 SP；断线/换会话 Agent 先读本文件与当轮 STATUS/汇总续接。

## 2. 门禁命令与内容

```powershell
npm run merge:gate
```

实现：`scripts/merge/cross-validate.mjs`（纯函数 `scanOutgoingPaths` / `auditReport` 有单测 `scripts/merge/cross-validate.test.mjs`，并入 `npm test`）。检查项：

| # | 检查 | 判定 |
| --- | --- | --- |
| 1 | `npm test` 全段（skills/spec/unit/checks/release/merge 纯函数） | 退出码 0 |
| 2 | `npm run spec:check`（规格自洽 + 禁用措辞） | 退出码 0 |
| 3 | `npm run skills:check`（发现入口同步） | 退出码 0 |
| 4 | `node scripts/release/pack-smoke.mjs`（tarball 隔离安装 + 真实流式请求） | 退出码 0 |
| 5 | outgoing 路径扫描（merge-base..HEAD） | 无依赖/dist/artifacts/.env/凭据/密钥/pnpm-lock/tsbuildinfo |
| 6 | 当轮 test-report 审计 | 无 FAIL 行；UNVERIFIED 须有恢复条件节；报告缺失即 RED |

报告：`artifacts/merge-gate/<branch>-<timestamp>.json` 与 `.md`（gitignored）。含 branch/target/merge-base/HEAD/outgoing commits 与 files、各步退出码、违规路径、FAIL/UNVERIFIED 统计、GREEN/RED 结论。交接与 STATUS 引用报告路径与结论，不粘贴敏感内容。

## 3. 自审记录（门禁之外的人工不可替代部分，由 Agent 完成）

合入前在当轮 `test-report.md` 追加自审节，至少包含：

1. **AC 逐条结论**：PASS/FAIL/UNVERIFIED/NOT_APPLICABLE + 依据（文件/用例/命令/cwd/数量）；UNVERIFIED 写恢复条件。
2. **scoped diff 复核**：master..HEAD 全量引入差异核对——无旧仓代码/提示词/内部类型迁入、无凭据/产物、依赖与许可台账一致、契约两端与存储迁移核对。
3. **分层证据**：L0 纯函数 / L1 伪 TTY e2e / L2 真实进程与制品 / L3 真终端人工（未做即 UNVERIFIED），互不冒充（见 [buding-frontend-testing](../skills/buding-frontend-testing/SKILL.md)）。
4. **bug 闭环**：本轮发现缺陷的 RED→修复→复绿记录；用户截图类缺陷须有 harness 回归用例。
5. **风险与回退**：残留风险、回退方式（分支保留、版本不动等）。

## 4. 合入与合入后

按 [buding-merge](../skills/buding-merge/SKILL.md)：固定源/目标 SHA 与 merge-base → `git merge-tree --write-tree` 预演 → 目标 checkout 正常 merge（保留历史，不 squash/rebase）→ ancestry 证明包含源 → 合入后在 master 复跑适用门禁 → STATUS/汇总记录 merge 结果 SHA 与门禁报告路径。**不 push、不打标签、不删分支**（除非另行授权）。

## 5. RED 处理与自动化边界

- RED：定位失败步 → 修复（产品 bug 走 RED-first；设施问题修设施）→ 重跑门禁；禁止降阈值、删断言、改报告措辞绕过。
- 并行会话：门禁只读committed 范围；工作区存在他会话在途改动时，先协调收口再跑门禁与合入，不集成他人未提交 diff。
- 自动化现状：本地门禁 + 规程已自动化；CI 侧（push 触发 cross-validate workflow）属远端动作，待 push 授权后另行登记启用。

## 6. 变更记录

| 日期 | 变化 | 身份 |
| --- | --- | --- |
| 2026-11-17 | 建立委托流程与门禁脚本；SP002 为首个适用轮 | USER_CONFIRMED 委托；流程文档 |
