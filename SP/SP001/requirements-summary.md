# SP001 · 能力基线、核心边界与发布范围

状态：ACTIVE（规格轮）｜更新：2026-11-16｜负责人：待指定

## 本轮目标与边界

- 目标：把「达到原 Agent 的 TUI 水平」从形容词变成**可逐项验收的能力清单**，并同时固定**核心边界与不变量**、**评测集规格**与**发布范围**，让 SP002–SP021 每一轮都有明确的对照基准、边界约束与出口门槛。本轮产出全部是规格，不含产品代码。
- 不包含：任何产品代码实现；运行原 Agent 或采集其效果数据；终端 UI 框架的具体选型；API 字段 / 事件 schema / 存储 schema / 权限规则语法；插件框架、微服务、常驻网关；Git 提交、合并、推送、发布、建分支、远端设置。
- 输入基线：仓库 HEAD `2ced5e4`（`feat : npm release package workflow`），工作区有用户既有未提交改动（本轮未触碰）。对照基线为 `D:\extra_project\buding-worker-space`（`budingx` 0.5.0，私有未开源），**只读盘点**：未读取源码内容、未读取 `.env`、未运行、未写入。
- 依赖与启动条件：无前置 SP 依赖。本轮需用户先批准设计并拍板三项待决：**O1**（npm 包名策略，见 release-scope OPEN-01）、**O2**（Windows 之外的平台范围，见 release-scope OPEN-02）、**O5**（原产品效果基线的采集授权，见 evaluation-suite OPEN-01）。待决编号以设计 §6 的 O1–O8 为全局索引，各需求正文内的 OPEN-xx 为该需求内的局部编号。
- 计划/批准身份：**MODEL_PROPOSED**（设计与计划 v1 draft）；**USER_CONFIRMED**（用户 2026-11-16 的四项决定 + Node-only 追加 + `AGENTS.md` 既有约定）。设计**尚未获批准**。

### 本轮用户决定（USER_CONFIRMED，2026-11-16）

1. **交付边界**：只交规格，不写产品代码。
2. **基线取证**：静态盘点 + 旧仓自证行为；不运行旧 Agent、不读旧仓凭据。
3. **复刻边界**：读机制、不抄代码 —— 可读旧仓源码理解机制与算法，所有实现独立编写；不复制文件，不搬系统提示词 / 内部 SDK 类型 / 全局状态。
4. **技术栈**：Core 零框架，TUI 层允许 MIT 终端框架。
5. **运行条件**：基于 Node，不依赖 Bun。

> 决定 2 的直接后果：**本轮不存在原产品效果基线**。因此「达到水平」在本轮只能是能力清单覆盖度，不能是效果结论；相关措辞被禁用（AC-09）。

## 需求索引

| 功能/优化目录 | 来源 / 身份 | 验收目标 | 责任范围 | 阶段 | 需求 / 设计 / 计划 / STATUS | 验证 | 集成状态 | 下一步 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `capability-baseline` | USER_CONFIRMED（目标）+ MODEL_PROPOSED（切分） | AC-01…AC-10：产出 85 项能力清单、必交分母固定 53、来源台账登记 | 能力盘点与基线定义 | VERIFYING | [需求](capability-baseline/requirements.md) ／ [清单](capability-baseline/capability-manifest.md) ／ 设计 §3.1 §3.5 ／ 计划 T-001 ／ [STATUS](capability-baseline/STATUS.md) | PASS 9 / N/A 1 | 未执行 | 用户验收后转 ACCEPTED |
| `evaluation-suite` | MODEL_PROPOSED（继承路线图 r3 的量） | AC-01…AC-12：任务 schema、30+30+20 配额、盲测与统计纪律、原产品基线缺口的诚实处理 | 评测方法与效果度量 | VERIFYING | [需求](evaluation-suite/requirements.md) ／ [任务清单](evaluation-suite/task-inventory.md) ／ 计划 T-002 ／ 设计 §3.3 ／ [STATUS](evaluation-suite/STATUS.md) | PASS 12 | 未执行 | 用户验收后转 ACCEPTED |
| `core-boundaries` | USER_CONFIRMED（Core 零框架、Node-only） | AC-01…AC-13：目录蓝图、I-01…I-12 不变量、契约方向、端无关与可取消要求 | 架构责任边界 | VERIFYING | [需求](core-boundaries/requirements.md) ／ 设计 §3.2 ／ 计划 T-003 ／ [STATUS](core-boundaries/STATUS.md) | PASS 13 | 未执行 | 用户验收后转 ACCEPTED |
| `release-scope` | USER_CONFIRMED（Node-only、发布须授权） | AC-01…AC-12：制品形态、包名策略、三态平台矩阵、运行条件、凭据与许可边界、待决项 | 发布形态与运行条件 | VERIFYING | [需求](release-scope/requirements.md) ／ 设计 §3.4 ／ 计划 T-004 ／ [STATUS](release-scope/STATUS.md) | PASS 12 | 未执行 | 用户拍板 OPEN-01…OPEN-04 并验收 |

