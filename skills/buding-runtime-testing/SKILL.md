---
name: buding-runtime-testing
description: Use when testing Coding Agent core, providers, tools, permissions, persistence, services, subprocesses, host integrations, or packaging. Not for UI-only styling, documentation-only edits, or Git-only operations.
---

# budingx-next 运行时验证

先读 [AGENTS.md](../../AGENTS.md)、[架构方向](../../docs/architecture.md)、[开发指南](../../docs/development.md) 与 [技术栈路由](../buding-sdd/references/technology-map.md)。当前已有 src/tui 聊天预览和 Node 回归/发布工具；完整 Agent Core、编码工具和其他客户端尚未实现。按实际 package.json 和当前状态选择验证。

先核对所属包真实 package/lock、入口、配置与相邻 fixture，再选命令/cwd。不套用旧仓路由、SDK、proc helper、sidecar 目录或 npm check 脚本。读取旧代码不授权复制 query、系统提示词、内部类型或 Agent 实现；独立实现依据自己的需求和公开协议，复用材料需来源/许可记录。

## 选择证据层

| 改动 | 聚焦证据 | 额外边界 |
| --- | --- | --- |
| 纯逻辑/转换/状态机 | 输入输出、错误、取消单测 | 不启动服务枚举纯逻辑 |
| Provider/协议 | 请求字段、模型映射、错误、流分块、工具参数 fixture | 模拟成功不证明真实上游可用 |
| 服务/通信 | 真实测试实例的就绪、鉴权、隔离、重连和关闭 | 单通道不等于全链路 |
| Agent/工具/权限 | 循环状态、授权、调用结果、停止与恢复 fixture | 真实文件/进程效果需隔离 smoke |
| 持久化 | 旧 fixture、前向迁移、备份、未知字段保留 | 真实旧数据导入另行设计授权 |
| 宿主/子进程 | 生命周期、stdin/out/err、退出、超时、进程树清理 | 平台行为用对应平台 smoke |
| 安装/制品 | 入口、依赖、资源查找 | 仓库外真实安装/运行 |
| 外部集成 | 消息/附件/会话映射、重试/去重 | 真实平台账号效果需授权 |

## 隔离与红绿验证

用临时目录、配置根和测试端口，核对所有模块确实使用隔离根。只管理本次启动的进程/socket，等待真实 ready 信号，不用长 sleep 掩盖竞态。始终释放资源；用户输入不得直接拼接为 shell 命令。Windows 路径空格、脚本启动与终止语义需适用平台验证。

不读取或清空真实 API Key、OAuth、聊天、Provider 设置、用户 Skills/MCP/插件/绑定；不为 live 测试从其他用户配置找凭据。运行 live 只使用明确授权的隔离配置，不输出敏感值。外部副作用受当前授权限制。

行为变更先目标失败，再最小实现和复测；基础设施报错不算 RED，零测试/全部 skip 不算 PASS。只 mock 外部依赖，不 mock 被测契约。保护用户暂存、未暂存与未跟踪文件，不为 RED 自动 stash/reset。

存储形状变更必须有前向迁移、旧 fixture、备份、未知字段保留及可执行的升级验证，缺失时不能宣称兼容。当前未实现存储；不要迁入旧用户数据来补 fixture。

## 门禁和失败处理

普通本地迭代使用最近回归；高风险或 PR/集成/发布按届时已配置的合同运行门禁。不存在的 test/build/coverage/start/check 脚本先设计配置，不能写为通过。技能维护命令仅证明维护工具，不证明产品；小文档修改不运行产品全量门禁。

跨进程、会话、Provider 与制品需要适用 E2E/smoke。无凭据/配额时完成非 live 检查，明确受阻 AC；旧仓测试成绩不作为新仓证明。维护者的本仓基线仅在代码、配置、依赖、环境和范围匹配时引用，标明来源与非本次运行。

失败区分目标回归、既有问题、环境和未发现测试。范围内可逆问题自主修复复测，范围外保留影响不扩大任务。相关契约、配置、依赖或冲突解决变化后重选受影响检查，不盲目复用旧成绩，也不降低阈值掩盖失败。

## 交付

在已有 STATUS/test-report 或小任务聊天记录 AC→用例→层级→结果、cwd、命令、pass/fail/skip、证据、缺口和待运行步骤。执行失败 `FAIL`，未执行/受阻 `UNVERIFIED`，真正无关 `NOT_APPLICABLE`。逻辑 fixture、协议、真实进程、UI、live 和制品安装分别下结论。原始日志留本地忽略的 artifacts 目录，摘要脱敏；缺必需证据不声称完整验收或发布就绪。无授权不提交、集成或发布。
