# SP008 host-contract 需求 — 多端架构入口与共享边界

- 迭代：SP008（路线图 r8：多端架构入口与共享边界）
- 工作目录：`SP/SP008/host-contract/`
- 路线图条目：[docs/iteration-plan.md](../../../docs/iteration-plan.md) SP008 行（shared-models-and-history、session-ownership、transport-boundaries）
- 能力锚点：CAP-L4-08（本地 API/WS 服务，必交，SP008，真实进程）、CAP-L4-09（stdio 宿主，必交，SP008，真实进程）；CAP-L4-20 制品属 SP009
- 基线：master `a8628b5`（SP007 合并与发布准备完成后），产品版本 0.7.0（prepared）
- 状态：需求已建立，等待设计与自审

## 1. 来源与用户指令

| 来源 | 内容 | 状态 |
| --- | --- | --- |
| 路线图 SP008 行（docs/iteration-plan.md:75） | 宿主契约（进程内/stdio/WS）与传输边界以轻量测试客户端验证：并发共享配置/历史、活动会话归属、凭据作用域和崩溃恢复实测；同机共享不冒充跨设备同步；固定通用身份、事件与权限接口，供 TUI/headless 和调度使用 | USER_CONFIRMED |
| 路线图说明（docs/iteration-plan.md:86） | SP008 自 SP001/005 承接共享数据约束，以契约和轻量测试客户端验证宿主入口；SP002–SP007 保持宿主无关和可取消 | USER_CONFIRMED |
| AGENTS.md 工作边界 | 「SP008 保留通用宿主契约」；Desktop、VS Code、远程/H5、IM 均为范围外（r8 只交付 TUI） | USER_CONFIRMED |
| 能力清单 CAP-L4-08/09 | 本地 API/WS 服务与 stdio 宿主为必交能力，证据层=真实进程；当前轮以轻量测试客户端验证契约，不交付真实其他端 | USER_CONFIRMED |
| 能力矩阵「多端共享边界（架构入口）」「会话管理」 | 区分同机共享与未来跨设备同步；并发开关不丢配置历史；活动会话所有权与只读观察/接管策略；凭据按作用域与安全存储处理，不能只把明文 key 放共享 JSON；不交付真实其他端；SP005 遗留：多项目并发共享、删除/导出策略、fork 会话隔离 | USER_CONFIRMED |
| 用户 m00133（2026-11-21） | 开发完成后先别合入 master；开发后需要多次端到端检测确保没问题；参考 `D:\my_project\budingWorkerSpace` 的 TUI 功能复刻但不要复制代码；注意 AST 检测 | USER_CONFIRMED |

## 2. 目标与非目标

### 目标

1. 固定**通用宿主契约**：版本化身份、会话事件、权限请求/响应、请求/响应与错误码；同一条契约供进程内、stdio、WebSocket 三种传输复用，TUI 与 headless 共用同一会话编排（`createAgentRuntime`）。
2. 提供**轻量测试客户端**与 `budingx serve` 入口（stdio/WS），以真实子进程证明宿主入口可用、可关闭、可恢复。
3. **共享模型/历史/配置**：同机多进程并发读写 `~/.budingx` 时不丢更新、不交叉覆盖；凭据按 `(id, host)` 作用域绑定，宿主传输面不外泄明文。
4. **活动会话归属**：同一会话同时只有一个写者（沿用 SP005 writer lock）；第二连接只读观察；崩溃后可显式接管；接管/观察不重放副作用。
5. **边界声明**：`identity.scope = 'local'`；WS 默认仅绑定回环地址并要求令牌；同机共享不称跨设备同步。

### 非目标（本轮明确不做）

- 不交付 Desktop/VS Code/远程/H5/IM 任一真实客户端；不实现跨设备同步、账号体系、云端中继、Team/Gateway 服务。
- 不实现断线后的事件重放/幂等恢复（参考仓 Gateway 的完整能力属范围外示例）；只保证断线不破坏会话与不越权。
- 不改三权限模式；不新增工具；不改 provider 协议；不实现子代理/团队/调度。
- 不做 npm 制品与发布工程（SP009）；不触发真实 npm 发布。
- 不实现会话删除/导出策略（SP005 遗留，需要产品决策，本轮只保持既有 `/export` 行为不变）。
- **不合入 master**（用户 m00133 覆盖默认委托）。

## 3. 当前状态（基线事实，已核对源码）

