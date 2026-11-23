// SP009 0.9.1 · skill-authoring 回归（SA-01 … SA-08）。
// 证据层级：真实临时技能目录 + 真实命令分发；只有 TUI 帧留给功能层。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { discoverSkills, parseFrontmatter, projectSkillRoots } from '../dist/tui/skills.js'
import { runCommand } from '../dist/tui/commands.js'
import { mountTty } from './helpers/mount-tty.mjs'

function skill(dir, name, text) {
  const target = join(dir, '.budingx', 'skills', name)
  mkdirSync(target, { recursive: true })
  writeFileSync(join(target, 'SKILL.md'), text)
  return join(target, 'SKILL.md')
}

function bases() {
  const home = mkdtempSync(join(tmpdir(), 'budingx-sa-home-'))
  const workspace = mkdtempSync(join(tmpdir(), 'budingx-sa-work-'))
  return { home, workspace, cleanup: () => {
    rmSync(home, { recursive: true, force: true })
    rmSync(workspace, { recursive: true, force: true })
  } }
}

function commandContext(home, cwd) {
  return {
    session: { id: 's', history: [] },
    configStore: {},
    credentialStore: {},
    getConfig: () => ({}),
    setConfig: () => {},
    exit: () => {},
    home,
    cwd,
    interactive: true
  }
}

test('SA-01 项目级技能向上遍历到 git 根，用户级单独加载', () => {
  const { home, workspace, cleanup } = bases()
  try {
    const repo = join(workspace, 'repo')
    const nested = join(repo, 'packages', 'app')
    mkdirSync(join(repo, '.git'), { recursive: true })
    mkdirSync(nested, { recursive: true })
    skill(repo, 'root-level', '---\nname: root-level\ndescription: 仓库根\n---\nbody')
    skill(nested, 'nested-only', '---\nname: nested-only\ndescription: 子目录\n---\nbody')
    // 越过 git 根再往上的技能不应被发现
    skill(workspace, 'above-repo', '---\nname: above-repo\ndescription: 仓库外\n---\nbody')
    const roots = projectSkillRoots(nested, home)
    assert.deepEqual(roots, [
      join(nested, '.budingx', 'skills'),
      join(repo, '.budingx', 'skills')
    ])
    const skills = discoverSkills({ homeDir: home, workspaceDir: nested })
    const names = skills.filter((s) => s.scope === 'project').map((s) => s.name).sort()
    assert.deepEqual(names, ['nested-only', 'root-level'])
  } finally {
    cleanup()
  }
})

test('SA-02 同名用户级优先；同一物理文件只加载一次', () => {
  const { home, workspace, cleanup } = bases()
  try {
    const userFile = skill(home, 'shared', '---\nname: shared\ndescription: 用户\n---\nUSER')
    skill(workspace, 'shared', '---\nname: shared\ndescription: 项目\n---\nPROJECT')
    // 项目级目录再软链到同一个用户文件：realpath 去重。
    const linkDir = join(workspace, '.budingx', 'skills', 'alias')
    mkdirSync(linkDir, { recursive: true })
    try {
      symlinkSync(userFile, join(linkDir, 'SKILL.md'))
    } catch {
      /* Windows 无权限时跳过软链断言 */
    }
    const skills = discoverSkills({ homeDir: home, workspaceDir: workspace })
    const shared = skills.filter((s) => s.name === 'shared')
    assert.equal(shared.length, 1)
    assert.equal(shared[0].scope, 'user')
    assert.equal(shared[0].body, 'USER')
    const alias = skills.filter((s) => s.path === join(linkDir, 'SKILL.md'))
    assert.equal(alias.length, 0, '同一物理文件不应重复加载')
  } finally {
    cleanup()
  }
})

