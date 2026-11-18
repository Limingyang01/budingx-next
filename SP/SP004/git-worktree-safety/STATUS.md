# Git 与工作树安全 状态

生命周期：DOCS-READY（实施待用户放行）｜更新：2026-11-18｜负责人：Agent 执行 SDD（2026-11-17 委托自审），用户验收 master 结果

## 当前范围与依据

- 需求/AC：[requirements.md](requirements.md) v0.2（GW-01…GW-09）
- 设计/计划：[设计 v1.1](../design/design.zh.md)（§7 Git 与工作树安全、§9 审计 F-17/F-18）／ [计划 v1.1](../design/plan.zh.md)（T6–T9、T23、T17 相关）
- 基线：`master` = `76edf2c`；环境 Windows + Node.js >=22.18 + TypeScript
- 当前批准范围：功能名称与出口门槛为 USER_CONFIRMED（路线图 r8 SP004；r6→r7→r8 下范围均未变）；AC 切分为 MODEL_PROPOSED，随设计文档一并自审。设计自审通过后覆盖计划/实施/测试/交付与各阶段本地提交、交叉验证门禁 GREEN 后合入 master 与推送（2026-11-17 委托）；npm 发布/打标签/远端设置不在授权内。**但用户 2026-11-18 指示「先只完成文档，正式开发前等我通知再动手」→ 实施与提交暂停**

## 进度（断线续接入口）

- 阶段清单：[x] 需求 → [x] 设计 → [x] 计划 → [ ] 实施 → [ ] 测试 → [ ] 交付；当前停点：**实施待用户放行**
- 已完成：需求 v0.2（9 条 AC + 2 条 OPEN）；设计 v1.1（§7.1 porcelain 解析 + `--no-optional-locks` + remoteUrl 脱敏、§7.2 改动归属复用 SP003 checkpoint、§7.3 worktree 进出与 slug 校验/恢复复用/keep-remove 退出语义、§7.4 提交门禁与 push 不实现、§9 审计 F-17/F-18）；计划 v1.1（T6–T9、T23）
- 待做（最小下一步）：**待用户放行后** → 执行 T6（Git 只读状态）→ T7（改动归属）→ T8（worktree 进出）→ T9（提交授权门禁）→ T23（Git 状态增强与 worktree 退出语义）
- 最新本地提交：无提交（文档均为工作区未提交文件）
- 阻塞/恢复条件：**用户放行是唯一业务前置**。另（2026-11-18 提交时复核）：分支 `feature/SP004/real-coding-task` **已创建**；先前记录的三项沙箱权限限制（① `.git/index.lock` ② 写 `src/tui/dist/` ③ `node --test` 的 `spawn EPERM`）**三项均已解除**（2026-11-18 复核：构建成功、测试可运行）。实施前仍需复核既有基线：332 项中 1 项（`G01 Ink 隐藏 Key 输入`）为**既有并发隔离缺陷**，非本轮引入（见迭代汇总）。真实 Git 证据使用临时仓库 fixture，不读写用户真实仓库

## 验证与验收

状态：UNVERIFIED。尚未实施，无测试运行。

## 集成与发布

合并、推送、产品发布：**文档已提交并推送**（提交 `84f2004`，分支 `feature/SP004/real-coding-task`，远端 SHA 已核对一致）；产品发布未执行。**本轮禁止在用户真实仓库执行提交/合并/推送**；验证一律使用临时仓库。

## 交接与历史

下一位 Agent 先读 [迭代汇总](../requirements-summary.md) 与本文件。参考仓 Git/worktree 行为事实仅用于能力对照；本仓实现独立编写。审计新增要点：`--no-optional-locks`（避免索引锁争抢）、remoteUrl 脱敏、slug 分段校验、worktree 恢复复用、`keep`/`remove` 退出与残留确认。
