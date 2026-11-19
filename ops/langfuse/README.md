# 本机 Langfuse 部署与追踪接入

适用：维护 budingx TUI 的开发者，需要在自己的机器查看 Agent 回合、模型调用、工具执行与错误记录。本部署是**开发者本机自建**观测平台，不是生产高可用部署。追踪**默认关闭**，正文采集需显式开启。

设计依据：[SP004 agent-observability 设计 §4.7](../../SP/SP004/agent-observability/design/design.zh.md)。

## 1. 环境要求

- Node.js >= 22.18（初始化与验收脚本使用 Node 内置模块）。
- Docker Engine / Docker Desktop 与 Docker Compose v2。
- Windows 可使用已安装 Docker Engine 的 WSL Ubuntu，无需同时安装 Docker Desktop。`control.ps1 -Distro <名称>` 可选其他已配置的发行版。
- 建议可用内存至少 8 GB、足够磁盘及镜像网络。此实例仅发布本机 `3000` 与 `9090` 端口；数据库不对宿主开放。

同一台机器默认只维护一个 `budingx-langfuse` 实例。不要在不同克隆目录中同时启动同名实例，也不要用新生成的凭据接管已有数据卷。不要为部署修改或停止其他项目的容器。

## 2. 初始化与启动

从仓库根目录执行：

```powershell
node scripts/langfuse/init-local.mjs
powershell -NoProfile -File scripts/langfuse/control.ps1 -Action start
powershell -NoProfile -File scripts/langfuse/control.ps1 -Action status
```

初始化生成以下本机文件，全部位于 Git 忽略的 `.runtime/langfuse/`，并在写入前限制为当前用户私有访问（POSIX 目录 `0700`/文件 `0600`；Windows 取消继承、仅授予当前用户 SID，再核对 DACL）：

| 文件         | 作用                                          |
| ------------ | --------------------------------------------- |
| `local.env`  | 数据库/对象存储密码、加密盐、初始化用户和项目 API Key、镜像版本 |
| `agent.env`  | 追踪开关、地址及 Langfuse 项目 Key            |
| `login.json` | 浏览器登录地址、邮箱和随机初始密码            |

初始化可重复运行，不覆盖已有凭据或 `agent.env` 的自定义值。已有 `local.env` 缺关键键会报错，先备份并明确修复，不删除数据卷重新来过。无法建立或验证私有权限时会在写入凭据前停止。不要将这些文件发给其他人；其他开发者应在自己的机器初始化自己的账号与 Key。

**镜像版本**：`local.env` 的 `LANGFUSE_IMAGE_TAG` 等是起始默认值，实施/首次部署时以 `docker compose pull` 实际拉取成功的稳定版为准并回写；不得凭记忆认定未验证版本可用。

首次下载镜像和执行数据库迁移需要时间。确认四个基础服务 healthy、Web/Worker 运行后，检查：

```powershell
Invoke-RestMethod http://localhost:3000/api/public/health
```

预期返回 `status: OK` 和版本。**健康检查通过不代表 Agent 验证通过**，两者分别取证。

Linux / Docker Desktop 也可直接执行：

```bash
node scripts/langfuse/init-local.mjs
docker compose -p budingx-langfuse --env-file .runtime/langfuse/local.env -f ops/langfuse/compose.yaml up -d
```

脚本在 Windows 找不到 Docker CLI 时使用 WSL。WSL 模式会启动隐藏的保活连接，使启动脚本退出后服务继续可用；记录在 `wsl-keeper.json`。它不更改全局启动项，不控制任何桌面窗口。Windows 重启后重新执行 start。

## 3. 登录与追踪配置

打开 `http://localhost:3000`，用本机 `login.json` 中的邮箱/密码登录。项目为 **budingX Agent**。初始化用户、组织、项目和 API Key 由 Langfuse 的 headless initialization 创建，不需要手工注册。

