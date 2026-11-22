# SP008 需求汇总 — 多端架构入口与共享边界

状态：**已合入 master，0.8.0 已准备待发布**（2026-11-21 开轮；用户 m00001 授权开发，m00133 一度要求不合入 master，m02549 授权推送功能分支，m02815 解除不合入约束并授权合入 master 与发布前准备）。验收证据见 [test-report](test-report.md)。

## 本轮目标与边界

目标（路线图 SP008 行，docs/iteration-plan.md:75）：多端架构入口与共享边界，三个工作流——
shared-models-and-history、session-ownership、transport-boundaries。

出口验收：宿主契约（进程内/stdio/WS）与传输边界以**轻量测试客户端**验证：并发共享配置/历史、
活动会话归属、凭据作用域和崩溃恢复实测；同机共享不冒充跨设备同步；固定通用身份、事件与权限接口，
供 TUI/headless 和调度使用。

用户指令：
- m00001（2026-11-21）：`/buding-sdd 开发SP008的内容` —— 按正式 SDD 开发 SP008 全部内容。
- m00133（2026-11-21）：开发完成后**先别合入 master**；开发后需要**多次端到端检测**确保没问题；
  参考 `D:\my_project\budingWorkerSpace` 的 TUI，功能复刻但**不要复制代码**，注意 AST 检测。
- m01288、m01304（2026-11-22）：**再次全面测试，MCP 和 hooks 自己模拟** —— `serve` 接入扩展装配，
  用自模拟 MCP 服务器与 hook 子进程做真实进程验证，并全面复测；仍不合入 master。
- m01515（2026-11-22）：**继续修复，完成 SP008 全部内容，尤其是 MCP 和 Hooks 的端到端测试** ——
  补齐 MCP/hooks 端到端矩阵；仍不合入 master。
- m01996（2026-11-22）：**继续做，测试并且修复到位** —— 针对验收后勘察出的七处测试缺口
  补齐证据并修复发现的实现缺陷（T17）；仍不合入 master。
- m02815（2026-11-22）：**允许合入 master，做好发布前的工作，我进行发布即可** —— 解除 m00133 的不合入约束；
  授权合入 master、推送 master 与发布前准备（版本 bump、台账、发行说明、dry-run）；实际 npm 发布由维护者手动触发。

边界：
- 不交付 Desktop/VS Code/远程/H5/IM 任何真实端；不做跨设备同步；不实现账号/云端 Gateway。
- 不做断线事件重放/幂等恢复；观察者跨进程只读历史，实时事件仅限同一宿主进程内多客户端。
- 三权限模式不变；不改 provider 协议；不做 npm 制品/发布（SP009）。
- 会话删除/导出新策略与 fork 隔离保持 SP005 遗留状态，本轮不改产品行为。
- 参考仓固定修订 `b5c9be8`（只读，读机制不抄代码）；新增文件全部纳入 AST 复核映射与处置。

## 需求索引

| 目录 | 来源 | 验收目标 | 责任范围 | 阶段 | 文档 | 验证 | 集成状态 | 下一步 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| host-contract §R1 shared-models-and-history（SH-01…SH-05） | 路线图 SP008；能力矩阵「多端共享边界」「会话管理」 | 并发配置更新不丢、陈旧锁恢复、读并发尾行容错、凭据按 (id,host) 作用域且传输不外泄、崩溃后接管不重放 | storage 配置/转录/凭据、host 身份 | 交付完成 | [requirements](host-contract/requirements.md) · [design](host-contract/design/design.zh.md) · [plan](host-contract/design/plan.zh.md) · [test-report](test-report.md) | PASS 5/5 | 已合入 master（`1d1ec9f`，m02815） | 0.8.0 已准备待发布 |
| host-contract §R2 session-ownership（SO-01…SO-04） | 路线图 SP008；矩阵「活动会话归属/只读观察/接管」 | 单写者 owner、第二连接 observer、submit 拒绝、崩溃 stale 显式 takeover、observer 无管理权 | storage writer lock、host 归属视图、host server 角色 | 交付完成 | 同上 | PASS 4/4 | 已合入 master（`1d1ec9f`，m02815） | 0.8.0 已准备待发布 |
| host-contract §R3 transport-boundaries（TB-01…TB-08） | 路线图 SP008；CAP-L4-08/09；矩阵「宿主契约」 | 版本化身份、事件一致、权限往返+超时 deny、帧/错误边界、WS 回环+令牌、关闭释放锁、边界声明 | host 协议/传输/服务端、tui serve 入口、边界脚本 | 交付完成 | 同上 | PASS 7 · PARTIAL 1（TB-07 SIGTERM，Windows 无法投递） | 已合入 master（`1d1ec9f`，m02815） | 0.8.0 已准备待发布 |

## 验收与交接

- 验收口径：每条 AC 至少各一例单元 + 一例功能（端到端）用例，先 RED 后 GREEN；真实进程、协议、
  存储、UI 证据分层记录；缺环境记 UNVERIFIED 并写恢复条件，不以 mock 冒充真实链路。
