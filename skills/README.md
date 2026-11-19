# 项目开发技能

本目录只维护一份 canonical 正文，发现入口按相对路径引用：

```text
skills/buding-*/                    7 个适配新仓的项目流程
skills/superpowers/<name>/         15 个 MIT Superpowers 7.0.0 技能及辅助资源
skills/react-ink/                  第三方 MIT React Ink 开发规范快照
skills/tui-design/                 第三方 MIT TUI/CLI 设计规范快照
.agents/skills/<entry>/SKILL.md     Codex 等助手的发现入口
.claude/skills/<entry>/SKILL.md     Claude Code 助手发现入口
.budingx/skills/<entry>/SKILL.md    预留的开发工具发现入口
```

当前新产品没有实现 Skill/MCP runtime，这些入口不证明产品会自动加载或执行技能。`.claude` 工具目录不包含 Claude Code 产品源码。

## 适配的项目流程

| 入口                                                        | 适用工作                                                     |
| ----------------------------------------------------------- | ------------------------------------------------------------ |
| [buding-sdd](buding-sdd/SKILL.md)                           | 正式需求/设计/计划、开发阶段衔接和证据                       |
| [buding-frontend-testing](buding-frontend-testing/SKILL.md) | 产品出现后所属 UI/状态/API 客户端验证                        |
| [buding-runtime-testing](buding-runtime-testing/SKILL.md)   | Core、Provider、工具、进程、存储、制品验证                   |
| [buding-merge](buding-merge/SKILL.md)                       | 用户明确授权的 Git 集成/发布与审查                           |
| [buding-npm-release](buding-npm-release/SKILL.md)           | TUI 构建、版本准备、Actions/OIDC 发布、官方安装验证与回执    |
| [buding-version-prepare](buding-version-prepare/SKILL.md)   | 升级产品版本、同步当前版本文档、发布预演及维护者手动发布交接 |
| [buding-langfuse](buding-langfuse/SKILL.md)                 | 本机 Langfuse 观测部署、访问、追踪接线与测试定位             |

Superpowers 入口使用 `superpowers-<name>`；上游文中的 `superpowers:<name>` 映射为本地入口，使用前必须读取 canonical 正文和适用资源。

## 第三方开发技能

| 入口                              | 适用工作                                                  | 来源                                                                                                                     |
| --------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| [react-ink](react-ink/SKILL.md)   | 用 React Ink 写终端 UI 时的组件、布局、输入与生命周期规范 | [dhruvjainin/absolute](https://github.com/dhruvjainin/absolute) 固定提交快照，[UPSTREAM](react-ink/UPSTREAM.json)        |
| [tui-design](tui-design/SKILL.md) | TUI/CLI 的布局、配色、快捷键、可发现性与跨框架设计审查    | [gfargo/tui-design-skill](https://github.com/gfargo/tui-design-skill) 固定提交快照，[UPSTREAM](tui-design/UPSTREAM.json) |

两者均按上游原文保留正文与 references，附 MIT 许可证和 UPSTREAM 哈希。`tui-design` 经 [podo/design-agent-skills](https://github.com/podo/design-agent-skills) 的 `tui-design-skill` 目录指针发现，上游真实技能名为 `tui-design`；`react-ink` 的原入口 `absolutelyskilled/react-ink` 已失效，快照取自上游删除前的最后内容提交。正文中的自动安装、伴随技能推广和回复样式建议不构成额外授权；升级需复核版本、许可、资源与哈希。

## 当前项目规则优先

主分支 `master`，Node.js + TypeScript，不依赖 Bun。已有简易聊天 TUI，完整 Agent 尚未实现；先读取实际 package/配置，不套用旧仓命令、框架、路径或测试成绩。

上游技能原文的 main、其他语言/框架、提交/分支清理和 Bash/Python 辅助脚本是通用工作流材料，不改变本仓项目规则或自动扩大授权。只有使用相关辅助资源时才检查对应解释器；本仓真实维护命令使用 Node。未安装全局插件、hooks 或全局设置。

## 维护

```powershell
npm ci --ignore-scripts --no-audit --no-fund
npm run skills:sync
npm run skills:check
npm run skills:test
```

修改项目技能的元数据后重新生成发现入口，不手写三份正文。同步器只处理管理清单，拒绝覆盖未知手写入口或跟随 symlink。Superpowers 保留完整原文/目录关系、[MIT 许可证](superpowers/LICENSE) 和 [UPSTREAM 哈希](superpowers/UPSTREAM.json)；升级需复核版本、许可、资源、哈希和别名，不能把本地补充规则写进上游文件后仍宣称原哈希有效。

验证工具检查实际生成入口、canonical 引用、文档链接、上游完整性及新仓边界。它们不执行产品、辅助 server 或 Git/npm 发布。来源与本次范围见 [迁移记录](../docs/migration/README.md)。
