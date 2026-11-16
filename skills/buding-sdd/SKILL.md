---
name: buding-sdd
description: Use when the user requests SDD, a cross-module Coding Agent feature, architecture-aware development, or confirmed sprint requirement aggregation. Not for a small documentation edit or read-only question unless SDD is explicitly requested.
---

# budingx-next SDD

先读 [AGENTS.md](../../AGENTS.md)、[文档导航](../../docs/index.md) 与 [架构方向](../../docs/architecture.md)。本仓已有 src/tui 简易聊天预览；完整 Agent 尚未实现。Node.js >=22.18 + TypeScript 已确定，禁止引入 Bun；源码统一 src/，未来各端框架和 Core 契约在对应迭代设计。默认主分支 master。技能名称延续发现入口，不代表继承旧产品实现。

读取、安装或迁移技能不代表启动产品开发、提交或发布。小 README 修订、链接修正、技能维护使用最小检查，不强加正式 SDD 或产品全量门禁。仅汇总需求时不进入实现。

## 阶段与授权

正式 SDD 先读项目 [using-superpowers](../superpowers/using-superpowers/SKILL.md)，按所处阶段实际加载正文；仅列名称不算执行。`superpowers:<name>` 映射本地 `superpowers-<name>` 发现入口，有 Skill 工具时调用本地入口，否则读取完整正文与适用引用。

| 阶段 | 本地正文 |
| --- | --- |
| 需求与设计 | [brainstorming](../superpowers/brainstorming/SKILL.md) |
| 获批设计转计划 | [writing-plans](../superpowers/writing-plans/SKILL.md) |
| 当前会话执行 | [executing-plans](../superpowers/executing-plans/SKILL.md) |
| 明确选定委派执行 | [subagent-driven-development](../superpowers/subagent-driven-development/SKILL.md) |
| 行为红绿验证与 AC 测试收口 | [test-driven-development](../superpowers/test-driven-development/SKILL.md) |
| 回归定位 | [systematic-debugging](../superpowers/systematic-debugging/SKILL.md) |
| 所需隔离 | [using-git-worktrees](../superpowers/using-git-worktrees/SKILL.md) |
| 适用审查 | [requesting-code-review](../superpowers/requesting-code-review/SKILL.md) |
| 完成前核验证据 | [verification-before-completion](../superpowers/verification-before-completion/SKILL.md) |

设计文档 `design/design.zh.md` 是正式 SDD 唯一常规人工审阅点。设计批准后，功能分支、计划、实施、测试与交付记录连续自主推进；计划直接沿用同版设计批准，不再汇报等待或逐段请求许可。写代码前从 master 最新提交创建 feature 分支，本轮全部本地提交在该分支完成且提交说明使用中文；测试全绿并记录交付后，按 [buding-merge](../buding-merge/SKILL.md) 安全规程自主合入 master。STATUS 记录批准原话或精确来源、文件版本/哈希与允许动作范围。批准不包含推送、打标签、npm 发布、远端设置或分支/worktree 清理，这些仍按 AGENTS.md 分别绑定用户授权。

同一范围与版本的用户批准持续有效，从最早未完成阶段恢复，不重建获批文档或重复询问。实质行为、AC、范围或架构变化才更新相关批准；格式修改不使批准失效。委派、隔离与收尾受当前工具契约及用户授权约束，上游默认路径和发布建议不扩大范围。

每个阶段开始时向用户输出 todolist：列出本次 SDD 全部阶段，已完成打勾、当前阶段标记进行中，优先使用当前运行时的任务清单能力，否则以 markdown 输出。每阶段完成时把勾选与最新本地提交同步到功能 STATUS 和迭代 `requirements-summary.md` 需求索引，断线或换会话的 Agent 先读这两处核对后从最早未完成阶段续接。仅在以下情形停等用户：阻塞性 OPEN、实质业务分叉、需要超出当前批准范围的授权动作；缺外部凭据或真实环境不阻塞推进，记 UNVERIFIED 并写明恢复条件。

## 1. 需求和状态

命名实际行为表面，例如 core、TUI、UI、provider/runtime、tools、storage、integration、docs 或 release；这些是责任分类，不是已有包。检查 `git status --short`、实际仓库、HEAD、暂存、工作区和正在进行的 Git 操作。空仓可以没有 HEAD，不把它当成需要自动提交的错误。

读用户材料，为验收点设置稳定 AC ID，区分 `USER_CONFIRMED`、`MODEL_PROPOSED` 与 `OPEN`。需求文档不单设人工批准门：仅实质影响架构方向、AC 或范围的阻塞性 OPEN 在设计前向用户一次问齐，其余 OPEN 以 MODEL_PROPOSED 默认方案写入设计，随设计文档一并审阅。票据工具可用且任务需要时再读取，不绑定某个服务。SP 必须来自用户或已有明确记录；无 SP 可使用 `docs/requirements/<slug>/`，无需为了落盘发明 SP001。目录和分支见 [记录约定](references/sp-records.md)。默认新分支 `feature/<description>`；用户确认迭代后才使用 `feature/SP<三位编号>/<description>`。

