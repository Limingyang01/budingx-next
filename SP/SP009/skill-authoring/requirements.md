# SP009 追加 · skill-authoring — 需求（0.9.1）

状态：正式 SDD（Agent 自审对象）。来源：用户 2026-11-23 指令「直接复刻 buding-worker-space 的 TUI 的 skill 创建和放置 skill 的能力……skill 应该有多个级别……创建了 skill 还需要有更新 TUI 的 skill 的能力……注意别复制代码，注意 AST 检测机制」，并确认「也做到 SP009 里面」「上述这几项都需要修复到 0.9.1」。

## 1. 目标

把参考仓的技能**级别 / 创建 / 放置 / 刷新**机制独立复刻到 budingx：

1. 多级别技能：用户级、项目级（含向上遍历）、内置级。
2. 创建技能：内置 `/skillify` 引导式创建（会话分析 → 提问澄清 → 选择级别 → 生成 SKILL.md → 确认后落盘）。
3. 放置技能：`<root>/skills/<name>/SKILL.md` 目录格式与 frontmatter 契约。
4. 刷新技能：技能目录变更后 TUI 自动更新可用技能（补全 / 帮助 / 面板），无需重启。

## 2. 边界

- 不复制参考仓源码与提示词文本；机制对照、独立编写；新增/改动文件纳入 AST 复核映射。
- 不新增 npm 运行时依赖（监听用 Node 原生 fs.watch + 轮询兜底）。
- 不实现参考仓的 managed/policy、plugin、MCP 技能级别（本仓尚无对应策略/插件体系），登记为后续级别。
- 技能的模型自动 invocation（when_to_use 驱动）不在本轮；技能仍为用户可调用命令，frontmatter 新字段先解析保存。
- 不改三档权限与工具审批；创建技能写文件仍走既有文件工具权限。

## 3. 验收条件（AC）

### 级别与放置

- **SA-01（U+F）**：用户级根 `~/.budingx/skills`、项目级根 `.budingx/skills`；项目级从 cwd **向上遍历**收集所有存在的根，遇到 git 仓库根停止（无 git 时到 home 停止，home 本身按用户级单独加载）。
- **SA-02（U）**：同名冲突按参考仓首胜顺序：**用户级 > 项目级（近目录优先）> 内置级**；同一物理文件（realpath 相同）只加载一次。
- **SA-03（U）**：SKILL.md frontmatter 解析 `name`/`description` 为必需；接受 `allowed-tools`、`when_to_use`/`when-to-use`、`argument-hint`、`arguments`、`context`、`user-invocable` 等扩展键并保存元数据，不因未知键判无效。
- **SA-04（U）**：无效条目（缺 frontmatter、正文为空、name 非法）保留在 `/skills` 面板并给出原因，不进入可用命令。

### 创建

- **SA-05（F）**：内置 `/skillify` 命令存在且为 prompt 型：触发后把创建引导作为上下文送达模型（会话不回显引导正文，沿用 0.9.0 技能显示机制），引导包含：分析当前会话、用提问工具澄清、选择保存级别（项目 `.budingx/skills/<name>/SKILL.md` 或个人 `~/.budingx/skills/<name>/SKILL.md`）、按 frontmatter 契约生成 SKILL.md、写盘前给用户确认、写盘后告知位置与调用方式。
- **SA-06（U）**：`/skillify` 可携带可选描述参数；无参数时引导仍完整。

### 刷新（命令式，用户 2026-11-23 明确「加一个命令去做，不需要一直轮询」）

- **SA-07（U+F）**：新增 `/reload-skills` 命令（local 型）：按需重新发现全部级别的技能，刷新 TUI 可用技能（补全列表 / 帮助 / `/skills` 面板），并回报「Reloaded: N skills」（含级别统计）。**不做持续轮询、不常驻文件监听**。
- **SA-08（F）**：创建/修改/删除 SKILL.md 后运行 `/reload-skills`，补全列表立即出现/移除对应技能命令，无需重启；`/skillify` 引导在写盘后提示用户运行 `/reload-skills` 激活新技能。

## 4. 参考机制对照（只读事实）

| 参考仓机制 | 本仓落地 |
| --- | --- |
| 技能源：policy/managed、user、project（向上遍历）、additional、legacy、plugin、mcp、bundled | 本轮：user、project（向上遍历）、bundled；其余登记后续 |
| 项目根遍历：cwd 向上至 git root（无 git 至 home），仅收集存在目录 | 同机制，独立实现（`src/tui/skills.ts`） |
| 去重：realpath 文件身份首胜；命令查找按列表顺序首胜（user 先于 project） | 同顺序；替换 SP006「项目覆盖用户」旧规则并更新旧测试 |
| `/skillify` 内置技能：会话记忆 + 用户消息注入、AskUserQuestion 多轮澄清、repo/personal 二选一、SKILL.md frontmatter 契约、写前确认 | 同机制；提示词**独立撰写**，不复制参考文本 |
| 刷新：`/reload-skills` 命令清技能/命令缓存并通知 UI（参考仓另有事件监听，本仓按用户要求只做命令式） | `/reload-skills` 命令按需重发现 + 宿主刷新补全/帮助/面板；不轮询、不常驻监听 |

## 5. 开放项

- OPEN-SA-1：managed/plugin/MCP 级别 → 后续轮（本仓无策略/插件体系）。
- OPEN-SA-2：模型自动 invocation 与 per-skill allowed-tools 强制 → 后续轮（需工具权限面扩展）。
