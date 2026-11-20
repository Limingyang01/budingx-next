# SP006 · TUI 还原度与扩展能力

状态：**DELIVERED ON FEATURE BRANCH（实施、测试与文档完成；未合入 master，远端推送按用户 m02328 授权执行，等用户检查）**｜功能分支 `feature/SP006/tui-parity-and-extensions`｜基线 master `dc94731`｜版本 0.6.0 已制备（`prepared`，未发布）｜验收报告 [SP006/test-report.md](test-report.md)

## 本轮目标与边界

- 目标：按路线图 SP006 出口与 TUI 还原度 P0，完成四区骨架、消息区冻结、帧缓冲差分、上下文键位、状态栏契约，并交付项目指令、技能/MCP、hooks、网页抓取、无头 CLI、制品安装与命令面扩展。
- 来源：路线图 r9 SP006 行与 P0 出口；`docs/tui-command-roadmap.md` 的七条命令；用户 2026-11-20 指令（m00001）要求复刻参考仓 TUI、不直接复制代码、注意 AST 与协议、设计多复核、全程不停、从 master 拉分支、**不合入 master 等检查**。
- 参考仓：本地 `budingWorkerSpace`，复核修订 `b5c9be8`；只读行为与协议，不复制源码、提示词或内部类型。
- 功能目录：`tui-usability`、`project-instructions`、`skills-and-mcp`、`hooks`、`web-retrieval`、`headless-cli`、`npm-packaging`，以及命令注册表与七条新命令。
- 明确排除：权限七档、Vim 双模式、鼠标选区、备用屏、远程 OAuth MCP、`/agents`、团队/浏览器/Computer Use/定时任务、npm 实际上传、tag、远端设置、**合入 master**（用户 m02328：可提交并推送远端，先不合入 master）。
- 保留行为：SP002 回合/事件/取消/审批、SP003 三档权限与工作区边界、SP004 命令与 worktree 安全边界、SP005 压缩/恢复/记忆/熔断；既有测试全绿是硬门槛。

## 需求索引（迭代进度入口）

| 功能/优化目录 | 来源 / 身份 | 验收目标 | 责任范围 | 阶段 | 需求 / 设计 / 计划 / STATUS | 验证 | 集成状态 | 下一步 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `tui-usability` · TU-01…TU-15 | 路线图 P0；AC MODEL_PROPOSED | 四区、resize、冻结、帧差分、键位上下文/chord/保留键/用户覆盖、状态栏字段与外部命令、CJK、多行、快捷键、无头事件与退出码 | `src/tui/render/{layout,frame-buffer,freeze-cache,statusline}.ts`、`src/tui/keybindings/*`、`strategy`、`app.tsx`、`headless.ts` | 需求/设计/计划 v1.1 · 实施 T-A1…T-A7 完成 | [需求](tui-parity-and-extensions/requirements.md) ／ [设计 v1.1](tui-parity-and-extensions/design/design.zh.md) ／ [计划 v1.1](tui-parity-and-extensions/design/plan.zh.md) ／ [STATUS](tui-parity-and-extensions/STATUS.md) | TU-01…TU-15 全部 PASS（含 UI 帧级缓存命中计数） | 仅功能分支，未合入 master | 用户检查后合入 |
| 同上 · PI-01…PI-05 | 路线图；AC MODEL_PROPOSED | 用户级/祖先/工作区/子目录分层发现、64/128 KiB 截断标注、工作区隔离、不读 `~/.claude` | 新增 `src/tui/project-instructions.ts`；`src/core/session.ts` 系统上下文端口 | 实施 T-C1 完成 | 同上 | 9 例 PASS（含真实请求体） | 仅功能分支 | 用户检查 |
| 同上 · SM-01…SM-09 | 路线图；AC MODEL_PROPOSED | 技能两源发现/项目覆盖/正文注入/无效跳过；stdio MCP 握手、工具注册、调用、审批、崩溃降级、密钥引用 | 新增 `src/tui/skills.ts`、`src/tui/mcp/{types,client,index}.ts` | 实施 T-C2/T-C3 完成 | 同上 | 7 + 8 例 PASS（含假 MCP 子进程与真实审批） | 仅功能分支 | 用户检查 |
| 同上 · HK-01…HK-08 | 路线图；AC MODEL_PROPOSED | 八事件、command/prompt、continue/block/suppress/systemMessage、PreToolUse allow/deny/ask、退出码 2、超时降级、禁用、损坏备份 | 新增 `src/core/hooks.ts`、`src/tui/hooks/{types,config,runner,index}.ts`；Session 接线 | 实施 T-C4 完成 | 同上 | 8 例 PASS（含真实回合事件顺序） | 仅功能分支 | 用户检查 |
| 同上 · WR-01…WR-05 | 路线图；AC MODEL_PROPOSED | HTML 正文提取、内网默认拒绝、审批、512 KiB 截断、超时/非 2xx/无效 URL 错误码、重定向上限 | 新增 `src/provider/web-fetch.ts`；runtime 工具表 | 实施 T-C5 完成 | 同上 | 7 例 PASS（含真实 HTTP 子进程） | 仅功能分支 | 用户检查 |
| 同上 · HC-01…HC-07 | 路线图；AC MODEL_PROPOSED | text/json/stream-json、事件顺序与字段、失败退出码 1、用法错误 2、非 TTY、不写用户数据 | `src/tui/headless.ts`、`cli.ts` | 实施 T-A7 完成 | 同上 | 5 例 PASS（真实子进程） | 仅功能分支 | 用户检查 |
| 同上 · NP-01…NP-05 | 路线图；AC MODEL_PROPOSED | tarball 白名单、仓库外隔离安装、真实流式任务、publish dry-run、台账字段 | `scripts/release/sp006-packaging.mjs`、`release-ledger.json`、`sp006-release-ledger.test.mjs` | 实施 T-D1 完成 | 同上 | 脚本 exit 0，6 项 PASS；台账 3 例 PASS | 仅功能分支 | 用户检查后发布 |
| 同上 · CMD-01…CMD-12 | `docs/tui-command-roadmap.md`；AC MODEL_PROPOSED | 三型注册表、模态槽、prompt 进度、七条新命令、22 条既有命令回归 | `src/tui/commands/{types,registry,util,builtin-*,index}.ts`、`commands.ts`、`app.tsx` | 实施 T-B1…T-B3 完成 | 同上 | 注册表 7 例 + 命令 10 例 + UI 2 例 PASS | 仅功能分支 | 用户检查 |
| 同上 · AST-01…AST-03 | 用户指令 m00001；AC MODEL_PROPOSED | 改动文件全映射、命中全处置、自检全 PASS | `scripts/review/sp004-ast.mjs` | 实施 T-D2 完成 | 同上 | 52/52 映射，命中 0，自检 3/3 PASS | 仅功能分支 | 用户检查 |

