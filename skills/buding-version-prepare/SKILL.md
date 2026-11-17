---
name: buding-version-prepare
description: Use when the user asks to bump or upgrade the budingx product version, prepare the next release version, or synchronize version-related documents before publishing. Not for triggering an npm publication or collecting a completed publication receipt.
---

# budingx 产品版本准备

用于「升级版本号」「准备发版版本」「同步版本相关文档」。以真实 `src/tui/package.json` 为版本源，根 private 包的 `0.0.0` 不变。先读 [版本规范](../../docs/versioning.md) 和 [发布操作手册](../../docs/github-actions-npm.md)；本技能不代替用户指定的发布方式。

## 绑定当前发布目标

- 检查实际 cwd、分支、HEAD、remote、暂存/未暂存/untracked；保护用户已有改动和同时进行的任务。明确 SP、目标渠道与用户是否自行执行工作流。
- 查询官方 `https://registry.npmjs.org` 的当前版本、dist-tag 和目标版本是否存在；只读取公开元数据，不要求 npm Token。
- 检查 `release-ledger.json`：上一版本须有已确认的 published 回执；若已有 prepared 候选，先完成同一候选，不重复 bump、不删条目绕过工具。上传状态不明时先核实原版本。
- 新 SP 的首次产品交付至少 minor，同一 SP 修复 patch；SP 编号不能凭参考仓猜测。1.0.0 的完整能力门槛遵守版本规范。
- 本地提交、合入、推送与实际发布分别绑定现有授权。用户自行执行 GitHub 工作流时，不代为触发或上传 npm。若 Git 授权缺失，先完成可审阅的版本准备和验证，再只确认最后缺失的动作。

## 使用现有版本工具

在根目录执行下列命令，将 kind 和 SPnnn 替换为已确定值：

```text
npm run version:prepare -- kind --iteration SPnnn
```

工具会同步 `src/tui/package.json`、`release-ledger.json` 和 `release-notes/v<version>.md`。填写真实发行说明，保留历史 published 条目的所有字段。不得复用已发布版本，不修改根维护包版本，不自行打 tag。

## 同步全部版本相关文档

按当前仓库查询版本引用，再逐项分类，不全局替换旧版本字符串：

- **当前入口**：PRODUCT.md、根 README、src/tui/README、docs/current-status、文档导航。分别写明源码版本 prepared 与 npm 实际已发布版本，不能把待发布版本写成 latest 已更新。
- **操作规范**：docs/versioning、development、npm-release-plan、github-actions-npm。当前命令/参数对应准备版本；回执之后的示例区分同轮 patch 与已确认新 SP minor，不能让维护者再次 minor 同一轮。
- **迭代记录**：当轮 requirements-summary、各功能 STATUS、test-report，追加本次准备状态和真实验证边界；保留历史证据身份。
- **发行说明**：功能、用户配置/按键/依赖、bin/资源路径等兼容变化，升级操作、限制、未验证项及维护者工作流参数。文件清单以真实 tarball 为准，不复用过时的固定文件数。随包 README 侧重版本与使用说明，动态发布状态放台账和根发布文档；收尾不重发同版本来改已发布文件。
- **历史材料**：旧发行说明、已发布台账、旧规格/设计基线中的旧版本保持原值；必要时加当前入口指针。文案中的测试 fixture 版本也不自动变成当前产品版本。

生产配置和本机 `.env.e2e.local` 不提交、不复制到发行说明或制品，不读取其他工具凭据。源码本地启动便利配置不扩展到正式产品。技能与文档不是已经实现的产品能力。

## 验证与交付

- 按所属格式处理当前任务文件。没有对应 formatter 时如实记录，不重排无关文件。
- 在可信的干净源码副本/既有隔离环境中执行锁定安装和真实发布 dry-run，避免混入其他任务的改动。用实际版本替换 VERSION：

```text
npm ci --ignore-scripts --no-audit --no-fund
npm run publish -- --dry-run --expected-version VERSION --tag latest
```

- 核对退出码、实际测试数、tarball 文件白名单、integrity、安装后的 CLI 版本和本地 HTTP smoke。fixture、真实 Provider、真终端、不同平台分别记录；未测项保留 UNVERIFIED 与恢复条件。
- 对 CI 模式敏感的交互测试，在 `CI=true` 环境执行发布预演，复现工作流模式；不通过关闭 CI、跳过用例或放宽断言获得绿测。实际 Windows/Linux 托管运行仍由工作流分别验证。
- 预演不上传 npm；CI Windows/Linux 验证由维护者触发后单独确认。错误时修复后重测，不降低门槛或把未发布台账改成 published。
- 按 [buding-merge](../buding-merge/SKILL.md) 固定源/目标与 outgoing，执行已授权的本地提交、门禁 GREEN 后合入 master，以及已授权的推送。保护无关暂存，不强推；推送后查询远端 master SHA。用户发布分支为 master 时，不能只留下功能分支候选。
- 交付版本/SP/tag、已更新文档、验证成绩和报告、Git 源/远端 SHA、未验证项，并给出工作流 branch/version/tag/dry_run 参数。明确尚未发布，由谁触发；真实发布和回执收尾另按 [buding-npm-release](../buding-npm-release/SKILL.md)。
