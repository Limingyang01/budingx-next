# SP008 验收报告 — 多端架构入口与共享边界

状态：**功能分支完成，未合入 master**（用户 m00133）｜日期：2026-11-22（含当日扩展复测）｜分支 `feature/SP008/host-contract`｜基线 master `a8628b5`｜产品版本 0.7.0（不 bump）

## 1. 方法与环境

- 设计/计划：[design.zh.md](host-contract/design/design.zh.md)、[plan.zh.md](host-contract/design/plan.zh.md)；需求：[requirements.md](host-contract/requirements.md)。
- 环境：Windows、Node.js v22.22.0、TypeScript 构建（`npm run build`，产物 `src/tui/dist`）、Node test runner。
- 真实进程：`spawn(process.execPath, [cli, 'serve', ...])`，每个用例使用独立临时 home；stdio/WS 都经过真实 CLI、真实 HTTP upgrade 与真实 writer lock。
- 真实存储：`~/.budingx` 临时根、`config.json`/`credentials.json`/`sessions/<id>/transcript.jsonl`/`writer.lock`；不读取真实密钥或真实用户历史。
- Provider：本地 HTTP/SSE fixture（OpenAI 兼容，固定回复）；不调用真实模型，不需要真实 API Key（`BUDINGX_API_KEY=fixture-key` 仅用于装配）。
- 传输：进程内 `connectInProcess`、stdio NDJSON、WebSocket（自写 RFC6455 帧 + 掩码 + 分片）。
- 计数命令：`npm run test:unit`；定向 `node --test src/host/test/*.test.mjs src/host/transport/test/*.test.mjs src/storage/test/config-store-lock.test.mjs src/storage/test/session-transcript-tail.test.mjs src/storage/test/session-writer-lock-inspect.test.mjs src/tui/test/sp008-*.test.mjs`。
- 参考仓只用于行为对照（`D:\my_project\budingWorkerSpace` @ `b5c9be8`，只读）；SP008 全部实现独立编写，未复制参考源码。

## 2. 汇总

| 指标 | 结果 |
| --- | --- |
| AC 总数 | **17**（SH-01…05、SO-01…04、TB-01…08） |
| PASS | **16** |
| PARTIAL | **1**（TB-07 的 SIGTERM 子项，Windows 平台限制，见 §5） |
| FAIL | **0** |
| UNVERIFIED | **0** |
| 全量回归 | **1188 项 / 1187 通过 / 0 失败 / 1 跳过**，EXIT=0（跳过项为既有 POSIX 权限用例） |
| SP008 定向套件 | **66 / 66 通过 / 0 失败 / 0 跳过**，29.1s |
| 多轮端到端 | **3 轮 × 23 例 + 扩展矩阵 3 轮 × 11 例，全部通过**（真实 stdio/WS 进程、并发、崩溃恢复、自模拟 MCP/hooks） |
| 宿主扩展装配 | **PASS**（`serve` 接入 MCP/hooks；observer 不启动扩展；关闭回收 MCP 子进程；扩展矩阵 8 类场景全通过） |
| 模块边界 | **PASS**（`npm run test:checks`） |
| AST 复核 | **PASS**（17/17 文件已映射；118 本仓单元 vs 15852 参考单元；18639 函数对；命中 0） |
| 门禁 | 见 §7（`npm run merge:gate`） |

## 3. 任务完成矩阵

