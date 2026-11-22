# STATUS — host-contract（SP008）

## 1. 当前有效范围

- 需求：`SP/SP008/host-contract/requirements.md`（R1/R2/R3，SH-01…SH-05、SO-01…SO-04、TB-01…TB-08）
- 设计：`design/design.zh.md`（v1.1，已自审；含令牌策略与传输 API 实施修订）
- 计划：`design/plan.zh.md`（T1…T14，含 RED/GREEN 与命令）
- 验收：`../test-report.md`（23 个新增测试文件 + 共享 helper/自模拟 MCP 服务器；AC 逐条证据）
- 基线：master `a8628b5`；功能分支 `feature/SP008/host-contract`；产品版本 0.8.0（prepared，待发布）
- 授权范围：设计、计划、实施、测试、交付记录、本地提交（中文说明）；
  **不含**打标签、npm 发布（由用户在 GitHub 手动触发）、远端设置、分支删除。
  用户 m02815（2026-11-22）解除 m00133 的「不合入 master」约束，授权合入 master、推送 master 与发布前准备。

## 2. 阶段清单

- [x] 需求：SP008 汇总、需求正文、STATUS 骨架
- [x] 设计：design/design.zh.md + 自审记录（§6/§8）
- [x] 计划：design/plan.zh.md（T1…T14）
- [x] 实施：T1–T10（共享数据、会话归属、协议/服务端、进程内/stdio/WS、引擎适配）
- [x] 测试收口：T11 定向 55/55 PASS；T15 复测后定向 58/58 PASS；T16 扩展矩阵后定向 66/66 PASS；T17 加固后定向 113/113 PASS；全量 1241 项 / 1240 通过 / 1 跳过 / 0 失败（T17 起含 transport 测试）
- [x] 多轮端到端：交付 3 轮 × 20 例 + 复测 3 轮 × 23 例 + 最终 HEAD 再 3 轮 × 23 例 + 扩展矩阵 3 轮 × 11 例 + 定向全量 3 轮 × 66 例 + 最终 HEAD 扩展 3 轮 × 11 例 + T17 加固 3 轮 × 42 例，全部 PASS（日志 `artifacts/quality-runs/SP008/host-contract/`）
- [x] 扩展复测（T15，用户 m01288/m01304）：`serve` 装配 MCP/hooks，自模拟 MCP 服务器与 hook 子进程，3 例真实进程端到端 PASS
- [x] 扩展矩阵（T16，用户 m01515）：MCP/hooks 端到端矩阵 8 例 PASS（八事件、updatedInput、additionalContext、ask、多服务器、isError、崩溃、连接失败）；扩展 3 轮 × 11/11 PASS
- [x] 测试加固（T17，用户 m01996）：补齐七处缺口（WS 服务端帧级 15 例、HostClient 错误分支 8 例、协议文案 3 例、serve 参数/退出码 7 例、interrupt/history.limit e2e 3 例、ws-client 失败路径 10 例、引擎 interrupt 语义 1 例）；修复 interrupt 恒 true、WS 客户端首帧竞争、空端口静默接受三处缺陷；test:unit 纳入 transport 测试
- [x] AST 复核：17/17 文件映射，命中 0，PASS
- [x] 交叉验证门禁：`npm run merge:gate` → **GATE GREEN**（交付 HEAD `4a638e9`；T15 复测后 HEAD `abbdcb1` 再次 GREEN，13 commits / 49 files；T16 扩展矩阵后 HEAD `9f7f00b` 再次 GREEN，15 commits / 50 files；T17 加固后 HEAD `c47e224` 再次 GREEN，四项检查全通过；竞态修复与收口后最终 HEAD `60d1688` 再次 GREEN，25 commits / 56 files）
- [x] 交付记录：test-report、PRODUCT.md §5.9、docs/development.md、汇总索引
- [x] 合入 master：已完成（用户 m02815 授权，2026-11-22，合并提交 `1d1ec9f`）；合入后全量 1243 项 / 1242 通过 / 0 失败 / 1 跳过
- [x] 发布前准备：0.8.0（minor，台账 prepared）、`release-notes/v0.8.0.md`、入口文档版本同步、dry-run GREEN（`artifacts/release/0.8.0-1795335507762/report.json`）、master 门禁 GREEN（`artifacts/merge-gate/master-2026-11-22T08-26-17-077Z.md`）
- [x] 推送 master：已推送并核对远端 SHA（`93adeb2`）
- [ ] npm 发布：待维护者在 GitHub 手动触发发布工作流（不在本轮授权内）

