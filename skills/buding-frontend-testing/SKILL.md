---
name: buding-frontend-testing
description: Use when validating Coding Agent UI, TUI interaction, frontend state, API clients, or editor webviews. Not for documentation-only edits, Git-only operations, or server-only tests.
---

# budingx-next 界面验证

先读 [AGENTS.md](../../AGENTS.md)、[开发指南](../../docs/development.md) 与 [技术栈路由](../buding-sdd/references/technology-map.md)。当前已有基于 Node readline 的 src/tui 聊天预览；Desktop、Webview 和移动端尚未实现。产品验证以实际 package.json 为准。本技能提供将来的验证规则，不证明这些产品能力存在。

定位实际受影响包后读取 package、测试配置、入口和相邻测试；命令必须真实存在且记录 cwd。不套用旧仓 React/Zustand/Vitest 版本或 desktop 路径，不为借用旧测试而安装旧框架。当前文档/技能维护只做相关维护检查，小 README 编辑不启动 UI 全量门禁或正式 SDD。

## 选择最小证据

| 风险 | 验证重点 | 证据 |
| --- | --- | --- |
| 视觉/布局 | 主题、长文本、空态、窄屏、稳定控件尺寸 | 真实界面/终端、必要截图与度量 |
| 交互/状态 | 会话切换、异步竞态、输入、焦点、权限与取消 | 可观察行为断言与适用真实 smoke |
| 请求/事件 | 字段、错误、流式事件、重连、旧事件隔离 | 请求形状和事件 fixture；真实链路另记 |
| 消费者/宿主 | 实际共享组件、平台能力和降级 | 各消费者回归及明确环境边界 |

每项对应用户 AC、文件/用例、层级和结果。DOM 模拟不证明真实布局/滚动，非交互输出不证明 TUI 键盘流。截图不证明请求、权限或操作已发生。不得注入 CSS、隐藏错误或伪造结果冒充真实页面证据。

## 执行与隔离

1. 行为变化先证明有意义的目标失败，再做最小实现与复测。测试不 mock 被测状态转换，不以快照替代关键断言。
2. 用所属包真实聚焦入口，读取测试数和实际输出。没有测试设施时先在当前设计/授权内建立最小验证，不编造已通过命令。
3. 模块级状态在 import 前隔离配置；按实际框架恢复 store、订阅、timer、socket 与全局替身。不清空真实 localStorage、用户配置或历史。测试 fixture 与真实账号分开。
4. 普通本地迭代先最近回归，PR/合并/发布按届时实际门禁；不默认全仓 coverage。跨进程/存储/Provider 使用 [runtime-testing](../buding-runtime-testing/SKILL.md)补相应证据。
5. 可逆且属于当前范围的问题自主修复、聚焦复测；无关基线失败记录影响，实质业务分叉才请求决定。

浏览器/终端/桌面 smoke 用当前可用工具。启动服务前确认端口和进程归属，只关闭自己启动的实例；记录地址与停止方式。真实账号、外部发送和其他副作用只在授权范围内进行。Editor host 与 Webview、宿主与渲染端若存在，应分别检查实际协议、编译和运行入口，不能用一端的测试替代另一端。

## 交付

PASS 需要实际执行、目标断言通过且测试数大于零；no tests、全部 skip 或环境阻塞为 `UNVERIFIED`，执行失败为 `FAIL`，确实无关才为 `NOT_APPLICABLE`。不使用允许零测试的选项掩盖缺口。

在已有 STATUS/test-report 或小任务聊天中记录 AC、文件、cwd、命令、pass/fail/skip、证据、未运行项和风险。视觉、交互、协议、真实网络各自下结论。原始日志和截图留在本地忽略的 artifacts 目录，正式摘要脱敏，不带入旧项目成绩和真实用户数据。没有授权不提交、推送或发布。
