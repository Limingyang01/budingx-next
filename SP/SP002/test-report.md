# SP002 验证报告 · 模型与会话闭环

日期：2026-11-17｜迭代：SP002｜设计：[design.zh.md v0.3 approved](design/design.zh.md)｜计划：[plan.zh.md](design/plan.zh.md)｜分支：`feature/SP002/model-session-loop`

本报告只记录**实际执行**的检查。未执行为 `UNVERIFIED`，失败为 `FAIL`，真正不适用才写 `NOT_APPLICABLE`。不使用 mock 冒充 live，不用旧仓成绩充数。

## 1. 实际执行的检查（汇总）

| 门禁 | 命令 | cwd | 实际数量/结果 |
| --- | --- | --- | --- |
| 技能与发现入口维护 | `npm run skills:test` | 仓库根 | 9 项，9 通过 / 0 失败 |
| 规格自洽性（能力清单/评测任务） | `npm run spec:test` | 仓库根 | 7 项，7 通过 / 0 失败 |
| 产品单元与进程回归 | `npm run test:unit`（= `npm run build && node --test src/*/test/*.test.mjs`） | 仓库根 | **103 项，103 通过 / 0 失败** |
| 模块边界检查 | `npm run test:checks`（`node scripts/checks/module-boundaries.mjs`） | 仓库根 | 1 次检查，PASS（core/provider/storage 无 UI/IO 反向依赖；运行时依赖白名单恰为 ink/react/string-width；bin=`dist/tui/cli.js`） |
| 发布与版本管理回归 | `npm run test:release` | 仓库根 | 16 项，16 通过 / 0 失败 |
| 编译 | `npm run build`（`tsc -p src/tui/tsconfig.json`） | 仓库根 | 通过；产物 `src/tui/dist/{core,provider,storage,tui}` |
| 打包与隔离安装 smoke | `node scripts/release/pack-smoke.mjs` | 仓库根 | tarball 32 文件；仓库外临时目录 `npm install` 成功；`--version` 与清单一致（0.1.1）；对本地 fixture 真实 HTTP 流式请求成功（calls=1） |

产品单元用例按文件分布（实际执行数）：

| 文件 | 数量 | 覆盖 |
| --- | --- | --- |
| `src/core/test/session.test.mjs` | 16 | 状态机、事件契约、工具回合、审批、打断、排队、快照、并发 |
| `src/core/test/normalize.test.mjs` | 7 | 消息规范化（孤儿 tool_result 剥离、id 去重、合成结果） |
| `src/core/test/tool-calls.test.mjs` | 6 | tool_calls 跨事件碎片装配 |
| `src/provider/test/openai.test.mjs` | 11 | 错误分类、重试、取消、限额、probe、工具片段 |
| `src/provider/test/sse.test.mjs` | 5 | SSE 分帧与 0.1.1 基线等价 |
| `src/storage/test/config-store.test.mjs` | 10 | 档案 CRUD、原子写、未知字段、损坏、迁移、输入校验 |
| `src/storage/test/credentials.test.mjs` | 7 | 凭据隔离、主机绑定、孤儿诊断、损坏保护 |
| `src/storage/test/profiles.test.mjs` | 3 | 端点归一化、参数校验、主机绑定 |
| `src/tui/test/cli.test.mjs` | 5 | 真实进程：帮助/版本、管道多轮、无 ANSI、失败回合、命令不外发 |
| `src/tui/test/commands.test.mjs` | 10 | 斜杠命令族与档案验证 |
| `src/tui/test/editor.test.mjs` | 9 | 多行编辑、历史召回、粘贴、按键语义 |
| `src/tui/test/render.test.mjs` | 6 | 帧模型、CJK/emoji 宽度、原子切换、resize 重排 |
| `src/tui/test/approval.test.mjs` | 3 | 审批 claim-once 与取消清理 |
| `src/tui/test/package.test.mjs` | 5 | 制品清单边界（依赖白名单、bin、files、engines） |