当前停点：SP008 已合入 master（`1d1ec9f`）并完成 0.8.0 发布前准备（版本 bump、发行说明、台账 prepared）；实际 npm 发布由维护者手动触发发布工作流。

## 3. 批准与来源

| 事项 | 来源 | 范围 |
| --- | --- | --- |
| SP008 开发 | 用户 m00001（2026-11-21） | 本轮全部内容，按 buding-sdd |
| 不合入 master | 用户 m00133（2026-11-21） | 覆盖 AGENTS.md 默认「门禁 GREEN 后合入并推送」委托 |
| 多轮端到端 + AST 检测 | 用户 m00133（2026-11-21） | 交付前必须完成 |
| 再次全面测试，MCP/hooks 自己模拟 | 用户 m01288、m01304（2026-11-22） | serve 接入扩展并全面复测，仍不合入 master |
| 完成 SP008 全部内容，尤其 MCP/hooks 端到端 | 用户 m01515（2026-11-22） | 补齐 MCP/hooks 端到端矩阵（T16），仍不合入 master |
| 继续做，测试并且修复到位 | 用户 m01996（2026-11-22） | 补齐七处测试缺口并修复发现的缺陷（T17），仍不合入 master |
| 参考实现对照 | AGENTS.md 工作边界；用户 m00133 | `D:\my_project\budingWorkerSpace` @ b5c9be8，只读，不抄代码 |
| 合入 master 与发布前准备 | 用户 m02815（2026-11-22） | 解除 m00133 的不合入约束；授权合入 master、推送 master、版本 bump、发行说明与 dry-run；npm 发布仍由维护者手动触发 |

## 4. AC 与验证

| AC | 结果 | 证据 |
| --- | --- | --- |
| SH-01 | PASS | `config-store-lock` 单元 + `sp008-config-concurrency` 两进程并发 |
| SH-02 | PASS | 活锁超时 `BUDINGX_STORAGE_006`、陈旧锁清理、SIGKILL 后继续 |
| SH-03 | PASS | `session-transcript-tail` 单元 + `sp008-shared-history` 并发只读 |
| SH-04 | PASS | `credentials` 主机作用域 + 三传输字节扫描不含密钥 |
| SH-05 | PASS | `sp008-crash-recovery`：历史完整、needs_review、不重放、哈希不变 |
| SO-01 | PASS | `ownership` 单元 + `sp008-ownership` 两进程 owner/observer |
| SO-02 | PASS | `server` 单元 + 双 WS 事件与 observer 断开隔离 |
| SO-03 | PASS | 活 owner 拒绝 takeover；SIGKILL 后 `--takeover` 成功；旧连接降级 |
| SO-04 | PASS | observer 写/管理请求全拒；owner 同类请求成功 |
| TB-01 | PASS | 三传输 hello 字段一致；版本不匹配 001 后断开 |
| TB-02 | PASS | 事件 JSON 往返 deepEqual；双 WS 同序事件；回合 completed |
| TB-03 | PASS | WS 审批 allow 往返；单元覆盖 20ms 超时 deny |
| TB-04 | PASS | 畸形/未知/重复/超限帧后连接仍可用；WS 超限先 fatal 再断开 |
| TB-05 | PASS | 401/401/成功；非回环启动前拒绝（`HOST_AUTH_004`，退出码 2） |
| TB-06 | PASS | 三传输入站帧与 stderr 不含 key/令牌/凭据路径 |
| TB-07 | PARTIAL | EOF/shutdown/客户端断开均 PASS；**SIGTERM 在 Windows 无法优雅投递，UNVERIFIED**（恢复条件见 test-report §9） |
| TB-08 | PASS | 边界脚本禁 host→tui/UI；PRODUCT §5.9 写明 scope=local、仅回环、同机≠跨设备 |

