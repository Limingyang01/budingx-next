# SP008 host-contract 设计 — 多端架构入口与共享边界

- 迭代：SP008 ｜ 功能目录：`SP/SP008/host-contract/`
- 设计版本：v1（2026-11-21），Agent 自审对象
- 基线：master `a8628b5`；功能分支 `feature/SP008/host-contract`
- 需求：`../requirements.md`（SH-01…SH-05、SO-01…SO-04、TB-01…TB-08，共 17 条）
- 参考实现：`D:\my_project\budingWorkerSpace` @ `b5c9be8`（只读；读机制、不抄代码；AST 复核在交付前执行）
- 现行用户约束（m00133）：交付前多轮端到端复跑；TUI 功能复刻但独立实现；AST 检测。
  「不合入 master」约束已由用户 m02815（2026-11-22）解除，授权合入 master 与发布前准备。
- 状态：设计已自审（见 §8）；v1.1 含实施期修订（令牌策略与传输 API 命名已回写）

## 1. 背景与目标

路线图 r8 只交付 TUI，但要求保留**通用宿主契约**：TUI 与未来各端（Desktop、VS Code、远程、IM）
不依赖同一个常驻进程，而是各自拥有实例、复用相同核心；共享持久化与活动执行分离，避免多个写者
竞争同一会话。SP008 的交付物不是任何新端 UI，而是：

1. 一条**版本化宿主契约**：身份、事件、权限、请求/响应、错误码与分帧；
2. 三种传输（进程内、stdio、WebSocket）对同一条契约的实现与**轻量测试客户端**；
3. 共享数据（配置/历史/凭据）在同机多进程下的并发安全与作用域；
4. 活动会话**归属**（owner/observer/takeover）与崩溃恢复语义；
5. 明确的边界声明：`scope=local`，同机共享 ≠ 跨设备同步。

## 2. 当前状态（设计输入）

| 事实 | 源码位置 | 影响 |
| --- | --- | --- |
| `SessionEvent` 已 UI 无关、可 JSON 序列化，含审批与终态 | `src/core/events.ts:176-330` | 宿主事件直接转发，不新增第二套事件词汇 |
| `Session` 提供 `on/submit/interrupt/dispose/adoptIdentity/restoreHistory` | `src/core/session.ts` | 引擎端口只需薄适配 |
| `ApprovalGateway.request(ApprovalRequest): Promise<ApprovalDecision>`，另有 `cancelAll?` | `src/core/tools.ts:101-106` | 宿主审批桥接点，超时以 `deny/via:'policy'` 结束 |
| `createAgentRuntime` 装配 provider/policy/tools/persistence/诊断 | `src/tui/runtime.ts` | TUI 与 `serve` 共用；host 层不得 import tui |
| CLI 主流程：`--version/--help` → `parseCliArgs` → `loadStores` → `mergeSources` → headless/pipe/interactive | `src/tui/cli.ts:302-368`；`src/tui/headless.ts:52-105` | `serve` 子命令需在 `parseCliArgs` 前分流，未知位置参数仍保持旧语义 |
| writer lock：O_EXCL 建 `writer.lock`，内容 `pid\n时间\n`；活锁拒绝、陈旧锁须 force | `src/storage/session-store.ts:120-205` | 会话归属的真相来源；本轮补接管/降级视图 |
| `SessionStore.acquire` 返回 `{acquired:true}|{acquired:false,reason}` | `src/storage/session-store.ts` | 不解析文案：新增 `inspectWriterLock` 读取 pid/活性 |
| `list()` 扫描目录重建，无共享索引 | `src/storage/session-store.ts:246-262` | 并发新增会话不互相覆盖 |
| `ConfigStore.load/save` 无跨进程锁 | `src/storage/config-store.ts:67-115` | 并发 load-modify-save 丢更新（SH-01 先红） |
| `read()` 对 `split('\n')` 后每行 JSON.parse，坏行计入 `corruptLines` | `src/storage/session-transcript.ts:77-117` | 尾行半行会被误计损坏（SH-03 先红） |
| `CredentialStore.get(id, host)`，host 不符返回 undefined | `src/storage/credentials.ts` | 凭据作用域基础已具备 |
| 边界脚本规则表只含 8 个目录 | `scripts/checks/module-boundaries.mjs` | 新增 `src/host` 须加规则并禁 host→tui |
| AST 复核要求改动文件全映射、命中全处置 | `scripts/review/sp004-ast.mjs` | 新增文件必须登记映射与处置 |
| 当前不存在 `src/host`、`serve` 子命令或宿主协议 | 仓库实际 | 全部为新增，不虚构为存量 |

