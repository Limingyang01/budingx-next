# SP003 · 工作区与安全修改

状态：ACTIVE（迭代已开轮：2026-11-17）｜更新：2026-11-17｜负责人：Agent 执行 SDD（2026-11-17 委托自审），用户验收 master 结果

## 本轮目标与边界

- 目标：交付「工作区与安全修改」——Agent 可在受控工作区内读取、搜索、编辑文件，改动可预览、可撤销、可追溯；权限按用户固定三模式（仅可查看 / 工作区内修改 / 完全权限）判定，越界与被拒绝时磁盘不变。出口以路线图 SP003 行为准：跨目录搜索、编码/CRLF/大文件/忽略规则、补丁冲突、目录穿越/junction 越界有回归；拒绝写入磁盘不变，diff 与实际修改一致，用户无关改动保留；三权限模式切换与边界有回归。
- 功能目录（沿用路线图命名）：[workspace-tools](workspace-tools/requirements.md)、[change-preview](change-preview/requirements.md)、[permission-controls](permission-controls/requirements.md)、[file-context](file-context/requirements.md)。
- 不包含：命令执行与编码任务循环、Git worktree 安全、计划与追问（SP004）；长会话压缩与恢复、项目记忆（SP005）；hooks / skills / MCP / 无头 CLI / TUI 体验主战场（SP006）；子代理与多模态（SP007）；桌面/VS Code/远程/IM 多端（SP008/SP009/SP016–SP018 已按 r6 暂缓）；多端架构入口契约（SP010）。本轮**不引入新的运行时第三方依赖**：diff、gitignore 语义、路径边界、权限规则全部自实现（见设计「周旋点」）。
- 输入基线：master HEAD `b0ffc9e`（路线图 r6 收口提交）；SP001 已 ACCEPTED（规格轮）；SP002 已实现并发布 0.2.0（npm latest=0.2.0），本轮在其 `src/core` / `src/provider` / `src/storage` / `src/tui` 四模块之上扩展；当前仓库**尚无任何文件工具实现**，`Session` 已具备工具回合、审批挂起与事件契约，本轮在其上接入真实工具。
- 依赖与启动条件：
  - USER_CONFIRMED（2026-11-17 用户会话）：「开启 SP003 的迭代任务」→ 授权启动本轮。
  - USER_CONFIRMED（2026-11-17 r6）：权限模式固定三档，替代参考仓 7 模式与早前「四类语义」提议；切换交互、命令执行边界与安全底线在 SP003 开轮细化；不得借「完全权限」绕过 deny 规则与凭据保护。
  - USER_CONFIRMED（2026-11-17 委托）：取消常规人工审查，设计文档为 Agent 自审对象；自审通过即包含从 master 创建功能分支、计划/实施/测试/交付自主推进、各阶段本地提交（中文提交说明）与**交叉验证门禁 GREEN 后**按 buding-merge 合入 master。push、npm 发布、远端设置、打标签、分支/worktree 删除不在委托内，仍单独授权。
  - 边界：本轮无 live Provider 依赖的 AC 之外，所有验证用本地 fixture 与真实文件进程完成；真实模型端到端仍依赖用户凭据（沿用 SP002 已取得的凭据状态，无则记 UNVERIFIED）。
- 计划/批准身份：迭代编号、功能名称与出口门槛为 USER_CONFIRMED（路线图 r6）；四份需求的 AC 切分为 MODEL_PROPOSED，随设计文档一并自审；技术方案（模块划分、工具契约、权限模型、diff 算法自实现）为 MODEL_PROPOSED，待设计自审通过后写入 `design/plan.zh.md`。

## 需求索引（迭代进度入口）

每阶段完成或停等时更新本表：阶段列按 `需求→设计→计划→实施→测试→交付` 打勾并标注当前停点原因，集成状态列随本地提交更新真实 SHA；断线或换会话的 Agent 先读本表定位，再进对应 STATUS 续接。