TUI 追踪通过显式 env 文件接入。把 `BUDINGX_LANGFUSE_ENV_FILE` 指向 `agent.env` 的**绝对路径**，再启动 TUI：

```powershell
$env:BUDINGX_LANGFUSE_ENV_FILE = (Resolve-Path .runtime/langfuse/agent.env).Path
npm start
```

追踪只导入五个白名单变量（`BUDINGX_LANGFUSE_ENABLED`、`BUDINGX_LANGFUSE_CAPTURE_CONTENT`、`LANGFUSE_BASE_URL`、`LANGFUSE_PUBLIC_KEY`、`LANGFUSE_SECRET_KEY`），进程环境优先；不读取工作区设置、不扫描仓库 `.env`、不导入 `NODE_OPTIONS` 等运行参数。文件缺失或不可读时保留继承环境并输出脱敏诊断，不阻断启动。

默认只采集元数据。若确有调试需要，在本机 `agent.env` 添加 `BUDINGX_LANGFUSE_CAPTURE_CONTENT=1` 后重启 TUI；内容脱敏不保证识别任意业务机密。启动诊断会显示 `Langfuse tracing: enabled/disabled`、`content capture: on/off` 与 base url host，**不输出密钥**。

需要 Sessions 对话回放时，必须同时确认追踪与 content capture 均开启。仅有追踪开关会产生调用链和用量，但 Input/Output 为空。旧的未采集记录不能补回；配置改变后先重启 TUI，再创建新任务。

## 4. 无界面验证

真实模型三场景验收见 [验收脚本](../../scripts/langfuse/verify-agent.mjs)：

```powershell
node scripts/langfuse/verify-agent.mjs
```

脚本使用生产 Agent 路径（Core Session + 真实 Provider + 只读工具），依次跑「读取存在文件成功」「读取不存在文件工具失败」「不可连接模型端点失败」，并从 Langfuse `/api/public/v2/observations` 回查观测。报告写 `.runtime/langfuse/verification.json`，每场景独立判定 `localExpectationMet` / `platformIndexed` / `hierarchyOk` / `sessionConsistent` / `contentVerified`。只有本地预期、平台索引、层级与会话一致性均满足，且正文符合配置，才退出 0。**「有 trace」不单独作为通过依据。**

模型凭据优先用 `BUDINGX_SMOKE_MODEL_KEY` / `BUDINGX_SMOKE_MODEL_BASE_URL` / `BUDINGX_SMOKE_MODEL`；缺失则明确报错退出，不消耗额度。平台鉴权失败会在发起任何模型调用前退出。

## 5. 日常管理

```powershell
powershell -NoProfile -File scripts/langfuse/control.ps1 -Action status
powershell -NoProfile -File scripts/langfuse/control.ps1 -Action logs
powershell -NoProfile -File scripts/langfuse/control.ps1 -Action stop
powershell -NoProfile -File scripts/langfuse/control.ps1 -Action start
```

stop 仅停止本实例容器，保留数据卷和本机凭据，不关闭 WSL 或其他容器。**不要使用 `down -v`**，它会删除本实例数据。关闭或重启 Windows 后需要重新 start。此部署没有配置备份；长期使用前为 PostgreSQL、ClickHouse 和对象存储制定备份/保留策略。

## 6. 常见问题