## 3. 方案

### 3.1 责任划分与模块图

```
src/tui/cli.ts ──serve──► src/tui/host-engine.ts ──创建──► createAgentRuntime (src/tui/runtime.ts)
      │                        │ implements
      │                        ▼
      │                 src/host/engine.ts  (HostEngine 端口，类型 + 工厂契约)
      │                        ▲
      ▼                        │
src/host/server.ts ◄── src/host/transport/{stdio,ws,in-process}.ts
      │  ├─ requests/roles ──► src/host/ownership.ts ──► src/storage/session-store.ts
      │  └─ events ──────────► SessionEvent（转发）
      └─ 帧编解码 ──────────► src/host/protocol.ts
测试/未来端 ──► src/host/client.ts（进程内/stdio/WS 轻量客户端）
共享数据：src/storage/config-store.ts（+update）、session-transcript.ts（尾行容错）、credentials.ts（不变）
```

依赖方向：`tui → host → core, storage`；`host` **禁止** import `tui`、React/Ink；`core` 保持无 IO。
`host` 不 import `provider/exec/workspace/git/plan/observability`（由边界脚本强制），因此
宿主引擎实现只放在 `src/tui/host-engine.ts`（它可以用运行时装配），未来其他端实现同一端口。

### 3.2 协议（`src/host/protocol.ts`）

- `HOST_PROTOCOL_VERSION = 1`；`HOST_FRAME_MAX_BYTES = 1_048_576`（1 MiB）。
- 分帧：NDJSON（UTF-8，一行一帧，`\n` 结尾）。WS 单条消息也按行切分，容忍多帧。
- 请求 `{ id, type, ... }`；响应 `{ id, ok:true, result } | { id, ok:false, error:{code,message} }`；
  hello 的响应是 `{ type:'hello_ok', id, protocolVersion, sessionId, workspaceId, clientId, role, scope }`；
  事件 `{ type:'event', seq, event: SessionEvent }`（`seq` 单调递增，用于顺序断言）；
  `{ type:'role_changed', role }`、`{ type:'fatal', code, message }`、`{ type:'pong', id }`。

请求类型（v1）：

| type | 参数 | 允许角色 | 结果 |
| --- | --- | --- | --- |
| `hello` | `protocolVersion`、`clientId?` | 全部 | `hello_ok` |
| `describe` | — | 全部 | `{ sessionId, workspaceId, role, state, permissionMode, title?, needsReview }` |
| `history` | `limit?` | 全部 | `{ messages, needsReview, warnings }`（只读，绝不重放工具） |
| `submit` | `text` | owner | `{ accepted: true }`，回合事件随后推送 |
| `interrupt` | — | owner | `{ interrupted: boolean }` |
| `approval` | `requestId`、`outcome` | owner | `{ accepted: true }`；未知 requestId → `HOST_STATE_006` |
| `set_permission_mode` | `mode` | owner | `{ mode }` |
| `takeover` | — | observer | 成功返回 `hello_ok`（role=owner），失败 `HOST_SESSION_003` |
| `ping` | — | 全部 | `pong` |
| `shutdown` | — | owner | `{ stopping: true }`，服务端优雅关闭 |

错误码（稳定机读字符串）：

| code | 含义 | 触发 |
| --- | --- | --- |
| `HOST_PROTOCOL_001` | 协议版本不支持 | hello 的 `protocolVersion` ≠ 1 → 回 fatal 后关闭 |
| `HOST_PROTOCOL_002` | 畸形帧/字段非法/重复请求 id | JSON 解析失败、缺字段、类型错、同连接 in-flight id 重复 |
| `HOST_SESSION_003` | 非所有者/归属冲突 | observer 发管理请求、takeover 时 owner 仍活着、owner 已失去锁 |
| `HOST_AUTH_004` | 认证/绑定违规 | WS 令牌缺失或错误、请求非回环绑定 |
| `HOST_PROTOCOL_005` | 帧过大 | 单帧 UTF-8 字节 > 1 MiB |
| `HOST_STATE_006` | 未知请求/未知状态 | 未知 `type`、未知 `approval.requestId`、已关闭后请求 |

