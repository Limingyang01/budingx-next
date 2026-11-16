# 简易 TUI 首发状态

USER_CONFIRMED：MIT、OpenAI 兼容配置/流式对话 TUI、验证后发布 npm；bootstrap 0.1.0，非 SP 完成。

已实现独立配置、SSE 客户端、终端入口、版本准备、tarball 安装 smoke 和本地发布编排。dry-run 已通过；正式 registry 发布待执行/核实。外部真实 Provider 没有明确授权的测试凭据，UNVERIFIED；本地真实 HTTP 只证明协议和执行链路。

TUI 覆盖率实测：行 95.28%、分支 80.00%，日志 artifacts/tui-coverage.log（忽略目录）。最终测试数量和发布回执交付时补充。全部 SP 和高级能力尚未启动；bootstrap 代码已提交 f3c4675 并推送 origin/master，经 GitHub API 核实。

发布尝试：23 项自动测试通过，Windows 真实终端 /config /model /help /exit smoke 通过，tarball 隔离安装及 npm shim 通过，Gitleaks 未发现泄漏。npm PUT 因 2FA 返回 403，随后查询 0.1.0 仍 E404；当前等待官方浏览器认证，不标 published。独立代码审查未发现重要问题，审查复测 14 项通过；真实终端 Ctrl+C 尚无交互自动化证据，API 取消/超时有回归覆盖。Git 提交与推送已完成并核实。

账号 2FA 已配置完成；刷新登录后 npm 已进入 /auth/cli 的发布专用认证流程，该认证未完成，最终轮询返回认证会话 404。随后 npm view budingx@0.1.0 再次返回 E404，确认版本未发布；台账保留 prepared，不重复上传。用户可在本机交互终端运行发布命令并及时完成浏览器验证。

Git 回执：bootstrap 代码 f3c4675、交付记录 6647943 均已推送，GitHub API 验证与本地 SHA 一致。本记录随后追加认证失效结果，不改动产品代码或版本。

后续调整（2026-11-16）：用户选择 GitHub Actions + npm Trusted Publishing。仓库新增手动 master 工作流、OIDC 模式、双平台验证编排和回执同步；账号设置步骤见 Actions 指南。此前 npm 登录/验证过期记录是历史，不代表正在进行本机发包。当前没有再次启动交互发布；账号端和远端 CI 的实际结果另行核实。

Actions 配置本地验证：31 项测试通过（技能 9、TUI 11、发布/工作流/回执 11），实际 tarball/隔离安装/npm shim/HTTP smoke 通过，Gitleaks 未发现泄漏；发布链路独立代码审查无重要问题。原始 dry-run 报告 artifacts/release/0.1.0-1794803380638/report.json（忽略目录）。尚未触发 GitHub-hosted 工作流或配置 npm 账号信任，OIDC 实际上传仍 UNVERIFIED，包台账仍 prepared。

CI 修复（2026-11-16）：运行 #2（https://github.com/Limingyang01/budingx-next/actions/runs/43805958514）中 Windows 通过、Linux 的多轮对话测试失败。已在 Ubuntu/WSL + Node 24.15.0 复现真实 stderr：`readline was closed`；stdin EOF 关闭接口后，异步模型响应完成仍调用 prompt，导致非零退出。新增延迟响应/EOF 回归，修复仅在输入仍开放时提示，不丢弃已排队消息或吞掉错误。原多轮失败恢复断言同时带出 stderr 以便诊断。

修复后 Windows Node 22.22.0/npm 10.9.4 与 Ubuntu/WSL Node 24.15.0/npm 11.12.1 的完整 dry-run 各 32 项通过（技能 9、TUI 12、发布 11），包含真实 tarball 安装与 HTTP smoke。日志在 artifacts/windows-publish-verification.log 和 artifacts/linux-publish-verification.log（本地忽略）。GitHub 的 npm 11.21.2 双平台实测将使用修复提交重新执行；正式 npm 发布仍待账号授权，不由本地测试通过推导。

## 首发成功与最终收尾（2026-11-16）

