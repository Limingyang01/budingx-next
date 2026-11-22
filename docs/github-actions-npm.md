# GitHub Actions + npm Trusted Publishing

本项目的推荐发布入口是 [Publish TUI to npm](https://github.com/Limingyang01/budingx-next/actions/workflows/publish-tui.yml)。配置文件见 [.github/workflows/publish-tui.yml](../.github/workflows/publish-tui.yml)。本指南说明仓库已实现的流程，以及账号端必须由维护者完成的设置；写入工作流不等于 npm 信任关系已建立或真实发布已验证。

## 当前发布状态（2026-11-22）

**0.8.0（SP008 多端架构入口与共享边界）已发布，npm `latest` 指向 0.8.0。** [GitHub Actions #45010118350](https://github.com/Limingyang01/budingx-next/actions/runs/45010118350) 使用源码 `b71b3f5`，`Verify (ubuntu-24.04)`、`Verify (windows-latest)` 与 `Publish verified TUI using npm OIDC` 三个作业全部成功，publishedAt=2026-11-22T10:06:13.912Z。官方 registry integrity、attestation/provenance（GitHub Trusted Publisher）、本机隔离安装与签名核验均通过；CI 的 `tui-publication-receipt` artifact 下载需登录未取得，台账依据公开证据登记并标注 `ciArtifactDownloaded: false`。首次运行 #45003613733 曾在 ubuntu-24.04 因测试取样竞态失败，修复（`37a4cfd`）后重新触发成功。详见 [0.8.0 发行说明](../release-notes/v0.8.0.md)。

**0.7.0（SP007）已发布，npm `latest` 指向 0.7.0。** [GitHub Actions #27](https://github.com/Limingyang01/budingx-next/actions/runs/44921288352) 使用源码 `a8628b5`，`Verify (ubuntu-24.04)`、`Verify (windows-latest)` 与 `Publish verified TUI using npm OIDC` 三个作业全部成功，publishedAt=2026-11-21T15:58:10.709Z。官方 registry integrity、attestation/provenance（GitHub Trusted Publisher）、本机隔离安装与签名核验均通过；CI 的 `tui-publication-receipt` artifact 下载需登录未取得，台账依据公开证据登记并标注 `ciArtifactDownloaded: false`。详见 [0.7.0 发行说明](../release-notes/v0.7.0.md)。

**0.6.0 已发布，npm `latest` 指向 0.6.0。** [GitHub Actions #26](https://github.com/Limingyang01/budingx-next/actions/runs/44870468295) 使用源码 `4a63ead`，`Verify (windows-latest)`、`Verify (ubuntu-24.04)` 与 `Publish verified TUI using npm OIDC` 三个作业全部成功。官方 registry integrity、attestation/provenance（GitHub Trusted Publisher）、本机隔离安装与命令入口复验均通过；CI 的 `tui-publication-receipt` artifact 下载需登录未取得，台账依据公开证据登记并标注 `ciArtifactDownloaded: false`。详见 [0.6.0 发行说明](../release-notes/v0.6.0.md)。

**0.5.4 已发布**（此前 latest 指向 0.5.4）。[GitHub Actions #23](https://github.com/Limingyang01/budingx-next/actions/runs/44682798887) 使用源码 `16f5e0c`，Ubuntu、Windows 和 OIDC 发布均通过。官方制品完整性、独立安装、本地 HTTP 流式冒烟、签名和 provenance 已核验。详见 [0.5.3 发行说明](../release-notes/v0.5.3.md)。

**0.4.0 已发布**，当时 npm `latest` 指向 0.4.0。[GitHub Actions #18](https://github.com/Limingyang01/budingx-next/actions/runs/44504716724) 使用源码 `82af4ab`，Windows、Linux 和 OIDC 发布均通过。官方源独立安装、本地 HTTP 流式测试、签名与来源证明均已核对。详见 [0.4.0 发行说明](../release-notes/v0.4.0.md)。

**0.3.6 已发布**，当时为 npm `latest`。[GitHub Actions #15](https://github.com/Limingyang01/budingx-next/actions/runs/44304795619) 的 Windows、Linux 与 OIDC 发布均成功，官方源隔离安装及签名核验通过。详见 [v0.3.6 发行说明](../release-notes/v0.3.6.md)。

SP003 的 **0.3.5 已发布**，当时为 npm latest。[GitHub Actions #14](https://github.com/Limingyang01/budingx-next/actions/runs/44262744543) 的 Windows、Linux 与 OIDC 发布均成功，官方源隔离安装及签名核验通过。详见 [v0.3.5 发行说明](../release-notes/v0.3.5.md)。

SP003 的 **0.3.4 已发布**，当时为 npm latest。[GitHub Actions #13](https://github.com/Limingyang01/budingx-next/actions/runs/44257392923) 的 Windows、Linux 与 OIDC 发布均成功，官方源隔离安装及签名核验通过。详见 [v0.3.4 发行说明](../release-notes/v0.3.4.md)。

SP003 的 **0.3.2 已发布**，当时为 npm latest。[GitHub Actions #12](https://github.com/Limingyang01/budingx-next/actions/runs/44248899298) 的 Windows、Linux 与 OIDC 发布均成功，官方源隔离安装及签名核验通过。详见 [v0.3.2 发行说明](../release-notes/v0.3.2.md)。

SP003 的 **0.3.1 已发布**，当时为 npm latest。[运行 #11](https://github.com/Limingyang01/budingx-next/actions/runs/44229230445) 的 Windows、Linux 与 OIDC 发布均成功，官方源隔离安装通过。详见 [v0.3.1 发行说明](../release-notes/v0.3.1.md)。

SP002 的 **0.2.0 已发布**，当时 npm latest=0.2.0，台账为 published。维护者执行的 [运行 #7](https://github.com/Limingyang01/budingx-next/actions/runs/44055301185) 基于 6ed77d8，Windows/Linux 验证和 OIDC 发布均成功。公开安装、签名和 provenance 已核验，见 [v0.2.0](../release-notes/v0.2.0.md)。原始 CI artifact 下载要求登录，尚未取得；台账使用公开来源和独立安装证据，不伪造 CI report。不得重发 0.2.0。

## 历史发布回执（2026-11-16）

- budingx@0.1.0 已通过普通账号会话和 Passkey 完成首发，当时 latest=0.1.0；registry integrity 与已验证 tarball 一致，已从官方源隔离安装、验证 npm 命令入口和 HTTP smoke。
- [GitHub 运行 #3](https://github.com/Limingyang01/budingx-next/actions/runs/43812845334) 基于 97fb43d，Windows/Linux 的验证均成功；该运行是 dry-run，发布 job 跳过，不能当作真实 OIDC 上传证明。
- [GitHub 运行 #6](https://github.com/Limingyang01/budingx-next/actions/runs/43826550093) 基于 49857ad，Windows/Linux 验证及 OIDC 发布全部成功，budingx@0.1.1 已公开，latest=0.1.1。npm 元数据的 Trusted Publisher、已验证的 provenance、源码 SHA 与运行地址对应一致；官方源隔离安装、npm shim、HTTP 流式 smoke 和 npm audit signatures 均通过。
- npm Trusted Publisher：Limingyang01/budingx-next、publish-tui.yml、environment npm-publish，允许直接发布；首次真实 OIDC 上传已验证，GitHub environment 已限制 master。
- 发布台账已记 published。0.1.0、0.1.1 均不可再次上传；下次按实际变更准备新版本。publish:otp 已移除，不再维护专用六位码发布路径。

## 已配置的仓库能力

- 仅 workflow_dispatch 手动触发，明确选择 master、输入与 src/tui/package.json 完全相同的版本、latest/next 和 dry_run；默认 dry_run=true。
- Windows Node 22 与 Linux Node 24 分别执行测试、真实 tarball 打包及隔离安装 smoke。发布 job 等两者通过后，在 Linux 上重新构建并测试它实际上传的同一个 tarball。
- 发布 job 使用 GitHub-hosted runner、npm 11.21.2、environment npm-publish，只有此 job 有 id-token:write；GitHub 内容权限只读。
- 使用 OIDC 临时凭据，CI 不运行 npm whoami，不接收 NPM_TOKEN/NODE_AUTH_TOKEN，不设置 npm 发布 secret，不把个人登录状态复制给 CI。
- 发布前校验身份/分支/工作流、预期版本、prepared 台账、发行说明及文件白名单；发布后核对 registry integrity、dist-tag 和隔离安装。
- Actions artifact 保存 tarball、report.json 和 runner 上更新的 release-ledger.json。不会给机器人 Git 写权限或自动提交版本，不改版本号后再偷偷发布。

## 从构建到发布：每轮操作清单

本节适用于新版本交付，不需要重复配置已建立的账号信任。Agent 使用 [buding-npm-release](../skills/buding-npm-release/SKILL.md)，版本规则见 [版本规范](versioning.md)。执行目录是本仓根目录。0.8.0（SP008）的发布回执已登记，npm `latest` 指向 0.8.0；后续按实际修复或新 SP 准备下一版。

### 1. 准备版本与发行说明

先检查工作区、当前包版本和台账。上一版必须 published，且不能遗留 prepared 版本；如果上传状态未知，先按本文恢复流程查清。新 SP 完成交付至少 minor，同轮修复 patch：

```powershell
git status --short
Get-Content src/tui/package.json
Get-Content release-ledger.json
# 新 SP 首次产品交付：先将 SPnnn 替换为已确认编号
npm run version:prepare -- minor --iteration SPnnn
# 已发布 SP 的后续修复使用 patch，且只在实际修复交付后准备
# bootstrap 维护修复的替代命令（只选择符合本次交付的一条）：
# npm run version:prepare -- patch --iteration bootstrap
```

prepare 同步产品版本、台账和根发行说明草稿。填完 `release-notes/v<version>.md` 的真实变更、验收和限制，按实际影响更新 README、STATUS 和使用文档。不要把根 private 包的 0.0.0 当作产品版本，不手工复用已经公开的版本。

### 2. 锁定安装、构建与发布预演

```powershell
npm ci --ignore-scripts --no-audit --no-fund
$releaseVersion = (Get-Content src/tui/package.json -Raw | ConvertFrom-Json).version
npm run publish -- --dry-run --expected-version $releaseVersion --tag latest
```

逐条确认命令退出码为 0 后再继续；预演失败时不要提交发布准备或触发正式上传。它调用 npm test（技能、TUI 编译/回归、发布工具测试），然后 pack 并隔离安装真实 tarball，检查 npm 命令入口与本地 HTTP 流式 smoke。只需编译时用 `npm run build`；编译不能替代完整发布预演。预演报告位于忽略目录 `artifacts/release/<version>-<timestamp>/report.json`，不会上传 npm。

SP003 制品含 package.json、README.md、LICENSE 和 dist/{core,provider,storage,tui,workspace} 下编译 JS；bin 为 dist/tui/cli.js，实际文件数以本次 dry-run 为准，不包含源码仓、开发依赖或用户配置。发布预演用当前 Node；Windows Node 22、Linux Node 24 的托管门禁仍由 Actions 分别执行。

### 3. 提交准备、正式运行与公开核实

在已授权范围内审阅、提交并推送准备变更，核对远端 master 的 SHA；触发方式见下文“一键发布”。使用当前 $releaseVersion 和选定 tag，正式运行须取消 dry_run。两端验证及 publish job 均 success 后，再核对官方源：

```powershell
npm view "budingx@$releaseVersion" version dist.integrity _npmUser dist.attestations --json --registry=https://registry.npmjs.org
npm view budingx dist-tags --json --registry=https://registry.npmjs.org
```

latest/next 应指向本次所选版本，发布身份应为 GitHub Trusted Publisher。provenance 的源码 SHA、工作流路径、运行地址与这次 Actions 匹配；该证明与实际下载 tarball 的完整性必须一致。不能仅凭总状态绿色或包存在就宣称 OIDC 已验证。

### 4. 从官方源独立安装复验

以下安装到本次新建的临时目录，不修改全局 budingx，也不使用其他工具的配置或密钥；先沿用上面读取的精确 $releaseVersion：

```powershell
$verifyRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("budingx-npm-verify-" + [guid]::NewGuid())
npm install --prefix $verifyRoot --ignore-scripts --no-audit --no-fund "budingx@$releaseVersion" --registry=https://registry.npmjs.org
npm exec --offline --prefix $verifyRoot -- budingx --version
npm audit signatures --prefix $verifyRoot --registry=https://registry.npmjs.org
node --input-type=module -e "import {smokeInstalled} from './scripts/release/smoke.mjs'; console.log(await smokeInstalled(process.argv[1], process.cwd()))" (Join-Path $verifyRoot 'node_modules/budingx')
```

安装后命令版本必须匹配，签名/attestation 和 HTTP smoke 均应通过；任一失败应保留现场诊断，不盲目重发。该 smoke 使用当前 Node、临时本地 HTTP 模型，不读取真实 API Key；外部真实 Provider 需另外授权配置和验证。临时目录路径可保存到本地验收记录；本流程不清理未知目录。

### 5. 保存发布证据并收尾

按下文导入该运行的原始 CI 回执；随后更新 release-ledger、当轮 STATUS、当前状态及发行说明，记录源码 SHA、运行 URL、制品 integrity、安装/来源验证与缺口。收尾文档提交晚于发布源码是正常情况，无需重新发布同一版本。经授权提交推送后核对远端 SHA，才算完成本轮交付。

如果日志/artifact API 要求登录，可由维护者下载正确运行的 artifact。无法下载时不伪造 CI report：可像 0.1.1 一样，基于公开成功运行、已验证 provenance、官方 registry integrity 和独立安装更新台账，明确记录 `verificationSource` 及未取得原始 artifact 的限制。证据不足就保留待核实状态。

## 首次启用：需要你在账号侧做什么

### 1. 首次建立 budingx 包

本项目已完成 0.1.0 首发及授信，budingx 无需重复本节操作。以下保留为尚未建包项目的一次性操作说明：npm 要求包已经存在，才能创建 Trusted Publisher；不能用尚未配置的 OIDC 工作流绕过首次建包。[npm trust 前置条件](https://docs.npmjs.com/cli/v11/commands/npm-trust/)

请在个人可信设备上完成一次实际首发及账号验证。使用个人设备已绑定的通行密钥（本机 PIN/指纹）或个人实体安全密钥，可以不扫码；不要在非个人电脑上新增本机凭据。邮件登录验证码不替代发布 2FA，npm 已停止新增 Google Authenticator/TOTP 绑定。[认证变更](https://github.blog/changelog/2025-10-10-strengthening-npm-security-important-changes-to-authentication-and-token-management/)

个人设备安装 Node >=22.18 后可执行：

```powershell
git clone https://github.com/Limingyang01/budingx-next.git
cd budingx-next
npm ci --ignore-scripts
npx --yes npm@11.21.2 login --auth-type=web --registry=https://registry.npmjs.org
npx --yes npm@11.21.2 run publish
```

使用 npm 账号自己的安全验证，密码/动态码/密钥只在 npm 官方界面操作，不发给 Agent。首发脚本只发布 src/tui 的合法 MIT 产品包，不发布根维护包；运行后核实 npm 页面确有 0.1.0。首发成功后，脚本更新个人设备副本的 release-ledger.json；将这条回执提交/推送或交由当前 Agent 在授权范围内同步。不要再次发布已存在的 0.1.0，不为配置 CI 创建空壳包。

若账号无法完成安全验证，先解决 npm 账号访问；Actions 不能代替账号恢复或首次信任授权。本项目当前不自动建立真实 npm 包、创建 token 或改账号认证方式。

### 2. GitHub 仓库和 Environment

在 [GitHub Environments](https://github.com/Limingyang01/budingx-next/settings/environments) 建立名为 **npm-publish** 的 environment，允许部署分支设为 master。按团队需要选择是否启用 required reviewers；启用后每次正式发布还需要 GitHub 环境审批。

确保仓库 Actions 已启用、默认分支为 master，并允许执行工作流中固定 SHA 的官方 checkout/setup-node/upload-artifact。**不需要添加 NPM_TOKEN secret**，也不需要开启 Actions 的仓库内容写权限。

### 3. npm Trusted Publisher

包存在后，在 npm 的 budingx → Settings → Trusted Publisher 中选择 GitHub Actions，准确填写：

| 字段                 | 值                                                                        |
| -------------------- | ------------------------------------------------------------------------- |
| Organization or user | Limingyang01                                                              |
| Repository           | budingx-next                                                              |
| Workflow filename    | publish-tui.yml                                                           |
| Environment name     | npm-publish                                                               |
| Allowed actions      | **允许直接 npm publish**；只有 stage publish 不符合本项目一键公开发布目标 |

工作流名称、大小写及 environment 必须完全匹配。此账号设置仍需你使用 npm 的安全验证；无需把 token 提供给 GitHub 或 Agent。新 trust 配置需在官方规定的有效期内完成首次成功发布（目前为 2 天），过期则按 npm 页面重建；普通 dry-run 不会激活 trust。[npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/)

可在个人设备使用 CLI 配置同样关系（仍会要求交互安全验证，包必须已存在）：

```powershell
npx --yes npm@11.21.2 trust github budingx --repo Limingyang01/budingx-next --file publish-tui.yml --environment npm-publish --allow-publish
```

如果 npm 页面只允许 staged 发布，需人工批准才能公开，不能把 staged 成功当作已公开；本工作流走 direct publish，不自动改成 stage 或绕过账号策略。来自 OIDC 的发布通常会自动生成 provenance，无需手工管理长期凭据。

## 配置后：一键发布

1. 先准备并审阅产品版本和发行说明，提交推送到 master。每个新 SP 交付至少 minor，同轮修复 patch，见 [版本规范](versioning.md)。
2. 在 Actions 选择 **Publish TUI to npm → Run workflow**，branch 选 master，输入该版本，tag 选 latest 或 next。
3. 首次可以保持 dry_run 勾选以验证 CI 环境；它不会上传，也不证明 OIDC 授权已成功。
4. 正式发布取消 dry_run，点击 Run workflow 新建运行；不要用 Re-run jobs 改参数，它会沿用原输入。若发布 job skipped，不能以整体绿色认定已发布。授信允许 direct publish 后，不需要每次 npm 扫码/动态码；GitHub 登录和可选环境审批仍遵守你的账号策略。
5. 确认 publish job 成功，查看 artifact tui-publication-receipt 的 report.json：state 必须是 published-and-installed。仅 verify job 成功、artifact 上传成功、stage 成功都不等于公开发布。

第一次手工发出 0.1.0 后，应按实际新交付准备下一个版本再测 OIDC；不能用同一个 0.1.0 再验证上传，也不自动 bump 一个空版本。workflow version 输入没有固定默认值，防止后续迭代误发旧版。

## 把 CI 回执同步到版本台账

工作流对 GitHub 内容只读，runner 更新的台账不会直接写回 master。下载成功运行的 report.json，在源码仓执行：

```powershell
npm run release:sync -- --receipt C:/path/to/downloaded/report.json
```

该命令核对当前包版本、成功状态和 GitHub run 地址格式，并向固定公共 npm registry 查询 immutable version/integrity 后，更新 release-ledger.json，保留原有未知字段。它信任维护者从正确 Actions artifact 下载的 JSON，不独立验签 artifact 或验证 GitHub run 结论；不要导入来源不明的报告。随后审阅并提交回执，才能准备下一轮：同一 SP 修复使用 patch，已确认的新 SP 首次产品交付使用 minor。0.5.2 的登记依据与来源见 [0.5.2 发行说明](../release-notes/v0.5.2.md)。旧版回执保留为历史证据。

本机核对公开 npm 元数据和导入回执不需要发布 token。首次手工首发的 session 回执由当时的脚本直接更新台账，本命令专用于 CI/OIDC 报告。

## 失败与恢复

- 版本已经存在：停止上传，核对实际 registry 和原运行，不自动 bump 或覆盖版本。
- 上传后回执/安装失败：先按精确版本查询，保留 report 状态；不要点击重新运行去盲重发。确认已公开但报告不完整时，由维护者核对制品/安装和台账，不能伪造成功报告解锁版本。
- ENEEDAUTH/OIDC 失败：核对包是否存在、账号是否有写权限、trust 字段/允许操作/environment、runner、id-token 权限和 npm 版本；不要添加个人 token 作为静默 fallback。
- staged 状态：不是公开成功，需要 npm 对应的审批；本项目默认 direct 模式不会自动批准 staged 包。
- master 之外触发：工作流不执行发布；fork 和其他工作流上下文也会被发布脚本拒绝。

## 当前证据边界

0.4.0 的 Windows/Linux 验证、OIDC 公开发布、官方源隔离安装、registry 签名和 provenance 已核验。运行 #18 的原始 CI 工件下载返回 HTTP 401，台账依据公开运行、已验签的 npm provenance 和独立安装结果登记。外部真实模型和 macOS 仍未验证。详见 [0.4.0 发行说明](../release-notes/v0.4.0.md)和[发布台账](../release-ledger.json)。