## 验收与交接

- AC 共 **69 条**（TU 15、PI 5、SM 9、HK 8、WR 5、HC 7、NP 5、CMD 12、AST 3）：**69 PASS / 0 PARTIAL / 0 FAIL / 0 UNVERIFIED**。逐条证据见 [验收报告](test-report.md)。
- 全量回归：`npm run test:unit` **914 项 / 913 通过 / 0 失败 / 1 跳过**，EXIT=0，54.0s；跳过项为仅在 POSIX 生效的文件权限断言。SP006 新增 20 个测试文件、110 例。
- 定向回归：`node --test src/tui/test/sp006-*.test.mjs sp0054-command-fidelity.test.mjs sp0054-enter-command.test.mjs commands.test.mjs commands-zh.test.mjs` **135 通过 / 0 失败**。
- 制品：`node scripts/release/sp006-packaging.mjs` exit 0；tarball 141 文件，隔离安装 0.6.0，无头流式 7 事件且未写用户数据，`npm publish --dry-run` 不上传。
- AST：`node scripts/review/sp004-ast.mjs --reference <参考仓> --reference-revision b5c9be8 --base dc94731`：52 改动文件 / 52 映射，自检 3 项 PASS，本仓单元 252、参考 14381、函数对 49285，命中「无」，结论 PASS。
- 本地提交：波次 A `cedf2a3`、波次 B `031b99b`、波次 C 与命令面 `4b78cdb`、波次 D `06d7b2a`、命令卡片修复 `f0b11eb`、台账同步 `47c5cb6`、`/resume` 修复 `1ef588a`。
- **集成状态：未合入 master**；远端推送按用户 m02328 授权在提交后执行。npm 0.6.0 仅 prepared，未上传。
- 已知限制：状态栏外部命令配置在应用挂载时读取一次，修改后需重启；无头模式不加载 MCP/hooks 交互面板；TU-09 可选字段按外部状态栏协议省略。恢复条件见验收报告。

## 变更记录

| 日期 | 变更 | 原因 |
| --- | --- | --- |
| 2026-11-20 | 立项并完成需求 v0.1、设计 v1.1、计划 v1.1 | 用户指令启动 SP006 |
| 2026-11-20 | 波次 A：四区/帧差分/冻结/键位/状态栏/无头 CLI | P0 骨架与协议 |
| 2026-11-20 | 波次 B：命令注册表三型 + 22 条既有命令迁移 | 命令面收口 |
| 2026-11-20 | 波次 C：项目指令、技能、MCP、hooks、WebFetch | 能力层交付 |
| 2026-11-20 | 波次 B3/D：七条新命令、制品脚本、AST 映射、文档收口、0.6.0 制备 | 完成本轮交付并准备验收 |
| 2026-11-20 | 两轮设计自审（D-01…D-14）、回归修复、全量 906 项通过 | 自审委托与质量门槛 |
| 2026-11-20 | 用户检查反馈修复一：命令卡片完成后不消失、单次调用占多行（`f0b11eb`） | 用户 m01955 报告 |
| 2026-11-20 | 用户检查反馈修复二：`/resume` 恢复后历史不可见（新增 `conversation_restored` 事件 + 转录重建 + 会话身份切换），全量 914 项通过 | 用户 m02285 报告；m02328 要求端到端测试后提交并推送远端、不合入 master |
