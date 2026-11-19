---
name: buding-langfuse
description: Use when deploying, starting, stopping, restarting, or accessing the local Langfuse observability stack on any host (Windows/WSL2, Docker Desktop, Linux, macOS), or querying it to test/debug budingx Agent turns, model calls, tool execution, and errors; or when wiring tracing into the TUI/e2e config. Not for general unit tests or non-observability work.
---

# budingx-next 本机 Langfuse 观测与测试定位

用本机自建 Langfuse 观察 Agent 回合（`agent.run` → `model.request` / `tool.<name>`），帮助测试与定位模型/工具/权限问题。设计依据 [SP004 agent-observability](../../SP/SP004/agent-observability/design/design.zh.md)，部署细节 [ops/langfuse/README.md](../../ops/langfuse/README.md)。追踪**默认关闭**、正文**显式 opt-in**；凭据只存本机，不提交、不外发、不读取其他客户端配置。

## 关键路径

| 项 | 位置 |
| --- | --- |
| 部署资产 | `ops/langfuse/compose.yaml`、`ops/langfuse/README.md` |
| 初始化/启停/验收脚本 | `scripts/langfuse/init-local.mjs`、`control.ps1`、`verify-agent.mjs` |
| 本机凭据（Git 忽略） | `.runtime/langfuse/local.env`、`agent.env`、`login.json` |
| 追踪实现 | `src/observability/`、Core 端口 `src/core/observability.ts`、宿主装配 `setupTracing`（`src/tui/runtime.ts`） |
| e2e 配置 | `.env.e2e.local`（含 Langfuse 登录与追踪变量）；模板 `scripts/testing/e2e.env.example` |

## 部署 / 启动 / 关闭 / 状态（跨宿主）

**动作语义**（`control.ps1 -Action <start|stop|status|logs>`，或等价 docker compose）：

| 动作 | 效果 | 数据 |
| --- | --- | --- |
| `start` | 先 `init-local.mjs`（幂等）再 `up -d` | 保留卷与凭据 |
| `stop` | 仅停容器 | **保留卷与凭据**，可再 start |
| `status` | `ps` 查看容器状态 | — |
| `logs` | tail web/worker 日志 | — |
| `down`（手动） | 停并删容器/网络 | 保留卷 |
| `down -v`（手动，**慎用**） | 连卷一起删 | **销毁数据**，仅限自己的全新/可弃实例 |

**首选 `control.ps1`**：自动识别宿主——有 `docker` CLI（Docker Desktop / 原生 Docker）直接用；无则走 WSL 并**自动管理保活进程**（`wsl-keeper.json`）。Windows 两种宿主都适用；Linux/macOS 若装了 `pwsh` 且有 docker 也可用。

```powershell
powershell -NoProfile -File scripts/langfuse/control.ps1 -Action start    # 启动
powershell -NoProfile -File scripts/langfuse/control.ps1 -Action status   # 状态
powershell -NoProfile -File scripts/langfuse/control.ps1 -Action stop     # 关闭（保留数据）
powershell -NoProfile -File scripts/langfuse/control.ps1 -Action logs     # 日志
```

**Linux / macOS / 无 PowerShell 的 bash 等价**（原生 Docker，localhost 直接可达，无需保活/override）：

```bash
node scripts/langfuse/init-local.mjs
C="docker compose -p budingx-langfuse --env-file .runtime/langfuse/local.env -f ops/langfuse/compose.yaml"
$C up -d        # 启动
$C ps           # 状态
$C stop         # 关闭（保留数据）
$C logs --tail 100 langfuse-web langfuse-worker
```

**新宿主首次**：`init-local.mjs` 生成**该宿主自己的**凭据（不复用他机）；首次需拉镜像（可在 `local.env` 设 `DOCKER_REGISTRY=mirror.gcr.io` 走镜像源）并跑数据库迁移，较慢；就绪前勿判失败。**重启已有实例**直接 `start`（不覆盖凭据）。

**项目名隔离**：本机若已有其他仓库的 `budingx-langfuse` 实例，用 `-Project budingx-next-langfuse`（bash 改 `-p`）避免接管其容器/卷。**不要停止或删除其他项目的容器与卷。**

**端口冲突**：默认 3000/9090 被占时，在 `local.env` 设 `LANGFUSE_WEB_PORT`/`LANGFUSE_MINIO_PORT` 并同步 `NEXTAUTH_URL`、`agent.env` 的 `LANGFUSE_BASE_URL`；不终止他人服务。

**关闭并确认**：`stop` 后 `status` 应无运行中容器；数据卷仍在（`docker volume ls | grep langfuse`）。要彻底清理自己的实例才用 `down`/`down -v`。

### Windows + WSL2 从宿主访问（关键坑）

- WSL2 NAT 模式下 Windows `localhost:3000` 转发可能不生效，且 WSL 空闲会自动关闭导致容器反复冷启动。
- **保活**：`control.ps1` 走 WSL 时会自动起保活进程；若手动 `docker compose` 绕过它，需自行起：
  `powershell -NoProfile -Command "Start-Process wsl.exe -ArgumentList '-d','Ubuntu','--','sleep','infinity' -WindowStyle Hidden"`