注：需求表里「`HOST_PROTOCOL_003` 会话非所有者」统一为 `HOST_SESSION_003`（与 SO 组 AC 一致）。

编码器/解码器纯函数，便于单元测试：
`encodeFrame(frame): string`、`decodeFrame(line, maxBytes?): {ok:true,frame}|{ok:false,code,message}`、
`isHostRequest(value)`、`isSessionEvent(value)`（形状校验，不用 schema 库）。

### 3.3 引擎端口（`src/host/engine.ts`）

```ts
export type HostEngineDescription = {
  sessionId: string
  workspaceId: string
  title?: string
  state: SessionState
  permissionMode: PermissionMode
  needsReview: { name: string; callId: string; detail?: string }[]
}

export interface HostEngine {
  describe(): HostEngineDescription
  history(limit?: number): { messages: Message[]; needsReview: ...; warnings: string[] }
  submit(text: string): void            // 立即返回；失败通过事件/错误码表达
  interrupt(): boolean
  approve(requestId: string, outcome: 'allow' | 'allow_session' | 'deny'): boolean
  setPermissionMode(mode: PermissionMode): boolean
  onEvent(listener: (event: SessionEvent) => void): () => void
  dispose(): Promise<void>
}
```

引擎不决定角色（server 负责），不决定传输。owner 引擎删除/关闭时释放 writer lock。

### 3.4 归属与角色（`src/host/ownership.ts`）

- `claimSessionOwnership({sessionId, home, force?})`：
  - 成功 → `{role:'owner', lock, ownerPid: process.pid}`；
  - 失败且持锁进程存活 → `{role:'observer', reason, ownerPid}`；
  - 失败且锁陈旧 → `{role:'observer', stale:true, ownerPid}`（不自动删除；`takeover()` 才 force）。
- `SessionOwnershipRole.takeover()`：检查锁 pid 活性；活着 → 抛 `HostOwnershipError('HOST_SESSION_003')`；
  已死 → force acquire，成功后 `role='owner'`。
- `isOwned()`：锁文件仍由本进程持有（读内容 pid === process.pid），每次管理请求前校验；
  失锁即降级为 observer 并广播 `role_changed`。
- 新增 `inspectWriterLock(sessionId, home)` 到 storage（或 SessionWriterLock 实例方法），返回
  `{pid, createdAt, active}`，避免解析错误文案。
- 跨进程 observer 只读：用 `SessionStore.restore` 取历史（read-only，不改文件、不重放）；
  实时事件只向同一宿主进程内的连接广播（限制写入文档与 `describe` 的 `scope`）。

### 3.5 共享配置与历史（R1）

1. `ConfigStore.update(mutate, opts?)`：`config.json.lock`（O_EXCL，内容 `pid\nISO\n`）→ `load()` →
   `mutate(config)` → `save()` → 释放；锁被占用时每 5–25ms 退避重试，默认 `timeoutMs=2000`；
   超时抛 `ConfigStoreError('storageLockTimeout', 'BUDINGX_STORAGE_006')`；锁 pid 已死或 mtime 超过 10s
   视为陈旧并清除重试；`save` 仍用 `writeJsonAtomic`，失败不产生半写文件。
2. transcript 尾行容错：`read()` 先判断 `raw.endsWith('\n')`；若同一会话目录存在**活** `writer.lock`
   （pid 存活），则丢弃最后一个换行后的片段（视为正在追加的半行，不解析、不计 `corruptLines`、不回写文件）。
   没有活写者时保持 SP005 SR-07：残缺尾行仍计 `corruptLines`，避免把真实截断静默当成并发。完整行损坏仍计 `corruptLines`。
3. 凭据：不改变存储格式；宿主不提供凭据读取接口，配置/描述只含 `apiKeyRef` 引用，不返回 key 明文；
   测试对三种传输的全部字节做断言（SH-04/TB-06）。
4. 并发新增会话：沿用目录扫描；测试只断言两个进程各自 `startSession` 后 `list()` 都能看到两条。