| 现象                            | 检查与处理                                                                                                                                               |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Docker Hub 连接重置             | 在本机 `local.env` 添加 `DOCKER_REGISTRY=mirror.gcr.io` 后重试；这是可选公共镜像路径，不修改 Docker 全局配置。镜像源不可用时保留原始错误，不冒充启动成功 |
| Web 缺少 DATABASE_URL           | 使用仓库中的完整 Compose，Web 和 Worker 都必须有公共基础设施环境变量；不要将 YAML 合并键当普通字段丢弃                                                   |
| 3000/9090 被占用                | 先确认占用者，不终止其他服务。修改 Compose 绑定端口，并同步 local.env 的 NEXTAUTH_URL、agent.env 的 Base URL                                             |
| WSL 退出后服务消失              | 检查隐藏保活进程及 WSL/Docker 服务；重新 start，不用关闭整个发行版排查                                                                                   |
| 追踪显示 disabled               | 检查 `BUDINGX_LANGFUSE_ENABLED=1` 与项目 Key 是否齐全、base URL 是否合法（http 仅限本机）；已运行的 TUI 不会热加载新环境，需重启                          |
| 有模型错误但没有工具步骤        | 模型可能在返回工具调用前已经失败；先看 model.request 的状态与错误                                                                                        |
| HTTP 402 / insufficient_balance | 模型套餐或额度问题；等待恢复或更换获授权的模型配置，不能据此判定 Langfuse 部署失败                                                                       |
| 看到 trace 但缺少新 observation | 查询实时 v2 observations；确认上报带 `x-langfuse-ingestion-version: 4`。检查 Worker、Redis、ClickHouse，避免因轮询旧接口误判                             |

## 7. 共享与验证记录

提交到 Git 的只有 Compose、脚本与文档。运行配置、账号密码、镜像日志和实际报告不提交（`.runtime/` 已忽略）。维护脚本自测：`node --test scripts/langfuse/*.test.mjs`。

开启内容采集后执行验证，报告还必须满足 `contentVerified=true`：根输入/输出可解析为 user/assistant 消息，所有子节点属于同一会话。不采集内容时该项为 `null`，并另行断言本 trace 所有观测均无正文，不冒称内容已验证。

成功标准分为：服务健康、项目鉴权、真实模型成功、真实工具失败、平台可查询；每项分别留证，未完成项保持 UNVERIFIED。