设计正本：[design.zh.md](design/design.zh.md) ／ [design.en.md](design/design.en.md)（英文为执行依据，v1 draft）
实施计划：[plan.zh.md](design/plan.zh.md) ／ [plan.en.md](design/plan.en.md)（v1 draft）

## 验收与交接

- 本轮出口门槛（对照路线图 SP001）：固定「水平」的定义与任务集/盲测/预算口径、公开契约与数据共享/凭据边界、来源台账；npm 包名/平台/运行条件列出待决项；五类高级必交能力不得降级；逐项登记实际行为、目标平台与对照场景。
- 实际验收：**规格部分 PASS**。47 条 AC 全部逐条走查完毕 —— **46 PASS / 0 FAIL / 0 UNVERIFIED / 1 NOT_APPLICABLE**（capability-baseline AC-09，前置条件「基线不可访问」未成立）。逐条记录见 [验证报告](test-report.md)。
- **范围提醒（不得误读）**：本轮是**规格轮**，交付物是规格与清单，**零产品代码**。上述 PASS 指**规格条款被满足**，**不代表任何产品能力已实现**，也**不代表已达成与原 Agent 的效果对齐** —— 原产品效果基线从未采集。
- 实际检查（本会话，cwd 均为仓库根）：
  - **`npm run spec:check` PASS（exit 0）**：能力清单 85 项（必交 53 / 建议 22 / 可选 9 / 范围外 1）、任务清单 基本 30 / 高级 30 / 保护 12、盲测 20，全部自洽
  - **`npm run spec:test` PASS（7 项）**：门禁自检，含「降级必交能力 / 改错统计数字 / 破坏盲测数量 / 删任务 / 未限定达成声明」五种人为破坏均被检出
  - **`npm test` PASS（44 项）**：skills 9 / spec 7 / tui 12 / release 16，0 失败
  - 文档相对链接补充扫描：173 个 `.md`、322 条相对链接、0 断链
  - `git diff package.json` 确认：**无新增依赖**
  - 未执行：任何安装/发布/live Provider 检查（本轮无产品代码，故无安装类证据）
- 门禁实际拦下并修掉的缺陷（证明门禁有效，非事后补记）：
  - 清单声明统计 87 项 / 必交 48，与实算 85 / 53 不符 —— **分母是所有下游轮次验收的锚点**
  - 任务清单 23 处备注空单元格、2 处盲测超配（高级 12 ≠ 10）、复合断言方向未定义
  - `plan.*.md` 中 2 处链接语法示例被既有链接检查判为断链（既有门禁在本轮第一次真实拦住文档）
  - 3 处肯定式「已对齐」表述 + 1 处未限定引用

- 未完成/延期项：
  - `evaluation-suite` 的 `task-inventory.md`（60 条任务槽位）未编写 —— 依赖设计批准
  - 文档链接检查脚本未实现 —— 属计划 T-005
  - 原产品效果基线 —— 未采集，且需单独授权（OPEN-05）
  - 仓库文档同步（`docs/index.md` / `current-status.md` / `iteration-plan.md` / `agent-capability-matrix.md`）—— 属计划 T-007