### 3.6 三种传输（R3）

| 传输 | 实现 | 关键点 |
| --- | --- | --- |
| 进程内 | `src/host/transport/in-process.ts`：`connectInProcess(server): HostTransport` 直接挂接连接 | 证明契约与网络传输同构；TUI 内嵌/测试用 |
| stdio | `src/host/transport/stdio.ts`：`connectStdio(server, {input, output}): StdioHandle`，`readline` 逐行读 | stdout 只写协议帧；日志走 stderr；EOF → 优雅关闭、退出码 0 |
| WebSocket | `src/host/transport/ws.ts`：`startWsHost({host, port, token, onConnection})` | 仅回环默认；RFC6455 手写握手/帧（无新依赖）；Bearer 令牌；1 MiB 上限；ping/pong |

WS 细节（自实现，避免新增第三方依赖）：
- 握手：校验 `Upgrade: websocket`、`Sec-WebSocket-Key`，返回 101 与 `Sec-WebSocket-Accept`
  （SHA-1 + 固定 GUID）；`Authorization: Bearer <token>` 用 `timingSafeEqual` 比较。
- 帧：支持文本帧（客户端必须掩码）、分片合并、ping→pong、close 回显；未掩码/保留位/超限 → 以
  1002/1009 关闭并（超限时）先发 `fatal HOST_PROTOCOL_005`。
- 绑定：默认 `127.0.0.1`；`--host` 非回环（`localhost/127.0.0.1/::1` 之外）→ 启动前拒绝并退出码 2，stderr 标记 `HOST_AUTH_004`（监听尚未建立，无法回协议帧）。
- 令牌：`--token` 或 `BUDINGX_HOST_TOKEN`，**必需**；未提供时拒绝启动（stderr 明确提示，退出码 2），
  不隐式生成、不打印到任何通道，不写入配置、不进入事件/错误消息。实施修订理由：隐式生成会把
  凭据写进终端日志/测试抓包，且 TB-05 要求“显式认证”，故改为显式提供。

轻量客户端（`src/host/client.ts`）：
```ts
class HostClient {
  constructor(options: { transport: HostTransport; protocolVersion?: number; clientId?: string; requestTimeoutMs?: number })
  readonly role: HostRole
  connect(): Promise<HelloResult>
  request(type: HostRequestType, payload?: Record<string, unknown>): Promise<HostResult>
  onEvent(listener: (event: SessionEvent, seq: number) => void): () => void
  onRoleChanged(listener: (role: HostRole) => void): () => void
  onClose(listener: () => void): () => void
  close(): void
}
connectInProcess(server): HostTransport
connectStdio(server, { input?, output? }): StdioHandle   // 服务端侧，stdio 管道由调用方提供
connectWebSocket({ url, token, timeoutMs? }): Promise<HostTransport>
```

### 3.7 CLI 入口（`budingx serve`）

- 在 `parseCliArgs` 之前识别 `args[0] === 'serve'`，交给 `runServeCommand(args.slice(1))`；
  其他参数仍走原路径，未知位置参数行为不变。
- 选项：`--transport stdio|ws`（默认 stdio）、`--host 127.0.0.1`、`--port 0`（0=随机端口，启动后把
  实际端口写到 stderr 的 `listening ws://127.0.0.1:<port>` 行）、`--session <id>`（缺省新建）、
  `--takeover`（陈旧锁显式接管）、`--home <dir>`（测试隔离，沿既有模式）。
- 认证：WS 必须令牌；stdio 不额外认证（管道继承进程权限）。
- 扩展装配（2026-11-22 复测修订）：owner 进程与交互入口一致地调用 `startMcp({ homeDir })` 与
  `startHooks({ homeDir })`，把 `mcp: { tools, statuses }` 与 `hooks: runner` 传入 `createAgentRuntime`；
  配置告警只写 stderr。observer 只读历史，不启动任何扩展子进程。关闭顺序为 `server.shutdown()`
  （含 `engine.dispose()`）→ `mcp.close()`；runtime 创建失败时先关 MCP 再释放锁，避免孤儿进程。
- 生命周期：POSIX 下 SIGINT/SIGTERM → 停止接受连接、`engine.dispose()`、释放锁、退出 0；
  `shutdown` 请求同样处理；stdio EOF 同 SIGTERM。Windows 无法投递可捕获的 SIGTERM，强制终止留下陈旧锁，由 `--takeover` 恢复（README/PRODUCT 如实声明）。