扩展矩阵（T16，非新增 AC）：`sp008-serve-extensions-matrix` 8 例 PASS —— hooks 八事件全覆盖（含 Notification/Stop、无 StopFailure）、`updatedInput` 改写入参真实到达 MCP、`additionalContext` 注入模型 system 消息、hook `ask` 仍回到人工审批、两个 MCP 服务器并存且调用隔离、MCP 工具 `isError` 反映为 `tool_result isError=true`、MCP 服务器崩溃后宿主仍可 ping/shutdown、连接失败只写 stderr 告警不阻断启动。

测试加固（T17，非新增 AC）：七处缺口全部补齐并 GREEN——WS 服务端帧级分支（426/401/400/分片/binary/opcode/掩码/超限/ping-pong/close）、HostClient 五个错误分支、协议 11 条校验文案精确断言、serve 参数与退出码（--help/未知/越界/非法 session/损坏配置）、owner 打断活动回合（stdio/WS，cancelled 收尾、空闲 false）、history.limit 截断语义（0/1/超量/非法）、ws-client 连接失败路径（403/accept/超时/头过大/非法 URL）。修复三处实现缺陷：interrupt 空闲返回 false、connectWebSocket 首帧推迟到宏任务、--port 空白值显式拒绝。详见 test-report §5 R6。

扩展复测（T15，非新增 AC）：`sp008-serve-extensions` 3 例 PASS —— MCP 工具经审批真实执行、hooks 五事件生命周期、提示词阻断（模型 0 调用）、PreToolUse deny 不执行工具、hook allow 跳过审批、observer 不启动扩展、shutdown 回收 MCP 子进程；加强 TB-03/TB-07 与 SO-02 的功能证据。

## 5. 提交与集成

- 设计/需求/计划：`1c5102e`
- T1–T3：`9e64cd0`（配置锁、transcript 尾行、写锁检视）
- T4–T6：`83d0135`（协议、归属、宿主服务端）
- T7：`eb039b0`（进程内传输）
- T8：`c31237d`（stdio 与 `serve`）
- T9：`157a554`（引擎适配/审批桥）
- T10：`1216475`（WebSocket/客户端）
- T11：`ee9cbc2`（归属/崩溃恢复/三传输端到端）
- T12/T13：`943591f`（host 边界、AST 映射）
- T14：`4a638e9`（文档与验收报告；其后追加最终 HEAD 复跑记录 `10008e9`）
- T15：`2b1b003`（serve 装配 MCP/hooks + 自模拟扩展端到端复测）
- T16：`9f7f00b`（MCP/hooks 端到端矩阵 8 例 + 扩展夹具增强）；其后文档收口 `562722b`、最终复跑记录 `cb07bc8`、收尾门禁回执 `95d7e3e`
- T17：`c47e224`（测试加固 43 新例 + 三处实现修复 + test:unit 纳入 transport）；`b876552`（崩溃接管 pid 判活竞态的测试侧修复）；文档收口 `27b5eae` 及本轮提交
- 合并 master：**已执行**（用户 m02815，2026-11-22）：`git merge --no-ff feature/SP008/host-contract`，合并提交 `1d1ec9f`；冲突 3 处按用户决策解决（缓存二进制删除并加入 `.gitignore`，host-engine 取功能分支版本，PRODUCT.md 手工合并保留 0.7.0 已发布事实）
- 推送 master：**已执行**（用户 m02815，2026-11-22）：`git push origin master`（9ca499b → 93adeb2）；`git ls-remote origin master` 核对 `93adeb2206d7a7808f25adfaec08e60fe33e55f2` 与本地一致
- 推送功能分支：**已执行**（用户 m02549，2026-11-22）：`git push -u origin feature/SP008/host-contract`，远端新建分支；`git ls-remote` 核对 `a4690c485139270ac410b4ce34cbdd824bfe162e` 与本地 HEAD 一致（26 commits / 67 files，master..HEAD）。远端 master 仍为 `56a161c`，未改动
- 发布：**未执行**，不 bump 版本