# 规划调整：TUI 单端优先、多端暂缓保留入口、三权限模式

状态：USER_CONFIRMED（范围）＋ MODEL_PROPOSED（阶段拆分/依赖/门禁设施扩展）｜来源：用户 2026-11-17 会话指示（含路线图截图与权限模式截图）｜归属：跨 SP 规划修订（无单一 SP，按 SP/README 无编号临时需求约定存放）｜配套：[路线图 r6](../../iteration-plan.md)、[验证报告](test-report.md)、[STATUS](STATUS.md)

## 用户决定（USER_CONFIRMED，2026-11-17）

1. **TUI 单端优先**：未来 SP 规划可能改变，目前不需要实现多个端，先做好 TUI 终端。截图红框能力（SP008 Desktop、SP009 VS Code、SP016 远程/H5、SP017 IM 基础与 Telegram/飞书、SP018 微信/钉钉）不需要。
2. **保留多端架构入口**：依然保留接入多端的架构入口，方便后续接入（宿主契约/传输边界/共享模型与历史/凭据作用域；SP010 契约轮；src/ 保留目录名）。
3. **三权限模式**：TUI 模式保留三种——仅可查看（只读文件与分析，不修改代码）、工作区内修改（允许编辑工作区文件）、完全权限（自动执行，无需反复确认）；更新在未来文档中，当前未实现。
4. **集成授权**：修改完成后合并到 master 分支并推送至远端；推送不成功多试几次（可能网络波动）。

## 范围与落地要求

- 暂缓轮标记 DEFERRED：编号保留不回收（仓库约定「已使用编号不改名或回收」），移出当前依赖链与验收分母；恢复须用户另行决定，原出口门槛保留作恢复依据。
- 保留必交：SP013 团队、SP014 浏览器、SP015 Computer Use（依赖改 SP014）、SP019 定时任务（依赖改 SP012，IM 通知移出）。
- SP010 改「多端架构入口与共享边界」契约轮（轻量测试客户端验证，不交付真实其他端）；SP011 收窄 TUI 制品；SP012/SP020/SP021 按当前范围验收。
- 能力清单 v1.1：CAP-L2-18、CAP-L4-11/12/13/14/15 共 6 项必交→暂缓，分母 53→47；CAP-L3-06 目标状态改三模式；CAP-L4-08/09/20 收窄为入口/TUI 制品（ID 语义不变，变更记录登记）。
- 任务清单 v1 行保留（门禁锚点），REM 5 题 + IM 6 题（含 4 题高级盲测）批注暂缓；SP020 开轮前 inventory v2 补齐高级 30 / 高级盲测 10 配额。
- spec 门禁：NECESSITY 增加「暂缓」；MUST_KEEP 移除 4 个暂缓 ID、保留 6 个必交 ID；新增 MUST_DEFER 反向保护（暂缓项不得静默恢复/删除）。
- merge 门禁设施扩展：非 SP 编号 feature 分支审计 `docs/requirements/<slug>/test-report.md`（本目录）；缺报告仍 RED。
- 全项目未来规划统一同步：iteration-plan r6、agent-capability-matrix r3、advanced-capabilities-plan、npm-release-plan r4、product-brief、architecture、repository-layout、versioning、current-status、index、reference-tui-replication-audit 批注、SP/README（DEFERRED 生命周期）、SP001 汇总变更记录、PRODUCT.md v1.3、README.md、AGENTS.md、skills/buding-frontend-testing、src/tui/README.md。
- 历史保留：SP001/SP002 已验收结论不改写；r1–r5 历史节保留并以 r6 注记替代冲突条款；0.2.0 发布回执（并发会话 9429c67）不被覆盖。

## 验收条件

| AC | 条件 | 验证方式 |
| --- | --- | --- |
| AC-01 | 路线图 r6 含 TUI 优先、5 轮 DEFERRED、SP010 入口契约、三模式、依赖与分母调整、版本记录 | 文档走查 + 链接检查 |
| AC-02 | 全项目规划文档同步一致（无残留「三端必交/分母 53/7 模式目标」现行表述） | grep 走查 + 文档走查 |
| AC-03 | 清单 v1.1 与 spec 门禁自洽：85 项、必交 47、暂缓 6；MUST_KEEP/MUST_DEFER 双向保护有自测 | npm run spec:check / spec:test |
| AC-04 | 任务清单 REM/IM 批注暂缓且 v1 统计锚点不变；inventory v2 义务登记 | spec:check + 走查 |
| AC-05 | 三权限模式以 USER_CONFIRMED 登记于路线图/矩阵/清单/PRODUCT，且标明未实现 | 文档走查 |
| AC-06 | PRODUCT.md 同步（§1/§2/§7/§8、说明书 v1.3），不覆盖 0.2.0 已发布事实 | 文档走查 |
| AC-07 | merge:gate GREEN（含本目录 test-report 审计）后合入 master；推送取得远端回执（失败重试） | 门禁报告 + git ls-remote |
| AC-08 | 不提交依赖/产物/凭据/异源 lockfile；保留用户未跟踪文件（CON、pnpm-lock.yaml）不动 | outgoing 扫描 + git status |

## 边界

- 本变更纯规划文档＋门禁设施；不含产品代码行为变更，不授权任何暂缓轮开发、npm 发布或远端设置/打标签/删分支。
- 产品版本不变（0.2.0 已发布）；说明书版本 v1.2→v1.3。