## 2. AC → 任务 → 文件 → 用例 → 结果

命令统一为 `node --test <文件>`（cwd＝仓库根）；标注「全量」者已在 `npm test` 中实际跑过。

### provider-streaming（PS-01…PS-08）

| AC | 任务 | 实现文件 | 测试用例 | 结果 |
| --- | --- | --- | --- | --- |
| PS-01 分帧等价 | T2 | `src/provider/sse.ts` | `sse.test.mjs`：分帧容忍任意 TCP 分片/CRLF/多行 data/注释行/[DONE]；多行 data 只保留载荷；残留帧冲刷；**基线回归：新分帧器与 0.1.1 预览实现产出的文本等价**（冻结基线 `src/provider/test/fixtures/legacy-chat.mjs`） | PASS（5 项） |
| PS-02 tool_calls 组装 | T2 | `src/core/tool-calls.ts` | `tool-calls.test.mjs`：按 index 组装、缺 index 补位、续流并入当前调用、非法 JSON 归一为错误项、缺 name/id 归一为错误项、并行顺序稳定 | PASS（6 项） |
| PS-03 错误分类 | T3 | `src/provider/errors.ts`、`src/provider/openai.ts` | `openai.test.mjs`：401/403/404/429/500/400 各自类别 + 机读码 + 不含 key 与上游 body；截断与非法事件为 invalid_stream；非 SSE 明确失败 | PASS（3 项并入 11 项文件） |
| PS-04 有界重试 | T3 | `src/provider/openai.ts` | `openai.test.mjs`：尊重 `Retry-After`（2s×2 次）并达上限失败；连续 5xx 指数退避且请求体 `model` 始终不变（无静默换模型） | PASS（2 项） |
| PS-05 取消 | T3 + T5 | `src/provider/openai.ts`、`src/core/session.ts` | `openai.test.mjs`：中途 abort → `aborted` 且零重试；`session.test.mjs`：打断在有界时间内取消模型请求并给出 cancelled 终态 | PASS（2 项） |
| PS-06 限额 | T3 | `src/provider/openai.ts`、`src/provider/sse.ts` | `openai.test.mjs`：响应超长 → `BUDINGX_PROVIDER_014`；单事件超限 → `BUDINGX_PROVIDER_013`；`sse.test.mjs`：解析器超限抛明确错误 | PASS（2 项） |
| PS-07 依赖白名单 + lint | T1/T12 | `scripts/checks/module-boundaries.mjs` | 全量 `npm test` 内的边界检查：core/provider/storage 无 UI/终端库，core 无 IO 模块与反向依赖，产品依赖白名单恰为 `{ink, react, string-width}` | PASS |
| PS-08 live 真实服务 | — | — | 需用户提供任一 OpenAI 兼容服务凭据与费用上限 | **UNVERIFIED**（恢复条件＝验收时提供凭据与预算；未用 mock 冒充） |

### model-management（MM-01…MM-07）