| 任务 | 描述 | 状态 | 提交 |
| --- | --- | --- | --- |
| T1 | 配置共享更新与锁（`ConfigStore.update`、`BUDINGX_STORAGE_006`） | PASS | 9e64cd0 |
| T2 | transcript 尾部半行容错（并发读不计 `corruptLines`） | PASS | 9e64cd0 |
| T3 | writer lock 检视 API（pid/创建时间/active，不删除陈旧锁） | PASS | 9e64cd0 |
| T4 | 宿主协议编解码（NDJSON、错误码、1 MiB 上限） | PASS | 83d0135 |
| T5 | 会话归属 owner/observer/takeover | PASS | 83d0135 |
| T6 | 宿主服务端（路由、角色、审批、事件、恢复视图） | PASS | 83d0135 |
| T7 | 进程内传输 | PASS | eb039b0 |
| T8 | stdio 传输 + CLI `serve` 分流 | PASS | c31237d |
| T9 | 运行时引擎适配与审批桥（超时 deny、恢复字段） | PASS | 157a554 |
| T10 | WebSocket 服务端 + 轻量客户端 | PASS | 1216475 |
| T11 | 端到端套件（并发/归属/崩溃/边界/审批） | PASS | 本轮 |
| T12 | 边界脚本与构建范围（host 规则） | PASS | 本轮 |
| T13 | AST 复核映射与处置 | PASS | 本轮 |
| T14 | 文档与交付记录（PRODUCT/STATUS/test-report） | PASS | 本轮 |
| T15 | 复测：`serve` 装配 MCP/hooks + 自模拟扩展端到端（用户 m01288/m01304） | PASS | 2b1b003 |
| T16 | MCP/hooks 端到端矩阵：八事件覆盖、updatedInput、additionalContext、hook ask、多服务器、isError、崩溃、连接失败（用户 m01515） | PASS | 9f7f00b |

## 4. 新增验证资产

| 文件 | 覆盖 | 用例数 |
| --- | --- | --- |
| `src/storage/test/config-store-lock.test.mjs` | SH-01/02 锁内重读-改-写、超时、陈旧锁、失败清理 | 4 |
| `src/storage/test/session-transcript-tail.test.mjs` | SH-03 尾行跳过、完整坏行、无写者时保持 SR-07 | 3 |
| `src/storage/test/session-writer-lock-inspect.test.mjs` | SO-01/03 锁检视语义 | 3 |
| `src/host/test/protocol.test.mjs` | TB-01/04/06 编解码、错误码、超限、事件不含密钥 | 5 |
| `src/host/test/ownership.test.mjs` | SO-01/03 归属、观察者、陈旧锁接管 | 4 |
| `src/host/test/server.test.mjs` | SO-01…04、TB-01/02/04/07 服务端路由与关闭 | 10 |
| `src/host/transport/test/in-process.test.mjs` | TB-01/02 进程内 hello/写/事件/关闭 | 3 |
| `src/host/transport/test/ws-frames.test.mjs` | TB-01/04 RFC6455 帧与 RFC 向量 | 3 |
| `src/tui/test/sp008-config-concurrency.test.mjs` | SH-01/02 两真实进程并发更新、kill 持锁进程 | 2 |
| `src/tui/test/sp008-host-engine.test.mjs` | TB-03/SH-05 引擎描述、真实 SSE 回合、审批超时、dispose | 4 |
| `src/tui/test/sp008-host-stdio.test.mjs` | TB-01/07 stdio owner/observer、EOF 释放锁 | 2 |
| `src/tui/test/sp008-host-ws.test.mjs` | TB-01/05/07 401、回环限制、事件、超限帧 | 3 |
| `src/tui/test/sp008-shared-history.test.mjs` | SH-03 并发追加期间只读恢复 | 1 |
| `src/tui/test/sp008-ownership.test.mjs` | SO-01/02/03/04 两进程归属、活 owner 拒绝、崩溃接管、WS 降级 | 3 |
| `src/tui/test/sp008-crash-recovery.test.mjs` | SH-05/SO-03 崩溃后历史、needs_review、不重放、字节不变 | 1 |
| `src/tui/test/sp008-transport-parity.test.mjs` | TB-01…07 三传输身份一致、边界帧、双 WS 事件、审批往返 | 4 |
| `src/tui/test/sp008-serve-extensions.test.mjs` | 复测：MCP 审批执行、hooks 生命周期/阻断/拒绝/放行、observer 不启动扩展、关闭回收子进程 | 3 |
| `src/tui/test/sp008-serve-extensions-matrix.test.mjs` | T16 扩展矩阵：hooks 八事件全覆盖、updatedInput 改写入参、additionalContext 注入模型上下文、hook ask 回到人工审批、多 MCP 服务器隔离、MCP 工具 isError、MCP 服务器崩溃、连接失败只告警 | 8 |
| `src/tui/test/helpers/host-process.mjs` | 共享 helper（fixture SSE 含 `mcp` 工具调用模式、可覆盖工具调用参数、serve 子进程、WS 客户端、记录帧），非用例 | — |
| `src/tui/test/helpers/sim-mcp-server.mjs` | 自模拟 stdio MCP 服务器（initialize/tools/list/tools/call，多工具名、失败工具 isError、崩溃退出、pid 与调用日志落盘），非用例 | — |

