# SP009 · 0.9.2 验证记录

## T1 WebFetch 与子代理失败

2026-11-24，开发分支 `feature/SP009/tui-gap-optimizations`，基线 `b8c920d`，Windows、Node 22.22.0。命令均从现有 checkout 的仓根执行。

| 验收 | 结果 | 证据 |
| --- | --- | --- |
| AC-SUBAGENT-01 | PASS | 本机 HTTP 及独立进程验证长/短文本、Unicode 裁剪、审批、私网拒绝、响应头后超时、网络错误、HTTP 404 和重定向。生产工具派发连续抓取 6 个长页后正常结束回合。公开 RFC 9110 返回 HTTP 200，正文 502906 个 UTF-16 码元，工具输出 32768 个码元，含截断提示且无 `BUDINGX_CORE_003` |
| AC-SUBAGENT-02 | PASS | Core 保持真实错误的两个熔断阈值并发出不同操作提示。并行派发中，失败子代理返回工具原始错误码、调用参数和已完成工具输出，另一子代理及主回合继续。后台通知和 TaskOutput 包含失败原因 |
| AC-SUBAGENT-03 | PASS | 用户授权使用现有隔离配置，MiniMax-M3.1-Flash 经真实 OpenAI 兼容端点完成 3 次任务，共 6/6 次请求，每次上限 128 输出 token。每次先调用 WebFetch，再根据返回正文答题，三次均返回可用结论且无 `AGENT_FAILED`。实际费用 UNVERIFIED |