| 功能/优化目录 | 来源 / 身份 | 验收目标 | 责任范围 | 阶段 | 需求 / 设计 / 计划 / STATUS | 验证 | 集成状态 | 下一步 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [workspace-tools](workspace-tools/requirements.md) | 路线图（USER_CONFIRMED 名称）；AC 切分 MODEL_PROPOSED | WT-01…11：读写/编辑/搜索工具、忽略规则、编码/CRLF/大文件策略、路径越界与 junction 防护、结果形态 | workspace 模块（文件 IO 与搜索） | ✅需求→▶设计 | [需求](workspace-tools/requirements.md) ／ [STATUS](workspace-tools/STATUS.md) | UNVERIFIED | 未提交 | 写设计稿 |
| [change-preview](change-preview/requirements.md) | 同上 | CP-01…08：结构化 diff、预览与磁盘一致、拒绝时磁盘不变、并发无关改动保留、撤销/检查点、对话框两级与源切换 | workspace + TUI 预览层 | ✅需求→▶设计 | [需求](change-preview/requirements.md) ／ [STATUS](change-preview/STATUS.md) | UNVERIFIED | 未提交 | 写设计稿 |
| [permission-controls](permission-controls/requirements.md) | 路线图 + USER_CONFIRMED 三模式 | PC-01…10：三模式判定与切换、审批三档、规则匹配与被遮蔽检测、拒绝追踪、安全底线 | core 决策 + workspace 规则 + TUI 交互 | ✅需求→▶设计 | [需求](permission-controls/requirements.md) ／ [STATUS](permission-controls/STATUS.md) | UNVERIFIED | 未提交 | 写设计稿 |
| [file-context](file-context/requirements.md) | 路线图 + CAP-L1-06 | FC-01…06：@ 文件引用解析与注入、@/命令统一补全、大文件与图片引用策略 | TUI 编辑器 + workspace 读取 | ✅需求→▶设计 | [需求](file-context/requirements.md) ／ [STATUS](file-context/STATUS.md) | UNVERIFIED | 未提交 | 写设计稿 |

## 验收与交接

- 本轮出口门槛（对照路线图 SP003）：① 跨目录搜索、编码/CRLF/大文件/忽略规则、补丁冲突、目录穿越/junction 越界均有回归；② 拒绝写入时磁盘不变，diff 与实际修改一致，用户无关改动保留；③ 三权限模式切换与边界有回归；④ 无旧仓源码/提示词/内部类型迁入，无新增运行时第三方依赖，模块边界检查通过。
- 实际验收：UNVERIFIED。设计自审通过后进入实施；AC 级证据见各功能 STATUS 与本轮 `test-report.md`。
- 未完成/延期项：live Provider 端到端（凭据）沿用 SP002 状态，无凭据则记 UNVERIFIED 并写恢复条件；真终端人工观感沿用人工清单。
- 下一轮输入（预计）：工作区工具与权限决策的公开契约、diff 结构、规则持久化格式、可撤销快照约定（供 SP004 命令执行与 Git 安全引用）。
- 风险/回退：
  - R-01 权限模型过松：完全权限若绕过 deny 规则或凭据保护，等同无门槛 → 设计要求 deny 规则与凭据路径黑名单在完全权限下仍生效，并有负向回归。
  - R-02 diff 与磁盘不一致：预览后并发外部修改会导致覆盖 → 设计要求写盘前校验基线指纹，不一致即拒绝并保留用户改动。
  - R-03 自实现 gitignore/diff 出错：语义偏差会漏搜或误写 → 用公开规范 + 自建 fixture 覆盖；不引入来路不明实现。
  - R-04 编辑语义歧义（唯一字面串/replace_all/空串创建）误伤文件 → 匹配数不符即拒绝，不做模糊替换。
  - 回退：本轮全部产出在 `SP/SP003/` 与 `feature/SP003/workspace-tools` 分支；产品版本不动（当前 0.2.0），失败可整体弃分支。
- Git/产品发布：未执行；合入 master 需交叉验证门禁 GREEN + 自审记录（[集成门禁](../../docs/integration-gate.md)）；push 与 npm 发布不在授权内。

## 变更记录

| 日期 | 范围或状态变化 | 原因/来源 | 影响及处理 |
| --- | --- | --- | --- |
| 2026-11-17 | 建立 SP003 迭代汇总与四个功能目录（workspace-tools / change-preview / permission-controls / file-context），共 35 条 AC 进入 intake | 用户会话「开启 SP003 的迭代任务」 | 仅开轮与需求整理；设计、计划、实现、提交、合并按 2026-11-17 委托由 Agent 自审推进，push/发布仍单独授权 |