## 5. AC 验收明细

约定：单元 + 功能证据分别列出；所有 PASS 均有真实断言，不以 mock 代替真实进程。

### R1 shared-models-and-history

| AC | 结果 | 单元证据 | 功能/端到端证据 |
| --- | --- | --- | --- |
| SH-01 | PASS | `config-store-lock.test.mjs`：锁内重读-修改-原子写、两字段都保留 | `sp008-config-concurrency.test.mjs`：两个真实 Node 进程并发更新不同字段，最终 JSON 合法且两更新都在 |
| SH-02 | PASS | 同文件：活锁超时 `BUDINGX_STORAGE_006` 且文件不变；陈旧 pid 自动清理；抛错不残留锁/临时文件 | `sp008-config-concurrency.test.mjs`：持锁子进程被 SIGKILL 后更新成功；活锁期间退出码非 0 且原文件哈希不变 |
| SH-03 | PASS | `session-transcript-tail.test.mjs`：半行跳过不计损坏、完整坏行仍计损坏、无写者时半行计损坏 | `sp008-shared-history.test.mjs`：真实并发追加期间只读恢复记录完整、原文件字节不变 |
| SH-04 | PASS | `credentials.test.mjs`：key 只在凭据文件、`(id,host)` 不匹配返回 undefined、主机变更后旧 key 不用 | `sp008-transport-parity.test.mjs`：抓取进程内/stdio/WS 全部字节，不含 `fixture-key`、令牌或 `credentials.json`；`protocol.test.mjs` 事件帧不含密钥字段 |
| SH-05 | PASS | `ownership.test.mjs`/`host-engine.test.mjs`：恢复历史与 needsReview 字段 | `sp008-crash-recovery.test.mjs`：SIGKILL 后陈旧锁、`needs_review` 步骤标出、无 provider 请求（requestCount=0）、transcript sha256 不变；owner/observer 均不重放 |

### R2 session-ownership

| AC | 结果 | 单元证据 | 功能/端到端证据 |
| --- | --- | --- | --- |
| SO-01 | PASS | `ownership.test.mjs`：首次 claim=owner，同进程第二次=observer，写拒绝 | `sp008-ownership.test.mjs`：两个真实进程同 home，第二个 observer；submit/interrupt/set_permission_mode 均 `HOST_SESSION_003`；owner 回合不受影响 |
| SO-02 | PASS | `server.test.mjs`：第二客户端 observer，读可用、写拒绝、断开不广播 | `sp008-host-ws.test.mjs`/`sp008-transport-parity.test.mjs`：双 WS 连接同 seq 事件；observer 断开后 owner ping/describe 正常，锁不变 |
| SO-03 | PASS | `ownership.test.mjs`：陈旧锁 observer(stale)，takeover 后 owner；活 owner 拒绝且锁不变 | `sp008-ownership.test.mjs`：活 owner 时 `--takeover` 退出 1 且 stderr 说明仍被写；SIGKILL 后 `--takeover` 成为 owner 并完成回合；`server.test.mjs` 同进程 takeover 将旧 owner 降级并广播 `role_changed` |
| SO-04 | PASS | `server.test.mjs`：observer 管理请求拒绝且权限模式/状态不变 | `sp008-ownership.test.mjs`：observer 全部写请求拒绝；WS 接管后旧连接降级为 observer，submit 被拒；新 owner 成功 |