- 下一轮输入：能力清单 v1（CAP ID 空间 + 必交分母 53）、不变量 I-01…I-12、任务 schema 与预算表、发布范围与待决项。
- 风险/回退：
  - R1 53 项必交能力在 21 轮内是否够，未排期验证 —— 某轮切不动就追加 SP 编号，不缩减必交范围
  - R2 上游终端框架可能缺少基线自研渲染器的等价能力 —— SP002 选型设实测门槛，逐项对照 CAP-L1-01/02/03/04/05/14/15
  - R3 无原产品效果基线 —— 效果维度不可证，禁止「已对齐」措辞
  - R5 `budingx` 包名冲突 —— OPEN-01 未决前不发布
  - 回退：规格文档为纯新增文件，删除 `SP/SP001/` 即可完全回退，不影响现有产品代码与发布链路
- Git/产品发布：**未执行**。未 stage、未 commit、未 push、未建分支、未改远端、未发版。

## 变更记录

| 日期 | 范围或状态变化 | 原因/来源 | 影响及处理 |
| --- | --- | --- | --- |
| 2026-11-16 | 建立 SP001 迭代目录，四项需求进入 ACTIVE（规格轮） | 用户要求以 SDD 流程按既有 SP001 设计生成设计文档 | 本轮只交规格；实现与 Git 动作另行授权 |
| 2026-11-16 | 交付边界定为「只交规格，不写产品代码」 | 用户决定 | 路线图 SP001 的定位未变；产品实现仍在 SP002+ |
| 2026-11-16 | 基线取证定为「静态盘点 + 旧仓自证行为」 | 用户决定 | 本轮无原产品效果基线；效果对齐门槛不可计算，恢复条件见 evaluation-suite STATUS |
| 2026-11-16 | 复刻边界定为「读机制、不抄代码」 | 用户决定 | 能力清单只记录行为与结构事实；实现全部独立编写 |
| 2026-11-16 | 技术栈定为「Core 零框架，TUI 层允许 MIT 终端框架」 | 用户决定 | 写入 I-01；框架选型留 SP002，须登记 MIT 许可 |
| 2026-11-16 | 运行条件追加「基于 node，不要依赖于 bun」 | 用户补充 | 与 `AGENTS.md` 既有约定一致；写入 I-09 与发布范围 |
| 2026-11-16 | 能力清单 v1 定稿：85 项，必交 53 | 本轮盘点结果 + 脚本实算复核 | 覆盖度分母固定为 53；建议/可选不计入分母。初稿的统计数字为目测估计（87/48），复核脚本实算后按实算值修正 |
| 2026-11-16 | 产出评测任务清单 v1（60 任务 + 12 保护用例 + 20 盲测） | T-002 执行 | 评测集从规格落到可执行题目清单；快照版本与哈希要求已定义 |
| 2026-11-16 | `docs/repository-layout.md` 与设计 §3.2 对齐 | T-003 步骤 1 | 归一 `providers/`→`provider/`、`protocol/`→`host/`；登记后续迭代模块名，避免后续改名 |
| 2026-11-16 | 新增 `scripts/spec/` 门禁（`spec:check` / `spec:test`）并并入 `npm test` | 复审重点第 1 条「无任何测试会失败」 | 把「必交能力被静默降级」从无覆盖变成有可执行拦截；本轮真实拦下 4 类缺陷 |
| 2026-11-16 | 新增禁用措辞检查（「已对齐」仅允许出现在明确禁止它的句子中） | 复审重点第 2 条 | 防止无基线情况下出现达成声明；本轮修掉 4 处 |
| 2026-11-16 | 47 条 AC 全部走查完毕：46 PASS / 0 FAIL / 0 UNVERIFIED / 1 NOT_APPLICABLE | T-008 执行 | 规格部分具备验收依据；**产品部分仍为零实现** |