| AC | 任务 | 实现文件 | 测试用例 | 结果 |
| --- | --- | --- | --- | --- |
| MM-01 持久化与原子写 | T7 | `src/storage/config-store.ts`、`src/storage/atomic.ts` | `config-store.test.mjs`：CRUD 跨实例加载 + 无残留 tmp；配置文件带 schema 版本字段 | PASS（2 项） |
| MM-02 验证分类 | T3/T7/T11 | `src/provider/openai.ts`（probe）、`src/tui/commands.ts` | `openai.test.mjs`：probe 可达性 + 工具能力探测 + 凭据错误分类且不泄漏 key；`commands.test.mjs`：`/provider check` 用档案凭据探测并报告工具能力；缺凭据时拒绝且不发请求 | PASS（5 项） |
| MM-03 切换不清史 | T5/T7/T11 | `src/core/session.ts`、`src/tui/commands.ts` | `session.test.mjs`：回合进行中切换模型不影响本回合快照、下一回合用新快照；`commands.test.mjs`：`/model` 切换不清空会话历史 | PASS（2 项） |
| MM-04 换主机不发旧 key | T7 | `src/storage/credentials.ts`、`src/storage/profiles.ts` | `credentials.test.mjs`：档案主机变更后旧 key 不会被取用；host 不符即视为无 key | PASS（2 项） |
| MM-05 凭据去向 | T7 | `src/storage/credentials.ts` | `credentials.test.mjs`：key 仅存于专用凭据文件、普通配置不含 key、UI 回显仅末 4 位；`config-store.test.mjs`：回显掩码 | PASS（4 项） |
| MM-06 兼容与迁移 | T7 | `src/storage/config-store.ts` | `config-store.test.mjs`：未知字段保留；损坏配置备份并明确报错且原文件未被清空；旧版本迁移到当前版本并保留 `.bak`；更新 schema 明确拒绝 | PASS（4 项） |
| MM-07 非法输入 | T7 | `src/storage/profiles.ts` | `config-store.test.mjs`：空名/超长名/控制字符/带凭据 URL/非 HTTPS/空模型名均显式拒绝且不落盘；重复档案名在 `commands.test.mjs` 拒绝 | PASS（2 项） |

### session-lifecycle（SL-01…SL-09）

| AC | 任务 | 实现文件 | 测试用例 | 结果 |
| --- | --- | --- | --- | --- |
| SL-01 状态机与终态至多一次 | T5 | `src/core/session.ts` | `session.test.mjs`：一次完整回合事件顺序且终态至多一次；状态集合与迁移受约束（非法迁移被拒并发 notice） | PASS（2 项） |
| SL-02 事件契约 | T4/T5 | `src/core/events.ts`、`src/core/session.ts` | `session.test.mjs`：事件顺序符合契约；全部事件可 JSON 序列化且与 UI 类型无关；delta 先于 completed | PASS（2 项） |
| SL-03 工具回合 | T5 | `src/core/session.ts`、`src/core/normalize.ts` | `session.test.mjs`：每个 tool_use 恰好一个 tool_result 并续跑至收敛；并行调用按序各回填一个；未知工具名/非法参数产生错误结果且不崩；`normalize.test.mjs`：孤儿剥离、去重、合成结果 | PASS（6 项） |
| SL-04 打断 | T6 | `src/core/session.ts` | `session.test.mjs`：有界时间内取消模型请求并给出 cancelled 终态；保留部分输出并为孤儿 tool_use 补合成 error 结果 | PASS（2 项） |
| SL-05 排队与注入边界 | T6 | `src/core/session.ts` | `session.test.mjs`：排队项在工具结果回填后按序注入且不重复；回合结束后剩余项自动起新回合并标记 inter_turn；驻留窗口内回收排队项发通知并交回文本（自动起新回合依赖队列 drain 定时器不被 `unref()`，见 §7） | PASS（3 项） |
| SL-06 配置快照 | T5 | `src/core/session.ts` | `session.test.mjs`：回合进行中切换模型不影响本回合快照，下一回合使用新快照 | PASS（1 项） |
| SL-07 并发与唯一行为 | T5/T6 | `src/core/session.ts` | `session.test.mjs`：active 时再次提交入队且不产生交错写历史；终态守卫拒绝重复终态 | PASS（1 项） |
| SL-08 审批最小闭环 | T5/T10 | `src/core/session.ts`、`src/tui/approval.ts` | `session.test.mjs`：deny 合成拒绝结果回填、会话继续、无挂起泄漏；allow 正常执行且按 id 匹配；`approval.test.mjs`：决策恰一次、未知 id 不处理、取消清空待决 | PASS（5 项） |
| SL-09 Core 边界 | T1/T12 | `scripts/checks/module-boundaries.mjs` | 全量 `npm test` 内的边界检查；core 不 import UI/IO/其他模块 | PASS |

### tui-conversation（TC-01…TC-08）

