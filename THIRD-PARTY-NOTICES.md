# 第三方开发资产声明

目前没有迁入旧 Agent 产品代码。下列声明用于本次开发资产迁移，不代表整个项目已经完成许可审计，也不授予旧项目主体代码的新许可。

| 组件 | 来源与版本 | 许可 | 使用范围 |
| --- | --- | --- | --- |
| Superpowers 开发技能 | [obra/superpowers](https://github.com/obra/superpowers)，7.0.0，revision `bb92a77741419a4ab5f06e711a283343f1ada0c3` | MIT；[原许可证](skills/superpowers/LICENSE) | `skills/superpowers/`，原文、辅助脚本与示例完整保留 |
| yaml | [yaml](https://github.com/eemeli/yaml)，2.8.3 | ISC，随依赖附带许可证 | 仅开发期解析技能 YAML frontmatter，不是产品依赖 |

Superpowers 文件校验信息保留在 [UPSTREAM.json](skills/superpowers/UPSTREAM.json)，本次迁移另见 [manifest](docs/migration/migration-manifest.json)。这些 MIT 资产不等同于 Anthropic 的 Claude Code 产品源码。

四个 `buding-*` 协作流程和技能发现维护工具来源于用户授权迁移的项目开发资产，并已适配新仓的空项目状态；来源记录不作为旧仓整体许可声明。项目整体许可证、未来产品源码和后续迁入模块的权利边界仍需分别确认，不能把插件 MIT 或这些第三方开发技能的 MIT 套用到全部产品。

用户已确认自有新增产品代码采用 [MIT](LICENSE)，src/tui 独立编写且没有运行时第三方依赖；这不授予旧 Agent 代码的新权利。开发编译使用 TypeScript 5.9.3（Apache-2.0）和 @types/node 22.20.5（MIT），许可随开发依赖保留，不随 TUI 运行包分发。
