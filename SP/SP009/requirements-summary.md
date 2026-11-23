# SP009 需求汇总 — TUI 独立交付和 npm 发布工程

状态：**进行中**（2026-11-23 开轮；用户 `/buding-sdd 开始SP009` 授权开发，继承 AGENTS.md 审查与集成委托）。设计已由 Agent 自审通过，计划沿用同版结论。

## 本轮目标与边界

目标（路线图 SP009 行，docs/iteration-plan.md:76）：TUI 独立交付和 npm 发布工程，三个工作流——tui-distribution、upgrade-compatibility、npm-publish-pipeline。

出口验收：TUI 干净 Windows 安装/升级/卸载；通过一条 `npm run publish` 完成门禁、同一 tarball 的安装测试、上传与回执；dry-run、next/latest、同版本/权限失败/不确定上传恢复有测试；来源许可及包名权限满足才可实际上传。

边界：
- 不做 Desktop/VS Code/远程/H5/IM，不做第二套安装器（.msi/brew/独立下载站）。
- 不改产品运行时行为、命令面、三档权限、Provider 协议与数据结构。
- 实际 npm 发布仍由维护者在 GitHub 手动触发；本轮交付发布前准备与交接参数。
- 真实 macOS 安装、真实 registry 回退与 dist-tag 移动无法在本轮取证，标 UNVERIFIED。

## 需求索引

| 目录 | 来源 | 验收目标 | 责任范围 | 阶段 | 文档 | 验证 | 集成状态 | 下一步 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| tui-delivery-and-npm-release §4.1（TD-01–TD-06） | 路线图 SP009；npm 方案「生产安装」「tarball 与运行依赖」 | 干净安装、包白名单、依赖闭包、入口与核心链路、版本一致性、engines 声明一致 | 发布编排、分发验证、文档 | 实施中 | [requirements](tui-delivery-and-npm-release/requirements.md) · [design](tui-delivery-and-npm-release/design/design.zh.md) · [plan](tui-delivery-and-npm-release/design/plan.zh.md) | 待验证 | 未合入 | T1/T2/T4/T7 |
| tui-delivery-and-npm-release §4.2（UC-01–UC-05） | 路线图 SP009；npm 方案「升级、回退与卸载」 | 覆盖升级、旧数据 fixture、卸载保留数据、指定旧版回退、一条命令门禁 | 分发验证、文档 | 实施中 | 同上 | 待验证 | 未合入 | T4/T5 |
| tui-delivery-and-npm-release §4.3（NP-01–NP-10） | 路线图 SP009；npm 方案「单条命令稳定发布」「dry-run/门禁失败」「版本与通道」「身份与政策」「上传结果不确定」 | 一条命令发布、dry-run 无副作用、门禁失败不上传、同版本拒绝、失败分类、通道规则、不确定上传判定、发行说明结构、发布流水线测试、CI 同源 | 发布编排 | 实施中 | 同上 | 待验证 | 未合入 | T1/T2/T6/T8/T9 |
| tui-delivery-and-npm-release §4.6（BF-01–BF-03） | 用户 2026-11-23 报缺陷 | 全自动档位不受工作区边界拦截；另两档与安全地板不变 | 权限策略、工作区路径 | 已修复 | 同上 | 22/22 PASS（定向） | 待复跑门禁 | T16 |
| tui-delivery-and-npm-release §4.4（SD-01–SD-03） | 用户 2026-11-23 追加指令 | 触发技能时正文不进入可见会话、仍完整送达模型；恢复视图不回显；/help 仍列出技能 | TUI 会话展示、normalize | 实施中 | 同上 | 3/3 PASS（定向） | 未合入 | T13 |
| tui-delivery-and-npm-release §4.4（EX-01–EX-02） | 用户 2026-11-23 追加指令 | `/export` 可选择会话（面板或 `--session`）、导出所选历史、读取失败明确报错 | TUI 命令面、会话只读接口 | 实施中 | 同上 | 4/4 PASS（定向） | 未合入 | T14 |

## 阶段进度

| 阶段 | 状态 | 最新提交 | 说明 |
| --- | --- | --- | --- |
| 需求与状态 | ✅ | 待提交 | requirements.md / STATUS.md 建立 |
| 事实、来源与边界 | ✅ | 待提交 | 已核对真实脚本、台账、CI 工作流与参考仓发布/迁移机制 |
| 正式设计 | ✅ | 待提交 | design.zh.md v1（自审通过） |
| 实施计划 | ✅ | 待提交 | plan.zh.md v1 |
| 实施 | ✅ | 待提交 | T1–T14 完成 |
| 测试收口 | ✅ | 待提交 | 全量 1250/1249/0/1；发布工具 56/56；定向 TUI 7/7 |
| 交付 | ⏳ | — | 门禁 GREEN → 合入 master → 推送 → 发布前准备 |

## 参考仓对照点

只读对照 `buding-worker-space` 的机制事实（中央版本源与目标同步、迁移门禁 `persistence-upgrade`、制品门禁 `package-smoke`、`release --dry` 预览），**不复制任何源码**；本仓差异与理由见 design.zh.md §7。
