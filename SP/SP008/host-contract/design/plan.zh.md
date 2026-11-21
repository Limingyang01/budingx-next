# SP008 host-contract 实施计划

- 依据：`design.zh.md` v1（自审通过，2026-11-21）；需求 `../requirements.md`
- 基线：master `a8628b5`；分支 `feature/SP008/host-contract`
- 执行约束：行为变更先写失败用例（RED），再最小实现（GREEN）；每条 AC 至少单元 + 功能（真实进程）
  各一例；新增/修改文件全部纳入 AST 复核映射；**不合入 master**（m00133）。
- 工作目录：`D:\my_project\budingx-next`
- 构建：`npm run build`（tsc -p src/tui/tsconfig.json，产物 `src/*/dist`）
- 单元测试：`node --test --test-concurrency=4 <test file>`；全量 `npm run test:unit`
- 功能测试：`node --test <src/tui/test/sp008-*.test.mjs>`（真实子进程 + fake SSE provider）
- 门禁：`npm run merge:gate`（仅证明分支可交付，不合入）

## 任务总览

| 任务 | 主题 | AC | 依赖 |
| --- | --- | --- | --- |
| T1 | 配置共享更新与锁 | SH-01/02 | — |
| T2 | transcript 尾行容错 | SH-03 | — |
| T3 | writer lock 检视 API | SO-01/03 | — |
| T4 | 宿主协议编解码 | TB-01/04/06 | — |
| T5 | 会话归属（owner/observer/takeover） | SO-01/03, SH-05 | T3 |
| T6 | 宿主服务端（路由/角色/审批/事件） | SO-01…04, TB-02/03/04 | T4, T5 |
| T7 | 进程内传输 | TB-01/02 | T6 |
| T8 | stdio 传输 + CLI serve 分流 | TB-01/02/07 | T6 |
| T9 | 运行时引擎适配（owner/observer、审批超时、恢复） | SO-01/02, SH-05, TB-03 | T5, T6 |
| T10 | WebSocket 服务端 + 轻量客户端 | TB-01/04/05/07 | T6, T9 |
| T11 | 端到端套件（并发/归属/崩溃/边界） | SH-01…05, SO-01…04, TB-01…07 | T1–T10 |
| T12 | 边界脚本与构建范围 | TB-08 | T4–T10 |
| T13 | AST 复核映射与处置 | 交付 | T1–T12 |
| T14 | 文档与交付记录（PRODUCT/STATUS/test-report） | TB-08 | 全部 |

---

### T1 配置共享更新与锁（SH-01/SH-02）

- 设计段：§3.5(1)；AC：SH-01、SH-02。
- Create：无。Modify：`src/storage/config-store.ts`（`update(mutate, {timeoutMs})`、锁文件常量与
  `BUDINGX_STORAGE_006`、陈旧锁清除）。
- Test：`src/storage/test/config-store-lock.test.mjs`（新增）、`src/tui/test/sp008-config-concurrency.test.mjs`（真实子进程）。
- Consumes：`writeJsonAtomic`、`createPrivateFileExclusive`/`readPrivateFile`、`paths.configPath`。
- Produces：`ConfigStore.update`；锁文件 `configPath()+'.lock'`。
- RED：并发两个子进程各 `update` 不同字段，断言两处更新都在 → 现状丢一处（FAIL）。
- 最小实现：锁 + 重读 + 原子写；退避重试；超时抛 `ConfigStoreError('storageLockTimeout')`。
- GREEN：单元（活锁超时、陈旧锁清除、无半写文件）+ 功能（并发均保留、文件合法 JSON）。
- 命令：`npm run build && node --test src/storage/test/config-store-lock.test.mjs`。

### T2 transcript 尾行容错（SH-03）