| AC | 任务 | 实现文件 | 测试用例 | 结果 |
| --- | --- | --- | --- | --- |
| TC-01 许可登记与钉扎 | T1/T12 | `THIRD-PARTY-NOTICES.md`、`src/tui/package.json` | `package.test.mjs`：运行时依赖恰为白名单三项、版本钉扎且无 workspace/file 协议；边界脚本校验白名单；NOTICES 登记 ink 8.0.0 / react 19.3.1 / string-width 9.0.0（MIT，仅渲染层） | PASS（2 项 + 文档核对） |
| TC-02 渲染 | T8 | `src/tui/render/reducer.ts` | `render.test.mjs`：增量文本按帧合并不逐字符重排；CJK/emoji 按显示宽度折行不切字；终态切换原子不丢段 | PASS（3 项）；真终端部分 **UNVERIFIED** |
| TC-03 输入区 | T9 | `src/tui/editor/buffer.ts`、`src/tui/editor/keys.ts` | `editor.test.mjs`：多行输入与光标行列移动；按字符移动（中文/emoji 不错位）；历史召回；多行粘贴不误发；undo；Enter/Shift+Enter | PASS（6 项）；真终端 CJK/IME 人工 smoke **UNVERIFIED** |
| TC-04 按键 | T9/T10 | `src/tui/editor/keys.ts`、`src/tui/app.tsx` | `editor.test.mjs`：执行中 Esc=打断、空闲 Esc=回收、执行中 Ctrl+C=打断、空闲 Ctrl+C=退出 | PASS（1 项）；真终端人工 smoke **UNVERIFIED** |
| TC-05 审批与残留 | T10 | `src/tui/approval.ts`、`src/tui/app.tsx` | `approval.test.mjs`：决策 resolve 恰一次、未知 id 不处理、取消清空待决且无残留 | PASS（3 项）；真终端人工 smoke **UNVERIFIED** |
| TC-06 非 TTY/管道 | T11 | `src/tui/cli.ts` | `cli.test.mjs`：管道输入按行发送且输出无 ANSI 污染；管道中的命令不会作为提示词发送；help/version 不依赖配置；未知选项与缺模型确定性报错 | PASS（5 项） |
| TC-07 resize | T8 | `src/tui/render/reducer.ts` | `render.test.mjs`：宽度变化后重排不错位也不丢字 | PASS（1 项，帧断言）；真终端 resize 人工 smoke **UNVERIFIED** |
| TC-08 构建与制品 | T12 | `src/tui/package.json`、`scripts/release/pack-smoke.mjs` | `package.test.mjs`：bin=`dist/tui/cli.js`、files 仅 dist/README/LICENSE、engines `>=22.18.0`、入口存在；实跑 `node scripts/release/pack-smoke.mjs`：tarball 30 文件 → 仓库外隔离安装 → `--version` 一致 → 真实 HTTP 流式请求成功 | PASS（5 项 + 1 次实跑 smoke） |

## 3. 汇总

| 需求 | AC 数 | PASS | UNVERIFIED | FAIL |
| --- | --- | --- | --- | --- |
| provider-streaming | 8 | 7 | 1（PS-08） | 0 |
| model-management | 7 | 7 | 0 | 0 |
| session-lifecycle | 9 | 9 | 0 | 0 |
| tui-conversation | 8 | 8（其中 TC-02/03/04/05/07 的真终端人工部分 UNVERIFIED） | 真终端人工项 | 0 |
| 合计 | 32 | 31 | 1 项 AC 全量未验（PS-08）+ 5 项 AC 的真终端人工部分 | 0 |

## 4. 未验证项与恢复条件