| 事实 | 位置 | 对 SP008 的影响 |
| --- | --- | --- |
| `SessionEvent` 联合已与 UI 无关、可 JSON 序列化，含审批/权限/终态事件 | `src/core/events.ts:176-330` | 宿主事件直接转发，不新增第二套事件协议 |
| `Session` 提供 `on/submit/interrupt/dispose/adoptIdentity/restoreHistory` 与 `currentState` | `src/core/session.ts` | 引擎端口只需薄适配，不改 Core |
| `createAgentRuntime` 装配 provider/policy/tools/persistence/诊断 | `src/tui/runtime.ts` | TUI 与 `serve` 共用；宿主层不得 import tui |
| headless 已有 `runHeadless`、`HeadlessEvent`（SP006 §11） | `src/tui/headless.ts` | 宿主协议不替代 headless CLI；两者都消费 Core 事件 |
| writer lock 用 O_EXCL + pid 判活，陈旧锁必须 force 才接管 | `src/storage/session-store.ts:109-210` | 会话归属的基础；本轮补「角色视图 + 观察者 + 接管 API」 |
| `SessionStore.list()` 扫描目录重建，无共享索引文件 | `src/storage/session-store.ts:246-262` | 并发新增会话不会互相覆盖索引；共享历史风险集中在 transcript 尾行 |
| `ConfigStore.load()` 读 + `save()` 原子写，无跨进程锁 | `src/storage/config-store.ts:67-115` | 并发 load-modify-save 会丢更新，需要共享更新入口 |
| 凭据按 `(id, host)` 双键，host 不匹配返回 undefined | `src/storage/credentials.ts` | 凭据作用域已有基础；宿主需只暴露引用与绑定状态 |
| `appendPrivateLine` 单行追加；`TranscriptRead.corruptLines` 统计坏行 | `src/storage/private-file.ts`、`src/core/transcript.ts` | 读取与追加并发时尾部半行不应被算作损坏 |
| 模块边界脚本只覆盖既有 8 个目录，校验 tui 依赖白名单 | `scripts/checks/module-boundaries.mjs` | 新增 `src/host` 需加规则（禁 host→tui，禁 UI 依赖） |
| AST 复核脚本已可用，阈值 30/60/0.80/0.45，改动文件必须全映射 | `scripts/review/sp004-ast.mjs` | 本轮新增文件必须登记映射与处置 |
| 当前不存在 `src/host` 或任何宿主/传输实现 | 仓库实际 | 拟新增模块，不虚构为现状 |

## 4. 责任划分（拟）

| 责任 | 归属 | 说明 |
| --- | --- | --- |
| 会话编排、事件、权限决策 | `src/core`（已有） | 不改事件语义；宿主只是消费者 |
| 共享数据（配置/会话/凭据） | `src/storage`（已有，本轮扩展） | 配置共享更新、transcript 尾行容错、凭据作用域断言 |
| 传输、身份、请求/响应与错误码 | `src/host`（拟新增） | 不依赖 tui；不 import UI；不实现业务 |
| 宿主装配（引擎端口实现、`serve` 入口） | `src/tui/host-engine.ts` + `src/tui/cli.ts`（拟新增/修改） | 复用 `createAgentRuntime`；未来其他宿主自行实现同一端口 |
| 轻量测试客户端 | `src/host/client.ts`（拟新增） | 供测试与未来端复用；不代表已交付真实其他端 |

## 5. 验收条件

约定：每条 AC 至少一例单元用例 + 一例功能（端到端）用例，先 RED 后 GREEN；真实进程/协议/存储证据分层记录。错误码为稳定机读字符串。

### R1 shared-models-and-history（SH）

