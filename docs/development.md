# 开发与发布

统一 Node.js >=22.18、TypeScript、master，不使用 Bun。当前产品为 src/tui 中的聊天预览，完整 Agent 见 [路线图](iteration-plan.md)，单仓源码边界见 [仓库布局](repository-layout.md)。

## 当前真实命令

```powershell
npm ci --ignore-scripts --no-audit --no-fund
npm run build
npm start
npm run skills:check
npm test
npm run publish -- --dry-run
```

npm test 执行技能维护、TUI 编译/回归及版本管理测试。dry-run 另生成实际 tarball，在仓库外安装并验证 npm 命令 shim 与本地真实 HTTP 流式请求；不上传。当前没有 Desktop/VSIX 构建，不照搬旧仓命令。

配置和限制见 [TUI README](../src/tui/README.md)。只用显式参数/BUDINGX_MODEL、BUDINGX_BASE_URL、BUDINGX_API_KEY；首发不落盘，不从其他工具寻找凭据。未来用户数据统一通过当前用户 home 解析到 ~/.budingx，不读写 ~/.claude。

## 版本和发布

每个新 SP 完成交付至少 minor 更新，同轮修复 patch，详见 [版本规范](versioning.md)。首发成功后的例子：

```powershell
npm run version:prepare -- minor --iteration SP001
```

该命令只准备版本、台账和发行说明，不提交/推送/tag。填完真实变更与验收后，在已有发布授权范围内执行 npm run publish。根维护包保持 private，只发 src/tui 白名单 tarball。推荐通过 GitHub Actions/OIDC 发布，详见 [Actions 设置与操作](github-actions-npm.md)。本机登录/2FA 仅用于首次建包或显式交互发布；0.1.1 已实测 CI/OIDC 发布；完整 Agent 全能力发布仍待后续迭代。详见 [发布方案](npm-release-plan.md)。

## 验证边界

维护检查不证明产品，fixture 不证明真实外部模型，编译不证明安装。真实 Provider 需要经授权的测试配置，不读取旧用户目录。运行时检查见 Node 测试和首发记录；测试环境使用临时目录和本地测试端口，只管理自己创建的资源。

CI 发布成功后下载 report.json，执行 `npm run release:sync -- --receipt <path>` 核对 npm integrity 并同步台账，审阅提交后再准备下一迭代版本。该命令不需要发布 token，不自动写 Git。