## 2. 事实、来源与边界

先复用本仓可用 Graphify 图谱，再核对实际源码和测试；不存在或不适用时说明限制，使用 `rg` 与现有文件。空产品仓先基于需求形成提议，不能导入旧图谱或把架构草案写成已实现事实。

读取旧仓只为授权的只读参考或来源审计；不得把旧 query、系统提示词、SDK 类型、Agent 源码或生成 bundle 复制或逐文件改写成新实现。可复用材料必须分别记录来源、许可、依赖及处理决定，不因它属于 UI 或由 AI 生成就宣称当然原创。不要读取真实密钥、用户配置和历史。独立实现的行为与效果规格全程对照 `budingWorkerSpace` 参考实现（定位与范围见 [独立实现与复用边界](../../docs/independent-development.md)），不允许脱离参考开发；允许优化，但核心逻辑不得背离、使用体验不得下降。代码与接口依据用户需求、公开协议独立编写，许可不明项保持待审计。

设计回答责任层、契约、状态归属、消费者、失败/取消路径和验证层；不预设旧服务路由、客户端共用实现或进程模型。按 [技术栈与验证路由](references/technology-map.md)读取真实配置后再选择技术和命令。

## 3. 正式设计和计划

使用 [大纲](references/design-and-plan.md)保存唯一中文正本 `design/design.zh.md`，中文即执行依据，不产出英文版本；决策与 AC 对齐。设计批准后立即生成同目录 `plan.zh.md`，直接沿用同版批准，不再询问。STATUS 保存批准原话或精确来源、对应文件版本/哈希与授权动作。

计划包含任务 ID、AC、精确文件、Consumes/Produces、依赖、责任/复用、工作目录、实际验证命令及预期行为。尚不存在的路径和接口明确标为拟新增。尚未选择测试框架时先完成这项设计，不填入旧仓命令假装可执行。设计文档批准即含从 master 创建功能分支、计划、实施、测试、交付记录、各阶段本地提交与完成后合入 master 的授权，不含推送、打标签、npm 发布或远端操作。

## 4. 实施与验证

按有效计划做最小完整变更；动代码前确认已位于本轮 feature 分支（设计批准后从 master 创建），不在 master 上直接开发。行为变更先写有意义的失败回归，再实现和复测；基础设施失败、零测试与全部 skip 不能作为 RED 或 PASS。测试同区域行为，避免 mock 掉被测契约。不为复现自动 stash、清理或覆盖用户工作。

- UI、状态和 API 客户端读 [frontend-testing](../buding-frontend-testing/SKILL.md)。
- Core、Provider、工具、存储、进程与制品读 [runtime-testing](../buding-runtime-testing/SKILL.md)。
- 普通本地迭代先最近的回归；PR/集成/发布按届时配置的门禁执行，不默认全仓 coverage。跨进程、UI、Provider、安装等证据各自记录，fixture 不冒充 live。

目标范围内可逆错误自主调查修复，范围外失败保留证据；实质业务分叉才请求决定。上游完成 helper 的退出码或 complete 标记不证明目标测试运行：核对数量和断言，零测试保持 `UNVERIFIED` 并纠正 STATUS。旧仓成绩或旧基线不能变成新仓 PASS。

## 5. 测试收口

测试是 SDD 实施后的最后实质阶段：为每条 AC 同时产出单元与功能（端到端）用例，先跑出预期失败（RED），再逐条修复复跑到通过（GREEN），直至目标范围全绿。一次即绿的用例须核对确实能捕获该行为，防止空转；单测与功能测试遵循同一红绿原则。测试中发现的 Bug 直接调查修复并重跑，不停等人工确认，仅实质业务分叉才停等。

## 6. 交付与恢复

核对 scoped diff、格式、链接、职责与重复逻辑。在已有 STATUS/test-report 记录 AC→任务→文件→测试用例→命令/cwd→实际数量/结果→证据，更新迭代索引与阶段勾选。未执行为 `UNVERIFIED`，失败为 `FAIL`，真正不适用才为 `NOT_APPLICABLE`；缺必需证据不声称完整验收或发布就绪。

长期契约变化同步架构文档；普通细节留在需求记录。交付、验收、提交、合并、推送、部署分别陈述。设计批准后各阶段完成即自主本地提交，提交说明使用中文，不提交依赖、日志、凭据、缓存或产物；交付记录完成后按 buding-merge 规程把 feature 分支合入 master 并在 STATUS 记录 merge 结果；无单独授权不推送、不打标签、不设置远端、不 npm 发布、不通知他人或清理分支/worktree。交接列文件、实际检查、跳过项、风险和下一步；断线恢复先读迭代汇总与 STATUS，再对照 `git log` 和实时 refs 核对，从最早未完成阶段续接并复用仍有效证据。