- 设计段：§3.5(2)；AC：SH-03。
- Modify：`src/storage/session-transcript.ts`（`read()` 对无结尾换行的尾部片段跳过且不计数）。
- Test：`src/storage/test/session-transcript-tail.test.mjs`（新增）、`src/tui/test/sp008-shared-history.test.mjs`。
- RED：写入完整两行 + 半行片段，断言 `records.length===2 && corruptLines===0` → 现状 corruptLines=1（FAIL）。
- GREEN：单元 + 功能（子进程追加、父进程 `SessionStore.restore`，原文件字节不变）。
- 命令：`npm run build && node --test src/storage/test/session-transcript-tail.test.mjs`。

### T3 writer lock 检视 API（SO-01/03 前置）

- 设计段：§3.4；AC：SO-01、SO-03（支撑）。
- Modify：`src/storage/session-store.ts`（`SessionWriterLock.inspect(): {pid, createdAt, active} | undefined`）。
- Test：`src/storage/test/writer-lock-inspect.test.mjs`。
- RED：锁文件存在时 `inspect().pid` 应为当前 pid、`active=true` → 方法不存在（FAIL）。
- GREEN：读写锁文件、`process.kill(pid,0)` 判活；不改变既有 acquire/release 语义。
- 命令：`npm run build && node --test src/storage/test/writer-lock-inspect.test.mjs`。

### T4 宿主协议编解码（TB-01/04/06）

- 设计段：§3.2；AC：TB-01、TB-04、TB-06（错误文本）。
- Create：`src/host/protocol.ts`。
- Test：`src/host/test/protocol.test.mjs`。
- RED：`decodeFrame('{"type":"nope"}', …)` 应返回 `HOST_STATE_006`；`decodeFrame('')` 返回
  `HOST_PROTOCOL_002`；1 MiB+ 帧返回 `HOST_PROTOCOL_005`；`encodeFrame` 以 `\n` 结尾 → 现有模块不存在（FAIL）。
- GREEN：纯函数实现 + 形状校验 + 大小限制；单元覆盖：合法/非法 JSON/未知类型/缺字段/超限/往返无损。
- 命令：`npm run build && node --test src/host/test/protocol.test.mjs`。

### T5 会话归属（SO-01/SO-03/SH-05）

- 设计段：§3.4；AC：SO-01、SO-03、SH-05（崩溃恢复半程）。
- Create：`src/host/ownership.ts`。
- Test：`src/host/test/ownership.test.mjs`。
- Consumes：`SessionWriterLock`、`inspectWriterLock`（T3）、`SessionStore.restore`。
- Produces：`claimSessionOwnership`、`SessionOwnershipRole`（role/takeover/isOwned/release）、`HostOwnershipError`。
- RED：第二个 claim 应返回 observer 且 reason 含活锁 pid；stale 时 takeover 成功、活 owner 时抛
  `HOST_SESSION_003` → 模块不存在（FAIL）。
- GREEN：单元（同进程两种锁场景 + 人为制造 stale 锁）。
- 命令：`npm run build && node --test src/host/test/ownership.test.mjs`。

### T6 宿主服务端（SO-01…04、TB-02/03/04）

- 设计段：§3.2/§3.3/§3.4/§3.8；AC：SO-01…SO-04、TB-02、TB-03、TB-04（服务端半程）。
- Create：`src/host/engine.ts`（端口类型）、`src/host/server.ts`。
- Test：`src/host/test/server.test.mjs`（fake engine：内存事件/审批表）。
- Consumes：T4 编解码、T5 角色、`SessionEvent`。
- RED：observer 发 `submit` 应得 `HOST_SESSION_003` 且 fake engine 未收到；每连接单响应；
  事件 seq 单调；未知 approval requestId → `HOST_STATE_006` → 现状无 server（FAIL）。
- GREEN：连接注册/角色门禁/路由/审批桥/广播/close；单元覆盖 owner/observer、重复 id、关闭后请求。
- 命令：`npm run build && node --test src/host/test/server.test.mjs`。

### T7 进程内传输（TB-01/02）

- 设计段：§3.6；AC：TB-01（同构）、TB-02（顺序）。
- Create：`src/host/transport/in-process.ts`。
- Test：`src/host/test/in-process.test.mjs`。
- RED：hello 返回字段集合与 stdio/WS 契约一致（先定义契约断言）→ 模块不存在（FAIL）。
- GREEN：直接挂接 sink，帧仍经编解码。
- 命令：`npm run build && node --test src/host/test/in-process.test.mjs`。