- 不许把宿主协议帧写到 stdout 以外的通道；stdout 仅协议。

### 3.8 错误、取消、恢复与兼容

- **错误**：全部走稳定错误码；连接级致命错误回 `fatal` 后关闭；请求级错误只影响该请求。
  错误消息不得包含绝对 home 之外的敏感内容，不得包含 key/凭据。
- **取消**：`interrupt` 映射 `Session.interrupt('user')`；observer 无权取消；传输断开默认**不**取消
  进行中的回合（TB-07），回合继续，事件在无客户端时丢弃（不缓存、不重放）。
- **恢复**：崩溃后新进程 `claim` 得到 observer+stale → `--takeover`/`takeover` 显式接管；
  恢复历史来自 transcript（`needsReview` 标出未知结果工具步骤，不重放）；不实现事件重放。
- **兼容**：headless 输出（SP006 §11）不变；TUI 交互不变；`SessionEvent` 不变；配置/转录/凭据
  文件格式不变（仅新增锁文件 `config.json.lock`，临时文件失败自动清理）；旧配置文件可直接读。

## 4. 变更集

| 动作 | 路径 | 内容 | 对应 AC |
| --- | --- | --- | --- |
| Create | `src/host/protocol.ts` | 版本、帧类型、编解码、请求/事件校验、错误码常量 | TB-01/02/04/06 |
| Create | `src/host/engine.ts` | `HostEngine` 端口与描述/历史类型（无实现） | SO-01/04, TB-02 |
| Create | `src/host/ownership.ts` | claim/takeover/isOwned、角色与降级、`HostOwnershipError` | SO-01/03, SH-05 |
| Create | `src/host/server.ts` | 连接注册、请求路由、角色门禁、审批桥、事件广播、关闭 | SO-01…04, TB-02…07 |
| Create | `src/host/transport/in-process.ts` | 进程内传输（同编码器） | TB-01/02 |
| Create | `src/host/transport/stdio.ts` | NDJSON stdio 服务端（读循环/EOF/关闭） | TB-01/07 |
| Create | `src/host/transport/ws.ts` | 最小 RFC6455 服务端、Bearer 校验、回环绑定、帧上限 | TB-01/04/05/07 |
| Create | `src/host/client.ts` | 轻量客户端（进程内/stdio/WS）、请求关联、事件流 | TB-01/02/03 |
| Create | `src/tui/host-engine.ts` | `HostEngine` 的运行时实现：createAgentRuntime、审批桥（超时 deny）、恢复历史 | SO/SH/TB 功能层 |
| Create | `src/tui/serve.ts` | `runServe`：选项解析、凭据/配置装载、归属、传输启动、信号处理 | TB-01/05/07 |
| Modify | `src/tui/cli.ts` | `serve` 子命令分流（parseCliArgs 前） | TB-01/07 |
| Modify | `src/tui/headless.ts` | `--help` 之外不变；仅在需要时共享选项类型（无行为变更） | — |
| Modify | `src/storage/config-store.ts` | `update(mutate)`、锁文件、`storageLockTimeout` 错误码 | SH-01/02 |
| Modify | `src/storage/session-transcript.ts` | 活写者时尾行半行容错（不计数、不回写）；无活写者保持 SR-07 计数 | SH-03 |
| Modify | `src/storage/session-store.ts` | `inspectWriterLock`（pid/活性/时间） | SO-01/03 |
| Modify | `scripts/checks/module-boundaries.mjs` | 新增 `host` 规则（禁 tui、禁 UI/IO 包），保留既有检查 | TB-08 |
| Modify | `src/tui/tsconfig.json` | include `../host/**` | 构建 |
| Modify | `scripts/review/sp004-ast.mjs` | 为 `src/host/*`、`src/tui/host-engine.ts`、`src/tui/serve.ts`、storage 改动文件登记映射与处置 | 交付 |
| Create | `src/host/test/*.test.mjs`、`src/tui/test/sp008-*.test.mjs`、`src/storage/test/*.test.mjs` | 单元 + 真实进程 e2e，先 RED 后 GREEN | 全部 |
| Modify | `PRODUCT.md`、`docs/development.md`（如需）、`SP/SP008/**` | 使用说明（`serve`）、证据与状态 | 交付 |

