# SP002 验证报告 · 模型与会话闭环

> 本历史记录沿用当时的 SP 编号，现行排期及新旧编号见[路线图 r8](../../docs/iteration-plan.md)。

日期：2026-11-17｜迭代：SP002｜设计：[design.zh.md v0.3 approved](design/design.zh.md)｜计划：[plan.zh.md](design/plan.zh.md)｜分支：`feature/SP002/model-session-loop`

本报告只记录**实际执行**的检查。未执行为 `UNVERIFIED`，失败为 `FAIL`，真正不适用才写 `NOT_APPLICABLE`。不使用 mock 冒充 live，不用旧仓成绩充数。

## 1. 实际执行的检查（汇总）

| 门禁                            | 命令                                                                          | cwd    | 实际数量/结果                                                                                                                         |
| ------------------------------- | ----------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| 技能与发现入口维护              | `npm run skills:test`                                                         | 仓库根 | 9 项，9 通过 / 0 失败                                                                                                                 |
| 规格自洽性（能力清单/评测任务） | `npm run spec:test`                                                           | 仓库根 | 7 项，7 通过 / 0 失败                                                                                                                 |
| 产品单元与进程回归              | `npm run test:unit`（= `npm run build && node --test src/*/test/*.test.mjs`） | 仓库根 | **103 项，103 通过 / 0 失败**                                                                                                         |
| 模块边界检查                    | `npm run test:checks`（`node scripts/checks/module-boundaries.mjs`）          | 仓库根 | 1 次检查，PASS（core/provider/storage 无 UI/IO 反向依赖；运行时依赖白名单恰为 ink/react/string-width；bin=`dist/tui/cli.js`）         |
| 发布与版本管理回归              | `npm run test:release`                                                        | 仓库根 | 16 项，16 通过 / 0 失败                                                                                                               |
| 编译                            | `npm run build`（`tsc -p src/tui/tsconfig.json`）                             | 仓库根 | 通过；产物 `src/tui/dist/{core,provider,storage,tui}`                                                                                 |
| 打包与隔离安装 smoke            | `node scripts/release/pack-smoke.mjs`                                         | 仓库根 | tarball 32 文件；仓库外临时目录 `npm install` 成功；`--version` 与清单一致（0.1.1）；对本地 fixture 真实 HTTP 流式请求成功（calls=1） |

产品单元用例按文件分布（实际执行数）：

| 文件                                     | 数量 | 覆盖                                                         |
| ---------------------------------------- | ---- | ------------------------------------------------------------ |
| `src/core/test/session.test.mjs`         | 16   | 状态机、事件契约、工具回合、审批、打断、排队、快照、并发     |
| `src/core/test/normalize.test.mjs`       | 7    | 消息规范化（孤儿 tool_result 剥离、id 去重、合成结果）       |
| `src/core/test/tool-calls.test.mjs`      | 6    | tool_calls 跨事件碎片装配                                    |
| `src/provider/test/openai.test.mjs`      | 11   | 错误分类、重试、取消、限额、probe、工具片段                  |
| `src/provider/test/sse.test.mjs`         | 5    | SSE 分帧与 0.1.1 基线等价                                    |
| `src/storage/test/config-store.test.mjs` | 10   | 档案 CRUD、原子写、未知字段、损坏、迁移、输入校验            |
| `src/storage/test/credentials.test.mjs`  | 7    | 凭据隔离、主机绑定、孤儿诊断、损坏保护                       |
| `src/storage/test/profiles.test.mjs`     | 3    | 端点归一化、参数校验、主机绑定                               |
| `src/tui/test/cli.test.mjs`              | 5    | 真实进程：帮助/版本、管道多轮、无 ANSI、失败回合、命令不外发 |
| `src/tui/test/commands.test.mjs`         | 10   | 斜杠命令族与档案验证                                         |
| `src/tui/test/editor.test.mjs`           | 9    | 多行编辑、历史召回、粘贴、按键语义                           |
| `src/tui/test/render.test.mjs`           | 6    | 帧模型、CJK/emoji 宽度、原子切换、resize 重排                |
| `src/tui/test/approval.test.mjs`         | 3    | 审批 claim-once 与取消清理                                   |
| `src/tui/test/package.test.mjs`          | 5    | 制品清单边界（依赖白名单、bin、files、engines）              |

## 2. AC → 任务 → 文件 → 用例 → 结果

命令统一为 `node --test <文件>`（cwd＝仓库根）；标注「全量」者已在 `npm test` 中实际跑过。

### provider-streaming（PS-01…PS-08）

| AC                      | 任务    | 实现文件                                           | 测试用例                                                                                                                                                                                                             | 结果                                                             |
| ----------------------- | ------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| PS-01 分帧等价          | T2      | `src/provider/sse.ts`                              | `sse.test.mjs`：分帧容忍任意 TCP 分片/CRLF/多行 data/注释行/[DONE]；多行 data 只保留载荷；残留帧冲刷；**基线回归：新分帧器与 0.1.1 预览实现产出的文本等价**（冻结基线 `src/provider/test/fixtures/legacy-chat.mjs`） | PASS（5 项）                                                     |
| PS-02 tool_calls 组装   | T2      | `src/core/tool-calls.ts`                           | `tool-calls.test.mjs`：按 index 组装、缺 index 补位、续流并入当前调用、非法 JSON 归一为错误项、缺 name/id 归一为错误项、并行顺序稳定                                                                                 | PASS（6 项）                                                     |
| PS-03 错误分类          | T3      | `src/provider/errors.ts`、`src/provider/openai.ts` | `openai.test.mjs`：401/403/404/429/500/400 各自类别 + 机读码 + 不含 key 与上游 body；截断与非法事件为 invalid_stream；非 SSE 明确失败                                                                                | PASS（3 项并入 11 项文件）                                       |
| PS-04 有界重试          | T3      | `src/provider/openai.ts`                           | `openai.test.mjs`：尊重 `Retry-After`（2s×2 次）并达上限失败；连续 5xx 指数退避且请求体 `model` 始终不变（无静默换模型）                                                                                             | PASS（2 项）                                                     |
| PS-05 取消              | T3 + T5 | `src/provider/openai.ts`、`src/core/session.ts`    | `openai.test.mjs`：中途 abort → `aborted` 且零重试；`session.test.mjs`：打断在有界时间内取消模型请求并给出 cancelled 终态                                                                                            | PASS（2 项）                                                     |
| PS-06 限额              | T3      | `src/provider/openai.ts`、`src/provider/sse.ts`    | `openai.test.mjs`：响应超长 → `BUDINGX_PROVIDER_014`；单事件超限 → `BUDINGX_PROVIDER_013`；`sse.test.mjs`：解析器超限抛明确错误                                                                                      | PASS（2 项）                                                     |
| PS-07 依赖白名单 + lint | T1/T12  | `scripts/checks/module-boundaries.mjs`             | 全量 `npm test` 内的边界检查：core/provider/storage 无 UI/终端库，core 无 IO 模块与反向依赖，产品依赖白名单恰为 `{ink, react, string-width}`                                                                         | PASS                                                             |
| PS-08 live 真实服务     | —       | —                                                  | 需用户提供任一 OpenAI 兼容服务凭据与费用上限                                                                                                                                                                         | **UNVERIFIED**（恢复条件＝验收时提供凭据与预算；未用 mock 冒充） |

