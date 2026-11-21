# tui-parity-and-extensions · STATUS

## 当前状态

| 项 | 值 |
| --- | --- |
| 需求 slug | tui-parity-and-extensions |
| 所属 SP | SP006（日常开发与 TUI 候选） |
| 需求版本 | v1.0（SELF_REVIEWED） |
| 设计版本 | v1.1（SELF_REVIEWED，design/design.zh.md） |
| 实施计划版本 | v1.0（APPROVED，design/plan.zh.md） |
| 生命周期 | ACTIVE |
| 阶段 | 已交付并合入 master：波次 A–D（T-A1…T-D3）+ 用户检查反馈修复（命令卡片、`/resume` 历史可见性）+ 真实模型端到端修复与全命令面端到端扩展（波次 E–I）+ 合入自审与门禁审计加固（波次 J），合并提交 `601ac7e` |
| 功能分支 | feature/SP006/tui-parity-and-extensions |
| 基线 | master dc94731（登记 0.5.4 发布回执并同步文档至 latest） |
| 需求文档 | SP/SP006/tui-parity-and-extensions/requirements.md |
| 设计文档 | SP/SP006/tui-parity-and-extensions/design/design.zh.md |
| 实施计划 | SP/SP006/tui-parity-and-extensions/design/plan.zh.md |
| 验收报告 | SP/SP006/test-report.md（执行完成） |
| AC 总数 | 69（TU-15 / PI-05 / SM-09 / HK-08 / WR-05 / HC-07 / NP-05 / CMD-12 / AST-03） |
| Git 范围 | 功能分支 `feature/SP006/tui-parity-and-extensions`（基线 `dc94731`）→ master，2026-11-21 以 `--no-ff` 合入（合并提交 `601ac7e`）；合入授权来自用户 m04845「合入master分支并且推送远端」 |

## 授权与来源

| 来源 | 原话或精确出处 | 覆盖范围 |
| --- | --- | --- |
| USER_CONFIRMED（用户 m00001，2026-11-20） | 「/buding-sdd 开始SP006的开发，功能需要复刻D:\my_project\budingWorkerSpace的tui，但是不要直接复制代码，注意AST检测机制以及协议，设计文档多复核一下，再进行开发，全程不要停下来，直接开发完，master分支拉出功能分支开发即可，先不要直接合入master分支，我检查后再合入」 | 本轮全部工作范围与交付方式；「先不要直接合入master分支」覆盖 2026-11-17 的自动合入与推送委托 |
| USER_CONFIRMED（用户 m00001） | 「功能需要复刻 D:\my_project\budingWorkerSpace 的 tui，但是不要直接复制代码，注意 AST 检测机制以及协议」 | 复刻口径＝读机制不抄代码；AST 复核与公开协议契约必须遵守 |
| USER_CONFIRMED（用户 m00001） | 「设计文档多复核一下，再进行开发」「全程不要停下来，直接开发完」 | 设计自审 ≥2 轮；端到端一次推进 |
| USER_CONFIRMED（docs/iteration-plan.md r9 SP006 行） | 「日常开发与 TUI 候选：project-instructions、skills-and-mcp、hooks、web-retrieval、headless-cli、tui-usability、npm-packaging」 | 功能目录与交付要点 |
| USER_CONFIRMED（docs/iteration-plan.md r9 SP006 出口） | 「项目指令、技能/MCP、受控 hooks、联网来源、追问/计划可用；TUI 中文/多行/快捷键/终端 resize 和无头事件/退出码可验证；实际 tarball 在仓库外隔离安装并完成核心任务，形成 npm dry-run 骨架而不上传」 | 出口门槛判定依据 |
| USER_CONFIRMED（docs/iteration-plan.md r9 SP006 TUI 还原度 P0 出口） | 「四区骨架收口（首屏/输入区/页脚）、消息区冻结缓存、帧缓冲差分、上下文键位系统（含 chord 与保留键校验）、状态栏可执行契约……P0 未过不得进入 P1 批次」 | TU-01…TU-13 的 P0 判定项 |
| USER_CONFIRMED（docs/tui-command-roadmap.md 2026-11-20） | 「SP006 仍需落地：/init、/btw、/worktree、/tasks、/mcp、/skills、/export，以及命令注册表三型 + 模态槽收口」 | CMD-01…CMD-11 |
| USER_CONFIRMED（2026-11-17 委托） | 「正式 SDD 中设计文档为 Agent 自审对象……自审通过即包含：从 master 创建 feature 分支、计划/实施/测试/交付的自主推进、各阶段完成后的本地提交（提交说明使用中文）」 | 流程授权（不含合入与推送） |
| MODEL_PROPOSED | 需求文档中的模块划分、AC 编号与切分粒度、69 条 AC 的具体措辞 | 可在实施中调整，只需保持可判定性与出口门槛覆盖 |

