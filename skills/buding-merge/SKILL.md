---
name: buding-merge
description: Use when a scoped local commit, cherry-pick, merge, push, or integration review is needed, including the buding-sdd closing merge of a completed feature branch into master. Reading, installing, or migrating this skill does not authorize Git integration or publication.
---

# budingx-next 集成与发布边界

先读 [AGENTS.md](../../AGENTS.md)、[开发指南](../../docs/development.md) 与 [技术栈路由](../buding-sdd/references/technology-map.md)。目标是只集成明确授权内容、保护用户工作并给出可核对结果。当前已有文档/技能、src/tui 聊天预览及本地测试/发布入口；完整 Agent 门禁按实际迭代建立。

默认主分支为 `master`，不创建 `main`。这不代表每次集成都默认合入 master，仍需使用用户明确的源、目标和动作范围。

## 1. 固定授权和现场

从当前对话绑定仓库、源、目标、文件/提交范围与允许动作：审查、stage/commit、cherry-pick/merge、push、远端设置、tag、npm 发布、部署、分支/worktree 删除分别判断。已有明确授权持续有效，缺关键目标或范围才询问，不重复审批同一动作。正式 SDD 收口时从 master 建分支与完成后合入 master 属于设计批准范围，按本规程安全执行；其余合并仍分别取得授权。

文档/技能迁移、安装本技能、通过测试或用户要求开发不自动授权提交/发布。旧仓保持只读；不要把源仓合并进新仓来迁移技能，也不沿用旧版本号、成绩或发布状态。用户已授权 MIT 聊天 TUI 验证后首发 npm，以及本次 Git 提交/推送；不得依据旧暂停状态重复审批。后续动作仍遵守各自实际授权。

先检查 `git status --short`、真实 repo/worktree、HEAD、暂存/未暂存/untracked、上游和 Git operation。初始仓可能没有提交/HEAD，不能因而自动创建提交或远端。默认新分支 `feature/<description>`；只有已确认 SP 才 `feature/SP<三位编号>/<description>`，不发明 SP001。

本地集成不包含 push、PR、通知、部署或清理。远端确实相关且已在任务范围时 fetch；纯本地任务无需联网或设置远端。未解决操作或范围不明先定位，不自动 abort/reset/stash。

## 2. 保护工作区与准备提交

读取完整 scoped diff、untracked 和 staged hunks。只格式化当前任务拥有内容，使用实际已配置工具。核对凭据、来源/许可和生成产物；扫描器未运行就说明人工检查限制。新文件或 AI 生成不等于当然原创。

只提交授权文件/hunks，不使用会夹带既有 staged 内容的普通整索引提交。在混合工作区使用经验证的临时 index 或独立 worktree；需要整合已提交内容且原工作区有无关改动时优先安全隔离。不得接管其他任务的 checkout。HEAD 前进后正确保留原 index 与新 HEAD 关系，不直接恢复旧 index 字节造成反向暂存。

同文件 hunks 无法可靠区分时保留现场，取得该具体范围决定。授权提交后检查实际 commit 的文件和内容；未授权提交则只交付 diff。已有提交不重复创建，不重写公共历史。

## 3. 预演与实际集成

固定最终源 SHA、目标 SHA、merge-base、方式和 outgoing 范围。初始空仓没有祖先时先判断是否根本只需授权文件提交，不为迁文档强行允许无关历史合并。

正常合并可用 `git merge-tree --write-tree <target-sha> <source-sha>`，检查退出码与冲突；它可能写 Git 对象但不改 index/worktree。命令不可用或 cherry-pick 预演用安全隔离 worktree，按授权顺序执行，预演方式与真实动作匹配。输入、范围或冲突解决改变后重算受影响检查；相同输入可复用有效结果。

集成前核对完整引入差异、依赖/lock、契约两端、fixture、存储迁移和实际制品资源。文档/技能范围不得夹带旧 Agent、query/提示词/SDK 类型或产品文件。只读来源审计不允许把旧实现换名并入新仓。

在正确目标 checkout 对固定源执行授权动作。正常 merge 保留历史，不自动 squash/rebase。冲突按双方意图和现有行为解决；业务语义不明保留现场并请求具体决定。

## 4. 验证与发布

检查实际第一父差异和目标文件，按真实变化选择维护检查，或产品存在后的 [前端](../buding-frontend-testing/SKILL.md)/[运行时](../buding-runtime-testing/SKILL.md)验证。小本地文档集成不默认全量门禁；PR/合并/发布就绪按届时真实合同补适用证据。不存在产品测试不能填 PASS，旧仓成绩不能导入。

merge 用 ancestry 证明包含源；cherry-pick 用提交映射与补丁内容证明，不要求原 SHA 为祖先。无冲突只是部分证据，不等于验证通过。结果和缺口分别记录。

仅获明确 push 授权后，再核对 remote、refspec、源/目标与精确 outgoing commits。其他任务本地提交不自动获得发布许可。不得把源直接推到目标名冒充 merge，不 force-push、不绕过服务器检查。

同名远端前进导致拒绝时 fetch、检查范围、保留本地提交并重新集成/验证，最多两次同步重试。其他拒绝、范围变化或语义不明时停止该发布步骤并保留成果。push 后查询远端 HEAD/包含关系；无法核实回执则 `UNVERIFIED`，不要重复已成功动作。

## 5. 交接与恢复

在已有记录或聊天中写仓库、授权动作/范围、源/目标/result SHA、预演输入、真实检查数量/结果、未运行项与风险。推送附观察到的远端 SHA 和包含证明；没有 SP 不生成虚构迭代记录。

恢复先核对实时 refs 和已有成果，跳过已完成动作。不自动删分支/worktree、清理冲突现场、通知其他人或宣称部署/npm 发布成功。
