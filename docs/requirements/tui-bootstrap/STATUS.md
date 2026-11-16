# 简易 TUI 首发状态

USER_CONFIRMED：MIT、OpenAI 兼容配置/流式对话 TUI、验证后发布 npm；bootstrap 0.1.0，非 SP 完成。

已实现独立配置、SSE 客户端、终端入口、版本准备、tarball 安装 smoke 和本地发布编排。dry-run 已通过；正式 registry 发布待执行/核实。外部真实 Provider 没有明确授权的测试凭据，UNVERIFIED；本地真实 HTTP 只证明协议和执行链路。

TUI 覆盖率实测：行 95.28%、分支 80.00%，日志 artifacts/tui-coverage.log（忽略目录）。最终测试数量和发布回执交付时补充。全部 SP 和高级能力尚未启动；bootstrap 代码已提交 f3c4675 并推送 origin/master，经 GitHub API 核实。

发布尝试：23 项自动测试通过，Windows 真实终端 /config /model /help /exit smoke 通过，tarball 隔离安装及 npm shim 通过，Gitleaks 未发现泄漏。npm PUT 因 2FA 返回 403，随后查询 0.1.0 仍 E404；当前等待官方浏览器认证，不标 published。独立代码审查未发现重要问题，审查复测 14 项通过；真实终端 Ctrl+C 尚无交互自动化证据，API 取消/超时有回归覆盖。Git 提交与推送已完成并核实。

账号 2FA 已配置完成；刷新登录后 npm 已进入 /auth/cli 的发布专用认证流程，当前进程等待用户浏览器确认。尚不记录公开发布成功。