不新增第三方依赖；`src/tui/package.json` 依赖白名单不变（WS 自实现）。

## 5. 验收条件（Given/When/Then 与测试层）

见 `../requirements.md` §5 的 SH/SO/TB 表；实现与测试一一映射：

| AC | 单元层（`node --test`） | 功能层（真实进程） |
| --- | --- | --- |
| SH-01 | `config-lock` 锁/退避/超时 | 两个 node 子进程并发 `ConfigStore.update` |
| SH-02 | 锁超时错误码、陈旧清除、无半写文件 | 子进程持锁 + kill，另一个进程重试 |
| SH-03 | 活写者存在时尾行片段不计 corrupt | 子进程持锁追加时父进程 `restore()` |
| SH-04 | 协议编码/凭据作用域单测 | 三传输抓包断言无 key 明文 |
| SH-05 | — | SIGKILL owner → 新进程 takeover → restore 完整、不重放 |
| SO-01 | ownership claim 单元 | 两进程 stdio/WS 抢同一会话 |
| SO-02 | server 角色门禁单元 | 同服务双 WS 连接 |
| SO-03 | takeover 活/死锁单元 | 真实进程崩溃后接管 |
| SO-04 | observer 管理请求拒绝单元 | WS observer 发 submit/approval/set_mode |
| TB-01 | 编解码 + 三传输同构（进程内） | stdio/WS spawn 客户端 hello |
| TB-02 | 事件顺序/单响应单测 | stdio/WS 一次 fake provider 回合 |
| TB-03 | 审批桥超时 deny 单测 | WS 审批 allow/deny 往返 |
| TB-04 | 解码错误码矩阵 | stdio/WS 畸形/超限/未知/重复 id |
| TB-05 | — | 真实 HTTP/WS 401/401/200 + 非回环拒绝 |
| TB-06 | 错误消息不含敏感串 | 三传输错误分支抓包 |
| TB-07 | server.close 释放锁单测 | stdio EOF/WS 断开/shutdown/SIGTERM |
| TB-08 | 边界脚本 + 协议 scope 断言 | 文档/监听地址检查 |

## 6. 设计自审记录（§8 之前）

**七个必答问题**

1. **谁拥有行为？** 会话编排、事件、权限决策仍属 `src/core`；宿主只做身份/路由/门禁/传输。
   归属状态属 storage（writer lock），宿主只读与解释。
2. **复用什么？** 复用 `Session`、`SessionEvent`、`ApprovalGateway`、`SessionWriterLock`、
   `ConfigStore`、`writeJsonAtomic`、`createAgentRuntime`；不复制参考仓事件词汇或控制协议。
3. **跨越什么契约？** `HostEngine` 端口（tui→host 注入）、`HostRequest/HostFrame` 协议
   （客户端↔服务端）、`ApprovalGateway`（宿主↔core）、writer lock（进程↔进程）。
4. **状态放哪里？** 会话内容在 `~/.budingx/sessions/<id>/`（既有）；锁在 `writer.lock`；
   配置锁在 `config.json.lock`；宿主不持久化自己的会话副本。
5. **谁受影响？** TUI（新增 `serve` 子命令，交互不变）、headless（不变）、未来各端（消费协议）、
   同机多进程用户（并发写安全）、测试（新增 fixture 与真实进程用例）。
6. **如何失败？** 稳定错误码；传输层致命错误关闭连接；归属冲突拒绝写入且不破坏会话；
   审批超时按 deny 结束；配置锁超时失败不覆盖原文件；WS 非回环/无令牌拒绝启动/连接。
7. **如何证明？** 单元 + 真实进程 e2e；三传输同构断言；AST 复核；边界脚本；门禁 RED/GREEN 证据
   记录在 test-report 与 STATUS。

**自审检查清单**