### R3 transport-boundaries

| AC | 结果 | 单元证据 | 功能/端到端证据 |
| --- | --- | --- | --- |
| TB-01 | PASS | `protocol.test.mjs` 编解码；`server.test.mjs` 版本不匹配返回 `HOST_PROTOCOL_001` 并在下一微任务断开、clientCount=0 | `sp008-transport-parity.test.mjs`：进程内/stdio/WS 三种 hello 字段一致（version=1、scope=local、sessionId、workspaceId、clientId、role） |
| TB-02 | PASS | `server.test.mjs`：带嵌套文本的 `status`/`text_delta`/`tool_result` 经 JSON 帧后 deepEqual，seq 连续且多客户端一致 | `sp008-transport-parity.test.mjs`：双 WS 事件序列与 turnId 一致、seq 严格递增不重复；stdio/WS 回合以 `turn_finalized completed` 收口；每请求唯一响应 |
| TB-03 | PASS | `sp008-host-engine.test.mjs`：审批一次生效、未知返回 false、20ms 超时按 deny | `sp008-transport-parity.test.mjs`：WS `approval_requested` → allow → `approval_resolved(allow,user)` → `tool_result isError=false` → 回合 completed；120s 默认超时路径由单元用例覆盖 |
| TB-04 | PASS | `protocol.test.mjs`：畸形 JSON/缺 id=002、未知类型=006、超 1 MiB=005；`server.test.mjs` 不断连且后续 ping 正常；重复 id=002 | `sp008-transport-parity.test.mjs`：stdio 注入截断 JSON、未知类型、重复 id、超限 submit 后仍能正常回合；WS 超限先收 `fatal HOST_PROTOCOL_005` 再断开 |
| TB-05 | PASS | — | `sp008-host-ws.test.mjs`：无令牌/错令牌 401，正确令牌升级成功；`--host 0.0.0.0` 启动前拒绝，退出码 2，stderr 含 `HOST_AUTH_004` 与 loopback 说明（监听未建立，无法回协议帧） |
| TB-06 | PASS | `protocol.test.mjs`：事件帧不含密钥字段 | `sp008-transport-parity.test.mjs`：三种传输全部入站帧 + stderr 扫描，不含 fixture key、WS 令牌、凭据路径 |
| TB-07 | PARTIAL | `server.test.mjs`：shutdown 释放锁、关闭连接、dispose 引擎 | `sp008-host-stdio.test.mjs`：stdin EOF 后退出码 0、锁删除；`sp008-host-ws.test.mjs`：shutdown 后监听关闭、锁删除、退出码 0；observer 断开不影响 owner 回合。**SIGTERM 子项 UNVERIFIED**：Windows 下 Node 不支持投递可捕获的 SIGTERM（`child.kill('SIGTERM')` 为强制终止），无法在本机验证优雅退出；服务端已注册 `SIGINT/SIGTERM → server.shutdown()`，清理路径与 shutdown 相同（已测） |
| TB-08 | PASS | `npm run test:checks`：`src/host` 规则禁止 import tui/provider/workspace/exec/git/plan/observability，禁止 UI 包；core/storage 也禁止 host 反向依赖 | `PRODUCT.md` §5.9：`scope=local`、仅回环、同机共享≠跨设备同步、无公网默认监听；`src/host` 全量源码无 tui import（脚本强制） |

### R4 宿主扩展装配（2026-11-22 复测新增，用户 m01288/m01304）