### T8 stdio 传输 + CLI serve 分流（TB-01/02/07）

- 设计段：§3.6/§3.7；AC：TB-01、TB-02、TB-07（stdio 半程）。
- Create：`src/host/transport/stdio.ts`、`src/tui/serve.ts`。Modify：`src/tui/cli.ts`（serve 分流）。
- Test：`src/host/test/stdio.test.mjs`（单元）、`src/tui/test/sp008-serve-stdio.test.mjs`（真实进程）。
- RED：`spawn(cli, ['serve','--transport','stdio'])` + hello → 应得 hello_ok/scope=local/role=owner →
  现状 `serve` 被当作 prompt（FAIL）。
- GREEN：readline 循环、EOF 关闭、退出码 0；stdout 仅协议帧。
- 命令：`npm run build && node --test src/tui/test/sp008-serve-stdio.test.mjs`。

### T9 运行时引擎适配（SO-01/02、SH-05、TB-03）

- 设计段：§3.3/§3.5/§3.8；AC：SO-01/02、SH-05、TB-03、SH-04（凭据不暴露）。
- Create：`src/tui/host-engine.ts`（`createOwnerEngine`、`createObserverEngine`、审批桥、恢复）。
- Test：`src/tui/test/sp008-engine.test.mjs`（fake provider，进程内）。
- Consumes：`createAgentRuntime`、`SessionStore.restore`、`startSession`、`ApprovalGateway`。
- RED：审批 120s 超时（测试缩短 50ms）应返回 deny/via policy 并产生 notice → 现状无引擎（FAIL）。
- GREEN：owner 引擎（runtime + 锁）、observer 引擎（只读 restore）、超时/取消/释放锁。
- 命令：`npm run build && node --test src/tui/test/sp008-engine.test.mjs`。

### T10 WebSocket 服务端 + 轻量客户端（TB-01/04/05/07）

- 设计段：§3.6；AC：TB-01、TB-04、TB-05、TB-06、TB-07（WS 半程）。
- Create：`src/host/transport/ws.ts`、`src/host/client.ts`。
- Test：`src/host/test/ws-frames.test.mjs`（掩码/分片/超限/ping）、`src/tui/test/sp008-serve-ws.test.mjs`（真实进程）。
- RED：未带令牌升级应 401 → 现状无服务（FAIL）；随后：正确令牌 → hello_ok；非回环启动被拒。
- GREEN：RFC6455 握手/文本帧/close/ping；Bearer 常量时间比较；回环绑定；客户端请求关联与事件流。
- 命令：`npm run build && node --test src/tui/test/sp008-serve-ws.test.mjs`。

### T11 端到端套件（R1/R2/R3 全景）

- 设计段：§3.5–§3.8；AC：SH-01…SH-05、SO-01…SO-04、TB-01…TB-07。
- Create：`src/tui/test/sp008-ownership.test.mjs`、`sp008-crash-recovery.test.mjs`、
  `sp008-transport-parity.test.mjs`（三传输同构矩阵）。
- 场景：
  1. 两进程抢同一会话 → owner/observer、observer submit 拒绝、owner 断开后 observer 可 takeover（stale）。
  2. owner SIGKILL → 新进程 `--takeover` → restore 完整、needsReview 标出、不重放。
  3. 三传输 hello 字段一致；WS 双连接 observer 实时事件、断开不影响 owner 回合。
  4. 畸形/超限/未知/重复 id 后仍能正常对话；审批往返与超时 deny；shutdown/EOF/SIGTERM 释放锁。
- RED：以上场景按现状全部失败（无 serve）；逐项转 GREEN，不以 sleep 猜状态，用帧等待。
- 命令：`npm run build && node --test src/tui/test/sp008-*.test.mjs`。

### T12 边界脚本与构建范围（TB-08）