- 用户额外要求（m00133）：多轮端到端复跑（stdio/WS 真实进程、并发、崩溃恢复），AST 复核 PASS。
- 门禁：`npm run merge:gate` 用于证明分支可交付；合入前门禁 GREEN（合并提交 `1d1ec9f`）。功能分支已按用户 m02549 授权推送 origin（`a4690c4`，远端 SHA 已核对）；master 已按用户 m02815 授权合入。
- 验收结果：定向 113/113、全量 1241 项（1240 通过 / 1 跳过，T17 起含 transport 测试）、交付 3 轮端到端各 20/20 + 扩展复测 3 轮各 23/23 + 最终 HEAD 再 3 轮各 23/23 + 扩展矩阵 3 轮各 11/11 + T17 加固 3 轮各 42/42、模块边界 PASS、AST PASS；TB-07 的 SIGTERM 子项因 Windows 平台限制记 PARTIAL/UNVERIFIED，恢复条件见 test-report §9。
- 扩展复测（m01288/m01304）：`serve` owner 装配 MCP/hooks，自模拟 stdio MCP 服务器与真实 hook 子进程验证审批执行、五事件生命周期、提示词阻断、工具拒绝、hook 放行、observer 不启动扩展、关闭回收子进程（test-report §5 R4）。
- 扩展矩阵（m01515）：MCP/hooks 端到端矩阵 8 例 PASS —— hooks 八事件全覆盖、`updatedInput` 改写入参真实到达 MCP、`additionalContext` 注入模型 system 消息、hook `ask` 回到人工审批、两个 MCP 服务器并存且调用隔离、MCP 工具 `isError` 反映为 `tool_result isError=true`、MCP 服务器崩溃后宿主仍可 ping/shutdown、连接失败只告警不阻断启动（test-report §5 R5）。
- 测试加固（m01996）：七处缺口补齐——WS 服务端帧级 15 例、HostClient 错误分支 8 例、协议校验文案 3 例、serve 参数/退出码 7 例、interrupt/history.limit 真实进程 3 例、ws-client 失败路径 10 例、引擎 interrupt 语义 1 例；修复 interrupt 恒 true、WS 首帧竞争、空端口三处缺陷（test-report §5 R6）。
- 交接输入（供 SP009/SP014/SP011）：宿主身份/事件/权限契约、`serve` 入口参数、共享更新错误码、
  归属/接管语义与已知限制（无跨进程实时事件、无事件重放）。
- 合入与发布前准备（m02815）：合入 master（`1d1ec9f`，3 处冲突按用户决策解决，含删除误入仓库的 Windows 缓存二进制并加 `.gitignore`）；合入后全量 1243/1242 通过；按 minor 准备 0.8.0（台账 prepared、发行说明 `release-notes/v0.8.0.md`、入口文档版本同步）；dry-run GREEN（`artifacts/release/0.8.0-1795335507762/report.json`，制品 181 文件含 `dist/host/**` 与 `dist/tui/serve.js`）；master 门禁 GREEN（`artifacts/merge-gate/master-2026-11-22T08-21-33-109Z.md`）。dry-run 期间修复基线遗留错误链接（`docs/current-status.md` 指向 SP007 验收报告的 slug 路径 → 轮次根目录路径），skills integrity 5/5 通过。

## 变更记录

| 日期 | 变更 | 依据 |
| --- | --- | --- |
| 2026-11-21 | 开轮：建立汇总、需求与 STATUS 骨架；从 master a8628b5 建 `feature/SP008/host-contract` | 用户 m00001；路线图 SP008 |
| 2026-11-21 | 记录用户新约束：不合入 master、多轮端到端、AST 检测 | 用户 m00133 |
| 2026-11-22 | 完成 T1–T14：共享数据、归属、三传输、serve、测试与文档；功能分支交付完成，未合入 master | 用户 m00001/m00133 |
| 2026-11-22 | T15 复测：`serve` 装配 MCP/hooks（`2b1b003`），新增自模拟 MCP 服务器与 3 例端到端；定向 58/58、全量 1180、3 轮 × 23 全通过；移除「serve 未接 MCP/hooks」限制 | 用户 m01288/m01304 |
| 2026-11-22 | T16 扩展矩阵：新增 `sp008-serve-extensions-matrix` 8 例（`9f7f00b`）；定向 66/66、全量 1188、扩展 3 轮 × 11 全通过、门禁 GREEN | 用户 m01515 |
| 2026-11-22 | T17 测试加固：七处缺口补齐 + 三处实现修复（`c47e224`）；定向 113/113、全量 1241/1240、3 轮 × 42 全通过；test:unit 纳入 transport 测试 | 用户 m01996 |
| 2026-11-22 | 最终复跑暴露崩溃接管 pid 判活竞态，测试侧 waitForPidDead 修复（`b876552`）；修复后 3 轮 × 42 全通过 | 用户 m01996 |
| 2026-11-22 | 功能分支推送 origin（`a4690c4`，26 commits / 67 files，远端 SHA 核对一致）；master 未合入未改动 | 用户 m02549 |
| 2026-11-22 | 合入 master（`1d1ec9f`，--no-ff，3 处冲突按用户决策解决：删除误入仓库的 Windows 缓存二进制并加 `.gitignore`、host-engine 取功能分支版本、PRODUCT.md 手工合并）；合入后全量 1243/1242 通过 | 用户 m02815 |
| 2026-11-22 | 发布前准备：minor → 0.8.0（`src/tui/package.json`）、台账 prepared、发行说明 `release-notes/v0.8.0.md`、入口文档版本同步；dry-run GREEN；master 门禁 GREEN；实际 npm 发布待维护者触发 | 用户 m02815 |
| 2026-11-22 | 推送 master（9ca499b → 93adeb2），远端 SHA 与本地一致 | 用户 m02815 |
