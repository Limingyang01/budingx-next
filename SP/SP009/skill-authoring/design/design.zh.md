# SP009 追加 · skill-authoring — 设计（v1，自审通过）

关联：[requirements.md](../requirements.md) · 分支 `feature/SP009/fix-0.9.1` · 随 0.9.1 交付。

## 1. 责任与契约

| 层 | 文件 | 职责 |
| --- | --- | --- |
| 技能发现 | `src/tui/skills.ts`（改） | 多级别根解析、向上遍历、frontmatter 扩展键、首胜去重、realpath 去重 |
| 内置技能 | `src/tui/skills-bundled.ts`（新） | 内置技能注册表；`/skillify` 创建引导（独立撰写提示词） |
| 技能刷新 | `/reload-skills` 命令（`commands/builtin-extended.ts`）+ `app.tsx` 修订号 | 按需重发现并刷新补全/帮助/面板；不轮询、不常驻监听 |
| 命令面 | `src/tui/commands.ts`、`commands/builtin-extended.ts`（改） | `/skillify` 走 prompt 型技能展开；`/skills` 面板显示级别与路径；`/reload-skills` 注册 |
| 宿主 | `src/tui/app.tsx`、`runtime.ts`（改） | 收到 reload 结果 → 递增 skillsRevision → 补全列表重算 + 一行提示 |

### 1.1 级别与根（SA-01/SA-02）

```
resolveSkillRoots({ homeDir, workspaceDir }):
  user:    <home>/.budingx/skills
  project: 从 workspaceDir 向上，收集每层存在的 <dir>/.budingx/skills，
           遇 git 根（含 .git 的目录）停止；无 git 时到 home 停止（home 不重复收集）
  bundled: 内置注册表（无磁盘根）
```

合并顺序 `[...user, ...project(近→远), ...bundled]`，按 `name.toLowerCase()` 首胜；
同一 realpath 的 SKILL.md 只保留首次出现（跨级别符号链接/重复父目录去重）。
**替换 SP006 旧规则「项目覆盖用户」**（参考仓命令查找为列表顺序首胜，user 先于 project），
旧测试 SM-01 同步改写并保留历史说明。

### 1.2 frontmatter（SA-03/SA-04）

`SkillEntry` 增加可选 `meta`：`allowedTools`、`whenToUse`、`argumentHint`、`arguments`、
`context`、`userInvocable`。解析接受 `when_to_use` 与 `when-to-use` 两种写法。
有效性判定不变：有 frontmatter、正文非空；name 缺省用目录名；name 非法（含路径分隔符/空白）判无效。
未知键不再导致无效（现状本就忽略未知键，保持）。

### 1.3 内置 /skillify（SA-05/SA-06）

- 注册为 prompt 型技能条目（scope='bundled'），`/skillify [描述]` 触发。
- 展开时注入：当前会话用户消息摘要（从 session.history 提取，截断保护）+ 可选用户描述 +
  **独立撰写**的创建引导（机制对齐参考仓：分析会话 → AskUserQuestion 澄清名称/目标/步骤/参数 →
  选择级别：项目 `.budingx/skills/<name>/SKILL.md` 或个人 `~/.budingx/skills/<name>/SKILL.md` →
  按 frontmatter 契约生成 SKILL.md（name/description/when_to_use/argument-hint/allowed-tools）→
  写盘前展示全文并确认 → 写盘后告知位置与 `/<name>` 调用方式）。
- 不复制参考仓 SKILLIFY_PROMPT 文本；只复刻流程结构与产物契约。
- 走 0.9.0 技能显示机制：正文作为 `skill:skillify` 上下文块，会话不回显。

### 1.4 刷新：/reload-skills 命令（SA-07/SA-08，命令式，无轮询）

用户明确要求「加一个命令去做，不需要一直轮询」。对齐参考仓 `/reload-skills` affordance：

- 新增 local 型命令 `/reload-skills`（无参数）：调用与 `/skills` 相同的发现路径
  （`listSkills()` / `discoverSkillCommands()`，本就每次从磁盘重读），统计有效技能数与级别分布，
  返回文本 `Reloaded: N skills（user X · project Y · bundled Z）`，并在 `CommandOutcome` 携带
  `skillsReloaded: number` 标记。
- `app.tsx` 维护 `skillsRevision` 状态；`execute()` 看到 `result.skillsReloaded !== undefined`
  时递增修订号并把回报文本设为提示。补全列表 `commandList` 的 `useMemo` 依赖加入 `skillsRevision`，
  于是重算并纳入新技能命令；`/help` 技能段与 `/skills` 面板打开时本就重读，天然同步。
- **不注册任何 fs.watch /  setInterval 轮询**；刷新完全由用户显式触发。
- `/skillify` 引导结尾提示：写盘后运行 `/reload-skills` 激活，再用 `/<name>` 调用。

## 2. 失败与取消

- 技能文件读取失败 → 该条目跳过或标无效，不影响其余；`/reload-skills` 回报有效数。
- 发现根不存在 → 视为空，命令仍成功返回 0 个。
- 无新增副作用需要 dispose（命令式，无常驻资源）。

## 3. 变更集与 AST

改：`skills.ts`、`commands.ts`、`commands/builtin-extended.ts`、`app.tsx`、`runtime.ts`、`sp006-skills.test.mjs`。
新：`skills-bundled.ts`、`skills-watch.ts`、`sp009-skill-authoring.test.mjs`、`scripts/review/sp009-ast.mjs`（映射表）。
AST 映射：skills.ts ↔ loadSkillsDir.ts/markdownConfigLoader.ts；skills-watch.ts ↔ skillChangeDetector.ts；
skills-bundled.ts ↔ bundledSkills.ts/skillify.ts；commands.ts ↔ commands.ts。提示词文本不参与 AST（独立撰写）。

## 4. AC 映射

SA-01/02 → §1.1；SA-03/04 → §1.2；SA-05/06 → §1.3；SA-07/08 → §1.4。
每条 AC 至少 1 单元 + 1 功能用例（功能用 mountTty 真实帧或真实文件事件）。
