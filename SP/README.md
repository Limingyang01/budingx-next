# SP 迭代管理

本目录是每个迭代需求、状态和验收记录的统一入口。总路线图见 [迭代计划](../docs/iteration-plan.md)。模板见 [templates](templates/README.md)。本次只建立规范和计划，不启动 SDD 或产品实现。

本项目没有需求 ID；迭代下按具体功能或优化需求建目录，`AC-01` 等仅标记验收条件。

## 编号与目录

用户已授权由 Agent 安排编号；当前计划采用 SP001–SP021。目录、分支和文档统一使用三位编号，不复用旧仓编号的历史含义。编号分配不表示需求、设计、实施或发布获批。迭代保留原编号，取消后不回收重用。

```text
SP/
  README.md
  templates/
  SP001/                         # 实际启动该轮时建立
    requirements-summary.md
    <requirement-slug>/
      requirements.md
      STATUS.md
      design/                    # 正式设计/计划阶段才建立，中文单份
        design.zh.md
        plan.zh.md
      test-report.md             # 执行验证时建立
```

## 使用步骤

1. 先读总路线图、[能力验收矩阵](../docs/agent-capability-matrix.md)、[npm 发布方案](../docs/npm-release-plan.md)和上一迭代的交接，核对真实仓库状态。当前只有计划，不默认继续编码。
2. 用户授权开始某轮后，从模板复制迭代汇总及该轮真实需求的 requirements/STATUS；替换全部占位值，不批量建立全部迭代空目录。
3. 汇总的需求索引表是本轮迭代进度入口：每阶段完成或停等时更新阶段勾选、最新本地 commit 与下一步，供断线或换会话的 Agent 先读表再进对应 STATUS 快速续接；功能/优化需求及设计正文在需求目录，避免多份事实。
4. 无编号的临时需求先放 docs/requirements/<slug>/；归入迭代时更新旧链接，保留来源。迭代内追加/撤回需求记录原因和影响，不覆盖原批准。
5. 实施前按当次授权及实际任务使用适用流程；计划存在不自动触发 SDD。正式 SDD 才建立中文设计/计划，小修改不生成无意义文件。
6. 每次交接同时更新需求 STATUS 与迭代汇总。完成验收后归档证据、遗留项、风险及下一轮输入；发布状态单独记录。
7. 每轮交付同步更新根目录 [产品说明书](../PRODUCT.md)：功能归类表里该迭代的状态改为实际状态，并按受影响情况更新使用说明、已知限制与版本历史；无产品行为变化时在交付记录写明「说明书无需更新」及理由。

## 状态和完成标准

- 生命周期：PLANNED → ACTIVE → VERIFYING → ACCEPTED → CLOSED；BLOCKED/CANCELLED 记录原因、恢复条件及日期。ACCEPTED 必须有实际验收依据，CLOSED 不能掩盖未完成项。
- 批准：正式 SDD 以设计文档为唯一常规人工审阅点，其批准覆盖计划、实现、测试、交付与各阶段本地提交（提交说明中文）；用户验收、合并、推送、发布仍独立授权并分别记录。需求不单设批准门，阻塞性 OPEN 先行确认，其余随设计审阅。技术提议使用 MODEL_PROPOSED，用户确认使用 USER_CONFIRMED，未决定使用 OPEN。
- 验证：PASS / FAIL / UNVERIFIED / NOT_APPLICABLE；零测试、全 skip、未执行不能记 PASS。保留命令/cwd/revision/环境和实际计数，不引用旧仓成绩充当通过证明。
- 日志、coverage、临时截图放忽略的 artifacts/quality-runs/<SP>/<slug>/<run>/；仓库保留脱敏摘要。没有 Git 提交时写“无提交”，不得虚构 SHA。
- 分支可用 feature/SP001/<description> 等；master 为主线。编号和模板不授权自动创建分支、提交、合并或发布。

正式记录的内容要求见 [SP 记录约定](../skills/buding-sdd/references/sp-records.md)。