自模拟 MCP 服务器 `src/tui/test/helpers/sim-mcp-server.mjs`（真实 stdio 子进程，JSON-RPC initialize/tools/list/tools/call，pid 与调用日志落盘）；hooks 为真实 Node 子进程脚本，读 stdin JSON 后按语义输出。全部经真实 `budingx serve` 进程与真实 stdio/WS 传输。

| 场景 | 结果 | 证据（`sp008-serve-extensions.test.mjs`） |
| --- | --- | --- |
| MCP 工具经审批执行（stdio） | PASS | 例1：`approval_requested name=mcp__sim__echo` → `approval allow` → `tool_result isError=false` 且含 `sim-echo:`；服务器侧调用日志恰 1 条 `{name:'echo',args:{text:'hello'}}`，证明工具真的执行 |
| hooks 全生命周期（stdio） | PASS | 例1：日志精确等于 `SessionStart|`、`UserPromptSubmit|`、`PreToolUse|mcp__sim__echo`、`PostToolUse|mcp__sim__echo`、`Stop|`（Stop 旁路轮询落盘） |
| 提示词阻断（WS） | PASS | 例2：`UserPromptSubmit` hook 退出码 2 → `turn_finalized outcome=error`、`error.code=BUDINGX_HOOK_BLOCKED`；fixture `requestCount=0`，被阻断的提示词未发给模型 |
| 工具拒绝（WS） | PASS | 例2：`PreToolUse` matcher `mcp__sim__echo` 返回 `deny` → `denial_recorded` + `tool_result` 含 `Denied by hook: simulated deny`；MCP 调用日志 0 条（未执行），MCP 服务器仍保持连接 |
| hook allow 跳过审批（WS） | PASS | 例3：全程无 `approval_requested`，`tool_result isError=false`，MCP 调用 1 条 |
| observer 不启动扩展（WS） | PASS | 例3：同 home/session 第二进程为 observer，submit 拒 `HOST_SESSION_003`；其 MCP pid 文件不存在、调用日志 0 条；observer shutdown 后 owner 的 writer.lock 仍在 |
| 关闭回收 MCP 子进程 | PASS | 例1：运行期间 MCP pid 存活；`shutdown` 后退出码 0、writer.lock 删除，轮询确认 MCP 子进程已退出（TB-07 清理路径扩展到扩展子进程） |

### R5 MCP 与 hooks 端到端矩阵（2026-11-22，用户 m01515）

T16 补齐第一组扩展用例未覆盖的八类场景，全部经真实 `budingx serve` 进程、真实 stdio/WS 传输、真实 stdio MCP 子进程与真实 hook Node 子进程；断言基于落盘日志、MCP 调用日志、模型请求体与宿主事件流。

| 场景 | 结果 | 证据（`sp008-serve-extensions-matrix.test.mjs`） |
| --- | --- | --- |
| hooks 八事件全覆盖 | PASS | 例1：hook 日志精确等于 `SessionStart|-`、`UserPromptSubmit|-`、`PreToolUse|mcp__sim__echo`、`PostToolUse|mcp__sim__echo`、`Notification|-`、`Stop|-`，且无 `StopFailure|-`（回合 outcome=completed，未走失败分支） |
| `PreToolUse` updatedInput 改写入参 | PASS | 例2：hook 输出 `hookSpecificOutput.updatedInput` 后，MCP 服务器侧收到的 `tools/call` 参数为 `{text:'rewritten-by-hook'}`，证明改写后的入参真正到达工具 |
| `additionalContext` 注入模型上下文 | PASS | 例3：hook 输出 `hookSpecificOutput.additionalContext`，SSE fixture 捕获的请求首条 system 消息含 `CTX-SIM-42` |
| hook `ask` 回到人工审批 | PASS | 例4：`PreToolUse` 返回 `permissionDecision:'ask'` 时仍产生 `approval_requested`，人工 allow 后 `tool_result isError=false` 且 MCP 调用 1 条 |
| 多 MCP 服务器并存 | PASS | 例5：`alpha`/`beta` 两个服务器同时挂载，模型调用 `mcp__beta__echo`；beta 调用日志 1 条、alpha 0 条，证明服务器隔离与路由正确 |
| MCP 工具 isError 失败 | PASS | 例6：`tools/call` 返回 `isError:true` → 宿主 `tool_result isError=true`；随后 ping 正常，宿主未崩溃 |
| MCP 服务器崩溃 | PASS | 例7：工具调用使 MCP 子进程 `exit(7)`，宿主仍可 ping、可 `shutdown` 退出 0，writer.lock 正常删除 |
| MCP 连接失败只告警 | PASS | 例8：服务器命令不可执行 → stderr 出现 `Warning: MCP broken`，宿主照常启动并能正常对话（未被连接失败阻断） |
## 6. 多轮端到端