上游参考：[官方 Compose 部署](https://langfuse.com/self-hosting/deployment/docker-compose)、[初始化](https://langfuse.com/self-hosting/administration/headless-initialization)、[OTLP 端点与属性映射](https://langfuse.com/integrations/native/opentelemetry)。

## 8. 无 Docker/WSL 时的兼容接收端（SP005）

本机没有 Docker 也没有 WSL2 发行版时，上面的真实栈无法启动。仓库内提供一个 **Langfuse 兼容接收端** `scripts/langfuse/local-receiver.mjs`：它实现追踪上报与查询所需的最小协议，让 Agent 的 OTLP 上报、SP004 的 `query-traces.mjs` / `verify-agent.mjs` 不改一行即可工作。

```bash
npm run langfuse:init        # 首次：生成 .runtime/langfuse/{local.env,agent.env,login.json}
npm run langfuse:receiver    # 启动：默认 http://127.0.0.1:3000（可用 --port/--storage 覆盖）
```

| 端点 | 用途 | 鉴权 |
| --- | --- | --- |
| `GET /api/public/health` | 存活探针 | 否 |
| `GET /` `GET /ui` | 只读查看页：按 trace 分组、按层级展开、显示 input/output 与级别 | 否 |
| `GET /ui/observations?limit=&traceId=&sessionId=&name=` | 查看页数据源，形状与 v2 一致（仅因服务只监听回环而免鉴权） | 否 |
| `POST /api/public/otel/v1/traces` | 接收 OTLP JSON（与 `src/observability/exporter.ts` 同协议） | Basic（项目 public/secret key） |
| `GET /api/public/v2/observations?traceId=&sessionId=&name=&fields=core,basic,io` | 回查观测（层级、工具名、级别、输入输出） | Basic |
| `GET /api/public/projects` | 项目身份探针 | Basic |

观测按 span 落盘到 `.runtime/langfuse/local-receiver/`，重启后保留；`--storage <dir>` 可指定别处。接收端要求上报带 `x-langfuse-ingestion-version: 4`，与 `src/observability/exporter.ts` 一致。

**查看测试效果**：启动后浏览器打开 <http://127.0.0.1:3000/> 即可看到每条 trace 的观测树（`agent.run` / `model.request` / `tool.<Name>`）、级别着色、耗时与 input/output，可过滤、手动刷新或 5s 自动刷新。这是替代性查看页，不是 Langfuse 的完整 UI。页面源文件是 `scripts/langfuse/local-ui.html`，改动后运行 `npm run langfuse:ui` 重新生成 `scripts/langfuse/local-ui.mjs`（测试会校验内联脚本可解析，防止转义错误导致页面静默不执行）。

**边界**：这是兼容接收端，不是 Langfuse 本体——只有只读查看页，没有 ClickHouse/PostgreSQL，没有登录、项目/用户管理、评测与数据集语义。它只能证明「上报与查询链路正确」，**不能替代**真实栈的服务健康与初始化验收；真实栈另由 `npm run langfuse:smoke` 与 `npm run langfuse:login` 验收（第 9 节）。

端到端用法：

- 有模型额度：`npm run langfuse:observe` → 跑 tool-success / tool-error 两个真实回合，回查并判读层级、工具名、级别，以及工具调用是否合适（次数预算、参数是否指向目标文件、有无重复调用）与模型观测是否带真实用量/耗时，报告写 `.runtime/langfuse/sp005-observation.json`。失败场景允许两种正确收尾：模型如实汇报（completed），或反复重试触发空转熔断（error + `BUDINGX_CORE_010`）；后者按 `MAX_TOOL_FAILURE_STREAK` 判次数上限，不再固定为 2。
- 无模型额度：`node --test scripts/langfuse/sp005-observation.e2e.test.mjs` → 用本地脚本化 OpenAI 兼容端点复现同一条链路（真实 HTTP、真实解析、真实工具、真实追踪、真实接收端）。

**真实模型结果（2026-11-20）**：真实栈 4.78.0 上 `npm run langfuse:observe` 两场景 `EXIT=0` —— tool-success（1 次 Read，参数 `facts.txt`，usage 1228，trace `66d417933b454d622df74c12ae762deb`）与 tool-error（5 次变路径 Read，触发 `BUDINGX_CORE_010` 熔断，usage 1362，trace `8043bca01f1f8363cada853abd4bd3bc`）。观测里可直接看到工具的 `input`/`output` 与 `model.request` 的真实 tokens；这两项能力是 SP005 期间由 Langfuse 数据暴露并补上的（provider 请求 `stream_options.include_usage`；Session 给工具观测写 payload）。

## 9. 本机真实栈：WSL2 内的 Docker Engine（2026-11-19 落地）

用户要求不使用 Docker Desktop，改为在 WSL2 发行版内直接跑 Docker Engine。落地步骤与后续维护事实如下（仓库只记录机制，不记录机器专属路径）。

1. **发行版**：用 Ubuntu 官方 rootfs 导入到本地目录，`wsl --import <名称> <目录> <rootfs.tar.gz> --version 2`；rootfs 取自 `https://cloud-images.ubuntu.com/wsl/jammy/current/ubuntu-jammy-wsl-amd64-ubuntu22.04lts.rootfs.tar.gz`。
2. **systemd**：在发行版内写 `/etc/wsl.conf`（`[boot] systemd=true`、`[user] default=root`），`wsl --terminate <名称>` 后重新进入，`ps -p 1 -o comm=` 应为 `systemd`。
3. **Docker**：apt 源换国内镜像，按官方 apt 仓库安装 `docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin`，随后 `systemctl enable --now docker`（`docker version` 有 Server 段才算成功）。镜像拉取可给 `/etc/docker/daemon.json` 配 `registry-mirrors`。
4. **保活（必做）**：WSL2 在没有 `wsl.exe` 会话时会按 `vmIdleTimeout`（默认约 60 秒）终止 VM；一旦 VM 退出，`dockerd` 与所有容器一起被 SIGTERM——表现为容器反复 “Up N seconds”、Postgres 崩溃恢复、Langfuse 迁移报 `Prisma P3009`。保活任选其一：常驻 `wsl -d <名称> -u root -- tail -f /dev/null`；或在 `%USERPROFILE%\.wslconfig` 写 `[wsl2]` 段并设 `vmIdleTimeout=-1`。
5. **迁移失败后的清理**：`Prisma P3009` 表示库里有失败迁移记录，先 `docker compose ... down -v` 清空数据卷再 `up -d`；不要在带失败记录的库上强行 `migrate resolve` 掩盖原因。

WSL 内启动（端口仍只发布到 `127.0.0.1`）：

```bash
cd /mnt/<盘符>/<仓库路径>
docker compose -p budingx-langfuse --env-file .runtime/langfuse/local.env -f ops/langfuse/compose.yaml up -d
docker compose -p budingx-langfuse --env-file .runtime/langfuse/local.env -f ops/langfuse/compose.yaml down
```

Windows 侧 `curl http://127.0.0.1:3000/api/public/health` 返回 `{"status":"OK","version":"<Langfuse 版本>"}`，`/api/public/projects` 用 `local.env` 里的项目 Key 可查到 `budingX Agent` 项目，即接入成功。

**无模型额度也能验收接入链路**：`npm run langfuse:smoke` 用生产导出器（`src/observability/exporter.ts` 编译产物）投递一条合成 trace（`agent.run` + `model.request` + `tool.Read` 失败），再从 v2 Observations API 回查，判定根节点唯一、子节点挂根、工具失败可见、会话一致；报告写 `.runtime/langfuse/stack-smoke.json`。它证明「上报 → 索引 → 查询」链路，不替代真实模型回合的 OB 判定。

**与第 8 节互斥**：兼容接收端与真实栈都默认占用 `127.0.0.1:3000`，同一时间只能起一个；真实栈可用 `LANGFUSE_WEB_PORT` 换端口并同步 `agent.env` 的 `LANGFUSE_BASE_URL`。

### 凭据来源与登录自检（2026-11-19 补）

UI 登不上，通常不是服务没起来，而是**账号密码不是这一套**：`local.env` 的 `LANGFUSE_INIT_USER_*` / `LANGFUSE_INIT_PROJECT_*` 只在首次初始化（数据库为空）时生效，而 `npm run langfuse:init` 早先会随机生成一套，和仓库根 `.env.e2e.local` 里的 `BUDINGX_LANGFUSE_EMAIL` / `BUDINGX_LANGFUSE_PASSWORD` / `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` 对不上。表现就是：用 `.env.e2e.local` 的密码登录失败，API 用它的 Key 查 `/api/public/projects` 返回 401。

现行规则：

- `.env.e2e.local` 是唯一事实来源；`npm run langfuse:init` 检测到它会直接复用这四个值，不再另生成（没有该文件时才随机生成）。
- 已经生成的 `local.env` / `agent.env` / `login.json` 不会被 init 覆盖；要改就改 `local.env` 里对应的 `LANGFUSE_INIT_USER_EMAIL`、`LANGFUSE_INIT_USER_PASSWORD`、`LANGFUSE_INIT_PROJECT_PUBLIC_KEY`、`LANGFUSE_INIT_PROJECT_SECRET_KEY`，同步 `agent.env` 的两个 Key 与 `login.json`。
- 改完必须重建数据库卷才会重新初始化：`docker compose ... down -v` 再 `up -d`（旧数据会清空，只用于本机验收）。
- 自检两条：`npm run langfuse:login`（走 NextAuth 的 csrf → credentials → session，返回 `ok:true` 即账号密码可用）；`npm run langfuse:smoke`（验证项目 Key 能上报并回查）。

```bash
npm run langfuse:login   # { csrfOk: true, sessionEmail: ..., ok: true }
npm run langfuse:smoke   # { sent: true, hierarchyOk: true, ... ok: true }
```
