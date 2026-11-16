# SP002 · 模型与会话闭环

状态：ACTIVE（需求 v0.1 已批准；设计稿 v0.1 draft 已提交待批）｜更新：2026-11-16｜负责人：Agent 执行 SDD，用户验收

## 本轮目标与边界

- 目标：按[路线图](../../docs/iteration-plan.md)交付「模型与会话闭环」——真实模型配置与流式交互、工具回合、取消和错误有证据；会话配置快照、事件/终态契约、首个构建和 Node bin/资源边界明确；TUI 不成为其他端运行前置。
- 功能目录（沿用路线图命名）：[provider-streaming](provider-streaming/requirements.md)、[model-management](model-management/requirements.md)、[session-lifecycle](session-lifecycle/requirements.md)、[tui-conversation](tui-conversation/requirements.md)；需求 v0.1 已批准，[设计稿 v0.1 draft](design/design.zh.md)（四需求共用一份，SP001 先例）已提交待批。内部侦察材料 [旧仓机制盘点](attachments/old-repo-mechanism-inventory.md)（仅设计参考，禁止入制品）。
- 不包含：工作区文件工具与权限控制（SP003）、命令执行与编码任务循环（SP004）、长会话压缩与恢复（SP005）、Desktop/VS Code 宿主（SP008/SP009）、跨端共享存储（SP010）、发布链路扩展（SP011）。工具回合在本轮只打通「会话→Provider→事件」契约面，落地哪些工具由 SP003/SP004 决定。
- 输入基线：master HEAD `3c166cb`；SP001 已 ACCEPTED（规格轮，2026-11-16 用户验收，O1=A / O2=A / O5=B 已拍板）；bootstrap 产品 `budingx@0.1.1` 已 npm 公开发布（OIDC + provenance，见 [release-ledger.json](../../release-ledger.json)）；现行 [src/tui](../../src/tui) 为独立编写的聊天 TUI，provider 调用直接写在 CLI 内，按 SP001 core-boundaries 风险条目在本轮做明确迁移拆分。
- 依赖与启动条件：
  - USER_CONFIRMED：用户 2026-11-16 会话授权「继续 SP002 迭代的开发工作」。
  - OPEN：live Provider 凭据与预算——用户 2026-11-16 答复**未指定具体服务**：provider 层按 OpenAI 兼容通用设计（base URL + key + 模型名），不绑定厂商；live 证据延后到验收时由用户提供任一真实服务的凭据与费用上限，届时无凭据则该 AC 记 UNVERIFIED，不用 mock 冒充通过。
  - USER_CONFIRMED（2026-11-16 真实用法，含补充答复）：用户会在执行过程中打断/补充，且**两种模式都存在**——①立即打断改方向（停止当前生成/工具回合，再输入新指令）；②不停止、先想到的先排队（执行中追加输入，在安全边界注入）。中断与追加输入是 `tui-conversation` 与 `session-lifecycle` 的一等交互场景，两种语义都要支持，具体按键与注入边界属设计决策。
  - SP001 交接项关闭状态：**O8=Ink 8 已拍板**（U5「没有版权问题你直接使用一样的即可，无需再调研」；逐项实测门槛由用户豁免，风险由设计 §7-R1 承接）；**O6**=同仓 `src/core` 目录不成包（设计 §3.1 落实，随设计批准生效）；依赖白名单 + lint（PS-07/SL-09，设计 §3.1）。
- 计划/批准身份：迭代编号、功能名称与出口门槛为 USER_CONFIRMED（路线图 r4）；需求 v0.1 已获用户批准（2026-11-16「批准」）。按新版 SP 约定，**设计稿是本轮唯一常规人工审阅点**：其批准覆盖计划、实现、测试、交付与各阶段本地提交（提交说明中文）；用户验收、合并、推送、npm 发布仍独立授权，现均未授权。设计稿现处 **v0.2 draft**（v0.1 经独立 builder 复核修订，见设计 §10）。

## 需求索引

| 功能/优化目录 | 来源 / 身份 | 验收目标 | 责任范围 | 阶段 | 需求 / 设计 / 计划 / STATUS | 验证 | 集成状态 | 下一步 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [provider-streaming](provider-streaming/requirements.md) | 路线图（USER_CONFIRMED 名称）；切分 MODEL_PROPOSED | PS-01…08：SSE 分帧迁移、tool_calls 组装、错误分类、有界重试、取消、限额、I-01 检查落地、live 证据 | provider 层 | ✅需求→▶设计（待批）→计划→实施→测试→交付 | [需求](provider-streaming/requirements.md) ／ [设计](design/design.zh.md) ／ [STATUS](provider-streaming/STATUS.md) | UNVERIFIED | 未执行（无提交） | 设计批准后出计划 |
| [model-management](model-management/requirements.md) | 同上 + USER_CONFIRMED（未指定服务→通用） | MM-01…07：档案 CRUD 持久化、验证、默认/会话模型不清史、key 转发边界、凭据隔离、schema 版本迁移、输入校验 | 配置与凭据边界 | ✅需求→▶设计（待批）→计划→实施→测试→交付 | [需求](model-management/requirements.md) ／ [设计](design/design.zh.md) ／ [STATUS](model-management/STATUS.md) | UNVERIFIED | 未执行（无提交） | 设计批准后出计划 |
| [session-lifecycle](session-lifecycle/requirements.md) | 同上 + USER_CONFIRMED（双中断模式） | SL-01…09：状态机与终态至多一次、事件契约、工具 round-trip、打断语义、排队双注入边界、配置快照、单写者、审批最小闭环、Core 边界 | Agent/会话层 | ✅需求→▶设计（待批）→计划→实施→测试→交付 | [需求](session-lifecycle/requirements.md) ／ [设计](design/design.zh.md) ／ [STATUS](session-lifecycle/STATUS.md) | UNVERIFIED | 未执行（无提交） | 设计批准后出计划 |
| [tui-conversation](tui-conversation/requirements.md) | 同上 | TC-01…08：O8 选型实测报告、流式渲染、多行/中文输入、键位（Esc/Ctrl+C/排队）、审批残留防治、非 TTY、resize 基本、bin/构建边界 | TUI 宿主层 | ✅需求→▶设计（待批）→计划→实施→测试→交付 | [需求](tui-conversation/requirements.md) ／ [设计](design/design.zh.md) ／ [STATUS](tui-conversation/STATUS.md) | UNVERIFIED | 未执行（无提交） | TC-01 已依 U5 关闭；设计批准后出计划 |