`node --test src/tui/test/sp008-*.test.mjs` 连续 3 轮；日志保存在 `artifacts/quality-runs/SP008/host-contract/`（gitignore 忽略）：

| 轮次 | 结果 | 覆盖 |
| --- | --- | --- |
| run-1…3（交付前） | 每轮 20/20 PASS，EXIT=0 | stdio/WS 真实进程、owner/observer、崩溃接管、崩溃恢复、三传输、审批、配置并发、共享历史 |
| final-run-1…3（交付 HEAD） | 每轮 20/20 PASS，EXIT=0 | 同上，提交后复跑 |
| ext-run-1…3（扩展复测） | 每轮 **23/23** PASS，EXIT=0，约 26.2s/轮 | 上述 20 例 + 自模拟 MCP/hooks 3 例（审批执行、生命周期、阻断、拒绝、放行、observer 隔离、子进程回收） |
| final2-run-1…3（复测 HEAD `abbdcb1`） | 每轮 **23/23** PASS，EXIT=0，26.9s / 26.2s / 26.2s | 同上，文档提交后在最终 HEAD 复跑，确认无回归 |
| matrix-run-1…3（扩展矩阵 HEAD `9f7f00b`） | 每轮 **11/11** PASS，EXIT=0 | 扩展用例 3 例 + T16 矩阵 8 例（八事件、updatedInput、additionalContext、ask、多服务器、isError、崩溃、连接失败） |
| t16-run-1…3（文档收口前定向全量） | 每轮 **66/66** PASS，EXIT=0 | SP008 定向 66 例全量复跑（宿主、传输、存储、三传输、归属、崩溃恢复、扩展、扩展矩阵） |

每轮均重新创建临时 home、重新启动 serve 子进程、重新建立 HTTP fixture 与 MCP/hook 子进程；不共享上一轮磁盘状态。

## 7. 模块边界、AST 与门禁