| ID | 验收条件（Given/When/Then） | 测试层 |
| --- | --- | --- |
| SH-01 | Given 同一 `~/.budingx/config.json`，When 两个独立进程并发更新不同字段（各自改写 `defaultModelId` 与新增 model，或同时新增不同 model），Then 两次更新都保留，文件始终是合法 JSON，退出码 0；不得出现后写覆盖先写的丢更新 | 单元（锁原语）+ 功能（两个真实子进程） |
| SH-02 | Given 配置更新进行中或持锁进程已被杀死，When 另一个进程尝试更新，Then 活锁进程存在时等待/超时给出稳定错误码 `BUDINGX_STORAGE_006` 且不覆盖原文件；陈旧锁（pid 已死）自动清理后完成更新；失败路径不产生半写文件 | 单元 + 功能（真实进程 kill） |
| SH-03 | Given 会话正被持有 `writer.lock` 的活 owner 追加记录，When 另一进程只读恢复该会话，Then 已落盘完整记录全部可见，正在写的尾部半行被跳过且不计入 `corruptLines`，原文件字节不被修改；没有活写者时残缺尾行仍按 SP005 SR-07 计为损坏 | 单元 + 功能（并发子进程） |
| SH-04 | Given 共享配置与凭据，When 任意宿主传输（进程内/stdio/WS）返回身份、事件或错误，Then 消息中不含 `apiKey` 明文、`credentials.json` 内容或 key 片段；凭据仅在 `(id, host)` 匹配时可取，host 变化返回 undefined | 单元 + 功能（三种传输抓包断言） |
| SH-05 | Given owner 进程崩溃（SIGKILL）留下锁与完整 transcript，When 新进程显式接管并读取历史，Then 历史完整、工具步骤不重放、需复核步骤被标出；接管前只读读取同样不重放 | 功能（真实进程崩溃） |

### R2 session-ownership（SO）

| ID | 验收条件 | 测试层 |
| --- | --- | --- |
| SO-01 | Given 同一会话无锁，When 两个宿主先后声明所有权，Then 第一个成为 `owner`，第二个得到 `observer`（原因含活锁 pid），observer 的 submit 被拒（`HOST_SESSION_003`）且会话不产生回合/不写 transcript | 单元 + 功能（两进程） |
| SO-02 | Given 一个 owner 宿主服务，When 第二个客户端连接同一服务，Then 该客户端是 observer：能收到会话事件与只读描述，不能 submit/interrupt/改权限；断开 observer 不影响 owner 与会话 | 功能（同进程多客户端 + WS 两连接） |
| SO-03 | Given stale 锁（owner 已崩溃），When 新宿主 `takeover`，Then 新宿主成为 owner 并获得写入权；若原 owner 仍存活，takeover 被拒绝（`HOST_SESSION_003`）且原锁不被删除；接管成功后旧连接若仍在则降级为 observer | 单元 + 功能（真实进程） |
| SO-04 | Given observer 角色，When 提交审批响应、切换权限模式、或调用 shutdown 之外的管理请求，Then 全部以稳定错误码拒绝、会话状态与权限模式不变；owner 执行同样请求成功 | 单元 + 功能 |

### R3 transport-boundaries（TB）

| ID | 验收条件 | 测试层 |
| --- | --- | --- |
| TB-01 | Given 进程内/stdio/WS 三种传输，When 客户端发送 `hello`，Then 收到相同结构的 `hello_ok`：`protocolVersion=1`、`sessionId`、`workspaceId`、`clientId`、`role`、`scope='local'`；协议版本不匹配返回 `HOST_PROTOCOL_001` 并关闭连接 | 单元（协议编解码）+ 功能（三传输各一） |
| TB-02 | Given 一次真实对话回合，When 通过任一传输订阅，Then 事件流与直接订阅 Session 的形状一致且 JSON 往返无损，顺序满足 `turn_started → text_delta* → turn_finalized`；每个请求有且仅有一个响应 | 功能（stdio/WS 真实进程 + fake provider） |
| TB-03 | Given 会话需要审批，When 客户端回 `approval` allow/deny，Then Core 收到对应结果并产生 `approval_resolved`；客户端不回或连接断开时，在配置超时（默认 120s，测试可缩短）后按 deny 处理并记录 notice，不永久挂起 | 单元（审批桥）+ 功能 |
| TB-04 | Given 畸形 JSON、超过 1 MiB 的帧、未知 `type`、缺字段、重复请求 id，When 服务器处理，Then 返回稳定错误码（`HOST_PROTOCOL_002/_005` 等），连接不崩溃，后续合法帧仍被处理；错误响应带请求 id | 单元 + 功能 |
| TB-05 | Given WS 宿主，When 未带令牌、带错误令牌、带正确令牌连接，Then 分别 401 拒绝 / 401 拒绝 / 成功升级；默认绑定 `127.0.0.1`，显式请求非回环绑定被拒绝（`HOST_AUTH_004`） | 功能（真实 HTTP/WS + 真实进程） |
| TB-06 | Given 任一传输的错误与身份响应，When 抓取全部字节，Then 不含明文密钥/凭据路径内容（与 SH-04 同一断言源，覆盖错误分支） | 单元 + 功能 |
| TB-07 | Given stdio 宿主与 WS 宿主，When stdin EOF / 客户端断开 / `shutdown` 请求 / 进程收到 SIGTERM，Then 释放 writer lock、关闭监听、无未处理 rejection，stdio 正常退出码 0；WS 客户端断开不中断正在进行的回合（默认策略） | 功能（真实进程） |
| TB-08 | Given 宿主身份与文档，When 检查 `scope` 与监听地址，Then 身份标 `local`，README/PRODUCT/认证说明明确「同机共享≠跨设备同步」，无公网监听默认值；`src/host` 不 import `src/tui`（边界脚本强制） | 单元（边界脚本）+ 文档检查 |