test('SA-03 frontmatter 扩展键被解析保存', () => {
  const parsed = parseFrontmatter(
    [
      '---',
      'name: demo',
      'description: 演示',
      'when_to_use: 当用户要演示时',
      'argument-hint: <文件名>',
      'allowed-tools: Read Grep',
      'context: inline',
      'user-invocable: false',
      '---',
      '正文'
    ].join('\n')
  )
  assert.equal(parsed.present, true)
  assert.equal(parsed.data.when_to_use, '当用户要演示时')
  const { home, workspace, cleanup } = bases()
  try {
    skill(workspace, 'demo', [
      '---',
      'name: demo',
      'description: 演示',
      'when_to_use: 当用户要演示时',
      'argument-hint: <文件名>',
      'allowed-tools: Read Grep',
      'context: inline',
      'user-invocable: false',
      '---',
      '正文'
    ].join('\n'))
    const entry = discoverSkills({ homeDir: home, workspaceDir: workspace })
      .find((s) => s.name === 'demo')
    assert.equal(entry.valid, true)
    assert.deepEqual(entry.meta, {
      allowedTools: 'Read Grep',
      whenToUse: '当用户要演示时',
      argumentHint: '<文件名>',
      context: 'inline',
      userInvocable: false
    })
  } finally {
    cleanup()
  }
})

test('SA-04 无效条目给出原因且不进入命令列表', () => {
  const { home, workspace, cleanup } = bases()
  try {
    skill(workspace, 'broken', '没有 frontmatter 的正文')
    skill(workspace, 'empty', '---\nname: empty\n---\n   \n')
    const skills = discoverSkills({ homeDir: home, workspaceDir: workspace })
    const broken = skills.find((s) => s.name === 'broken')
    assert.equal(broken.valid, false)
    assert.equal(broken.error, '缺少 frontmatter')
    const empty = skills.find((s) => s.name === 'empty')
    assert.equal(empty.valid, false)
    assert.equal(empty.error, '正文为空')
  } finally {
    cleanup()
  }
})

test('SA-05/06 内置 /skillify 展开为创建引导（含级别选择/确认/刷新）', async () => {
  const { home, workspace, cleanup } = bases()
  try {
    const result = await runCommand('/skillify 把发布流程固化下来', commandContext(home, workspace))
    assert.ok(result.skillPrompt, '必须是 prompt 型技能展开')
    assert.equal(result.skillPrompt.name, 'skillify')
    const body = result.skillPrompt.body
    for (const keyword of ['SKILL.md', '项目级', '用户级', '确认', '/reload-skills']) {
      assert.ok(body.includes(keyword), '引导应包含 ' + keyword)
    }
    // 无参数时也完整
    const bare = await runCommand('/skillify', commandContext(home, workspace))
    assert.ok(bare.skillPrompt.body.includes('SKILL.md'))
  } finally {
    cleanup()
  }
})

test('SA-07/08 /reload-skills 命令即时发现新技能', async () => {
  const { home, workspace, cleanup } = bases()
  try {
    skill(workspace, 'before', '---\nname: before\ndescription: 已有\n---\nbody')
    const first = await runCommand('/reload-skills', commandContext(home, workspace))
    assert.equal(typeof first.skillsReloaded, 'number')
    const before = first.skillsReloaded
    // 新建一个技能后，再运行刷新即可发现（无需重启、无轮询）。
    skill(workspace, 'after', '---\nname: after\ndescription: 新增\n---\nbody')
    const second = await runCommand('/reload-skills', commandContext(home, workspace))
    assert.equal(second.skillsReloaded, before + 1)
    assert.match(String(second.message), /内置 1/)
  } finally {
    cleanup()
  }
})

test('SA-07 帧级：新建技能后 /reload-skills 让补全列表立即出现该技能（无需重启）', async (t) => {
  const workspace = mkdtempSync(join(tmpdir(), 'budingx-sa-tty-'))
  const prevCwd = process.cwd()
  process.chdir(workspace)
  t.after(() => {
    process.chdir(prevCwd)
    rmSync(workspace, { recursive: true, force: true })
  })
  const ui = await mountTty(t, {
    config: { model: 'fixture' },
    commandOverrides: { cwd: workspace },
    provider: { async *stream() { yield { type: 'message_completed', finishReason: 'stop' } } }
  })
  // 挂载后再写入新技能：初始补全备忘录不含它，刷新后才应出现。
  skill(workspace, 'zzzreload', '---\nname: zzzreload\ndescription: 刷新验证\n---\nbody')
  await ui.send('/reload-skills')
  await ui.send('\r')
  await ui.waitFor((frame) => frame.includes('已刷新'), 4000)
  // 触发 / 补全并按前缀过滤，新技能命令应出现在候选里。
  await ui.send('/zzz')
  await ui.waitFor((frame) => frame.includes('zzzreload'), 4000)
  assert.match(ui.last(), /zzzreload/)
})