### model-management（MM-01…MM-07）

| AC                     | 任务      | 实现文件                                                 | 测试用例                                                                                                                                                               | 结果         |
| ---------------------- | --------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| MM-01 持久化与原子写   | T7        | `src/storage/config-store.ts`、`src/storage/atomic.ts`   | `config-store.test.mjs`：CRUD 跨实例加载 + 无残留 tmp；配置文件带 schema 版本字段                                                                                      | PASS（2 项） |
| MM-02 验证分类         | T3/T7/T11 | `src/provider/openai.ts`（probe）、`src/tui/commands.ts` | `openai.test.mjs`：probe 可达性 + 工具能力探测 + 凭据错误分类且不泄漏 key；`commands.test.mjs`：`/provider check` 用档案凭据探测并报告工具能力；缺凭据时拒绝且不发请求 | PASS（5 项） |
| MM-03 切换不清史       | T5/T7/T11 | `src/core/session.ts`、`src/tui/commands.ts`             | `session.test.mjs`：回合进行中切换模型不影响本回合快照、下一回合用新快照；`commands.test.mjs`：`/model` 切换不清空会话历史                                             | PASS（2 项） |
| MM-04 换主机不发旧 key | T7        | `src/storage/credentials.ts`、`src/storage/profiles.ts`  | `credentials.test.mjs`：档案主机变更后旧 key 不会被取用；host 不符即视为无 key                                                                                         | PASS（2 项） |
| MM-05 凭据去向         | T7        | `src/storage/credentials.ts`                             | `credentials.test.mjs`：key 仅存于专用凭据文件、普通配置不含 key、UI 回显仅末 4 位；`config-store.test.mjs`：回显掩码                                                  | PASS（4 项） |
| MM-06 兼容与迁移       | T7        | `src/storage/config-store.ts`                            | `config-store.test.mjs`：未知字段保留；损坏配置备份并明确报错且原文件未被清空；旧版本迁移到当前版本并保留 `.bak`；更新 schema 明确拒绝                                 | PASS（4 项） |
| MM-07 非法输入         | T7        | `src/storage/profiles.ts`                                | `config-store.test.mjs`：空名/超长名/控制字符/带凭据 URL/非 HTTPS/空模型名均显式拒绝且不落盘；重复档案名在 `commands.test.mjs` 拒绝                                    | PASS（2 项） |

### session-lifecycle（SL-01…SL-09）

| AC                         | 任务   | 实现文件                                       | 测试用例                                                                                                                                                                                                  | 结果         |
| -------------------------- | ------ | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| SL-01 状态机与终态至多一次 | T5     | `src/core/session.ts`                          | `session.test.mjs`：一次完整回合事件顺序且终态至多一次；状态集合与迁移受约束（非法迁移被拒并发 notice）                                                                                                   | PASS（2 项） |
| SL-02 事件契约             | T4/T5  | `src/core/events.ts`、`src/core/session.ts`    | `session.test.mjs`：事件顺序符合契约；全部事件可 JSON 序列化且与 UI 类型无关；delta 先于 completed                                                                                                        | PASS（2 项） |
| SL-03 工具回合             | T5     | `src/core/session.ts`、`src/core/normalize.ts` | `session.test.mjs`：每个 tool_use 恰好一个 tool_result 并续跑至收敛；并行调用按序各回填一个；未知工具名/非法参数产生错误结果且不崩；`normalize.test.mjs`：孤儿剥离、去重、合成结果                        | PASS（6 项） |
| SL-04 打断                 | T6     | `src/core/session.ts`                          | `session.test.mjs`：有界时间内取消模型请求并给出 cancelled 终态；保留部分输出并为孤儿 tool_use 补合成 error 结果                                                                                          | PASS（2 项） |
| SL-05 排队与注入边界       | T6     | `src/core/session.ts`                          | `session.test.mjs`：排队项在工具结果回填后按序注入且不重复；回合结束后剩余项自动起新回合并标记 inter_turn；驻留窗口内回收排队项发通知并交回文本（自动起新回合依赖队列 drain 定时器不被 `unref()`，见 §7） | PASS（3 项） |
| SL-06 配置快照             | T5     | `src/core/session.ts`                          | `session.test.mjs`：回合进行中切换模型不影响本回合快照，下一回合使用新快照                                                                                                                                | PASS（1 项） |
| SL-07 并发与唯一行为       | T5/T6  | `src/core/session.ts`                          | `session.test.mjs`：active 时再次提交入队且不产生交错写历史；终态守卫拒绝重复终态                                                                                                                         | PASS（1 项） |
| SL-08 审批最小闭环         | T5/T10 | `src/core/session.ts`、`src/tui/approval.ts`   | `session.test.mjs`：deny 合成拒绝结果回填、会话继续、无挂起泄漏；allow 正常执行且按 id 匹配；`approval.test.mjs`：决策恰一次、未知 id 不处理、取消清空待决                                                | PASS（5 项） |
| SL-09 Core 边界            | T1/T12 | `scripts/checks/module-boundaries.mjs`         | 全量 `npm test` 内的边界检查；core 不 import UI/IO/其他模块                                                                                                                                               | PASS         |

### tui-conversation（TC-01…TC-08）

| AC                   | 任务   | 实现文件                                                 | 测试用例                                                                                                                                                                                                                         | 结果                                                          |
| -------------------- | ------ | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| TC-01 许可登记与钉扎 | T1/T12 | `THIRD-PARTY-NOTICES.md`、`src/tui/package.json`         | `package.test.mjs`：运行时依赖恰为白名单三项、版本钉扎且无 workspace/file 协议；边界脚本校验白名单；NOTICES 登记 ink 8.0.0 / react 19.3.1 / string-width 9.0.0（MIT，仅渲染层）                                                  | PASS（2 项 + 文档核对）                                       |
| TC-02 渲染           | T8     | `src/tui/render/reducer.ts`                              | `render.test.mjs`：增量文本按帧合并不逐字符重排；CJK/emoji 按显示宽度折行不切字；终态切换原子不丢段                                                                                                                              | PASS（3 项）；真终端部分 **UNVERIFIED**                       |
| TC-03 输入区         | T9     | `src/tui/editor/buffer.ts`、`src/tui/editor/keys.ts`     | `editor.test.mjs`：多行输入与光标行列移动；按字符移动（中文/emoji 不错位）；历史召回；多行粘贴不误发；undo；Enter/Shift+Enter                                                                                                    | PASS（6 项）；真终端 CJK/IME 人工 smoke **UNVERIFIED**        |
| TC-04 按键           | T9/T10 | `src/tui/editor/keys.ts`、`src/tui/app.tsx`              | `editor.test.mjs`：执行中 Esc=打断、空闲 Esc=回收、执行中 Ctrl+C=打断、空闲 Ctrl+C=退出                                                                                                                                          | PASS（1 项）；真终端人工 smoke **UNVERIFIED**                 |
| TC-05 审批与残留     | T10    | `src/tui/approval.ts`、`src/tui/app.tsx`                 | `approval.test.mjs`：决策 resolve 恰一次、未知 id 不处理、取消清空待决且无残留                                                                                                                                                   | PASS（3 项）；真终端人工 smoke **UNVERIFIED**                 |
| TC-06 非 TTY/管道    | T11    | `src/tui/cli.ts`                                         | `cli.test.mjs`：管道输入按行发送且输出无 ANSI 污染；管道中的命令不会作为提示词发送；help/version 不依赖配置；未知选项与缺模型确定性报错                                                                                          | PASS（5 项）                                                  |
| TC-07 resize         | T8     | `src/tui/render/reducer.ts`                              | `render.test.mjs`：宽度变化后重排不错位也不丢字                                                                                                                                                                                  | PASS（1 项，帧断言）；真终端 resize 人工 smoke **UNVERIFIED** |
| TC-08 构建与制品     | T12    | `src/tui/package.json`、`scripts/release/pack-smoke.mjs` | `package.test.mjs`：bin=`dist/tui/cli.js`、files 仅 dist/README/LICENSE、engines `>=22.18.0`、入口存在；实跑 `node scripts/release/pack-smoke.mjs`：tarball 30 文件 → 仓库外隔离安装 → `--version` 一致 → 真实 HTTP 流式请求成功 | PASS（5 项 + 1 次实跑 smoke）                                 |

