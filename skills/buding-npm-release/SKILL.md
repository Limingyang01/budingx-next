---
name: buding-npm-release
description: Use when preparing, building, verifying, publishing or recovering a budingx TUI npm release through GitHub Actions and Trusted Publishing. Not for Desktop/VSIX releases or ordinary SP implementation.
---

# TUI 构建与 npm 发布

先读 [仓库约定](../../AGENTS.md)、[版本规范](../../docs/versioning.md) 和 [构建到发布操作手册](../../docs/github-actions-npm.md)。后者是命令、账号配置、CI 流程和故障恢复的唯一操作文档；不复制旧项目的发布流程。当前只发 `src/tui` 的公开包 `budingx`，根包 private；Node，不依赖 Bun。

## 绑定任务与版本

- 核对实际仓库根目录、`git status --short`、master/HEAD、remote，以及 `src/tui/package.json`、`release-ledger.json`、发行说明和当前工作流。以实时源码和官方 registry 为准，不照搬 0.1.1、历史运行编号或本机绝对路径。
- 区分只准备/验证、Git 提交推送、触发 Actions、实际 npm 发布和回执收尾。已有明确授权继续有效；阅读或调用本 Skill 不自动授权后续外部动作。用户自行触发时，只提供参数并跟进结果，不代为触发。遵守当前工具限制，不把浏览器自动化设为前提。
- 新 SP 交付至少 minor，同轮修复 patch；bootstrap 修复用 patch + iteration bootstrap。当前版本有 published 回执且无 prepared 遗留后才能准备下一版。不为发布测试发明 SP、空版本或重用已发布版本。

## 准备与构建

按操作手册执行锁定安装、`npm test` 和带 `--expected-version` 的真实发布 dry-run。后者包含构建、六文件白名单 tarball、隔离安装、npm shim 和真实本地 HTTP 流式 smoke；不上传。保留报告，核对实际测试数量、制品 integrity 和未验证项。

填好根目录 `release-notes/v<version>.md`，同步产品 README 与相关文档。在已授权范围提交推送准备变更后，查询远端 master SHA，确保 Actions 使用该提交。Git 操作遵守 [buding-merge](../buding-merge/SKILL.md)。不要执行裸 `npm publish` 发布根维护包，也不要把本机账号 Token 传给 CI。

## 正式发布与观察

工作流固定为 `publish-tui.yml`，分支 master，输入准确版本和 tag。dry_run 默认 true；正式发布必须取消勾选并新建运行，Re-run jobs 沿用旧参数。

通过可用的 GitHub CLI/API 或维护者提供的页面/日志跟进同一运行，固定 source SHA 和 run URL。确认 Windows、Linux 验证均 success 后，发布 job 也必须 success。整体绿色但 publish skipped 只算验证成功。

OIDC 发布依赖 GitHub-hosted runner、发布 job 的 id-token:write、npm-publish environment，以及 npm 对精确仓库/工作流/environment 的 Trusted Publisher。新电脑不需要保存 npm 发布 Token；GitHub 登录和配置的环境审批仍适用。认证失败先核对这些字段和日志，不静默回退个人 Token/OTP。账号操作只让维护者在官方界面完成，不索取凭据。

## 公开安装与回执

1. 从固定官方源查询精确版本、dist-tag、integrity，核对发布身份为 GitHub Trusted Publisher。按操作手册在隔离目录安装官方包，验证 shim 版本与 HTTP smoke；fixture 不代表真实外部模型验证。
2. 验证 registry signature/attestation，核对 provenance 的 source SHA、工作流和运行地址。无法验证的项明确列出，不以工作流名称代替 OIDC 证据。
3. 优先下载该运行的 `tui-publication-receipt`，检查 report.state 为 published-and-installed，使用 `npm run release:sync -- --receipt <path>` 导入。该工具会查询 npm integrity，但不独立验签 artifact，不能导入来源不明的 JSON。
4. 无法下载 CI artifact 时，不能伪造 CI report。可以依据公开运行成功、已验证 provenance、registry integrity 和本机独立安装结果更新台账，明确记录 verificationSource 和证据缺口；证据不够就保留 pending。
5. 更新台账、STATUS、当前状态和发布说明。在授权范围提交推送收尾记录，核对远端 SHA。记录发布源码 SHA 与后续文档提交 SHA，二者不同是正常的，不重发制品。

## 停止与恢复

上传状态不确定或上传后安装/回执失败时，先查询精确版本并检查原报告；只重试有界元数据查询，不重复上传、不自动 bump。版本已存在就验证并收尾；staged 不是公开成功。日志 API 无权限时请维护者提供必要日志或 artifact，不读取凭据绕过权限。

交付至少包含：版本/tag、发布源码 SHA、运行 URL、Windows/Linux/publish 结果、registry integrity、安装与来源验证、台账和文档位置、Git 提交/远端状态、未验证能力。只准备文档或 Skill 的任务不启动真实发布。