红灯集中运行 11 项，9 项按预期失败，2 项既有保护通过。构建后运行 [T1 定向命令](design/plan.zh.md#t1-定向命令)，80 项通过，0 失败，0 跳过。追加父 Agent 同参数重复派发仍熔断的保护用例后，重跑 `AC-SUBAGENT-02` 定向 3/3 通过。规格与模块边界检查通过。真实 Provider 命令为 `node --env-file=.env.e2e.local scripts/testing/sp009-live-subagent.mjs`，退出 0，脱敏回执为 `artifacts/SP009-0.9.2/live-subagent-1795491536411.json`。公开网络与真实 Provider 作为独立证据，未替代全量测试和集成门禁。

## T2–T7 分批验收

仓根运行 `npm run build` 和 `node --test --test-concurrency=4`。本地综合定向日志为 `artifacts/SP009-0.9.2/acceptance-1124.log`，共 133 项通过，0 失败、0 跳过。下表列出产品入口与各自证据层。真实外部 Provider 与本机协议端点分别见 T1 和 T7。

| 验收条件 | 结果 | 证据 |
| --- | --- | --- |
| AC-FORK-01 | PASS | `sp009-session-branches.test.mjs` 通过 Ink 从当前和历史派生，续写及重开后核对 ID、正文、权限和来源 |
| AC-FORK-02 | PASS | 同文件验证两个真实进程同源派生；`session-transcript.test.mjs` 验证损坏原件、待核对步骤及分支完整发布 |
| AC-NAME-01、AC-NAME-02 | PASS | Ink 中文标题；存储覆盖空、超限、旧标题回退、锁竞争及追加转录后标题不丢失 |
| AC-RESUME-01、AC-RESUME-02 | PASS | Ink 正文命中、清空、无结果和键盘选中恢复；`workspace-resume.test.mjs` 验证工作区隔离；恢复回归覆盖按 ID 和真实 CLI 续写 |
| AC-EXPORT-01、AC-EXPORT-02 | PASS | `sp009-export.test.mjs` 的 Agent Write 修改真 Git 工作区后由 Ink、无头导出同一会话，比较输出、围栏、文件归属及脱敏；`sp006-commands-extended.test.mjs` 验证旧格式、覆盖和路径约束 |
| AC-INPUT-01、AC-INPUT-02 | PASS | `editor.test.mjs` 及 `sp009-input-ui.test.mjs` 的多行草稿、Ctrl+R、上限拒绝、两次 Enter、全文和撤销 |
| AC-TRANSCRIPT-01、AC-TRANSCRIPT-02 | PASS | `sp009-transcript-render.test.mjs`、`screen-e2e.test.mjs`、`sp006-resume-history.test.mjs` 验证实时与恢复、工具状态、通知、展开与历史位置 |
| AC-RULES-01、AC-RULES-02 | PASS | 局部源测试 `sp009-rules-loader.test.mjs` 覆盖语法、可信根、符号链接、循环、深度及预算；`sp009-runtime-features.test.mjs` 通过真实本机协议验证局部规则、兄弟范围和用户拒绝规则 |
| AC-SKILL-01、AC-SKILL-02、AC-SKILL-03 | PASS | `sp009-skills-loader.test.mjs` 及技能 UI 回归覆盖发现、禁用和资源；运行时经真实本机 HTTP 验证模型、手动调用、工具范围与宿主权限交集，以及下一回合恢复 |
| AC-TASKS-01、AC-TASKS-02 | PASS | `sp009-tasks-panel.test.mjs` 用真实 Ink 核对日志选择、隔离及取消确认；运行时验收实际 Shell 与 Agent 停止、终态和继续对话 |
| AC-WORKTREE-01、AC-WORKTREE-02 | PASS | 真实 Ink 在隔离仓创建及进入，运行时校验文件、@引用、Shell 和重启恢复；`sp009-worktree-command.test.mjs` 校验缺失目录、不同仓库和分支等失败 |
| AC-WORKTREE-03 | PASS | 隔离真实 Git 验证独立审批、分支/HEAD 复核、并发创建、普通合并、冲突、暂存或工作树脏状态和未授权删除 |
| AC-MCP-01、AC-MCP-02、AC-MCP-03 | PASS | `sp009-mcp-transports.test.mjs` 与 `sp009-mcp-entrypoints.test.mjs` 验证真实 stdio/HTTP/SSE/WS、资源、重连上限、无调用重放、同源鉴权及三入口；运行时 Ink 验证最小确认、拒绝、取消与超时 |

### 自有判据和自审

- 正文搜索以最近 200 个会话、每会话最多 256 KiB 内容为界。只在工作区内索引可读的用户和助手正文。
- Markdown 只列持久化结构化写入证据。缺证据的旧会话以及无法归属的 Shell/Git 写入不从当前工作树推断。
- 工作树合并沿用 Git 默认整合方式。按绑定分支、双方 HEAD、工作区和暂存区复核，保留原生冲突。目标有 Git 忽略文件时需要 Git 2.38+ 执行合并树预检。
- 复审复核会话写锁与临时批准、附件及后台任务归属、MCP 生命周期和凭据、Worktree 并发以及规则和技能导入。修订后以隔离哨兵验证权限拒绝、连接响应脱敏与派生隔离。产品说明书同步命令、键位、数据范围、权限和协议配置。第三方运行时依赖、许可和包入口未新增。

### UNVERIFIED 恢复条件

- 原生终端的 IME / 鼠标观感和第三方 MCP 服务组合需要对应终端与授权测试服务。交互现有证据为真实 Ink 帧。外部 MCP OAuth、复杂表单和 sampling 超出本次实现范围。
- Provider 实际金额以供应商账单核对。0.9.2 的 GitHub Windows/Linux 托管验证、正式 npm 上传和回执依赖维护者手动触发后取得。

## T8 交叉验证与集成

`npm run merge:gate` 在功能分支 `28d64d7ccad7229c629d2752674dfd4fc1e94d1c` 完成，**GREEN**。六项检查退出码均为 0（`npm test`、规格、技能、版本、隔离安装和升级）。报告 `artifacts/merge-gate/feature-SP009-tui-gap-optimizations-2026-11-24T04-32-35-488Z.md`，检查 3 个引入提交、80 个文件，无禁带路径和失败行。合并预演及 ancestry 校验通过。功能合并与远端核验 SHA 为 `42528089566b903ac393e7a6e710b5f8e99154d6`。

### 0.9.2 发布预演

- 在 Windows、Node 22.22.0、`CI=true` 下执行 `npm ci --ignore-scripts --no-audit --no-fund` 和 `npm run publish -- --dry-run --expected-version 0.9.2 --tag latest`，均退出 0。
- 预演执行 1520 项自动化测试，1519 项通过，0 失败、0 取消。1 项 POSIX 文件权限测试在 Windows 跳过。产品测试为 1344 通过 / 1345 执行。
- tarball 190 个文件，隔离安装后 CLI 返回 0.9.2，本机 HTTP fixture 命中 1 次。SHA-512 integrity 为 `sha512-BEmesNNxLRx0NHAug8AoDBapcFZn9FhkWGBTBNdITmHJ/UHkUagU6w2X2OsRKaeZU1NYvwqOKAvRw3n8vmkGGw==`。报告 `artifacts/release/0.9.2-1795495213094/report.json` 状态为 `dry-run-complete`。
- 本机预演使用 master 的合入代码与当前 0.9.2 版本文件。正式发布的源码与双平台工作流回执待取得。

### 正式发布运行 #33 与 Windows 验证修复

- [Actions #33](https://github.com/Limingyang01/budingx-next/actions/runs/45335678863) 使用源码 `f3302a6`，Ubuntu 验证通过，Windows 在「Check, pack and install the actual tarball」失败，OIDC 发布作业被跳过。官方源仍指向 0.9.1，查询 0.9.2 返回 HTTP 404。公开作业注释只有退出码。原始 Windows 日志和验证 artifact 的下载需要登录。
- 本机用 Windows、Node 22.22.0、npm 11.21.2、`CI=true` 和 `FORCE_COLOR=1` 复跑发布预演，产品测试 1345 项中 1343 通过、1 失败、1 平台跳过。唯一失败是 `src/tui/test/render.test.mjs` 的选中思考行断言。原始帧包含颜色转义码及正确的 `> Thinking - Second summary`。定向运行先复现失败，再对该断言使用 `stripVTControlCharacters`。有色和无色渲染各 15/15 通过。
- 本次修订只涉及测试断言及验收记录。产品行为、版本、发布工作流和打包文件无需调整。正式发布回执继续以成功运行、官方源和独立安装结果确认。
