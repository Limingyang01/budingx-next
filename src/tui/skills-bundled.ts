// Built-in (bundled) skills. SP009 addendum SA-05: a `/skillify` prompt skill that
// walks the user through creating a reusable `SKILL.md`, mirroring the reference's
// create-then-place flow. The prompt text below is written independently for this
// repository; only the mechanism (interview → choose level → write → confirm) is
// replicated.
import type { SkillEntry } from './skills.js'

const SKILLIFY_BODY = [
  '你正在帮用户把当前会话里一段可复用的工作方法固化成技能（skill）。按以下步骤进行，全部用中文回复：',
  '',
  '1. 先分析本次会话：用户在做什么？哪些步骤是重复出现、值得复用、有明确成功判据的？如果会话里没有可复用的流程，直接告诉用户「本次会话还没有可沉淀的流程」，不要硬造。',
  '2. 用提问工具向用户澄清：技能名称（短横线命名，如 `review-pr`）、一句话用途、触发场景（when_to_use）、需要哪些参数（argument-hint）、是否限制可用工具（allowed-tools）。一次问清，不要反复追问。',
  '3. 让用户选择保存级别：',
  '   - 项目级：`<项目根>/.budingx/skills/<name>/SKILL.md`（只对当前项目生效，可提交进仓库共享）',
  '   - 用户级：`~/.budingx/skills/<name>/SKILL.md`（对所有项目生效）',
  '4. 按下面的契约生成 SKILL.md（YAML frontmatter + 正文）：',
  '   ---',
  '   name: <短横线命名>',
  '   description: <一句话用途>',
  '   when_to_use: <触发场景>',
  '   argument-hint: <参数提示，可省略>',
  '   allowed-tools: <工具白名单，可省略>',
  '   ---',
  '   # <标题>',
  '   <正文：可复用的步骤、注意事项、成功判据。正文是模型执行技能时读到的指令，要具体可执行。>',
  '   正文里用 `$ARGUMENTS` 表示用户调用技能时传入的参数。',
  '5. 写盘前把完整 SKILL.md 内容展示给用户确认；用户确认后再用文件写入工具落盘（项目级用相对项目根的路径，用户级用 `~` 展开后的绝对路径）。',
  '6. 写盘成功后告诉用户：保存位置、如何激活（运行 `/reload-skills` 让当前会话识别新技能）、如何调用（`/<name>`），以及之后可以直接编辑该文件。',
  '',
  '约束：不要覆盖已有的同名技能文件（先读取确认）；不要写入 `.budingx` 之外的项目目录；技能正文不要包含密钥、token 或用户隐私数据。'
].join('\n')

/**
 * 内置技能注册表。没有磁盘根，scope 固定为 'bundled'，与磁盘技能同名时由
 * 磁盘技能优先（discoverSkills 中内置级最后加载）。
 */
export function bundledSkillEntries(): SkillEntry[] {
  return [
    {
      name: 'skillify',
      description: '把本次会话里可复用的流程固化成 SKILL.md（项目级或用户级）',
      body: SKILLIFY_BODY,
      path: 'bundled://skillify/SKILL.md',
      scope: 'bundled',
      valid: true,
      meta: {
        whenToUse: '用户想把当前会话的做法沉淀成可复用技能时',
        argumentHint: '[可选的技能描述]',
        userInvocable: true
      }
    }
  ]
}