## 交付内容

| 支柱 | 主要产物 |
| --- | --- |
| 结构层 | 四区骨架契约、帧缓冲差分层、消息冻结缓存、上下文键位系统、状态栏字段契约与外部命令通道 |
| 能力层 | 项目指令发现与注入、技能目录级发现与调用、MCP stdio 客户端与工具注册、受控 hooks 引擎、网页正文抓取工具、无头事件协议与退出码 |
| 命令面 | 命令注册表三型 + 模态槽；/init、/btw、/worktree、/tasks、/mcp、/skills、/export；既有命令迁移与回归 |
| 制品 | tarball 白名单、仓库外隔离安装、真实核心任务验证、npm publish --dry-run 骨架 |
| 证据 | 每条 AC 的单元 + 功能/真实进程用例、独立来源 AST 复核记录、test-report.md |

## 关键决定

| 编号 | 决定 | because |
| --- | --- | --- |
| D-01 | 本轮**不合入 master、不推送远端** | 用户 m00001 明确「先不要直接合入master分支，我检查后再合入」；该条优先于 2026-11-17 的自动合入委托（后由 m04845 放开，见 D-21） |
| D-02 | 复刻按 SP001 决定 3「读机制、不抄代码」执行，全部改动文件纳入 AST 复核映射 | 用户 m00001「不要直接复制代码，注意 AST 检测机制」；scripts/review/sp004-ast.mjs 已有可复用的检测口径与阈值 |
| D-03 | 权限仍为三档，参考仓七档只作安全底线语义来源 | USER_CONFIRMED（r6） |
| D-04 | 渲染改造先做**可断言的差分与冻结缓存单元**，再接入 Ink 渲染层 | 风险 R-S2：帧缓冲差分与 Ink 重绘模型冲突，全屏重写超出本轮预算 |
| D-05 | MCP 只做 stdio + tools 能力子集，resources/prompts/OAuth 显式记 NOT_IMPLEMENTED | 风险 R-S1：协议面大易越界，本轮须可判定完成 |
| D-06 | 命令面改为注册表驱动，既有内联命令全部迁入 | 路线图 SP006 命令面收口要求 + CMD-12 回归约束 |
| D-07 | hooks / MCP / 抓取任一失败均降级不中断回合 | 边界规则「失败不扩散」；避免单点能力拖垮主回路 |
| D-08 | 效果口径永久采用 O5=B（自有能力测量 + 能力清单覆盖度），不使用参考仓测试成绩 | docs/tui-fidelity-gap-baseline.md 与 AGENTS.md 禁止「已对齐/同等效果」宣称 |
| D-09 | 项目指令除用户级/工作区级/子目录外，还加载工作区父目录（最多 3 层，遇 home 或根停止） | 需求 PI-02 要求「工作区根 + 逐级向上」；设计 §7.1 已同步修正 |
| D-10 | 技能正文为空或缺 frontmatter 时标记为 invalid 并跳过，调用时说明原因 | SM-03/SM-05；避免把空技能当提示提交 |
| D-11 | `CommandResult` 增加可选 `outcome` 桥接既有 `CommandOutcome` | 迁移 22 条既有命令时不改变宿主行为 |
| D-12 | `/tasks` 读后台任务登记表（TaskRegistry），不复用待办列表 | CMD-08 要求状态、退出码与输出路径 |
| D-13 | `/init` 已存在则拒绝；`/btw` 空参数只提示用法；`/mcp` `/skills` 非交互降级为文本 | CMD-05/06/09/10 的可判定降级 |
| D-14 | `src/core/exec.ts` 的 `CommandResult` 增加 `command?`/`startedAt?`，后台快照回填 | /tasks 需要稳定的命令标识与启动时间 |
| D-15 | 用户 m02328 授权「修复后提交并推送远端，先不要合入master分支」：推送放开、合入仍禁止 | 用户 m02328 明确「提交并且推送远端，先不要合入master分支」；覆盖 D-01 中「不推送」部分 |
| D-21 | 用户 m04845 授权「合入master分支并且推送远端，做好发布前的准备工作」：合入与推送放开，npm 实际上传仍由用户在 GitHub 手动触发 | 用户 m04845 明确授权；发布前准备（版本/文档/台账/dry-run）在委托内，实际 npm 发布与打 tag 不在 |
| D-16 | `/resume` 历史可见性走会话事件通路（新增 `conversation_restored` 事件 + 渲染层重建转录），并按参考实现的 `switchSession` 语义切换会话身份与转录端口 | 渲染层契约规定不直接读会话；参考实现 `REPL.tsx` 的 resume 回调除写回消息列表外还切换会话 id 与转录文件指针，只做可见性会让续写落回旧会话 |