## 验收与交接

- 本轮出口门槛（对照路线图）：真实模型配置与流式交互有 fixture + live 证据；工具回合契约可验证；取消与错误路径有回归；会话配置快照与事件/终态契约固定；首个构建与 Node bin/资源边界明确；Core 不依赖 UI（依赖白名单检查落地）；TUI 不是其他端前置。
- 实际验收：UNVERIFIED；尚无实现与证据。
- 未完成/延期项：O8 已关（U5）、O6 随设计批准生效；live 凭据仍 OPEN——验收时无凭据则对应 AC 记 UNVERIFIED 并写恢复条件，不降门槛、不用 mock 冒充。
- 下一轮输入（预计）：provider/session 公开契约、事件模型、配置快照规则、选型结论与许可登记、迁移后的模块边界。
- 风险/回退：
  - R2（承接 SP001，2026-11-16 依 U5 修订）：选型门槛豁免后，风险从「选错框架」转为「CJK/IME 打字体验与 Ink 渲染 churn」——以 M1 人工 smoke（Windows Terminal+ConHost）、版本钉扎 8.0.0、回退自研输入层承接（设计 §7）。
  - `src/tui` provider 逻辑迁移拆分可能破坏已发布的聊天功能——迁移前先补行为回归，保持 npm 包可构建。
  - live Provider 无凭据/无预算 → 对应项 UNVERIFIED，不用 mock 冒充通过。
  - 回退：本轮全部产出在新目录 `SP/SP002/` 与后续实现分支；产品版本在获得发布授权前不动。
- Git/产品发布：未执行；无提交、无推送、无发布。发生时另行记录真实回执。

## 变更记录

| 日期 | 范围或状态变化 | 原因/来源 | 影响及处理 |
| --- | --- | --- | --- |
| 2026-11-16 | 建立 SP002 迭代汇总，四项候选需求进入 intake；核对 SP001 出口与 bootstrap 事实 | 用户会话授权继续 SP002 开发 | 仅开轮与整理；需求正文、设计、计划与实现待逐项批准 |
| 2026-11-16 | 旧仓只读机制盘点落盘 `attachments/`；四项需求 v0.1 草案 + STATUS 建立（32 条 AC），进入待评审 | 侦察子代理报告 + 新仓 `src/tui` 直读 + 用户两轮答复（未指定服务；双中断模式） | 草案为 MODEL_PROPOSED；评审通过前不进设计定稿、不动代码 |
| 2026-11-16 | 四项需求 v0.1 **获用户批准**（会话答复「批准」，对应 Agent 提议「批准，进设计」）；迭代进入 design 阶段；启动 O8 终端框架选型调研（TC-01 前置） | USER_CONFIRMED；设计、计划、实现、提交、发布仍未授权 | 选型实测报告随设计稿一并交付审阅；本轮仍零代码零依赖变更 |
| 2026-11-16 | **O8 依 U5 关闭为 Ink 8**（用户拍板沿用老仓库同框架，调研/spike 豁免；TC-01 交付简化为许可登记+版本钉扎）；[设计稿 v0.1 draft](design/design.zh.md) 提交待批；记录按新版 SP 规范迁移（中文单份、设计唯一审阅点、阶段勾选入口） | USER_CONFIRMED（U5 原话见设计 §2）；双路调研证据仍存档 `attachments/` | Builder 独立复核进行中，意见随后一次性回灌；仍零代码、零依赖（ink/react 未安装进仓库） |
| 2026-11-16 | 独立 builder 复核返回（9 问 + 3 勘误，含 ink/chalk 实包取证）；设计稿升 **[v0.2 draft](design/design.zh.md)**，意见处理表见设计 §10；关键修订：凭据绑定防删除重建旁路（Q3）、打包布局拍平+bin 路径（Q5）、队列驻留窗口与 Esc 回收（Q6）、审批 Esc 分叉（Q7）、回合续跑语义与 max_turns（Q1）、Ctrl+C 单击→双按为有意变更（勘误，代决可否决） | builder 复核报告（内部） | 无新增上抛未决项；等待用户对 v0.2 的批准（批准=覆盖计划/实施/本地提交，见新版约定） |