- GitHub 运行 #3：https://github.com/Limingyang01/budingx-next/actions/runs/43812845334 ，源码 97fb43d，Windows/Linux 验证均通过；publish job skipped（dry-run）。
- 维护者怀疑旧的本地 Passkey 曾被删除；重新注册新 Passkey 后，通过 npm 官方认证完成普通会话首发。未新增/保留任何 OTP 或安全密钥内容到仓库。
- 官方 npm 已公开 budingx@0.1.0，latest=0.1.0，integrity 与上传 tarball 完全一致；在 Node 22.22.0 下从官方源重新隔离安装，npm shim --version 和真实本地 HTTP 流式 smoke 均通过。外部真实 Provider 仍未用测试凭据实测。
- 本次上传曾因 npm 处理延迟，在 uploaded-awaiting-receipt 暂停；没有重复上传。手动续验后原报告已更新 published-and-installed，路径 artifacts/release/0.1.0-1794811652432/report.json（本地忽略），release-ledger.json 已保存公开回执。
- npm trust 已创建并再次查询核对：Limingyang01/budingx-next / publish-tui.yml / npm-publish，包含直接发布及 staged 权限。该配置尚未通过一次真实 OIDC 上传验证；environment 分支保护需维护者核对，不能凭 trust 已建立宣称全部 CI 发布验证完成。
- 已移除未提交的 publish:otp 入口、实现、专用测试和使用文档；它不属于已发布 TUI 包。保留 Passkey 会话发布和 OIDC 工作流。
- 发布脚本新增有限的远端版本可见性查询，覆盖本次真实处理延迟；认证错误/错误 JSON 不重试，超时明确禁止重复上传。收尾本地 npm test 共 36 项通过（技能 9、TUI 12、发布 15）。

产品仍为 bootstrap，不代表任何 SP 或高级 Agent 功能已经完成。后续从真实新版本执行 OIDC 发布，不能重发 0.1.0。

## 0.1.1 发布准备（2026-11-16）

用户已授权将发布流程修复整理为 0.1.1，并通过 GitHub Actions 实际验证 OIDC 与官方 npm 安装。版本为 bootstrap 阶段的 patch，不启动 SP；版本工具新增 bootstrap 回归，产品 README 更新 Windows/Linux 验证范围，根发行说明列明 registry 可见性等待和发布回执链路。初始本地完整 dry-run 37 项通过，包含 tarball 安装与 HTTP smoke；报告 artifacts/0.1.1-local-dry-run.log（忽略目录）。GitHub 运行及实际 registry 状态尚待执行，不预记 published。

用户指定由其手动触发 Actions，禁止 computer-use；Agent 只通过 API 跟进。准备提交需先推送到 master，发布完成后再提交实际回执。当前 0.1.1 台账为 prepared，未请求或使用任何 npm 个人令牌。

## 0.1.1 OIDC 实际发布完成（2026-11-16）

- 准备提交 49857ad3d7b94aebc2d2b722078bc2c880403bb2 已推送；运行 #5 的 Windows/Linux 通过但 publish skipped，未据此标记成功。
- 用户重新以 master、0.1.1、latest、dry_run=false 触发 [运行 #6](https://github.com/Limingyang01/budingx-next/actions/runs/43826550093)。Windows Node 22/Linux Node 24 验证和 Publish verified TUI using npm OIDC 全部 success。该源码的完整本地 dry-run 共 37 项通过（技能 9、TUI 12、发布 16）。
- 官方 npm 公开 0.1.1，latest=0.1.1；发布者为 GitHub Actions，trustedPublisher.id=github。provenance 的源码 SHA、工作流、运行地址和 tarball SHA512 对应一致，npm audit signatures 验证 1 个 registry signature 与 1 个 attestation 均通过。
- 本机 Node 22 从官方源在隔离目录重新安装精确版本，npm shim --version=0.1.1，真实本地 HTTP 流式 smoke 通过；不修改全局安装。独立验证证据在 artifacts/0.1.1-registry-verification/verification.json，公开证明保存在 artifacts/0.1.1-attestations.json（均忽略）。
- release-ledger.json 依据公开 GitHub 结果、npm 元数据/已验证 provenance 和本机独立安装更新 published。未下载原始 CI artifact，未冒充原始报告；它保留在运行 #6 的 tui-publication-receipt 中。0.1.0 历史字段保留。
- 本次 API 跟进和安装验证未使用 computer-use、个人 npm Token 或额外账号验证。外部真实模型仍 UNVERIFIED，macOS 未认证；未启动 SP 或扩大聊天 TUI 功能。