## 3. 汇总

| 需求               | AC 数 | PASS                                                    | UNVERIFIED                                          | FAIL |
| ------------------ | ----- | ------------------------------------------------------- | --------------------------------------------------- | ---- |
| provider-streaming | 8     | 7                                                       | 1（PS-08）                                          | 0    |
| model-management   | 7     | 7                                                       | 0                                                   | 0    |
| session-lifecycle  | 9     | 9                                                       | 0                                                   | 0    |
| tui-conversation   | 8     | 8（其中 TC-02/03/04/05/07 的真终端人工部分 UNVERIFIED） | 真终端人工项                                        | 0    |
| 合计               | 32    | 31                                                      | 1 项 AC 全量未验（PS-08）+ 5 项 AC 的真终端人工部分 | 0    |

## 4. 未验证项与恢复条件

| 项                                                                      | 原因                           | 恢复条件                                                                                                      |
| ----------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| PS-08 live 真实服务（流式一轮 / tool_calls 回合 / 手动取消 / 错误 key） | 无真实 Provider 凭据与费用预算 | 用户提供任一 OpenAI 兼容服务的凭据与费用上限后执行 `probe` + live 回合，补录结果                              |
| TC-02/03/04/05/07 的真终端部分（Windows Terminal + ConHost）            | 本环境无真 TTY 交互            | 用户在真终端按 [人工清单](#5) 执行并回填结果；CJK/IME 打字体验为 R1 门槛，不达标时按设计 §7-R1 回退自研输入层 |
| macOS/Linux 验证                                                        | 本机为 Windows                 | 按 O2=A 于 SP011 后逐个平台验证                                                                               |
| 真实 npm 发布回执                                                       | 未获发布授权                   | 用户授权后按 [buding-npm-release](../../skills/buding-npm-release/SKILL.md) 执行并保存回执                    |

## 5. 人工 smoke 清单（供验收时补证据）

1. Windows Terminal 中启动 `budingx`，中文连打、emoji、宽字符不乱码不切字。
2. Shift+Enter 换行、↑/↓ 召回历史、多行粘贴不误发。
3. 执行中按 Esc：立即停止当前生成，保留已输出文本，会话回到可继续状态。
4. 执行中直接输入补充内容：出现排队指示，当前回合结束后按序注入，不丢失不重复。
5. 空闲时按 Esc：排队的补充内容回到输入框可编辑。
6. 空闲时连按两次 Ctrl+C 退出；执行中单按 Ctrl+C 为打断。
7. 触发一次审批：卡片只显示队首、y/n 生效恰一次、卡不留残留。
8. 拖动窗口改变宽度：重排不错位、不崩溃。
9. ConHost（非 Windows Terminal）重复第 1–8 项的关键路径。

## 6. 与已批准设计的偏差（已记录，未改变设计意图）

1. **tool_call 装配归 Core**：core 不得 import provider，故碎片装配函数落在 `src/core/tool-calls.ts`，provider 只发 `tool_call_delta` 碎片。PS-02 的可观察行为不变。
2. **`tool_call_delta.index` 可选**：部分网关在续流片段不带 index，装配器据此把续流并入当前调用；`index` 必填无法表达该情形。
3. **`turn_finalized` 增加 `restoreText?`**：auto-restore 需要一个可观察出口（设计 §3.2 允许的最小扩展）。
4. **失败回合回滚历史**：失败回合不写入会话历史（与 0.1.1 预览一致），模型不会看到它答不了的提示；已用输入历史 `↑` 可召回原文。
5. **`ToolHandler` 增加可选 `summary`**：provider 的工具声明需要静态描述，`describe(input)` 仍是运行时摘要。
6. **计划中的「Vitest」措辞**：统一为 node --test（需求 PS-01 已勘误）。

## 7. 复验记录（2026-11-17）

交付后复验（用户要求「检查 SP002 是否完成」）实测发现一处真实缺陷，原报告「103 项 103 通过」的结论在修复前并不成立，已修复并复测。

### 7.1 缺陷

- 现象：`node --test src/core/test/session.test.mjs` 报 13 通过 / 3 cancelled；`回合结束后剩余排队项自动起新回合并标记 inter_turn 边界` 的 promise 永不 resolve（`Promise resolution is still pending but the event loop has already resolved`），并连带取消其后 3 项用例。
- 根因：`src/core/session.ts` 的 `scheduleQueueDrain()` 把队列自动启动定时器 `unref()` 了。unref 后的定时器不维持事件循环，空闲时事件循环直接排空 → **排队的补充输入永远等不到自动起新回合**，SL-05 契约在非 TTY／进程空闲场景下失效（真 TUI 因 stdin 保持事件循环而未暴露）。
- 修复：移除队列 drain 定时器的 `unref()`（`dispose()` 原本就会清理该定时器，不会吊住进程）。取消预算那处 `unref()` 保留——它是兜底安全网，回合本身由 abort 信号维持事件循环。

### 7.2 修复后复测（同一环境重跑）

| 门禁                 | 命令                                         | 结果                                                                  |
| -------------------- | -------------------------------------------- | --------------------------------------------------------------------- |
| 编译                 | `npm run build`                              | 通过                                                                  |
| 产品单元与进程回归   | `npm run test:unit`                          | **103 项，103 通过 / 0 失败 / 0 cancelled**                           |
| session 专项         | `node --test src/core/test/session.test.mjs` | **16 项，16 通过 / 0 cancelled**                                      |
| 全量门禁             | `npm test`                                   | skills 9 + spec 7 + unit 103 + checks PASS + release 16，**全部通过** |
| 打包与隔离安装 smoke | `node scripts/release/pack-smoke.mjs`        | PASS（tarball 32 文件；本报告 §1 原记 30 文件，实际为 32，已更正）    |

### 7.3 复验后的遗留状态

- 缺陷修复后无新增未验证项；§4 的 PS-08（live 凭据）与 TC-02/03/04/05/07（真终端人工）仍按原样保持 UNVERIFIED。
- 本次复验只覆盖自动化门禁，未改变真终端与 live 证据的恢复条件。

## 8. 复现命令

```powershell
npm ci --ignore-scripts --no-audit --no-fund
npm run build
npm test
node scripts/release/pack-smoke.mjs
```

## 9. 交付后补充记录（2026-11-17，续接中断会话）

上次会话在 SP002 验收前中断。续接核对发现工作区有一项**未完成的交付后补充**：首屏头部（版本 / 模型 / 端点主机 / 密钥状态 / 工作目录 + 未配置引导）。本轮将其收尾并修正两处问题：

| 项                                                 | 处理                                                                                                    |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| UI 状态持有完整 `ResolvedConfig`（含 apiKey 原文） | 改为配置版本号触发重渲；头部只接收 `keyMasked: boolean`，密钥原文不进入 React 状态与渲染层              |
| 头部测试断言「末四位掩码」                         | 改为断言头部**不接触任何密钥内容**（仅 configured / not configured），与 MM-05「UI 回显最小化」口径一致 |
| `PRODUCT.md`                                       | 新增 §5.3 首屏信息（用户可见行为变更须同步说明书）                                                      |

补充后的实际执行证据（cwd＝仓库根，同一环境重跑）：

| 门禁           | 命令                                  | 结果                                                                  |
| -------------- | ------------------------------------- | --------------------------------------------------------------------- |
| 编译           | `npm run build`                       | 通过                                                                  |
| 产品单元       | `node --test src/*/test/*.test.mjs`   | **107 项（+4 header），107 通过 / 0 失败 / 0 cancelled**              |
| 全量门禁       | `npm test`                            | skills 9 + spec 7 + unit 107 + checks PASS + release 16，**全部通过** |
| 打包隔离 smoke | `node scripts/release/pack-smoke.mjs` | PASS（tarball **33 文件**，新增 `dist/tui/render/header.js`）         |

遗留：工作区有未跟踪的 `pnpm-lock.yaml`（本机以 pnpm 安装所致）。本仓发布链为 npm（根 `package-lock.json`、CI `npm ci`），该文件不属于本轮授权范围，**未提交、未删除**，待用户确认。§4 的 PS-08（live 凭据）与 TC-02/03/04/05/07（真终端人工）仍保持 UNVERIFIED，恢复条件不变。

## 10. 首屏样式对照重做（2026-11-17，用户反馈「首屏样式不正确」）

用户要求对照参考产品 TUI 首屏样式、文案换成 budingx。只读盘点参考仓 `LogoV2` 组件群的**布局机制**（不抄代码、不搬美术资产）：圆角框 + 顶边框嵌入产品名/dim 版本、≥70 列左栏（加粗欢迎 + 7 宽吉祥物 + dim 模型/cwd）右栏信息feed、dim 竖线分隔、<70 列居中紧凑、配置后无边框精简横幅、win32 无现代终端 env 走纯 ASCII 兜底（env 可强制）。品牌色取参考仓自有紫 `#af87ff`。上游 Ink 8 无 `borderText`（系参考仓自研渲染器扩展），故框线/标题/分隔由 `src/tui/render/header.ts` 以**纯 styled-span 行**独立绘制，Ink 层仅映射 span；吉祥物为同槽位自有绘制。密钥仍以布尔参与判定，原文不进渲染层。

实际执行证据（cwd＝仓库根）：

| 门禁           | 命令                                       | 结果                                                                                             |
| -------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| 编译           | `npm run build`                            | 通过                                                                                             |
| 首屏专项       | `node --test src/tui/test/header.test.mjs` | **9 项全过**（策略判定、宽度自洽截断、宽/窄/极窄等宽框、ASCII 纯 ASCII、精简横幅、零密钥、引导） |
| 全量门禁       | `npm test`                                 | skills 9 + spec 7 + unit **112** + checks PASS + release 16，全部通过                            |
| 打包隔离 smoke | `node scripts/release/pack-smoke.mjs`      | PASS（tarball 33 文件）                                                                          |
| 几何目检       | node 投影纯文本                            | 100 列双栏 / 60 列 ASCII 紧凑 / 精简横幅框线对齐、无越界                                         |

`PRODUCT.md` §5.3 已同步重写。真终端颜色/IME 观感仍属 §5 人工清单（UNVERIFIED 不变）。

## 11. 交互面文案中文化（2026-11-17，用户原话「文案你给我替换成中文吧，除了必须用英文的地方，其余换成中文」）

语言策略：现代终端（pixel）交互面中文——首屏（欢迎/快速上手/本轮新增/模型行）、状态行、提示、审批卡、排队指示、斜杠命令回显与 `/help`（`CommandContext.lang='zh'`）；**ASCII 兜底屏保持英文**（老 conhost 代码页安全，对照参考仓 AsciiWelcomeV2 同行为）；**非 TTY/管道与 `--help`/错误输出保持英文**（TC-06 机器面稳定，`lang` 缺省 `'en'`）；命令语法/env/标识符/路径/错误码始终英文。密钥掩码 `maskKey` 不变（既有断言）。

实际执行证据（cwd＝仓库根）：

| 门禁           | 命令                                                                                                        | 结果                                                                                             |
| -------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 编译           | `npm run build`                                                                                             | 通过                                                                                             |
| 文案专项       | `node --test src/tui/test/header.test.mjs src/tui/test/commands-zh.test.mjs src/tui/test/commands.test.mjs` | **25 项全过**（header 10：中文像素屏/英文 ASCII 屏/等宽几何；zh 命令 5；既有英文命令 10 不回归） |
| 全量门禁       | `npm test`                                                                                                  | skills 9 + spec 7 + unit **118** + checks PASS + release 16，全部通过                            |
| 打包隔离 smoke | `node scripts/release/pack-smoke.mjs`                                                                       | PASS（33 文件）                                                                                  |

关于「模型名称」：首屏模型行取自配置（`BUDINGX_MODEL` / `--model` / 档案 + `/model`），属 SP002 已实现能力（MM-03）；未配置态显示「模型：未配置」是诚实状态而非缺口。从服务端拉取可用模型列表不在 SP002 AC，也未在路线图排期（如需要另行登记待决）。

## 12. CLI 测试 home 隔离修复与并行会话观察（2026-11-17）

- **缺陷**：`cli.test.mjs` spawn 真实 CLI 时只清空 `BUDINGX_*`、未隔离用户 home。本机 `~/.budingx` 存在真实档案后，「缺模型明确报错」用例前提失效（走真实请求得 401）。与[实现缺口核查 §6](implementation-gap-audit.md)（并行会话产出）结论一致。
- **修复（仅测试设施）**：`run()` 以 `mkdtempSync` 新建临时 home 并 pin `HOME`/`USERPROFILE`；产品代码未动。复跑 `node --test src/tui/test/cli.test.mjs` **5/5 PASS**。
- **门禁快照（修复后即刻）**：`npm test` = skills 9 + spec 7 + unit **122/124** + checks PASS + release 16；pack smoke PASS（34 文件）。**2 项 FAIL 不归因本修复或排查文档**：`probe 探测可达性并按需检查工具能力`（openai.test）与 `G05/G06 能力修改及显式孤儿清理`（commands.test 新增）—— workspace 存在**并行会话的在途 SP002 缺口修复**（`src/provider/openai.ts`、`src/tui/{cli,commands,runtime}.ts`、`src/core/session.ts` 及对应测试已被其修改，未提交），失败源于其在途变更。本会话不集成、不提交该部分 diff。
- **边界**：并行会话的 `implementation-gap-audit.md` / `design/gap-closure-plan.md` 保持未跟踪、未触碰；SP002 验收应在其缺口修复收口后统一进行（G01 密钥录入、G04 切换同步请求配置等为其报告 P1 项）。

## 13. 屏幕类端到端 harness 与方法论沉淀（2026-11-17，用户要求「自行启动 TUI 做 e2e 并沉淀方法论」）

- **设施**：`src/tui/test/helpers/mount-tty.mjs`——真实 `ink render(<App>)` + 真实 Session/审批网关/临时 home 存储；PassThrough 伪 TTY（isTTY/columns/resize）捕获完整 ANSI 帧；`stripVTControlCharacters` 断言文本；`FORCE_COLOR=3` 支持 truecolor 断言；键序分块写入；`waitFor` 谓词超时附末帧。无原生 pty 依赖。
- **用例**：`screen-e2e.test.mjs` 9 项（S1 未配置中文欢迎框几何/引导/零密钥；S2 配置后精简横幅显示真实模型名；S3 /model 即时重渲；S4 ASCII 兜底整帧纯 ASCII；S5 流式中文增量+状态迁移+中间帧存在；S6 Esc 打断提示/部分保留/回空闲；S7 排队指示+自动注入；S8 Ctrl+C 单按提示双按退出；S9 resize 紧凑重排）。与并行会话 `app.test.mjs`（G01–G12 输入/审批/命令类）互补不重复。
- **RED 实例**：S4 首跑 RED——ASCII 兜底帧含非 ASCII 的 `·`（hint 与模型行分隔符）；修复为 `WORDS.sep` 单源（pixel `·` / ascii `-`）后 GREEN。另两个 harness 方法论坑已固化进技能：测试进程须显式 pin 终端策略；组合 chunk `abc\r` 会丢 Enter。
- **方法论**：[buding-frontend-testing](../../skills/buding-frontend-testing/SKILL.md) 新增「TUI 帧级端到端」节：L0 纯函数 / L1 伪 TTY e2e / L2 真实进程 / L3 真终端人工 四层证据表、harness 六规则、RED-first 屏幕缺陷回归政策、Provider 证据层标明、ConPTY/node-pty 列为未采纳选项。
- **实际执行**：`npm test` = skills 9 + spec 7 + unit **151** + checks PASS + release 16 全绿（cwd 仓库根）；聚焦 `node --test src/tui/test/screen-e2e.test.mjs src/tui/test/header.test.mjs` 19/19。
- **边界不变**：IME preedit、真 ConHost/WT 观感、鼠标选区仍 UNVERIFIED（§5 人工清单）；harness 绿不冒充真终端验收。

## 14. 2026-11-17 缺口收尾（G01…G17）

用户授权：按 implementation-gap-audit.md 先 P1、再其余项与测试。沿用设计 v0.3；继续原 feature 分支。开始 HEAD c57d51a；执行期间外部新增 7e5dcea（CLI 测试 home 隔离），已保留，未重写该提交。

### 14.1 实现与回归映射

| 缺口        | AC / 设计          | 修正与证据入口                                                                                                                                |
| ----------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| G01         | MM-02/04/05        | commands + runtime + App 隐藏录入；commands.test、runtime.test、app.test：真实 Ink 录入保存不回显、主机重检、更新活动凭据。                   |
| G02/G03     | MM-01              | edit 分离 ID/字段，default 持久化；commands.test 验证存储读回；活动编辑更新配置，跨主机清 Key、删除当前档案使其失效。                         |
| G04/G05     | MM-03、SL-06       | 每回合捕获 Provider；runtime.test 使用两个本地 HTTP 服务验证端点、model、Authorization、能力快照；管道入口使用同一装配。                      |
| G06         | 设计 §3.5          | 启动仅显示孤儿数量；orphans / orphans clean 分开；commands.test 验证查看不删、显式清理。                                                      |
| G07         | SL-05              | App 保留忙时命令；异步边界命令串行，Core 自动队列可暂停；app.test 验证命令不丢失、异步探测后再切换和发送、自动队列不会抢跑。                  |
| G08         | TC-03              | usePaste/useCursor 接线、多行箭头优先、可见光标独立刷新；editor.test 和 app.test 验证 bracketed paste 不误发及连续箭头实际 CSI 列坐标。       |
| G09         | SL-08、TC-05       | 审批 Esc 拒绝并续跑，停打 700ms 重现；finalize 调用 gateway.cancelAll；app.test 实际审批交互 + 现有取消/resolve-once 测试。                   |
| G10/G11/G12 | TC-02/04/07、PS-04 | 回收清 frame 队列、工具结果/notice 可见、逻辑原文保留并订阅宽度；历史重排 memo 不随每个 delta 重算；render.test、app.test 的流事件与 resize。 |
| G13/G14     | MM-02、PS-03       | 有界解析探测及错误体；200 普通文本不再通过，工具探测要求 echo 调用；openai.test 验证协议错误、上下文超限、工具能力不符。                      |
| G15/G16     | PS-04/05/06        | timeout 接到连接/读取空闲时限；取消释放退避 timer；Retry-After 秒数和日期；openai.test + runtime.test 慢端点。                                |
| G17         | SL-03              | 有合法调用标识的非法 JSON 回填错误结果后续跑，缺标识仍报协议错误；session.test 实际二次模型调用验证。                                         |

### 14.2 红绿与审查记录

- 第一轮 G01/G02/G03/G05/G06/G13/G14 测试观察到 5 项预期失败，随后转绿；G08/G10 观察到 2 项预期失败后转绿；G17 观察到 completed/error 不符后修正并转绿。
- 审查补充的光标单独移动测试先失败（无光标输出），后检查连续左/左/右实际 CSI 5G/4G/5G；修正 Ink insertion/layout effect 的提交时序。
- 补充 PS-06 思考及工具参数限额、跨主机文件密钥合并测试：均先观察行为失败再修正；首次配置测试缺 import 属测试编写错误，修正 import 后重新观察 file-key 泄漏的真实失败。
- 独立 reviewer 提出异步命令抢跑、活动档案编辑不同步、光标提交时序三项；均修正并补相应回归。命令/Provider fixture 与实际 Ink 流测试各自保留边界，不以 mock 证明真终端体验。
- 只读参考本地参考仓模型命令的会话/默认模型分离机制、TextInput 的 mask/cursor 接线，并对照已有机制盘点的回合边界队列和审批规则。新实现独立编写，无旧代码/用户数据迁入。

### 14.3 实际检查

- 第一轮完整 npm test：技能 9、规格 7、产品 141、发布 16 全部通过；模块边界检查通过（合计 173 项）。最终格式化及审查后复验成绩见本节后续追加。
- 日志保存在本地忽略目录 artifacts/SP002-gap-closure/，不纳入提交。
- PRODUCT.md 已同步模型录入/编辑/默认/能力/清理、命令边界、按键和限制；src/tui/README.md 同步用法。产品版本仍为 0.1.1，本次不执行版本准备或 npm 发布。

### 14.4 未验证边界

PS-08 live Provider 仍为 UNVERIFIED：未使用真实凭据或费用预算。TC-02/03/04/05/07 的 Windows Terminal 与 ConHost 人工 IME/显示验收仍为 UNVERIFIED；Ink PassThrough/TTY 标记输入测试不能替代真实系统终端。没有读取旧用户 Key 或历史。

本轮缺口代码已处理不代表用户已验收；尚未获得本轮真实环境验收证据，不宣称完整发布就绪。

### 14.5 最终复验回执

- 格式化后最终 npm test：**技能 9/9、规格 7/7、产品 151/151、发布 16/16，合计 183 项 PASS，0 FAIL、0 SKIP；模块边界检查通过**。产品成绩包含工作区同期新增的 9 项屏幕测试；该组夹具及 header 配套改动由同期任务维护，本次保留并一起复验，不混入本次局部提交范围。
- 最终复验前曾因同期新增屏幕测试的导入路径和默认终端模式/按键批处理夹具失败；同期夹具修正后，独立屏幕测试 9/9 通过，再跑完整门禁得到上述成绩。不将该次失败隐藏为成功。
- 独立审查三项反馈均已处理：异步命令在真正执行时重新等待回合边界（含延迟 prompt 后的 clear）、活动配置编辑/删除刷新、光标提交时序。reviewer 最终确认原三项已处理；新增 clear 实际 Ink 回归通过。
- 隔离安装 smoke：tarball **34 文件**，仓库外安装后运行版本 0.1.1，真实本地 HTTP 流式请求通过，退出码 0。父进程也使用临时 HOME/USERPROFILE，不访问真实用户配置。
- skills:check、spec:check 通过。用临时固定版本 Prettier 3.6.2 格式化本次文件，2 空格、ESM、单引号、无分号；未增加项目依赖或修改全局编辑器配置。
- 未运行真实 Provider 和 Windows Terminal/ConHost 人工验收；仍保持第 14.4 节的 UNVERIFIED，未升级产品版本、未推送、未 npm 发布。

## 15. Agent 自审与合入决策（2026-11-17，委托流程首次应用）

依据：用户 2026-11-17 委托（取消常规人工审查、Agent 自审、交叉验证 GREEN 才合入 master；见 [集成门禁](../../docs/integration-gate.md) 与 AGENTS.md）。本节为合入前自审记录。

1. **AC 结论**（沿用 §2/§3 并复核 §14 收尾）：32 条 AC 中 27 条全层 PASS；TC-02/03/04/05/07 自动层 PASS、真终端人工部分 UNVERIFIED；PS-08（live 真实服务）UNVERIFIED。G01–G17 全部有实现+回归映射（§14），无残留 FAIL。UNVERIFIED 恢复条件见 §4 与 §14.4：live 凭据+预算由用户提供后补录；真终端观感/IME 由用户在 master 结果上可选抽查（不阻塞合入，委托已取消人工审查前置）。
2. **交叉验证门禁**：`npm run merge:gate` **GREEN**（报告 `artifacts/merge-gate/feature-SP002-model-session-loop-2026-11-17T07-17-55-948Z.md`）：npm test 全段（skills 9 / spec 7 / unit 151 / checks PASS / release 16 / merge 4）+ spec:check + skills:check + pack-smoke（34 文件隔离安装+真实流式请求）退出码全 0；outgoing 路径扫描无违规；报告审计无 FAIL 行、UNVERIFIED 有恢复条件节。门禁自身误报（汇总表表头列名 FAIL）已修复并补回归（4cde2f7）。
3. **scoped diff 复核**：master..HEAD 88 文件；核心前缀外仅 README.md 与 package-lock.json（npm 自有 lock，合法）；`git diff master..HEAD -- src` 扫描旧仓路径/claude 导入 **0 命中**；运行时依赖白名单恰为 ink/react/string-width（边界检查）；无凭据/产物/异源 lockfile 进入提交；THIRD-PARTY-NOTICES 与依赖一致。
4. **分层证据**：L0 纯函数（header/reducer/editor/normalize/tool-calls 等）；L1 伪 TTY e2e（app.test 10 + screen-e2e 9 + runtime.test，真实 Ink 帧/键流/双端点 HTTP fixture）；L2 真实进程（cli.test 5，home 隔离）+ 制品隔离安装；L3 真终端人工 UNVERIFIED（§5 清单）。各层不互相冒充。
5. **bug 闭环**：队列 drain unref（§7）、ASCII 兜底非 ASCII `·`（§13 S4 RED→修复）、CLI 测试 home 未隔离（§12）、G01–G17（§14）、门禁表头误报（4cde2f7）——均 RED/复现→修复→复绿。
6. **风险与回退**：live 与真终端证据缺口已登记恢复条件；产品版本仍 0.1.1（无发布授权）；回退＝master 上 revert 本次 merge 提交，feature 分支保留不删。
7. **合入决策**：门禁 GREEN + 自审通过 → 按 buding-merge 规程合入 master（委托范围内）。**push/打标签/npm 发布不在委托内，不执行**。

## 16. 真实模型与扩展端到端验证（2026-11-17）

用户明确要求应用 buding-frontend-testing 执行 e2e，发现 Bug 立即修复。基线含屏幕 harness 提交 87d34e2；执行期间门禁委托及自审文档的同期提交保留。测试范围为 L1 实际 Ink 帧/键流、L1+真实本地 HTTP 全链路、L2 CLI 子进程和制品、真实外部 Provider，分别下结论。

### 16.1 本轮缺陷与红绿证据

| 缺陷                                               | 首次失败证据                                                                                                                   | 修复与复验                                                                                                                                            |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| clear 只清上下文，旧回答仍在屏幕                   | S10：history 已为空，但末帧仍含 fixture-old-answer，断言预期失败                                                               | Core 发 conversation_cleared，reducer 重置可见内容并保留尚未执行的排队项；S10 复绿。                                                                  |
| 真实服务拒绝工具请求：function parameters is empty | 外部 Provider 连续两次 HTTP 400；随后两个离线回归分别验证 Core 请求 schema 为 undefined、无 schema 工具被本地严格 fixture 拒绝 | ToolHandler 可携带 parameters，Core 传到 Provider；无参数工具显式发送 object/properties 空 schema；离线回归复绿，真实工具审批+结果回传+模型续答通过。 |
| truecolor 测试夹具 pin 颜色晚于 Chalk 初始化       | S11 实际 ANSI 不含品牌 truecolor 转义                                                                                          | FORCE_COLOR 在动态加载 Ink/App 之前设置；S11 复绿。属于夹具修正，不改变产品颜色策略。                                                                 |
| 真实错误诊断先截断再脱敏可能留下密钥前缀           | 独立 reviewer 用合成密钥跨第 2000 字符的离线 fixture 证明                                                                      | 改为先完整脱敏再截断，新增纯函数回归通过；不为该日志修正额外发送真实请求。                                                                            |

### 16.2 新增/扩展自动化

- screen-e2e：S1…S12，包含清屏、真实 truecolor ANSI、完成后长回答缩放重排；既有首屏/ASCII/中文流/打断/排队/退出/resize 用例保留。
- wire-e2e：W1 配置与密钥隐藏录入→双端点/模型/凭据切换→默认存储；W2 真实 HTTP 鉴权失败与恢复、历史不污染；W3 真实 reader 取消及续聊；W4 工具审批允许/拒绝两种路径及 Provider 续跑。全程使用临时存储和自己启动的 localhost HTTP 服务。
- 扩展 mount-tty 的 sessionFactory，复用产品 createConfiguredSession，避免只用假 Provider 证明线路行为。真实进程仍由 cli.test 覆盖；不以该进程内流假装系统控制台。

### 16.3 真实 Provider 回执

仅在用户说明已配置完成后，读取明确授权的根目录 .env.e2e.local。初始限额为 6 次、5 美元；用户随后明确允许增至最多 12 次，费用仍限 5 美元。输出 cap 为每请求 max_tokens=128，生成路径 maxAttempts=1。没有读取其他用户配置、旧产品凭据或历史。

| 场景                         | 最终结果 | 证据范围                                                                                                       |
| ---------------------------- | -------- | -------------------------------------------------------------------------------------------------------------- |
| live-stream-ui               | PASS     | 实际外部请求、text delta、实际 Ink/UI；密钥不出现在 raw 帧。                                                   |
| live-tool-approval-roundtrip | PASS     | 模型实际返回工具调用，TUI 允许审批，执行自有 echo 测试桩，tool_result 回传后模型续答；不是工作区真实编码工具。 |
| live-stream-cancel           | PASS     | 首个流事件后经 Session 用户取消入口中断，Provider 停止、终态 cancelled；Esc 键流另由本地 HTTP+Ink W3 证明。    |
| live-tool-empty-schema       | PASS     | 未提供 handler schema，实际服务接受默认空 object schema，并完成审批与工具续答。                                |
| live-invalid-key             | PASS     | 使用故意无效的测试 key，实际服务返回 auth 错误；没有把真实 key 用作错误示例。                                  |

**累计 9 次 HTTP 请求**：包含修复前的两次工具 400 和修复后的有参数、无参数两组工具回合（各两请求），未超用户授权的 12 次。未读取供应商账单，实际费用为 UNVERIFIED，不声称已核实实际花费。当前限额与用户授权记录保存在忽略的 artifacts/SP002-e2e/live-summary.json；历史失败保留在 previousRuns。正式报告不记录端点、模型标识、凭据或原始聊天内容。

真实测试为显式 opt-in 脚本 scripts/testing/live-provider.mjs；npm test 不会自动发送真实请求。空模板位于 scripts/testing/e2e.env.example。真实 .env.e2e.local 仍被 Git 忽略且未跟踪，不纳入任何提交。

### 16.4 未验证边界与恢复条件

PS-08 真实 Provider 四类行为已取得本节证据；其他型号/供应商未测。L3 Windows Terminal/ConHost 的中文 IME preedit、候选窗、鼠标选区和实际观感仍为 UNVERIFIED；恢复条件是在对应真实控制台执行 §5 人工清单。供应商账单费用 UNVERIFIED，恢复条件为用户自行核对供应商账单；本轮不访问其账号账单。

本轮独立审查只读、未读真实配置、未发外部请求；其日志脱敏反馈已修复。PRODUCT 与 TUI README 已同步 clear 语义、schema 兼容性及验证状态；产品版本未升级，未推送或 npm 发布。完整门禁与制品复验结果在本节追加。

### 16.5 最终自动化与自审

- npm test：技能 9/9、规格 7/7、产品 161/161、发布 16/16、集成门禁单元 4/4，**合计 197 项通过，0 失败、0 跳过**；模块边界检查通过。真实 Provider 是独立显式执行的 5 项，不计入该 197 项。
- 专项 e2e 覆盖屏幕 S1…S12、App 8 项、真实 HTTP W1…W4、runtime 3 项和 CLI 子进程 5 项（各层见上文），真实服务验证按 16.3 单列。
- Prettier 3.6.2 用固定选项格式化本次 JS/TS/Markdown；未引入产品依赖。env 示例无所属 formatter，空模板手工核对。真实配置及 artifacts 不提交。
- 自审：读取当前 scoped diff、契约生产与消费两端及 Node bin 布局；独立 reviewer 的日志边界反馈已修复并补离线断言。颜色断言修复测试夹具初始化时序；没有为绿测修改产品颜色语义或降低断言。
- 本轮不更改版本、不推送、不发布。按已有集成委托，只有 merge:gate GREEN 且自审通过后才合入 master；精确门禁回执保存在 artifacts/merge-gate，合入结果以 Git ancestry 为准。

### 16.6 master 集成回执

源提交 `e06ddafb83f6c2b8efaa8f53a14c6eb21081db09`；目标原提交 `484c6a9623ffc6eb6bdfcc8e335d6ff3d3c58bd1`；交叉验证报告 `artifacts/merge-gate/feature-SP002-model-session-loop-2026-11-17T07-37-05-630Z.md` 为 GREEN。merge-tree 预演无冲突，本地 `master` 合并提交 `ffdb7bab0f19bdc4c5a374dd8d08c7e546bad43a`；merge-base ancestry 证明包含源，合并后 tree 与通过门禁的源 tree 完全相同。未推送、未打标签、未发布；`.env.e2e.local` 保持忽略且未跟踪。

## 17. 本地启动自动加载测试模型（2026-11-17）

用户要求本机 `npm run start` 自动使用现有 e2e 模型，并明确「只允许本地测试使用，真实环境得自己配置」。实现仅修改根目录私有维护包的 start 命令，使用当前 Node 支持的原生 `--env-file-if-exists=.env.e2e.local`，不改发布产品入口、不持久化档案、不打印密钥。文件可缺省；显式进程环境优先，CLI 参数仍优先。自动化测试的预算字段不控制交互用量。

验证：`node --test src/tui/test/local-start.test.mjs`。新增自动加载用例先观察到模型未配置的预期失败；实现后 4 项全过，覆盖加载、缺文件、环境优先级及正式入口不加载。均为临时配置/home 的真实子进程，不读取用户真实配置，不调用实际模型。配置文件仍被 Git 忽略且不提交；只有空模板维持原先跟踪状态。

自审及文档：PRODUCT.md、开发指南与 TUI README 已同步本地/真实环境边界；未加依赖，未改构建、发布或安装 bin。按当前 Node 版本原生能力实现；该开发命令没有对应旧产品机制，产品 Provider/Agent 核心逻辑未修改。格式化与交叉验证门禁在提交及合入前运行，实际门禁报告存于 artifacts/merge-gate。不推送、不发布。

门禁回执：`artifacts/merge-gate/feature-SP002-local-test-start-2026-11-17T07-51-08-244Z.md` GREEN（npm test、spec:check、skills:check、pack-smoke 全部通过）；源 `626ae7ea6a0494df2b303b9e6c451b2048aedf6f` 合入本地 master `db1fcb7c21a3a9eadca5f06d5d2f7dac3f42d883`，ancestry 及 tree 一致性已确认。独立审查无待修问题，4 项专项回归通过；未读取或提交真实配置、未发真实模型请求。

## 18. 0.2.0 版本准备（2026-11-17）

用户要求升级版本并同步全部版本相关文档，明确由其自行执行 GitHub 工作流发布。本次只准备 0.2.0（SP002 minor）：产品 package、prepared 台账、发行说明、产品/根/TUI README、当前状态、版本规范、发布计划/指南、文档导航与四模块 STATUS 已同步。0.1.0/0.1.1 的历史回执及 SP001 规格基线保持原版本，测试中的固定示例版本不冒充当前版本。

官方 registry 查询：latest=0.1.1，0.1.1 已存在，0.2.0 尚不存在；不预记 published，不触发 Actions 或 npm 上传。版本工具 4 项、CLI/清单/本地启动 14 项均通过；build 通过。验证隔离配置，不读取 .env.e2e.local。

独立审查发现并修正了发布指南中“回执后再次 minor SP002”的错误示例；同轮修复仍 patch，新 SP 首次交付 minor。手动工作流参数为 master / 0.2.0 / latest，正式上传 dry_run=false。本次发布 dry-run 及锁定安装将在干净的源码副本执行，实际数量与制品回执后续追加。

复用技能：新增 skills/buding-version-prepare，三套发现入口由生成器同步；完整发布技能保留实际上传边界。发现性回归先因缺少新技能失败，接入后技能维护 10 项通过。独立前向场景验证：基线未使用仓库原子版本工具、未明确完整 dry-run；读新技能后采用 version:prepare + 锁定安装/expected-version dry-run，并在已有 prepared 候选时保持幂等、不重复 bump，保留历史回执与用户手动触发边界。官方 quick_validate.py 首次因缺 PyYAML 和 Windows 默认 GBK 编码未完成；使用 artifacts 下临时 PyYAML 依赖及 Python UTF-8 模式后实际通过，未安装全局或产品依赖。Node YAML/发现入口/链接校验也已通过。

### 18.1 0.2.0 实际发布预演回执

固定源码 `3c1a44bb55e1a02b164dd8c0ff022b92bd16432b` 的 Git archive 在仓库外干净目录验证；不包含工作区私有配置或未跟踪文件。`npm ci --ignore-scripts --no-audit --no-fund` 成功；`npm run publish -- --dry-run --expected-version 0.2.0 --tag latest` 退出 0。技能 10、规格 7、产品 165、发布 16、门禁单元 4，合计 **202 PASS / 0 FAIL / 0 SKIP**；模块边界通过。制品 31 文件，npm shim 版本 0.2.0，本地 HTTP smoke 通过。原始报告及同一 tarball 保存在忽略目录 artifacts/release/0.2.0-prepared；state=verified-local，dryRun=true，不是上传回执。

本轮未触发 GitHub 工作流、未 npm 上传、未调用真实模型。用户同时进行的开发技能安装以其提交 6f0ed5b 保留在源码基线，未改写其内容；所有开发技能与用户配置均不进入 TUI tarball。版本文档审查的两处误导均修正，新增版本准备技能完成发现同步、10 项维护测试和两场景前向检查。

### 18.2 master 发布准备交接

交叉验证门禁 `artifacts/merge-gate/feature-SP002-release-0.2.0-2026-11-17T09-02-45-778Z.md` 为 GREEN，固定源 `07c5a4482143f05733e106205507c4dd65f622e1`。集成前复核时 master 已快进到该源（reflog 确认），tree 与通过门禁的源一致，无需重复合并。后续仅追加本节及预演数量文档，不改变已验证的产品包内容。用户自行在 master 触发工作流，尚未触发 Actions、未上传 npm，台账保持 prepared。

### 18.3 发布前 CI 模式交互回归

补做 `CI=true` 的 20 项 Ink 交互用例，先观察到 4 PASS / 16 FAIL。原因是 Ink 8 自动在 CI 关闭交互输出，仅标记假流 isTTY 不足以保留 ANSI、光标、resize 和中间帧；依据为 [Ink 8 官方 render 文档](https://github.com/vadimdemedes/ink/blob/v8.0.0/readme.md)。两个测试 render 入口显式使用 interactive:true 后，同样的 CI=true 用例 20/20 通过。正式 CLI 未改变，不关闭 CI、不降低断言。

新增 ci-render.test 子进程回归，验证真实品牌色帧及连续光标坐标在 CI 下仍执行；清除继承的 Node 内部 NODE_TEST_CONTEXT，显式 TAP 并断言 2 项通过，避免空跑退出 0 冒充成功。该回归 1/1 通过。该模式验证补入版本准备及前端验证技能；0.2.0 仍是同一 prepared 候选，不重复 bump。最终发布预演需按 CI=true 复跑；本地模拟不等于 Windows/Linux 托管运行已经成功。

### 18.4 最终 CI 发布预演与集成

干净固定源码 `2c636312e8aaafa9e60636b6027e97d12702aeea` 在 CI=true 下锁定安装及发布 dry-run 通过：技能 10、规格 7、产品 166、发布 16、门禁单元 4，合计 **203 PASS / 0 FAIL / 0 SKIP**。31 文件 tarball 与前一预演制品 integrity 完全一致，说明修改仅涉及测试/文档/技能，产品内容未变。回执为 artifacts/release/0.2.0-prepared-ci/report.json，state=verified-local、dryRun=true、npm shim=0.2.0、fixtureRequests=1。

同样 CI=true 的交叉验证门禁 artifacts/merge-gate/feature-SP002-release-ci-tty-2026-11-17T09-17-45-790Z.md 为 GREEN；独立审查无待修问题，CI 交互专项 21 项通过。已合入本地 master `71fad97e45b9b6d1ab08226c33238fae05df01ec`，ancestry/tree 一致性已确认。版本仍为 0.2.0 prepared，不重复 bump；实际托管 Windows/Linux 运行和 npm 上传由维护者执行，未预记成功。

## 19. 0.2.0 正式发布收尾（2026-11-17）

用户自行执行发布工作流后，Agent 只跟进同一次运行，没有重新触发、重复上传或 bump。固定 [运行 #7](https://github.com/Limingyang01/budingx-next/actions/runs/44055301185)，source=6ed77d8a93335f8b261493e1fa4f0994ce4bc7bd、branch=master、workflow_dispatch。Windows Verify、Ubuntu Verify、Publish verified TUI using npm OIDC 全部 success。

### 19.1 公开核验与独立安装

- 官方 registry：budingx@0.2.0 已存在，latest=0.2.0，publishedAt=2026-11-17T09:29:30.139Z。\_npmUser 为 GitHub Actions，trustedPublisher.id=github。
- integrity=sha512-VG7rcn0u16SxtJpBEJ77s78tEUfgVuBM3qC/81c/VWsofUmng1JeTKIZYFWBTB8eESd4scFo4WW0axORecqOtA==；与预演制品一致。
- SLSA provenance subject SHA512 与 tarball integrity 一致；workflow repository/path/ref、resolved gitCommit、run invocation URL 均断言匹配本次6ed77d8/运行7。
- 仓库外临时 prefix 从官方源安装，ignore-scripts，不改全局安装；HOME/USERPROFILE 隔离。npm shim --version=0.2.0；真实本地 HTTP 流式 smoke 通过，fixtureRequests=1。
- npm audit signatures 退出0：46 packages verified registry signatures、5 packages verified attestations。这与 JSON 字段匹配分别记录，不只凭工作流名称宣称 OIDC 来源。
- 原始 artifact 下载 API 返回401 Requires authentication；未下载 CI report，未伪造 published-and-installed JSON 或调用 release:sync 导入假回执。按发布技能允许的公开 registry/provenance + independent-install 路径更新 ledger，verificationSource=public-registry-provenance-and-independent-install，ciArtifactDownloaded=false。

### 19.2 收尾范围与边界

本次只更新台账和当前发布文档/STATUS；源码 package 版本仍0.2.0，历史0.1.0/0.1.1回执保留。发布源码SHA与收尾文档SHA不同，制品不重发。原始公开元数据、签名日志、安装/HTTP smoke、自有验证摘要位于忽略的 artifacts/release/0.2.0-run-7，不写入用户密钥或真实聊天；没有读取本地模型配置或额外发真实模型请求。L3 IME/鼠标/控制台观感及其他 Provider/平台未测范围继续 UNVERIFIED，恢复条件沿用§5/§16。
