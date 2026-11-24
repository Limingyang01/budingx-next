# SP009 · TUI 差距优化状态（0.9.2）

状态：IN_PROGRESS｜更新：2026-11-24｜开发基线：master b8c920d，TUI 0.9.1。

- 需求：[0.9.2 TUI 差距优化](requirements.md)，12 项、28 条 AC（11 项差距优化 + 1 项缺陷修复 #42）。
- 用户授权来源：2026-11-24「/buding-sdd 开始0.9.2的优化需求的开发」。开发、测试、中文提交、门禁通过后集成和推送、发布前准备沿用 AGENTS.md 2026-11-17 委托。
- 工作分支：`feature/SP009/tui-gap-optimizations`，复用现有 checkout。启动时本地及远端 master 均为 `b8c920d`。
- 版本口径：**USER_CONFIRMED（2026-11-24 用户决定）保持 0.9.2**，不按 minor 处理；与版本规范的语义张力记入路线图版本记录。
- 盘点固化：[TUI 差距盘点（2026-11-24）](../../../docs/requirements/tui-gap-inventory-2026-11-24/requirements.md)；原盘点全表未入库，需补录（见该文件 OPEN-1）。
- 交接：[SP009 汇总](../requirements-summary.md)、[SP011 团队交接](../../SP011/requirements-summary.md)、[SP015 P1 收口](../../SP015/requirements-summary.md)。

| 阶段 | 状态 | 记录 |
| --- | --- | --- |
| 需求与归属 | 已登记 | 12 项、28 条验收条件见需求正本，登记提交 `61e1f6a` |
| 参考事实核对 | 已完成 | 逐项对照参考仓 `master_node b5c9be8` 与本仓现状，结果固化在需求正本「参考对照与偏离声明」；标注还原/新增/收紧 |
| 缺陷定位（#42） | 已完成 | 子代理失败四层根因已核实并写入需求正本 #42：WebFetch 字节截断与 core `TOOL_OUTPUT_CAP` 不匹配 → `BUDINGX_CORE_003` → 同错误码连续 5 次熔断 `BUDINGX_CORE_010` → 子代理 `AGENT_FAILED` 且信息不足 |
| 设计、计划 | 自审通过 | [设计 v1.0](design/design.zh.md)（Git blob `cee4bb5`）与[实施计划](design/plan.zh.md)。独立审阅涉及局部规则、导出归属、真实失败和 Provider 验收，已落实到设计 §2、§3、§5、§8 |
| 实施、测试 | 定向通过 | T1 本地提交 `5105f7a`。T2–T7 有定向验收及复审证据，见[报告](test-report.md) |
| 集成、版本准备、发布 | 等待门禁 | 交叉验证后核对实际集成与发布准备。当前发布事实见 SP009 汇总 |

本次开发按批次同步 [产品说明书](../../../PRODUCT.md) 的实际行为，发布前同步版本及兼容说明。