- [x] 每条 AC 都有可执行的单元与功能层验证路径，且测试层与证据类型匹配（不拿 mock 冒充真实进程）。
- [x] 依赖方向符合 architecture.md：core 无 IO、host 不依赖 tui/UI；新增目录纳入边界脚本。
- [x] 不新增第三方依赖；WS 按 RFC6455 自实现，风险与替代方案见 §7。
- [x] 安全默认：仅回环、令牌必需、错误不泄密钥、凭据按 (id,host) 作用域。
- [x] 不实现范围外能力（跨设备同步、事件重放、账号体系、Desktop/VS Code/IM），并在文档声明限制。
- [x] 兼容性：`SessionEvent`、headless 输出、配置/转录/凭据格式不变；仅新增锁文件与协议。
- [x] 与参考仓对照点逐条给出采用/偏离理由（requirements §6）。

## 7. 风险与开放项

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 自实现 WS 帧处理有边界缺陷 | 连接异常/测试不稳 | 只支持文本帧与最小控制帧；帧上限；单元测试覆盖掩码/分片/超限；失败时回 fatal+close |
| Windows 上 SIGTERM 行为与 POSIX 不同 | TB-07 退出码断言不稳 | 测试用 `shutdown` 与 stdin EOF 主路径，SIGTERM 分支按平台记录；不伪造 PASS |
| 真实进程测试依赖时序 | 偶发失败 | 客户端按帧等待、固定超时、每次隔离 home；不使用 sleep 猜状态 |
| 观察者跨进程无实时事件 | 体验限制 | 明确写入文档与 describe；同进程多客户端实时，跨进程恢复历史 |
| 配置锁与用户手工编辑竞争 | 锁超时 | 超时错误码提示重试；不静默覆盖；保存仍原子 |
| AST 复核判定为相似 | 无法交付 | 独立实现（不同结构/命名/组织）；命中按事实处置；必要时重构而非照抄 |

设计修订（实施期，2026-11-22）：SH-03 初稿把所有“无结尾换行”的尾片段都视为在途、不计损坏，
但这与已验收的 SP005 SR-07（半写入损坏行被跳过**并计数**）直接冲突。实施改为按证据区分：仅当同目录存在
活 `writer.lock`（pid 存活）时按在途追加跳过且不计数；没有活写者时仍计 `corruptLines`，保留 SR-07 的
真实截断告警。选择依据：两个 AC 都保留，且不把崩溃截断静默吞掉；代价是读取方需多一次锁文件读取。

设计修订（实施期，2026-11-22）：WS 令牌由初稿的“未提供时随机生成并打印到 stderr”改为“必须由
`--token` 或 `BUDINGX_HOST_TOKEN` 显式提供，缺失即退出码 2”。理由：打印到 stderr 会把凭据留在
终端日志、CI 抓包与测试日志中，违背 SH-04/TB-06 的“传输面不外泄”；TB-05 的认证语义也要求
调用方显式持有令牌。代价是本地试用需先设置环境变量或参数，已在 PRODUCT.md 写明。同步把
§3.6/§3.7 的传输与客户端签名回写为实际导出（`connectStdio`、`startWsHost`、`HostClient` 类），
避免设计与实现名义漂移；其余行为不变。

设计修订（实施期，2026-11-22，T17 测试加固）：补齐七处测试缺口时发现并修复三个实现缺陷——
① `HostEngine.interrupt()` 初版恒返回 true，改为 `session.isBusy` 为 false 时返回 false、
有活动回合才转发打断（§3.3 本就约定 `{ interrupted: boolean }`）；② `connectWebSocket` 的 101
握手与首批帧同 TCP 块到达时，同步 pump 会在调用方 await 后注册监听器之前投递导致丢帧，
改为握手剩余字节 `setTimeout(pump, 0)` 推迟到宏任务；③ `parseServeArgs` 的 `Number('')===0`
会静默接受 `--port ''`，改为空白值显式拒绝（退出码 2）。另把 `test:unit` 的 glob 扩到
`src/host/transport/test/*.test.mjs`，使 WS 帧级测试进入全量回归与门禁。证据：
`sp008-host-engine` 第 5 例、`sp008-interrupt-history`（stdio/WS 真实进程）、`ws-client.test` 10 例、
`sp008-serve-cli` 7 例；详见 test-report §5 R6。

开放项（不阻塞本轮）：事件重放/幂等（范围外）、会话删除/导出策略（SP005 遗留）、
WS 鉴权扩展（令牌轮换/多用户，未来 Gateway）、跨设备同步（未来路线图）。
