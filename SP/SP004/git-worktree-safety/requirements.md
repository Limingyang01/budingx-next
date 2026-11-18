# git-worktree-safety · Git 与工作树安全

状态：ACTIVE（2026-11-18 开轮；v0.2 经参考仓审计修订）｜版本：v0.2｜来源：路线图 SP004（USER_CONFIRMED）+ 参考仓行为事实盘点与只读审计（只读参考）

## 目标

Agent 面对 Git 仓库时能识别工作区状态、隔离自己的改动、不触碰用户无关改动；无明确授权时不执行提交、合并、推送等写操作；需要隔离时能进入/退出 worktree（退出可选择保留或移除，移除前有残留确认），失败可恢复。

## 边界

- 只做**只读状态识别 + 改动归属 + worktree 进出 + 写操作门禁**。
- 不做 PR/GitHub 集成与审查命令族（`/commit`、`/review` 等属 SP006/SP007 范围外，SP004 仅交付安全门与只读能力）。
- 不做子代理级 worktree 隔离（SP011 要求更强，本轮只交付会话级）。
- **不做** hook 驱动的 worktree 包装（参考 F-18 有，本轮只做纯 git 路径，hook 包装留 SP006）。
- **不做**切分支前自动 stash（参考有，AGENTS.md 禁止自动 stash/reset）。

## 参考对照点

来源：[排查文档 §4 SP004/§3.3](../../../docs/reference-tui-replication-audit.md)、[能力矩阵 Git 与 worktree 条目](../../../docs/agent-capability-matrix.md)、[参考仓事实 §6/§8](../../../skills/buding-sdd/references/reference-repo-inventory.md)、**2026-11-18 参考仓只读审计（见[设计 §9](../design/design.zh.md)，F-17/F-18）**。

| 锚点 | 参考行为 | 本轮目标 |
| --- | --- | --- |
| 矩阵 §Git 与 worktree | 识别脏工作区、暂存/untracked、多项目和 worktree；用户无关改动不丢失；review diff 有依据；只有明确授权才提交/合并/推送；不自动 stash/reset/删除分支；隔离失败可恢复 | 行为等价 |
| 参考 §3.3 | `EnterWorktree` / `ExitWorktree` 工具表面，会话级 | 行为等价（会话级） |
| 参考 F-17 | Git 状态用 `git --no-optional-locks status --porcelain`；`GitRepoState` 含 `commitHash`/`branchName`/`remoteUrl`/`isHeadOnRemote`/`isClean`/`worktreeCount` | 行为等价（**必须带 `--no-optional-locks`** 避免索引锁争抢）；三分类 + conflicted 比参考更细，属加强 |
| 参考 F-18 | slug 分段校验（≤64 字符、每段仅字母数字点下划线连字符、禁 `.`/`..`）；分支名 `worktree-<flattenSlug>`（`/`→`+`）；已存在 worktree **恢复复用**；退出 `keep`/`remove`，`remove` 有未提交/未合并时**必须 confirm**否则拒绝并列出；回执含 `discardedFiles`/`discardedCommits` | 行为等价 |
| 参考 F-08 | 破坏性 git 命令只警告不阻断 | 行为等价（见 `command-execution` CE-18） |
| 参考 §6 | `/branch`、`/commit`、`/review` 等命令族 | 本轮不交付命令族，仅交付底层能力与门禁 |

## TUI 还原度对本需求的约束（2026-11-18 对齐）

用户 2026-11-18 要求针对参考仓 buding-worker-space 还原能力与 TUI 布局/UI/交互，作为 SP001–SP016 的**横向约束**落地（[路线图 r9](../../../docs/iteration-plan.md)「TUI 还原度要求」、[还原度基线](../../../docs/tui-fidelity-gap-baseline.md)、设计 §9.7）。**本需求的 AC、依赖与出口门槛不变。**

本需求在还原度上的义务：

- **命令卡片随能力同步交付**：命令文本、解释器、退出码、输出摘要（含截断标记）四项在卡片中可见；不允许「能力已实现但卡片未接线」。
- **不预支 SP006**：本轮不改四区骨架排布，不在 src/tui/render 内引入虚拟列表、冻结缓存、帧缓冲差分或上下文键位系统；卡片动画与折叠汇总属 SP006。
- **边界不放宽**：权限模式仍固定三档；仍按「读机制、不抄代码」；参考副本中的 no-op stub 工具目录不作为能力来源。

## 验收条件（AC）

- **GW-01** Given 仓库存在已暂存修改，When Agent 读取仓库状态，Then 区分 staged / unstaged / untracked / conflicted 四类并分别计数；Git 调用带 `--no-optional-locks`；返回 `remoteUrl`（**凭据脱敏后**）、`isHeadOnRemote`、`worktreeCount`。
- **GW-02** Given 工作区为脏，When Agent 准备修改文件，Then 不 reset、不 stash、不丢弃用户改动，用户无关改动在修改后仍存在。
- **GW-03** Given Agent 本轮修改了文件，When 生成改动摘要，Then 只包含 Agent 自己的改动，不混入用户既有改动。
- **GW-04** Given 未获授权，When 模型请求提交/推送，Then 该动作被拒绝并记录拒绝原因，仓库状态不变；**导出面无 push 能力**。
- **GW-05** Given 仓库存在多个 worktree，When 进入隔离工作树，Then 新建独立目录且不影响主工作区已有改动；**目标 worktree 已存在时恢复复用**而非重复创建。
- **GW-06** Given 处于隔离工作树，When 退出，Then 主工作区状态保持原样；默认 `keep` 保留 worktree 与分支；显式 `remove` 时若有未提交文件或未合并提交，**未确认则拒绝并列出残留项**，确认后移除并在回执中给出 `discardedFiles`/`discardedCommits` 计数。
- **GW-07** Given worktree 创建失败（名称冲突、目录权限、磁盘满）或 slug 非法（>64 字符、空段、含 `.`/`..`），Then 明确失败并回落到原工作目录，不留下半成品状态。
- **GW-08** Given 仓库不是 Git 仓库或 git 不可用，When 执行 Git 相关能力，Then 明确报告「非 Git 仓库」/「git 不可用」而不是伪造状态。
- **GW-09** Given Agent 需要提交，When 提交被授权，Then 提交范围仅含 Agent 自己的改动（不夹带用户无关改动），且提交前展示将要纳入的文件清单；提交前重新校验范围清单，漂移则拒绝。

## 开放问题

- OPEN-01：worktree 隔离目录位置。默认方案：默认放在用户数据根 `~/.budingx/worktrees/<repo-slug>/<name>`（与项目目录分离，避免污染仓库），可通过参数指定；用户未授权删除时不自动清理。
- OPEN-02：`GW-09` 的提交能力本轮交付「可执行的受控提交」+「提交前范围分析与清单产出」；提交信息由用户提供或 Agent 生成但**须用户确认**；**push 不实现**。

## 身份

AC 切分为 MODEL_PROPOSED，随设计文档自审；功能名称与出口门槛为 USER_CONFIRMED（路线图 r8；r6→r7→r8 下 SP004 范围均未变）。