- `scripts/checks/module-boundaries.mjs`：新增 `RULES.host`，`ui` 禁 UI 包但允许 `node:readline`；`dirs` 禁 `tui/provider/workspace/exec/git/plan/observability`；`core`/`storage` 的禁止依赖加入 `host`。`npm run test:checks` → 模块边界检查通过。
- `scripts/review/sp004-ast.mjs`：新增 17 条 SP008 文件映射，覆盖 `git diff master...HEAD` 的全部 `.ts`；命中 0。
- 门禁：`npm run merge:gate` → **GATE GREEN**（2026-11-22，最终 HEAD `4a638e9`，报告 `artifacts/merge-gate/feature-SP008-host-contract-2026-11-21T16-59-01-452Z.md`）：`npm test`、`spec:check`、`skills:check`、`pack-smoke` 全通过，禁带路径违规 0。首次 RED 因报告放在 slug 目录而 master 复核按 `SP/SPnnn/test-report.md` 查找；正本移至轮次根目录后复跑 GREEN，偏差见 §8。
- 复测门禁（T15 后）：`npm run merge:gate` → **GATE GREEN**（HEAD `abbdcb1`，outgoing 13 commits / 49 files，报告 `artifacts/merge-gate/feature-SP008-host-contract-2026-11-22T00-41-00-318Z.md`）：四项检查退出码全 0，禁带路径违规 0，报告 FAIL 行 0、UNVERIFIED 行 2（TB-07 SIGTERM 与既有 POSIX 权限用例），恢复条件节齐备。
- 扩展矩阵门禁（T16 后）：`npm run merge:gate` → **GATE GREEN**（HEAD `9f7f00b`，outgoing 15 commits / 50 files，报告 `artifacts/merge-gate/feature-SP008-host-contract-2026-11-22T01-27-09-665Z.md`）：`npm test`/`spec:check`/`skills:check`/`pack-smoke` 四项检查全通过，禁带路径违规 0。
- 文档收口门禁（T16 文档后）：`npm run merge:gate` → **GATE GREEN**（outgoing 15 commits / 50 files，报告 `artifacts/merge-gate/feature-SP008-host-contract-2026-11-22T01-41-12-691Z.md`）：四项检查退出码全 0，禁带路径违规 0，报告 FAIL 行 0、UNVERIFIED 行 3（TB-07 SIGTERM 与 2 项既有 POSIX 权限用例），恢复条件节齐备。

## 8. 偏差与实施期修订

| 项 | 计划/设计原写法 | 实际 | 理由与处置 |
| --- | --- | --- | --- |
| WS 令牌 | 设计初稿：未提供时生成随机 32 字节 hex 并只写 stderr | 令牌必需；缺失时 stderr 报错、退出码 2，不隐式生成、不打印 | 隐式生成会把凭据写进终端/日志/测试抓包；TB-05 要求显式认证。已回写 design §3.6/§8、PRODUCT §5.9 |
| 传输 API | `serveStdio`、`startWebSocketHost`、`HostClient` type | `connectStdio(server,{input,output})`、`startWsHost({host,port,token,onConnection})`、`class HostClient` | 统一「连接函数返回 HostTransport」模型，便于三传输共用客户端；已回写 design §3.6 |
| 非回环拒绝 | 设计错误表列 `HOST_AUTH_004`，未说明表达层 | 启动前拒绝，退出码 2，stderr 标记 `HOST_AUTH_004` | 监听尚未建立，没有连接可回协议错误；用稳定错误码文本保留机读性 |
| TB-01 版本关闭 | 需求要求「返回 001 并关闭」，初版只回错误 | 回 001 后 `queueMicrotask` 删除客户端并以 1002 关闭 | T11 对照 AC 发现缺口，已补实现与单测（`server.test.mjs`） |
| 恢复字段 | 设计 §3.3 要求接管后 `needsReview`/`warnings` 可见 | 初版 `serve` 只 `startSession`，`HostEngine` 无恢复字段 | T11 补 `NeedsReviewStep` 协议字段、`HostEngine` 透传、`serve` 调 `runtime.sessions.resume` 并写 warning；测试 `sp008-crash-recovery` 证明 |
| 测试文件命名 | 计划：`sp008-engine`/`sp008-serve-stdio`/`sp008-serve-ws`；`ws-frames` 在 `src/host/test/` | 实际：`sp008-host-engine`/`sp008-host-stdio`/`sp008-host-ws`；`src/host/transport/test/ws-frames.test.mjs` | 命名更贴近被测对象，无功能影响 |
| 审批 e2e 命令 | 计划用 Bash `echo hi` | 改用 `rm -rf sp008-approval-temp` | `echo` 属只读白名单自动放行，不触发审批；改用 execute 能力命令才能真实验证审批往返 |
| 崩溃恢复测试命名 | 计划覆盖 SO-03 | 实际同时覆盖 SH-05 与 SO-03 | 同一场景（SIGKILL 后接管）自然覆盖两条 AC，避免重复造数据 |
| 验收报告位置 | 计划：`SP/SP008/host-contract/test-report.md` | 正本：`SP/SP008/test-report.md`；slug 路径保留入口页 | `merge:gate` 的 master 复核按 `SP/SPnnn/test-report.md` 读取最新一轮报告（SP001–SP007 同此约定）；报告留在 slug 目录会使门禁判为缺少报告 |
| serve 扩展装配 | 初版 `serve` 未传 `mcp`/`hooks`，作为已知限制记录 | 复测按用户 m01288「mcp 和 hooks 自己模拟」接入 `startMcp`/`startHooks`，并新增 3 例真实进程端到端 | 宿主入口应与交互入口能力一致；observer 仍不启动扩展。限制条目已从 §9 与 PRODUCT §5.9.2 移除，改为装配说明 |
| 扩展矩阵覆盖 | 计划未单列矩阵用例 | T16 新增 `sp008-serve-extensions-matrix.test.mjs` 8 例 | 覆盖八事件语义、入参改写、上下文注入、ask 审批、多服务器隔离、工具失败、服务器崩溃、连接失败降级；能力早已在 `core`/`tui` 就位，本次只补证据，未改实现 |

