# 文档导航

npm `latest` 为 [0.9.2（SP009）](../release-notes/v0.9.2.md)。实现与证据见 [0.9.2 状态](../SP/SP009/tui-gap-optimizations/STATUS.md)。

本仓是 budingx-next 的独立开发起点，当前有文档、技能、维护工具及简易聊天 TUI，完整 Agent 尚未实现。

0. [产品说明书](../PRODUCT.md)：面向使用者的产品事实入口——版本号、按迭代归类的功能表、使用说明、已知限制与版本历史；产品变更须同步更新它。
1. [当前状态](current-status.md)：已有资产、未实现内容及真实验证范围。
2. [产品目标](product-brief.md)：用户确认目标、建议 MVP 与待决定项。
3. [独立实现边界](independent-development.md)：参考实现定位（严格参考本地 budingWorkerSpace、行为复刻不抄代码）、来源台账、允许复用的条件及开发隔离。
4. [架构方向草案](architecture.md)：稳定责任边界，尚不是已批准实施规格。
5. [开发指南](development.md)：当前可运行的维护命令和未来测试选择。
6. [文档约定](documentation.md)：需求、设计、计划、证据和历史材料的身份。
7. [迭代路线图](iteration-plan.md)：r8 当前 SP001–SP016 的目标、依赖与验收门槛，TUI 单端交付及通用宿主契约。
8. [SP 管理与模板](../SP/README.md)：统一按迭代及功能/优化记录。
9. [SP001 迭代汇总](../SP/SP001/requirements-summary.md)：能力基线、核心边界与发布范围（规格轮，已验收，未启动实现）。
10. [迁移记录](migration/README.md)：本次取舍、来源和检查结果。
11. [剩余 SP 参考复刻排查](reference-tui-replication-audit.md)：对照参考仓 TUI 的逐轮排查、缺口与独立实现周旋点（r1 draft 待审）。
12. [TUI 还原度差距基线](tui-fidelity-gap-baseline.md)：对照参考仓的规模差距、分层差距、落地机制与 P0–P3 优先级；还原度判定口径（结构覆盖率 + 行为用例）。
13. [TUI 命令路线图](tui-command-roadmap.md)：用户清单 18 项 + /models 的逐项现状、参考机制事实、SP 归属与别名/快捷键；2026-11-20 补排。
13. [集成门禁与自审流程](integration-gate.md)：2026-11-17 委托——Agent 自审、交叉验证门禁 GREEN 才合入 master、自动化命令与报告。

开发约定见 [AGENTS.md](../AGENTS.md)，开发技能入口见 [skills/README.md](../skills/README.md)，第三方许可见 [声明](../THIRD-PARTY-NOTICES.md)。

规划配套必读：[Agent 能力与验收矩阵](agent-capability-matrix.md)、[TUI npm 一键发布方案](npm-release-plan.md)、[剩余 SP 参考复刻排查](reference-tui-replication-audit.md)。

完整替代必读：[高级能力功能拆分与验收](advanced-capabilities-plan.md)。

首发使用与交付：[TUI README](../src/tui/README.md)、[版本管理](versioning.md)、[首发状态](requirements/tui-bootstrap/STATUS.md)。

上一补丁为 [0.9.1](../release-notes/v0.9.1.md)（主循环、上下文、子代理与技能更新）。上一版本为 [0.9.0 · TUI 独立交付和 npm 发布工程](../release-notes/v0.9.0.md)。此前 [0.8.0 · 多端架构入口与共享边界](../release-notes/v0.8.0.md)（SP008，由 [运行 #45010118350](https://github.com/Limingyang01/budingx-next/actions/runs/45010118350) 发布）、[0.7.0 · Agent 质量与扩展](../release-notes/v0.7.0.md)（SP007，由 [运行 #27](https://github.com/Limingyang01/budingx-next/actions/runs/44921288352) 发布），进度见 [SP009 迭代汇总](../SP/SP009/requirements-summary.md)。历史发布见 [0.6.0 发行说明](../release-notes/v0.6.0.md)、[0.5.4 发行说明](../release-notes/v0.5.4.md)、[0.5.3 发行说明](../release-notes/v0.5.3.md)、[0.5.2 发行说明](../release-notes/v0.5.2.md)和 [0.5.0 发行说明](../release-notes/v0.5.0.md)。

源码模块组织见 [仓库布局](repository-layout.md)。

构建与发布手册：[GitHub Actions + npm Trusted Publishing](github-actions-npm.md)；Agent 执行入口：[buding-npm-release](../skills/buding-npm-release/SKILL.md)。
