# SP008 需求汇总 — 多端架构入口与共享边界

状态：ACTIVE（2026-11-21 开轮；用户 m00001 授权开发，m00133 明确**开发完成后先不合入 master**）

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

边界：
- 不交付 Desktop/VS Code/远程/H5/IM 任何真实端；不做跨设备同步；不实现账号/云端 Gateway。
- 不做断线事件重放/幂等恢复；观察者跨进程只读历史，实时事件仅限同一宿主进程内多客户端。
- 三权限模式不变；不改 provider 协议；不做 npm 制品/发布（SP009）。
- 会话删除/导出新策略与 fork 隔离保持 SP005 遗留状态，本轮不改产品行为。
- 参考仓固定修订 `b5c9be8`（只读，读机制不抄代码）；新增文件全部纳入 AST 复核映射与处置。

## 需求索引

| 目录 | 来源 | 验收目标 | 责任范围 | 阶段 | 文档 | 验证 | 集成状态 | 下一步 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| host-contract §R1 shared-models-and-history（SH-01…SH-05） | 路线图 SP008；能力矩阵「多端共享边界」「会话管理」 | 并发配置更新不丢、陈旧锁恢复、读并发尾行容错、凭据按 (id,host) 作用域且传输不外泄、崩溃后接管不重放 | storage 配置/转录/凭据、host 身份 | 计划完成 | [requirements](host-contract/requirements.md) · [design](host-contract/design/design.zh.md) · [plan](host-contract/design/plan.zh.md) | UNVERIFIED | 未合入 | 实施 T1 |
| host-contract §R2 session-ownership（SO-01…SO-04） | 路线图 SP008；矩阵「活动会话归属/只读观察/接管」 | 单写者 owner、第二连接 observer、submit 拒绝、崩溃 stale 显式 takeover、observer 无管理权 | storage writer lock、host 归属视图、host server 角色 | 需求完成 | 同上 | UNVERIFIED | 未合入 | 设计 |
| host-contract §R3 transport-boundaries（TB-01…TB-08） | 路线图 SP008；CAP-L4-08/09；矩阵「宿主契约」 | 版本化身份、事件一致、权限往返+超时 deny、帧/错误边界、WS 回环+令牌、关闭释放锁、边界声明 | host 协议/传输/服务端、tui serve 入口、边界脚本 | 需求完成 | 同上 | UNVERIFIED | 未合入 | 设计 |

## 验收与交接

- 验收口径：每条 AC 至少各一例单元 + 一例功能（端到端）用例，先 RED 后 GREEN；真实进程、协议、
  存储、UI 证据分层记录；缺环境记 UNVERIFIED 并写恢复条件，不以 mock 冒充真实链路。
- 用户额外要求（m00133）：多轮端到端复跑（stdio/WS 真实进程、并发、崩溃恢复），AST 复核 PASS。
- 门禁：`npm run merge:gate` 用于证明分支可交付；**本轮不合入 master、不推送 master**（m00133）。
- 交接输入（供 SP009/SP014/SP011）：宿主身份/事件/权限契约、`serve` 入口参数、共享更新错误码、
  归属/接管语义与已知限制（无跨进程实时事件、无事件重放）。

## 变更记录

| 日期 | 变更 | 依据 |
| --- | --- | --- |
| 2026-11-21 | 开轮：建立汇总、需求与 STATUS 骨架；从 master a8628b5 建 `feature/SP008/host-contract` | 用户 m00001；路线图 SP008 |
| 2026-11-21 | 记录用户新约束：不合入 master、多轮端到端、AST 检测 | 用户 m00133 |
