# tui-parity-and-extensions · STATUS

## 当前状态

| 项 | 值 |
| --- | --- |
| 需求 slug | tui-parity-and-extensions |
| 所属 SP | SP006（日常开发与 TUI 候选） |
| 需求版本 | v1.0（SELF_REVIEWED） |
| 设计版本 | v1.0（SELF_REVIEWED，design/design.zh.md） |
| 实施计划版本 | v1.0（APPROVED，design/plan.zh.md） |
| 生命周期 | ACTIVE |
| 阶段 | 实施中：波次 A 完成（T-A1…T-A7） |
| 功能分支 | feature/SP006/tui-parity-and-extensions |
| 基线 | master dc94731（登记 0.5.4 发布回执并同步文档至 latest） |
| 需求文档 | SP/SP006/tui-parity-and-extensions/requirements.md |
| 设计文档 | SP/SP006/tui-parity-and-extensions/design/design.zh.md |
| 实施计划 | SP/SP006/tui-parity-and-extensions/design/plan.zh.md |
| 验收报告 | SP/SP006/tui-parity-and-extensions/test-report.md（待写） |
| AC 总数 | 67（TU-15 / PI-05 / SM-09 / HK-08 / WR-05 / HC-07 / NP-05 / CMD-12 / AST-03） |
| Git 范围 | 本轮只在功能分支提交；**不合入 master、不推送远端**（用户 m00001） |

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
| MODEL_PROPOSED | 需求文档中的模块划分、AC 编号与切分粒度、67 条 AC 的具体措辞 | 可在实施中调整，只需保持可判定性与出口门槛覆盖 |

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
| D-01 | 本轮**不合入 master、不推送远端** | 用户 m00001 明确「先不要直接合入master分支，我检查后再合入」；该条优先于 2026-11-17 的自动合入委托 |
| D-02 | 复刻按 SP001 决定 3「读机制、不抄代码」执行，全部改动文件纳入 AST 复核映射 | 用户 m00001「不要直接复制代码，注意 AST 检测机制」；scripts/review/sp004-ast.mjs 已有可复用的检测口径与阈值 |
| D-03 | 权限仍为三档，参考仓七档只作安全底线语义来源 | USER_CONFIRMED（r6） |
| D-04 | 渲染改造先做**可断言的差分与冻结缓存单元**，再接入 Ink 渲染层 | 风险 R-S2：帧缓冲差分与 Ink 重绘模型冲突，全屏重写超出本轮预算 |
| D-05 | MCP 只做 stdio + tools 能力子集，resources/prompts/OAuth 显式记 NOT_IMPLEMENTED | 风险 R-S1：协议面大易越界，本轮须可判定完成 |
| D-06 | 命令面改为注册表驱动，既有内联命令全部迁入 | 路线图 SP006 命令面收口要求 + CMD-12 回归约束 |
| D-07 | hooks / MCP / 抓取任一失败均降级不中断回合 | 边界规则「失败不扩散」；避免单点能力拖垮主回路 |
| D-08 | 效果口径永久采用 O5=B（自有能力测量 + 能力清单覆盖度），不使用参考仓测试成绩 | docs/tui-fidelity-gap-baseline.md 与 AGENTS.md 禁止「已对齐/同等效果」宣称 |

## 未验证项与恢复条件

| 项 | 状态 | 恢复条件 |
| --- | --- | --- |
| 参考仓 hooks/MCP/无头协议的精确字段名与时序 | UNVERIFIED（等待三份参考侦察报告回填） | 报告回填后在 design.zh.md §2 补齐事实表并复核 AC |
| 帧缓冲差分与 Ink 的兼容方式 | UNVERIFIED | 实施 TU-04 时以真实 Ink 帧输出量化验证；若与 Ink 重绘模型冲突，按 D-04 退化为「渲染层内部差分 + 可断言帧」 |
| MCP 真实第三方服务器互通 | UNVERIFIED（本轮用仓库内假 MCP 服务器做协议级验证） | 后续轮次引入真实服务器做互通验证 |

## 下一步

1. 波次 B：命令注册表三型（T-B1）、22 条既有命令迁移（T-B2）、7 条新命令（T-B3）。
2. 波次 C：项目指令 / 技能 / MCP / hooks / web-fetch。
3. 波次 D：制品脚本、AST 映射复核、文档收口与 test-report.md。
4. 收口：npm test、npm run merge:gate、AST 复核、test-report.md、requirements-summary.md、PRODUCT.md 与 docs 同步。
5. 停在功能分支，等用户检查后再合入 master。
