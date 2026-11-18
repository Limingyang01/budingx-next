# 开发与发布

统一 Node.js >=22.18、TypeScript、master，不使用 Bun。SP002 已实现「模型与会话闭环」：`src/core`、`src/provider`、`src/storage` 三个新模块与 `src/tui` 的 Ink 对话界面；完整编码工具仍待后续迭代，见 [路线图](iteration-plan.md)，单仓源码边界见 [仓库布局](repository-layout.md)。

## 当前真实命令

根目录 `npm start` / `npm run start` 仅用于本地开发测试，使用 Node 原生 `--env-file-if-exists=.env.e2e.local` 自动加载本地测试模型，不写入持久化档案、不打印密钥。没有文件时正常继续；显式进程环境优先。正式安装的 `budingx` 入口不读取该文件，真实环境自行配置。预算与请求数只由显式 live e2e 脚本执行，交互启动不会执行这类计数限制。

```powershell
npm ci --ignore-scripts --no-audit --no-fund
npm run build
npm start
npm run skills:check
npm run spec:check
npm test
npm run merge:gate
node scripts/release/pack-smoke.mjs
npm run publish -- --dry-run
```

`npm test` 执行技能维护、规格自洽性、产品单元回归、模块边界检查与版本管理测试。`npm run merge:gate` 为合入 master 前的交叉验证门禁（全量门禁 + outgoing 路径扫描 + 当轮报告审计），流程与自审要求见 [集成门禁](integration-gate.md)。TUI 屏幕类端到端用进程内伪 TTY harness（`src/tui/test/helpers/mount-tty.mjs` + `screen-e2e.test.mjs`，真实 Ink 渲染帧断言，无需真终端/截图），方法论见 [buding-frontend-testing](../skills/buding-frontend-testing/SKILL.md)；真终端 IME/观感/鼠标仍属人工 smoke 清单。

## 源码与构建布局（SP002 起）

```text
src/
  core/       # 事件契约、会话与回合状态机、工具回合、输入队列（零 UI、零 IO 副作用）
  provider/   # OpenAI 兼容流解析、tool_calls 碎片、错误分类、有界重试、取消、probe
  storage/    # ~/.budingx 配置与凭据仓库、档案 CRUD、三源合并
  tui/        # Ink 对话界面、渲染 reducer、多行编辑器、审批卡、CLI 入口
```

单一 tsc 程序编译整个 `src/`（`src/tui/tsconfig.json`，`rootDir=src`、`outDir=src/tui/dist`），产物为 `src/tui/dist/{core,provider,storage,tui}`，产品 bin 为 `dist/tui/cli.js`。源码目录按模块拍平到 `src/<模块>/` 直下。

模块边界由 `scripts/checks/module-boundaries.mjs` 强制：core/provider/storage 禁止 import UI/终端库，core 额外禁止 IO 模块与跨模块反向依赖；产品运行时依赖白名单恰为 `{ink, react, string-width}`。该检查已并入 `npm test`。

## 运行时依赖

产品运行包只依赖 `ink@8.0.0`、`react@19.3.1`、`string-width@9.0.0`（均 MIT，仅用于渲染层，已登记在 [第三方声明](../THIRD-PARTY-NOTICES.md)）。构建期另用 TypeScript 5.9.3、`@types/node` 22.20.5、`@types/react` 19.3.0。根 `package.json` 的 devDependencies 与 `src/tui/package.json` 的 dependencies 版本必须一致，由边界脚本校验。

## 打包与隔离安装验证

`node scripts/release/pack-smoke.mjs` 在仓库外临时目录真实打包、安装 tarball 并对本地 fixture 发起一次真实 HTTP 流式请求（不上传、不发布）。`npm run publish -- --dry-run` 是完整发布演练，需要台账中存在 prepared 版本条目；当前候选为 SP003 的 0.3.1，完整预演使用 `npm run publish -- --dry-run --expected-version 0.3.1 --tag latest`。0.3.0 已发布，回执见对应发行说明。

## 验证边界

维护检查不证明产品，fixture 不证明真实外部模型，编译不证明安装。真实 Provider 需要经授权的测试配置，不读取旧用户目录。运行时检查见 Node 测试、隔离安装 smoke 与 [SP002 验证报告](../SP/SP002/test-report.md)；测试环境使用临时目录和本地测试端口，只管理自己创建的资源。

CI 发布成功后下载 report.json，执行 `npm run release:sync -- --receipt <path>` 核对 npm integrity 并同步台账，审阅提交后再准备下一迭代版本。该命令不需要发布 token，不自动写 Git。

构建到 npm 的逐轮清单、隔离安装复验与失败恢复统一维护在 [发布操作手册](github-actions-npm.md)，Agent 执行使用 [buding-npm-release](../skills/buding-npm-release/SKILL.md)。

## 显式 opt-in 的真实模型 e2e

先构建，再将 scripts/testing/e2e.env.example 复制到仓库根目录 .env.e2e.local；填写 Base URL、模型、Key、允许的美元预算、请求/输出上限和工具能力。只提交空模板，真实本地文件被 Git 忽略。npm test 不读取该文件，也不会自动调用真实服务。

用户授权测试费用后，运行 node scripts/testing/live-provider.mjs。脚本执行流式 UI、工具审批回合（支持 tools 时）、用户取消入口及无效 Key 错误；只使用临时存储及自有 echo 测试桩，不读取旧客户端数据。请求计数和脱敏回执保存在忽略的 artifacts/SP002-e2e/。

失败后可用 --resume --only-tools 只续测工具项并累计既有请求数；只有取得用户新授权，才用 --request-cap NUMBER 覆盖原请求上限。预算字段记录用户授权，不代替供应商计费限额；实际费用需用户核对账单。该脚本不证明系统终端 IME 或鼠标体验。