## 未验证项与恢复条件

| 项 | 状态 | 恢复条件 |
| --- | --- | --- |
| 参考仓 hooks/MCP/无头协议的精确字段名与时序 | PARTIAL：已按设计契约实现并用假服务器/真实子进程验证；未与参考仓逐字段对照 | 需要时按参考仓源码复核字段表 |
| 帧缓冲差分与 Ink 的兼容方式 | RESOLVED（D-04）：差分/冻结为可断言单元，Ink 层用元素冻结接入 | 帧级 UI 测试已覆盖四区与状态栏 |
| MCP 真实第三方服务器互通 | UNVERIFIED（本轮用仓库内假 MCP 服务器做协议级验证） | 后续轮次引入真实服务器做互通验证 |
| 真实模型交互 e2e 的自动化程度 | PARTIAL：用 `mountTty` 回放按键 + 真实 Provider 跑通 18 项，但不是人工在真终端逐键操作 | 需要时由用户真终端复验观感 |

## 验证结果

| 项 | 结果 |
| --- | --- |
| AC | 69 / 69 PASS，0 PARTIAL，0 FAIL，0 UNVERIFIED（逐条见 SP/SP006/test-report.md） |
| 全量单测 | 926 项 / 925 通过 / 0 失败 / 1 跳过（跳过项仅 POSIX 文件权限） |
| SP006 新增 | 21 个测试文件、120 例；另在既有 SP005.4 用例补 2 例（非全屏 `/help` 回归、`/undo` 文案本地化） |
| 制品 | sp006-packaging.mjs 6 项 PASS，exit 0，未上传 |
| AST | 53/53 映射，命中 0，自检 3/3 PASS（本仓单元 258、参考 14411、函数对 48743） |
| 版本 | 0.6.0 prepared（sourceCommit 见 release-ledger.json，receipt 占位 null） |

## 下一步

1. 功能分支已按用户 m02328、m03678 授权推送远端（`origin/feature/SP006/tui-parity-and-extensions`）；2026-11-21 按用户 m04845 授权，经交叉验证门禁 GREEN（报告 `artifacts/merge-gate/feature-SP006-tui-parity-and-extensions-2026-11-21T00-23-20-601Z.md`）后以 `--no-ff` 合入 master（合并提交 `601ac7e`）。
2. 推送 `origin/master` 后，npm 0.6.0 由维护者在 GitHub 手动触发发布工作流，回执按 buding-npm-release 收尾。
3. 合入前若继续改代码，需重跑全量单测、制品 smoke 与 AST 复核。