- 设计段：§3.1；AC：TB-08。
- Modify：`scripts/checks/module-boundaries.mjs`（新增 host 规则与依赖白名单）、
  `src/tui/tsconfig.json`（include `../host/**`）。
- Test：`scripts/checks/module-boundaries.mjs` 自检（脚本内 grep 逻辑已存在）+ 新增 host 负例
  断言由脚本自身覆盖；`src/host/test/boundaries.test.mjs` 可选（调用脚本）。
- RED：脚本对 `src/host` 无规则时，故意 import tui 不被发现 → 现状无规则（FAIL）。
- GREEN：host 规则：禁止 import `tui`、`react`/`ink`/UI 包；允许 core/storage/node 内建。
- 命令：`npm run test:checks`。

### T13 AST 复核映射与处置

- 设计段：交付要求（用户 m00133）；AC：AST-01…AST-03（映射/处置/自检）。
- Modify：`scripts/review/sp004-ast.mjs`（`src/host/*`、`src/tui/host-engine.ts`、`src/tui/serve.ts`、
  `src/storage/*` 改动文件映射；命中处置写实）。
- 命令：`node scripts/review/sp004-ast.mjs --reference D:/my_project/budingWorkerSpace --reference-revision b5c9be8 --base master`。
- RED：新增文件无映射 → 脚本 FAIL（预期先失败）。GREEN：映射全、命中全处置、自检 3/3。

### T14 文档与交付记录

- Modify：`PRODUCT.md`（`budingx serve` 用法、限制：仅本机、令牌必需、无事件重放）、
  `docs/development.md`（如需命令示例）、`SP/SP008/host-contract/test-report.md`、
  `STATUS.md`、`SP/SP008/requirements-summary.md`。
- 命令：`npm run merge:gate`；多轮复跑 T11 套件并记录日志到 `artifacts/quality-runs/SP008/host-contract/<run>/`（忽略）。
- 产出：AC 逐条 PASS/UNVERIFIED 证据、限制说明、commit 记录；**不合并**。

## 测试收口映射

| AC | 单元用例 | 功能用例 |
| --- | --- | --- |
| SH-01 | config-store-lock.test.mjs | sp008-config-concurrency.test.mjs |
| SH-02 | config-store-lock.test.mjs | sp008-config-concurrency.test.mjs（kill 持锁进程） |
| SH-03 | session-transcript-tail.test.mjs | sp008-shared-history.test.mjs |
| SH-04 | protocol.test.mjs + credentials 单测 | sp008-transport-parity.test.mjs（抓包） |
| SH-05 | ownership.test.mjs（stale） | sp008-crash-recovery.test.mjs |
| SO-01 | ownership.test.mjs + server.test.mjs | sp008-ownership.test.mjs |
| SO-02 | server.test.mjs | sp008-ownership.test.mjs（双 WS） |
| SO-03 | ownership.test.mjs + server.test.mjs | sp008-crash-recovery.test.mjs |
| SO-04 | server.test.mjs | sp008-ownership.test.mjs |
| TB-01 | protocol.test.mjs + in-process.test.mjs | sp008-serve-stdio/-ws + parity |
| TB-02 | server.test.mjs（seq/顺序） | sp008-serve-stdio/-ws |
| TB-03 | server.test.mjs + engine 超时 | sp008-serve-ws（审批） |
| TB-04 | protocol.test.mjs + ws-frames.test.mjs | sp008-transport-parity（畸形帧） |
| TB-05 | ws-frames.test.mjs（令牌比较） | sp008-serve-ws（401/200/绑定） |
| TB-06 | protocol/错误文本单测 | parity 抓包 |
| TB-07 | server.close 单测 | sp008-serve-stdio/-ws（EOF/断开/shutdown/SIGTERM） |
| TB-08 | module-boundaries 脚本 | 文档检查（PRODUCT §serve） |

## 状态

- [x] T1 … [ ] 全部：设计自审通过后逐任务实施；每完成一个任务即记录 RED/GREEN 输出摘要与本地提交。
- 当前停点：计划完成，准备 T1 RED。