## 6. 参考实现对照点（budingWorkerSpace，读机制不抄代码）

| 参考事实（只读核对） | 本轮采用 | 偏离与理由 |
| --- | --- | --- |
| 服务端 WS 事件族：`connected`、`runtime_snapshot`、`content_start/delta`、`tool_use_complete`、`tool_result`、`permission_request⇄permission_response`、`status`、`permission_mode_changed`、`error`、`pong`（`src/server/ws/events.ts`） | 直接转发 Core `SessionEvent` + 最小宿主信封（`hello_ok`/`response`/`fatal`/`pong`） | 不新增第二套事件词汇；Core 已有事件即协议事实，减少翻译层与不一致风险 |
| JSON 行分帧：WS `data.split('\n')`、stdio 行协议；`control_request`/`control_response` 请求-响应（`src/server/directConnectManager.ts`、`src/cli/transports/WebSocketTransport.ts`） | 统一 NDJSON 分帧 + `{id,type}` 请求与 `{id,ok,result|error}` 响应；WS 单帧也容忍多行 | 统一分帧让三种传输共用同一编解码器与测试客户端 |
| 权限以 `can_use_tool` 控制请求往返，允许/拒绝带 updatedInput/deny message | 复用 Core 的 `approval_requested`/`approval_resolved` 与 `ApprovalGateway`；宿主只做转发与超时 | Core 已拥有审批语义，宿主不另造权限模型 |
| 服务端 `directConnectManager`/会话服务区分所有者连接与远程会话，带 Bearer 令牌 | writer lock 作为写者真相，WS 仅本机回环 + 令牌 | 不引入账号/云端概念；同机多进程共享同一数据根 |
| 无头 CLI `--input-format stream-json`/事件输出（`src/cli/print.ts`） | 保留既有 headless；宿主协议独立版本化，不改变 headless 输出 | 两者共用 Core 事件但协议不同，避免破坏 SP006 已验收契约 |
| 崩溃后锁/会话恢复 | 沿用 SP005「陈旧锁显式 force」+ 本轮 takeover 视图 | 不静默抢锁；崩溃恢复必须显式且可审计 |

## 7. 开放问题与决定

| 问题 | 决定 | 依据 |
| --- | --- | --- |
| 进程模型：常驻服务还是各端自带实例？ | 各端自带运行时；`serve` 是可选宿主入口，TUI 不依赖它 | docs/architecture.md:17；用户确认 r8 TUI 单端 |
| WS 是否对外监听？ | 默认 `127.0.0.1`，非回环绑定直接拒绝；令牌必需 | 「同机共享不冒充跨设备同步」；安全默认 |
| 是否需要事件重放/幂等恢复？ | 本轮不做；断线只保证不破坏会话、不越权 | 参考 Gateway 属范围外；避免半成品恢复语义 |
| 观察者跨进程能否看到实时事件？ | 不能；跨进程只读 = 恢复持久化历史。实时事件仅限同一宿主进程内多客户端 | 不在本机进程间建额外 IPC；如实记录限制 |
| 配置并发更新入口 | 新增 `ConfigStore.update(mutate)`：锁文件 + 重读 + 变更 + 原子写 + 释放；超时错误码 `BUDINGX_STORAGE_006` | 现状无锁必丢更新（SH-01 先红） |
| `src/host` 依赖方向 | host 只依赖 core（类型）与 node 内建；**禁止 import tui**；tui 实现引擎端口并装配 | 防止反向依赖宿主 UI；边界脚本强制 |

## 8. 排除清单

- 跨设备/云同步、认证服务器、账号与组织、配额计费。
- 事件重放、断点续传、请求幂等缓存、多写者 CRDT。
- Desktop/VS Code/Web/移动端 UI、IM 接入。
- 会话删除/导出新策略、fork 会话隔离（SP005 遗留，需单独决策）。
- 真实 npm 发布与 tag。
