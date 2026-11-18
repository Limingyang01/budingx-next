# TUI 的 npm 打包与一键发布计划

状态：bootstrap 实现及后续扩展计划；r5；2026-11-18（同步路线图 r8，当前只规划 TUI/CLI 制品）。用户已确认 MIT/简易聊天范围并授权验证后发布；本地发布编排与安装 smoke 已实现，正式状态见 release-ledger.json。范围为 TUI/CLI，不把 Desktop、VSIX、维护仓和技能资料整体发布到 npm。

## 推荐入口：GitHub Actions + Trusted Publishing

现在推荐从 [Publish TUI to npm](https://github.com/Limingyang01/budingx-next/actions/workflows/publish-tui.yml) 手动一键触发。精确账号配置、首次建包限制、environment、direct publish 权限和回执同步见 [Actions 配置指南](github-actions-npm.md)。bootstrap 0.1.1 已通过真实 OIDC 发布；SP002 的 0.2.0 也已通过维护者触发的运行 #7 发布，具有本版本独立回执，不复用旧版本证据。

## 本机命令与命令边界

首发 bootstrap 或明确授权的本机交互发布入口是在仓库根目录执行 **`npm run publish`**，由跨平台 Node 发布入口完成检查、构建、打包、实际安装测试和 registry 发布，再核对回执。无参数的稳定发布使用已准备且经审阅的版本，默认发布到 https://registry.npmjs.org；不静默自增版本、不顺带提交/推送/tag。

当前 npm latest 为 0.3.2（SP003）。准备下一版本后，按下面命令读取候选版本并预演。

```powershell
$releaseVersion = (Get-Content src/tui/package.json -Raw | ConvertFrom-Json).version
npm run publish -- --dry-run --expected-version $releaseVersion --tag latest
```

裸 `publish` 不是默认 PowerShell 命令。`npm run publish` 是项目编排入口，`npm publish` 是 npm 原生命令；两者不能混为一谈。入口内部对验证过的 tarball 调用 npm publish；不得在待发布包的同名 publish 生命周期里递归调用自己。npm 生命周期包括 prepublishOnly/prepack/prepare 等不同阶段，prepare 在一些安装场景也会执行，因此不能把上传或完整发布编排塞入安装钩子。[npm scripts 官方说明](https://docs.npmjs.com/cli/v11/using-npm/scripts/)

根维护包继续 private:true；独立生成/维护 TUI 发布包的元数据与 allowlist，仅该发布单元可公开。发布脚本选择精确包目录和 tarball，不能临时移除根 private 标记来发整个仓库。npm 会拒绝发布 private:true 包；bin 声明用于安装后的命令入口，入口需为 Node 可执行脚本。[npm package.json 官方说明](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/)

## 迭代归属

| 迭代                  | 交付                                                                                                                                                                                |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SP001                 | 固定 CLI/包名/支持平台/Node 版本和发布范围；来源台账、许可证及包名归属的待决项明确列出，不沿用旧仓版本或授权。                                                                      |
| SP002                 | 产品开始时确定可构建产物、bin、运行资源和宿主依赖的边界；不把内部源码路径当可发布入口。                                                                                             |
| SP006                 | 形成真实 npm tarball，隔离 prefix 安装和 npm exec/npx 路径验证；验证无需源码/tsx/开发依赖/其他端/Bun；先形成发布 dry-run 流程，不进行公开发包。                                     |
| SP007                 | 固定制品符合性、依赖/来源和秘密扫描、稳定/预发布版本规则及 CI 的非发布验证；消除原生工具与平台资源隐式缺失。                                                                        |
| SP009                 | 实现一键发布入口、账号/registry/版本/权限检查、候选与稳定通道、同一 tarball 发布、回执/失败恢复、安装升级卸载和发布说明。                                                           |
| SP010 / SP015 / SP016 | 中期编码检查、TUI 全能力制品（当前范围）及最终替代验收分别验证公开链路与安装后的任务；真实公开发布只在届时已获明确授权且许可等条件满足时执行，否则将该项标为 UNVERIFIED，不能称正式发布链路已验收。 |

此前用户偏好公开无 scope 包名 budingx、命令 budingx；新产品沿此作为目标，但名称可用性、账号所有权、版本历史本次未查询。不得因为偏好已确认就宣称包名可用或有写权限；冲突时保留结果并请求命名决定，不擅自换名字/覆盖他人包。根维护版本 0.0.0 和旧产品 0.5.0 均不自动成为新产品版本。

## 一键发布的执行顺序

1. 绑定确定的发布输入：commit、包名、已准备 SemVer、registry、tag、平台/Node 范围和变更说明。要求所发内容来自固定可复现基线；有无关工作时拒绝混入或从获授权基线隔离构建，不自动 stash/reset/提交。
2. 检查 Node/npm、锁文件、许可/第三方声明、账号/包写权限和包版本。只在真实发布模式验证发布身份；dry-run 可离线运行本地检查，远端未核实项如实标明。认证通过不等于已经证明实际发布权限。
3. 执行实际配置的适用门禁和发布构建。失败立即非零退出，不把 lint/build 通过当真实 Provider 或制品安装通过；release 命令不得偷偷忽略必要测试。
4. 从显式文件白名单生成一次最终 tarball，记录包内文件/版本、大小、内容摘要及依赖清单。不能只检查 npm pack --dry-run 清单而不验证实际压缩包，也不能在安装通过后重新构建另一个包去上传。
5. 将同一 tarball 安装到隔离 prefix，在仓库外运行 help/version、非交互与 TUI 启动 smoke 和可控模型/工具闭环；验证 bin/shim、资源定位、生产依赖、卸载以及不读真实用户配置。真实 Provider 测试使用经授权的测试配置，与 fixture 结果分开。
6. dry-run 到此停止并生成可审阅报告，不上传、不改 dist-tag、不打 Git 标签。真实模式输出精确包/版本/目标后发布已验证 tarball；无额外项目审批循环，npm 官方认证挑战仍按账号策略交互完成。
7. 查询 registry 的包名/版本、tarball integrity、dist-tag 和实际安装结果，保存脱敏回执。上传成功但回执网络失败标“待核实”，先查询，不直接重复发包。真实 registry smoke 使用隔离安装位置，不改用户全局 CLI。
8. 失败报告阶段/退出码、已发生的远端动作及恢复步骤。发布成功后说明页或诊断失败不能被误报为“未上传”，也不自动撤回、覆盖版本或移动 latest。

## 认证与发布渠道

本机一键路径使用届时有效的 npm 登录和所需 2FA；不把 OTP/token/密码写脚本、仓库或日志，也不把此前“已登录”当作未来登录永远有效。“一键”是免手工拼接构建/打包/上传命令，不承诺绕过 npm 验证。[npm 发布 2FA 要求](https://docs.npmjs.com/requiring-2fa-for-package-publishing-and-settings-modification/)

CI 已配置 npm OIDC Trusted Publishing，并固定仓库、master、publish-tui.yml、npm-publish environment、hosted runner 和 npm 版本；首次建包和账号信任设置仍需单独完成。按 npm 当时支持的直接发布或 staged 发布策略记录结果；若要求人工批准，上传至 staged 不等于已经在公共 registry 可安装，不绕过该要求。正式 CI 入口允许 direct publish；stage-only 授权不能实现无 npm 人工审批的公开发布。CI 中不检查 npm whoami，也不回退到个人发布 token。[npm trusted publishing](https://docs.npmjs.com/trusted-publishers/)

## 必须实现的验收场景

| 场景               | 必须观察到的结果                                                                                                                                                                              |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 单条命令稳定发布   | 已准备的合法版本执行 npm run publish，检查→打包→隔离安装→上传→回执连通，用户无需手工 cd/复制包/执行第二条上传命令。仅实际发布阶段触发必要认证。                                               |
| dry-run / 门禁失败 | dry-run 和任一门禁失败的运行都没有 registry 发布、dist-tag 修改或 Git 写操作；失败有明确非零退出码。                                                                                          |
| tarball 与运行依赖 | 包内无凭据、用户历史、旧实现、源码目录回退、workspace/file 私有依赖；运行不需要开发依赖或安装后本地编译 TypeScript；必要原生资源在声明 OS/架构上可用。                                        |
| 生产安装           | 在干净 Windows + 声明的 Node 下全局安装、隔离 prefix、npm exec/npx 均能启动 budingx 并跑核心链路；缺/不支持 Node 时有明确信息。macOS/Linux 若声明支持则必须有对应安装证据，未测则不宣称支持。 |
| 版本与通道         | 同版本拒绝重新上传，不自动 bump；预发布必须显式 next 等非 latest 通道，稳定版/预发布与 tag 约束有测试；registry 错误/权限拒绝时不降级到其他账号或地址。                                       |
| 身份与政策         | 登录过期/2FA 取消/无包写权限/命名冲突不产生假成功；CI 若处于 staged 则报告待批准，只有公开可安装才记公开发布成功。                                                                            |
| 上传结果不确定     | 模拟上传后超时/回执失败，能查询版本与 integrity 判定已发/未发/未知，不盲重试；确认已发后继续回执检查，不覆盖版本。                                                                            |
| 升级、回退与卸载   | 从前一版升级保留配置/历史，有迁移和旧 fixture；安装指定旧版的兼容条件明确；缺陷版优先新版本修复或经授权调整 dist-tag/弃用，不把 unpublish 当常规回退；卸载默认保留用户数据。                  |
| npm 原生命令与钩子 | 发布入口/pack/prepack 的调用路径无递归或重复上传，安装脚本永不上传；直接 npm publish 不被文档冒充根目录编排命令。                                                                             |

npm 的上传、文件选择、版本和 tag 行为以官方命令为准；本计划要求先固定版本并上传经检查 tarball，具体参数在实现时针对固定 CLI 版本核验。[npm publish 官方说明](https://docs.npmjs.com/cli/v11/commands/npm-publish/)

## 当前完成情况与剩余条件（2026-11-17）

bootstrap 的 0.1.0/0.1.1 已发布，0.1.1 的 Windows/Linux Actions 验证及真实 OIDC 上传已取得回执；SP002 已完成一个真实服务的五项 Provider 验证。当前 0.2.0 已发布，并取得运行 #7、公开安装、签名和来源核验回执。真实终端 IME、其他平台实际使用、完整升级迁移和上传不确定时的自动恢复仍按各自验收计划推进。脚本遇已存在版本拒绝上传，上传后回执失败应先查询版本/integrity，再核对台账，不盲重试。

## 首发完成回执（2026-11-16）

0.1.0 已发布到官方 npm，latest=0.1.0；integrity、发布时间和实际安装回执见 release-ledger.json 与首发 STATUS。npm trust 配置已通过账号查询核实，首次真实 OIDC 上传仍待下个有实际变更的新版本，不能重复上传 0.1.0。publish:otp 已移除；当前账号通过 Passkey 认证，本机交互发布和 CI/OIDC 分别保留。

首发实测出现“上传成功但元数据延迟可见”：发布脚本现只对版本尚不可见及已知临时网络错误做有限查询（默认最多 31 次、间隔 10 秒，单次查询 10 秒超时），不重复上传，不重试认证错误或错误 JSON，最终 integrity/tag/安装校验保持必需。超过窗口保留 uploaded-awaiting-receipt 状态并要求核对原版本，不能自动 bump 重发。

SP003 权限模式与会话体验已准备为 [0.3.4](../release-notes/v0.3.4.md)。原 0.3.3 候选的修复包含在 0.3.4 中，当前公开版本为 0.3.2。