## 9. 已知限制与恢复条件

- **跨进程无实时事件**：observer 进程只恢复磁盘历史；同一宿主进程内多客户端才共享实时事件。这是设计边界，不是缺陷。
- **无事件重放/断线续传**：断线只保证不破坏会话、不越权；客户端需重新 hello/describe/history。
- **SIGTERM 优雅退出未在 Windows 实测**：Node 在 Windows 不投递可捕获 SIGTERM；恢复条件：在 Linux/macOS 上执行 stdio serve，发 SIGTERM，断言退出码 0 且 writer.lock 删除。现有强制终止后由 `--takeover` 接管，已有 e2e 覆盖。
- **WS 仅 `ws://` 回环**：不支持 `wss://`/TLS/反向代理；跨设备同步不在本轮范围。
- **扩展装配的边界**：`serve` 已与交互入口一致装配 MCP/hooks，但仍有三点限制：MCP 服务器连接失败只写 stderr 告警、不阻断宿主启动（与 TUI 相同）；宿主没有 `/mcp`、`/hooks` 交互面板，状态只能从 stderr 与工具行为观察；扩展配置在启动时读取一次，修改后需重启宿主。
- **会话删除/导出/fork 隔离**：SP005 遗留，未改变产品行为。
- **真实其他端**：Desktop/VS Code/远程/H5/IM 均未交付；本轮只交付通用契约与轻量测试客户端。
- **真实模型**：本轮端到端全部使用本地 SSE fixture；真实模型链路已在 SP007 验收，本轮不重复消耗外部额度。

## 10. 复现命令

~~~bash
cd D:/my_project/budingx-next/.worktrees/SP008
npm run build
npm run test:unit
node --test src/host/test/*.test.mjs src/host/transport/test/*.test.mjs src/storage/test/config-store-lock.test.mjs src/storage/test/session-transcript-tail.test.mjs src/storage/test/session-writer-lock-inspect.test.mjs src/tui/test/sp008-*.test.mjs
npm run test:checks
node scripts/review/sp004-ast.mjs --reference D:/my_project/budingWorkerSpace --reference-revision b5c9be8 --base master
npm run merge:gate
~~~

扩展复测单独跑：`node --test src/tui/test/sp008-serve-extensions.test.mjs`（3 例，自模拟 MCP/hooks）。

扩展矩阵单独跑：`node --test src/tui/test/sp008-serve-extensions-matrix.test.mjs`（8 例，MCP/hooks 端到端矩阵）。

多轮日志：`artifacts/quality-runs/SP008/host-contract/run-{1,2,3}.log`、`final-run-{1,2,3}.log`、`ext-run-{1,2,3}.log`、`final2-run-{1,2,3}.log`、`matrix-run-{1,2,3}.log`、`t16-run-{1,2,3}.log`（本地保留，不提交）。