- **绑定**：用 gitignored 的 `.runtime/langfuse/compose.override.yaml` 把 web/minio 绑到 WSL 内 `0.0.0.0`（`ports: !override`），再 `docker compose -f ops/langfuse/compose.yaml -f .runtime/langfuse/compose.override.yaml up -d`。NAT 下仅本机可达，不暴露外网；已提交 compose 仍为 loopback 默认。
- 保活 + 0.0.0.0 后，Windows `http://localhost:3000` 通常即可访问；否则用 WSL IP（`wsl -d Ubuntu -- hostname -I`）`http://<WSL_IP>:3000`。`netsh portproxy` 需管理员，非必需。
- 就绪信号：`curl http://localhost:3000/api/public/health` 返回 `{"status":"OK","version":...}`。**健康通过 ≠ Agent 验证通过。**
- Docker Desktop 宿主无此坑：localhost 原生可达，无需保活/override。

## 登录与启用追踪

- Web UI 登录邮箱/密码在 `.env.e2e.local` 的 `BUDINGX_LANGFUSE_EMAIL`/`BUDINGX_LANGFUSE_PASSWORD`（源自 `login.json`）。项目为 **budingX Agent**。
- TUI 追踪：`npm start` 经 `--env-file-if-exists=.env.e2e.local` 加载 `BUDINGX_LANGFUSE_ENABLED`、`LANGFUSE_BASE_URL`、`LANGFUSE_PUBLIC_KEY`、`LANGFUSE_SECRET_KEY`、`BUDINGX_LANGFUSE_CAPTURE_CONTENT`。`ENABLED=1` 启用；`CAPTURE_CONTENT=1` 才采集正文（先脱敏后裁剪）。
- `LANGFUSE_BASE_URL` 用 `http://localhost:3000`（`isValidBaseUrl` 仅允许 http 本机地址；WSL IP 的 http 会被拒）。诊断输出 enabled/disabled、capture、host，不含密钥。

## 用 Langfuse 定位问题

1. **跑真实回合**：启用追踪后运行 TUI 或 e2e；或跑三场景验收 `node scripts/langfuse/verify-agent.mjs`（需 `BUDINGX_SMOKE_MODEL_KEY/_BASE_URL/_MODEL`，已在 `.env.e2e.local` 配好别名）。
2. **拿 trace/session ID**：宿主回执按 `turnId` 提供 `traceId`/`sessionId`；验收报告写 `.runtime/langfuse/verification.json`。
3. **平台回查**：`GET {base}/api/public/v2/observations?traceId=<id>&fields=core,basic,io`（Basic 认证 = public:secret）。I/O 是原始字符串需 `JSON.parse`，**不要**传 `parseIoAsJson`。上报用 `parentSpanId`/`session.id`，回查用 `parentObservationId`/`sessionId`。
4. **判读**：根 `agent.run` 唯一；子观测 `parentObservationId` 指向根；`level=ERROR` 为失败、`WARNING` 为取消/权限阻断（`outcome=blocked`）；`model.request` 看模型错误，`tool.<name>` 看工具错误。**「有 trace」不等于通过**，须核对场景节点、级别、父子与会话一致。
5. 判定纯函数在 `scripts/langfuse/verify-agent.mjs`（`judgeStructure`/`judgeContent`/`aggregateExitCode`），可复用做断言。

## 常见故障

| 现象 | 处理 |
| --- | --- |
| ClickHouse `Dirty database version N`、web 重启循环 | 多为**两套 Langfuse 栈并存**争用或 fresh-migration 中断。移除本项目竞争实例、`down -v` 清自己的卷后重启；**勿删其他项目卷** |
| Windows 连不上 localhost:3000 | 先确认 WSL 保活进程在、web 绑 0.0.0.0、health 在 WSL 内 OK；再用 WSL IP |
| web 时好时坏 | WSL 空闲关闭所致，启动保活进程 |
| 3000/9090 被占 | 改 `LANGFUSE_WEB_PORT`/`LANGFUSE_MINIO_PORT` 并同步 URL；不终止他人服务 |
| MSYS 里 `wsl -- bash -c` 嵌套引号被破坏 | 把命令写成 `.runtime/*.sh` 脚本文件再 `wsl -- bash <脚本>`，勿内联多层引号 |
| 追踪 disabled | 查 `ENABLED=1`、项目 Key 齐全、base URL 合法；TUI 不热加载 env，需重启 |
| 新宿主首启慢 / 拉镜像失败 | 首次需拉镜像并迁移，耐心等就绪；Docker Hub 不通时 `local.env` 设 `DOCKER_REGISTRY=mirror.gcr.io`；保留原始错误，不冒充启动成功 |
| 换宿主后 trace 上报失败 | 每台宿主凭据独立；核对 `.env.e2e.local` 的 `LANGFUSE_BASE_URL`/Key 与该宿主 `agent.env` 一致，且 base URL 为 http 本机地址 |

## 边界

- 只管理本次启动的实例；停止用 `control.ps1 -Action stop`（保留卷），**禁 `down -v` 删他人数据**。
- 不读取/迁移其他客户端凭据；真实模型 live 消耗用户授权额度（`BUDINGX_E2E_BUDGET_USD`）。
- 凭据、登录、验收报告只落 `.runtime/langfuse/`（Git 忽略）；仓库只留脱敏摘要。
- 维护脚本自测：`node --test scripts/langfuse/*.test.mjs`（已接入 `npm test` 的 `test:langfuse`）。
