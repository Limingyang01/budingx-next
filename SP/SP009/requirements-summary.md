# SP009 需求汇总 — TUI 独立交付和 npm 发布工程

状态：**已合入 master 并发布 0.9.0 与 0.9.1**（2026-11-23 开轮；用户 `/buding-sdd 开始SP009` 授权开发，继承 AGENTS.md 审查与集成委托）。设计已由 Agent 自审通过，计划沿用同版结论；合并提交 `10704ab`／`2a918b3`，发布运行 [#45100998785](https://github.com/Limingyang01/budingx-next/actions/runs/45100998785)（源码 `aecd8b7`），该运行为 0.9.0 的历史回执。当前 npm `latest` 为 0.9.1，详见 [发布回执](../../release-notes/v0.9.1.md)。

0.9.2 优化已按 2026-11-24 用户指令**开始开发（IN_PROGRESS）**，详见 [TUI 差距优化需求](tui-gap-optimizations/requirements.md)及[状态](tui-gap-optimizations/STATUS.md)。后续阶段进度随该子需求的 STATUS 推进。

0.9.2 出口验收：12 项产品 AC 逐条 PASS（无参考对照的自研扩展项另附自有判据与实测结果；#42 的端到端证据必须来自真实 Provider 的真实子代理任务）；既有命令面、三档权限、工作区边界与制品入口无回归；npm 发布回执按发布台账取得。版本口径：**USER_CONFIRMED（2026-11-24 用户决定）保持 0.9.2**，不按 minor 处理；与版本规范的语义张力记入[路线图版本记录](../../docs/iteration-plan.md#版本记录)。

## 本轮目标与边界

目标（路线图 SP009 行，docs/iteration-plan.md:76）：TUI 独立交付和 npm 发布工程，三个工作流——tui-distribution、upgrade-compatibility、npm-publish-pipeline。

出口验收：TUI 干净 Windows 安装/升级/卸载；通过一条 `npm run publish` 完成门禁、同一 tarball 的安装测试、上传与回执；dry-run、next/latest、同版本/权限失败/不确定上传恢复有测试；来源许可及包名权限满足才可实际上传。

0.9.0 原始交付边界：
- 不做 Desktop/VS Code/远程/H5/IM，不做第二套安装器（.msi/brew/独立下载站）。
- 不改产品运行时行为、命令面、三档权限、Provider 协议与数据结构。
- 实际 npm 发布仍由维护者在 GitHub 手动触发；本轮交付发布前准备与交接参数。
- 真实 macOS 安装、真实 registry 回退与 dist-tag 移动无法在本轮取证，标 UNVERIFIED。

## 需求索引

| 目录 | 来源 | 验收目标 | 责任范围 | 阶段 | 文档 | 验证 | 集成状态 | 下一步 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| tui-delivery-and-npm-release §4.1（TD-01–TD-06） | 路线图 SP009；npm 方案「生产安装」「tarball 与运行依赖」 | 干净安装、包白名单、依赖闭包、入口与核心链路、版本一致性、engines 声明一致 | 发布编排、分发验证、文档 | 已交付 | [requirements](tui-delivery-and-npm-release/requirements.md) · [design](tui-delivery-and-npm-release/design/design.zh.md) · [plan](tui-delivery-and-npm-release/design/plan.zh.md) | 随 0.9.0 发布回执核验通过 | 已合入 master（`10704ab`／`2a918b3`） | T1/T2/T4/T7 |
| tui-delivery-and-npm-release §4.2（UC-01–UC-05） | 路线图 SP009；npm 方案「升级、回退与卸载」 | 覆盖升级、旧数据 fixture、卸载保留数据、指定旧版回退、一条命令门禁 | 分发验证、文档 | 已交付 | 同上 | 随 0.9.0 发布回执核验通过 | 已合入 master（`10704ab`／`2a918b3`） | T4/T5 |
| tui-delivery-and-npm-release §4.3（NP-01–NP-10） | 路线图 SP009；npm 方案「单条命令稳定发布」「dry-run/门禁失败」「版本与通道」「身份与政策」「上传结果不确定」 | 一条命令发布、dry-run 无副作用、门禁失败不上传、同版本拒绝、失败分类、通道规则、不确定上传判定、发行说明结构、发布流水线测试、CI 同源 | 发布编排 | 已交付 | 同上 | 随 0.9.0 发布回执核验通过 | 已合入 master（`10704ab`／`2a918b3`） | T1/T2/T6/T8/T9 |
| tui-delivery-and-npm-release §4.6（BF-01–BF-04） | 用户 2026-11-23 报缺陷 | 全自动档位不受工作区边界拦截；另两档与安全地板不变；同类工具全面排查 | 权限策略、工作区路径、内置工具 | 已修复并交付 | 同上 | 26/26 PASS（定向） | 已合入 master（`10704ab`／`2a918b3`，随 0.9.0） | T16/T17 |
| skill-authoring（SA-01–SA-08） | 用户 2026-11-23 追加，随 0.9.1 | 技能多级别（user/project 向上遍历/bundled）、/skillify 创建、SKILL.md 放置、/reload-skills 命令刷新（不轮询） | TUI 技能发现/命令面/宿主 | 已交付（门禁 GREEN） | [requirements](skill-authoring/requirements.md) · [design](skill-authoring/design/design.zh.md) · [plan](skill-authoring/design/plan.zh.md) | SA-01…08 PASS（定向+帧级） | 已合入 master `ab65450` | S1–S5 |
| loop-context-fidelity（LF-01–04、LC-01–06） | 用户 2026-11-23 追加，随 0.9.1 | 交互无 32 回合硬停、无头 --max-turns、子代理默认无预算、上下文窗口动态/自定义、默认启用自动压缩、阈值对齐参考仓、压缩改模型摘要 | core 主循环/预算、provider 发现、TUI 装配 | 已交付（门禁 GREEN） | [requirements](loop-context-fidelity/requirements.md) · [design](loop-context-fidelity/design/design.zh.md) · [plan](loop-context-fidelity/design/plan.zh.md) | 定向+E2E 通过 | 已合入 master `ab65450` | L1–L10 |
| subagent-fidelity（SF-01–05） | 用户 2026-11-23 截图追加，随 0.9.1 | 子代理通知按系统消息渲染、不把 XML 当用户输入、XML 仍进模型上下文、默认无第预算 | core 事件/会话、render reducer、agent-runtime | 已交付（门禁 GREEN） | [requirements](subagent-fidelity/requirements.md) · [design](subagent-fidelity/design/design.zh.md) · [plan](subagent-fidelity/design/plan.zh.md) | N-01/N-02 PASS | 已合入 master `ab65450` | D1–D4 |
| tui-delivery-and-npm-release §4.4（SD-01–SD-03） | 用户 2026-11-23 追加指令 | 触发技能时正文不进入可见会话、仍完整送达模型；恢复视图不回显；/help 仍列出技能 | TUI 会话展示、normalize | 已交付 | 同上 | 3/3 PASS（定向） | 已合入 master（`10704ab`／`2a918b3`，随 0.9.0） | T13 |
| tui-delivery-and-npm-release §4.4（EX-01–EX-02） | 用户 2026-11-23 追加指令 | `/export` 可选择会话（面板或 `--session`）、导出所选历史、读取失败明确报错 | TUI 命令面、会话只读接口 | 已交付 | 同上 | 4/4 PASS（定向） | 已合入 master（`10704ab`／`2a918b3`，随 0.9.0） | T14 |
| tui-gap-optimizations（0.9.2，12 项、28 条 AC） | 用户 2026-11-24 指令与 [TUI 差距补排](../../docs/iteration-plan.md#tui-差距补排2026-11-24)；#42 来自用户 2026-11-24 现场报告 | 会话与导出、输入和转录、规则及技能、后台任务与工作树、MCP，以及 WebFetch 子代理失败兜底 | TUI / Core / Storage / Git / MCP / Provider | 实施与定向验收通过 | [需求](tui-gap-optimizations/requirements.md) · [设计](tui-gap-optimizations/design/design.zh.md) · [计划](tui-gap-optimizations/design/plan.zh.md) · [STATUS](tui-gap-optimizations/STATUS.md) | [验证记录](tui-gap-optimizations/test-report.md) | 待交叉验证和集成 | T8 门禁与版本准备 |

## 阶段进度（0.9.0 / 0.9.1 已交付记录）

本表「最新提交」列记录的是当阶段当时的提交；0.9.0/0.9.1 的实际合入与发布回执以本文件抬头与[发布回执](../../release-notes/v0.9.1.md)为准。0.9.2 的阶段进度另见 [tui-gap-optimizations/STATUS.md](tui-gap-optimizations/STATUS.md)。

| 阶段 | 状态 | 最新提交 | 说明 |
| --- | --- | --- | --- |
| 需求与状态 | ✅ | 待提交 | requirements.md / STATUS.md 建立 |
| 事实、来源与边界 | ✅ | 待提交 | 已核对真实脚本、台账、CI 工作流与参考仓发布/迁移机制 |
| 正式设计 | ✅ | 待提交 | design.zh.md v1（自审通过） |
| 实施计划 | ✅ | 待提交 | plan.zh.md v1 |
| 实施 | ✅ | 待提交 | T1–T14 完成 |
| 测试收口 | ✅ | 待提交 | 全量 1250/1249/0/1；发布工具 56/56；定向 TUI 7/7 |
| 交付 | ✅ | `2a918b3` | 门禁 GREEN → 合入 master（`10704ab`、`2a918b3`）→ 推送；发布 dry-run PASS |
| 发布前准备 | ✅ | `9e8cdf0` | 0.9.0 准备完成（台账、发行说明五小节、版本文档同步、dry-run PASS） |
| 正式发布与回执 | ✅ | 待提交 | 维护者触发运行 #45100998785（源码 `aecd8b7`）发布 0.9.0；registry/provenance/独立安装核验通过，台账 published |

## 参考仓对照点

只读对照 `buding-worker-space` 的机制事实（中央版本源与目标同步、迁移门禁 `persistence-upgrade`、制品门禁 `package-smoke`、`release --dry` 预览），**不复制任何源码**；本仓差异与理由见 design.zh.md §7。
