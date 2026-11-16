---
name: buding-sdd
description: Use when the user requests SDD, a cross-module Coding Agent feature, architecture-aware development, or confirmed sprint requirement aggregation. Not for a small documentation edit or read-only question unless SDD is explicitly requested.
---

# budingx-next SDD

先读 [AGENTS.md](../../AGENTS.md)、[文档导航](../../docs/index.md) 与 [架构方向](../../docs/architecture.md)。本仓已有 src/tui 简易聊天预览；完整 Agent 尚未实现。Node.js >=22.18 + TypeScript 已确定，禁止引入 Bun；源码统一 src/，未来各端框架和 Core 契约在对应迭代设计。默认主分支 master。技能名称延续发现入口，不代表继承旧产品实现。

读取、安装或迁移技能不代表启动产品开发、提交或发布。小 README 修订、链接修正、技能维护使用最小检查，不强加正式双语 SDD 或产品全量门禁。仅汇总需求时不进入实现。

## 阶段与授权

正式 SDD 先读项目 [using-superpowers](../superpowers/using-superpowers/SKILL.md)，按所处阶段实际加载正文；仅列名称不算执行。`superpowers:<name>` 映射本地 `superpowers-<name>` 发现入口，有 Skill 工具时调用本地入口，否则读取完整正文与适用引用。

| 阶段 | 本地正文 |
| --- | --- |
| 需求与设计 | [brainstorming](../superpowers/brainstorming/SKILL.md) |
| 获批设计转计划 | [writing-plans](../superpowers/writing-plans/SKILL.md) |
| 当前会话执行 | [executing-plans](../superpowers/executing-plans/SKILL.md) |
| 明确选定委派执行 | [subagent-driven-development](../superpowers/subagent-driven-development/SKILL.md) |
| 行为红绿验证 | [test-driven-development](../superpowers/test-driven-development/SKILL.md) |
| 回归定位 | [systematic-debugging](../superpowers/systematic-debugging/SKILL.md) |
| 所需隔离 | [using-git-worktrees](../superpowers/using-git-worktrees/SKILL.md) |
| 适用审查 | [requesting-code-review](../superpowers/requesting-code-review/SKILL.md) |
| 完成前核验证据 | [verification-before-completion](../superpowers/verification-before-completion/SKILL.md) |

同一范围与版本的用户批准持续有效，从最早未完成阶段恢复，不重建获批文档或重复询问。实质行为、AC、范围或架构变化才更新相关批准；格式修改不使批准失效。委派、隔离、自动提交与收尾受当前工具契约及用户授权约束，上游默认路径和发布建议不扩大范围。集成时使用 [buding-merge](../buding-merge/SKILL.md)。

## 1. 需求和状态

命名实际行为表面，例如 core、TUI、UI、provider/runtime、tools、storage、integration、docs 或 release；这些是责任分类，不是已有包。检查 `git status --short`、实际仓库、HEAD、暂存、工作区和正在进行的 Git 操作。空仓可以没有 HEAD，不把它当成需要自动提交的错误。

读用户材料，为验收点设置稳定 AC ID，区分 `USER_CONFIRMED`、`MODEL_PROPOSED` 与 `OPEN`。票据工具可用且任务需要时再读取，不绑定某个服务。SP 必须来自用户或已有明确记录；无 SP 可使用 `docs/requirements/<slug>/`，无需为了落盘发明 SP001。目录和分支见 [记录约定](references/sp-records.md)。默认新分支 `feature/<description>`；用户确认迭代后才使用 `feature/SP<三位编号>/<description>`。

## 2. 事实、来源与边界

先复用本仓可用 Graphify 图谱，再核对实际源码和测试；不存在或不适用时说明限制，使用 `rg` 与现有文件。空产品仓先基于需求形成提议，不能导入旧图谱或把架构草案写成已实现事实。

读取旧仓只为授权的只读参考或来源审计；不得把旧 query、系统提示词、SDK 类型、Agent 源码或生成 bundle 复制或逐文件改写成新实现。可复用材料必须分别记录来源、许可、依赖及处理决定，不因它属于 UI 或由 AI 生成就宣称当然原创。不要读取真实密钥、用户配置和历史。独立实现依据自己的需求与公开协议，许可不明项保持待审计。

设计回答责任层、契约、状态归属、消费者、失败/取消路径和验证层；不预设旧服务路由、客户端共用实现或进程模型。按 [技术栈与验证路由](references/technology-map.md)读取真实配置后再选择技术和命令。

## 3. 正式设计和计划

使用 [大纲](references/design-and-plan.md)保存 `design/design.en.md` 与 `design/design.zh.md`，决策与 AC 对齐，英文作为执行依据。设计批准后生成同目录 `plan.en.md` / `plan.zh.md`；已有同版批准可直接沿用。STATUS 保存原话或精确来源、对应文件版本/哈希与授权动作。

计划包含任务 ID、AC、精确文件、Consumes/Produces、依赖、责任/复用、工作目录、实际验证命令及预期行为。尚不存在的路径和接口明确标为拟新增。尚未选择测试框架时先完成这项设计，不填入旧仓命令假装可执行。正式设计/计划完成不自动获得实现以外的 Git 或发布权限。

## 4. 实施与验证

按有效计划做最小完整变更。行为变更先写有意义的失败回归，再实现和复测；基础设施失败、零测试与全部 skip 不能作为 RED 或 PASS。测试同区域行为，避免 mock 掉被测契约。不为复现自动 stash、清理或覆盖用户工作。

- UI、状态和 API 客户端读 [frontend-testing](../buding-frontend-testing/SKILL.md)。
- Core、Provider、工具、存储、进程与制品读 [runtime-testing](../buding-runtime-testing/SKILL.md)。
- 普通本地迭代先最近的回归；PR/集成/发布按届时配置的门禁执行，不默认全仓 coverage。跨进程、UI、Provider、安装等证据各自记录，fixture 不冒充 live。

目标范围内可逆错误自主调查修复，范围外失败保留证据；实质业务分叉才请求决定。上游完成 helper 的退出码或 complete 标记不证明目标测试运行：核对数量和断言，零测试保持 `UNVERIFIED` 并纠正 STATUS。旧仓成绩或旧基线不能变成新仓 PASS。

## 5. 交付与恢复

核对 scoped diff、格式、链接、职责与重复逻辑。在已有 STATUS/test-report 记录 AC→任务→文件→命令/cwd→实际数量/结果→证据，更新适用索引。未执行为 `UNVERIFIED`，失败为 `FAIL`，真正不适用才为 `NOT_APPLICABLE`；缺必需证据不声称完整验收或发布就绪。

长期契约变化同步架构文档；普通细节留在需求记录。交付、验收、提交、合并、推送、部署分别陈述。无授权不 stage/commit/push、不设置远端、不 npm 发布、不通知他人或清理分支/worktree。交接列文件、实际检查、跳过项、风险和下一步；恢复先核对现状，复用仍有效证据。