| 项 | 原因 | 恢复条件 |
| --- | --- | --- |
| PS-08 live 真实服务（流式一轮 / tool_calls 回合 / 手动取消 / 错误 key） | 无真实 Provider 凭据与费用预算 | 用户提供任一 OpenAI 兼容服务的凭据与费用上限后执行 `probe` + live 回合，补录结果 |
| TC-02/03/04/05/07 的真终端部分（Windows Terminal + ConHost） | 本环境无真 TTY 交互 | 用户在真终端按 [人工清单](#5) 执行并回填结果；CJK/IME 打字体验为 R1 门槛，不达标时按设计 §7-R1 回退自研输入层 |
| macOS/Linux 验证 | 本机为 Windows | 按 O2=A 于 SP011 后逐个平台验证 |
| 真实 npm 发布回执 | 未获发布授权 | 用户授权后按 [buding-npm-release](../../skills/buding-npm-release/SKILL.md) 执行并保存回执 |

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

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| 编译 | `npm run build` | 通过 |
| 产品单元与进程回归 | `npm run test:unit` | **103 项，103 通过 / 0 失败 / 0 cancelled** |
| session 专项 | `node --test src/core/test/session.test.mjs` | **16 项，16 通过 / 0 cancelled** |
| 全量门禁 | `npm test` | skills 9 + spec 7 + unit 103 + checks PASS + release 16，**全部通过** |
| 打包与隔离安装 smoke | `node scripts/release/pack-smoke.mjs` | PASS（tarball 32 文件；本报告 §1 原记 30 文件，实际为 32，已更正） |

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

| 项 | 处理 |
| --- | --- |
| UI 状态持有完整 `ResolvedConfig`（含 apiKey 原文） | 改为配置版本号触发重渲；头部只接收 `keyMasked: boolean`，密钥原文不进入 React 状态与渲染层 |
| 头部测试断言「末四位掩码」 | 改为断言头部**不接触任何密钥内容**（仅 configured / not configured），与 MM-05「UI 回显最小化」口径一致 |
| `PRODUCT.md` | 新增 §5.3 首屏信息（用户可见行为变更须同步说明书） |

补充后的实际执行证据（cwd＝仓库根，同一环境重跑）：

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| 编译 | `npm run build` | 通过 |
| 产品单元 | `node --test src/*/test/*.test.mjs` | **107 项（+4 header），107 通过 / 0 失败 / 0 cancelled** |
| 全量门禁 | `npm test` | skills 9 + spec 7 + unit 107 + checks PASS + release 16，**全部通过** |
| 打包隔离 smoke | `node scripts/release/pack-smoke.mjs` | PASS（tarball **33 文件**，新增 `dist/tui/render/header.js`） |

遗留：工作区有未跟踪的 `pnpm-lock.yaml`（本机以 pnpm 安装所致）。本仓发布链为 npm（根 `package-lock.json`、CI `npm ci`），该文件不属于本轮授权范围，**未提交、未删除**，待用户确认。§4 的 PS-08（live 凭据）与 TC-02/03/04/05/07（真终端人工）仍保持 UNVERIFIED，恢复条件不变。

## 10. 首屏样式对照重做（2026-11-17，用户反馈「首屏样式不正确」）

用户要求对照参考产品 TUI 首屏样式、文案换成 budingx。只读盘点参考仓 `LogoV2` 组件群的**布局机制**（不抄代码、不搬美术资产）：圆角框 + 顶边框嵌入产品名/dim 版本、≥70 列左栏（加粗欢迎 + 7 宽吉祥物 + dim 模型/cwd）右栏信息feed、dim 竖线分隔、<70 列居中紧凑、配置后无边框精简横幅、win32 无现代终端 env 走纯 ASCII 兜底（env 可强制）。品牌色取参考仓自有紫 `#af87ff`。上游 Ink 8 无 `borderText`（系参考仓自研渲染器扩展），故框线/标题/分隔由 `src/tui/render/header.ts` 以**纯 styled-span 行**独立绘制，Ink 层仅映射 span；吉祥物为同槽位自有绘制。密钥仍以布尔参与判定，原文不进渲染层。

实际执行证据（cwd＝仓库根）：

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| 编译 | `npm run build` | 通过 |
| 首屏专项 | `node --test src/tui/test/header.test.mjs` | **9 项全过**（策略判定、宽度自洽截断、宽/窄/极窄等宽框、ASCII 纯 ASCII、精简横幅、零密钥、引导） |
| 全量门禁 | `npm test` | skills 9 + spec 7 + unit **112** + checks PASS + release 16，全部通过 |
| 打包隔离 smoke | `node scripts/release/pack-smoke.mjs` | PASS（tarball 33 文件） |
| 几何目检 | node 投影纯文本 | 100 列双栏 / 60 列 ASCII 紧凑 / 精简横幅框线对齐、无越界 |

`PRODUCT.md` §5.3 已同步重写。真终端颜色/IME 观感仍属 §5 人工清单（UNVERIFIED 不变）。

## 11. 交互面文案中文化（2026-11-17，用户原话「文案你给我替换成中文吧，除了必须用英文的地方，其余换成中文」）

语言策略：现代终端（pixel）交互面中文——首屏（欢迎/快速上手/本轮新增/模型行）、状态行、提示、审批卡、排队指示、斜杠命令回显与 `/help`（`CommandContext.lang='zh'`）；**ASCII 兜底屏保持英文**（老 conhost 代码页安全，对照参考仓 AsciiWelcomeV2 同行为）；**非 TTY/管道与 `--help`/错误输出保持英文**（TC-06 机器面稳定，`lang` 缺省 `'en'`）；命令语法/env/标识符/路径/错误码始终英文。密钥掩码 `maskKey` 不变（既有断言）。

实际执行证据（cwd＝仓库根）：

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| 编译 | `npm run build` | 通过 |
| 文案专项 | `node --test src/tui/test/header.test.mjs src/tui/test/commands-zh.test.mjs src/tui/test/commands.test.mjs` | **25 项全过**（header 10：中文像素屏/英文 ASCII 屏/等宽几何；zh 命令 5；既有英文命令 10 不回归） |
| 全量门禁 | `npm test` | skills 9 + spec 7 + unit **118** + checks PASS + release 16，全部通过 |
| 打包隔离 smoke | `node scripts/release/pack-smoke.mjs` | PASS（33 文件） |

关于「模型名称」：首屏模型行取自配置（`BUDINGX_MODEL` / `--model` / 档案 + `/model`），属 SP002 已实现能力（MM-03）；未配置态显示「模型：未配置」是诚实状态而非缺口。从服务端拉取可用模型列表不在 SP002 AC，也未在路线图排期（如需要另行登记待决）。

## 12. CLI 测试 home 隔离修复与并行会话观察（2026-11-17）

- **缺陷**：`cli.test.mjs`  spawn 真实 CLI 时只清空 `BUDINGX_*`、未隔离用户 home。本机 `~/.budingx` 存在真实档案后，「缺模型明确报错」用例前提失效（走真实请求得 401）。与[实现缺口核查 §6](implementation-gap-audit.md)（并行会话产出）结论一致。
- **修复（仅测试设施）**：`run()` 以 `mkdtempSync` 新建临时 home 并 pin `HOME`/`USERPROFILE`；产品代码未动。复跑 `node --test src/tui/test/cli.test.mjs` **5/5 PASS**。
- **门禁快照（修复后即刻）**：`npm test` = skills 9 + spec 7 + unit **122/124** + checks PASS + release 16；pack smoke PASS（34 文件）。**2 项 FAIL 不归因本修复或排查文档**：`probe 探测可达性并按需检查工具能力`（openai.test）与 `G05/G06 能力修改及显式孤儿清理`（commands.test 新增）—— workspace 存在**并行会话的在途 SP002 缺口修复**（`src/provider/openai.ts`、`src/tui/{cli,commands,runtime}.ts`、`src/core/session.ts` 及对应测试已被其修改，未提交），失败源于其在途变更。本会话不集成、不提交该部分 diff。
- **边界**：并行会话的 `implementation-gap-audit.md` / `design/gap-closure-plan.md` 保持未跟踪、未触碰；SP002 验收应在其缺口修复收口后统一进行（G01 密钥录入、G04 切换同步请求配置等为其报告 P1 项）。
