import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { discoverSkills, findSkill, parseFrontmatter } from '../dist/tui/skills.js'
import { discoverSkillCommands, listSkills, loadSkillBody } from '../dist/tui/commands.js'

function writeSkill(root, name, text) {
  const dir = join(root, '.budingx', 'skills', name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), text)
}

test('SM-01 两类根都被发现，记录名称/描述/路径/来源', () => {
  const home = mkdtempSync(join(tmpdir(), 'budingx-skill-home-'))
  const workspace = mkdtempSync(join(tmpdir(), 'budingx-skill-work-'))
  try {
    // Stop project discovery at the fixture instead of inheriting host ancestor skills.
    mkdirSync(join(workspace, '.git'))
    writeSkill(home, 'review', '---\nname: review\ndescription: 代码审查\n---\n审查正文')
    writeSkill(workspace, 'ship', '---\nname: ship\ndescription: 发布\n---\n发布正文')
    const skills = discoverSkills({ homeDir: home, workspaceDir: workspace })
    // SP009 0.9.1：内置技能（skillify）也会出现在发现结果里。
    assert.equal(skills.length, 3)
    const review = findSkill(skills, 'review')
    assert.equal(review.scope, 'user')
    assert.equal(review.description, '代码审查')
    assert.equal(review.path, join(home, '.budingx', 'skills', 'review', 'SKILL.md'))
    assert.equal(findSkill(skills, 'ship').scope, 'project')
    assert.equal(findSkill(skills, 'skillify').scope, 'bundled')
  } finally {
    rmSync(home, { recursive: true, force: true })
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('SM-01 同名技能用户级优先（SP009 0.9.1 对齐参考仓首胜顺序）', () => {
  const home = mkdtempSync(join(tmpdir(), 'budingx-skill-home-'))
  const workspace = mkdtempSync(join(tmpdir(), 'budingx-skill-work-'))
  try {
    writeSkill(home, 'demo', '---\nname: demo\ndescription: 用户版\n---\nUSER-BODY')
    writeSkill(workspace, 'demo', '---\nname: demo\ndescription: 项目版\n---\nPROJECT-BODY')
    const skills = discoverSkills({ homeDir: home, workspaceDir: workspace })
    const demo = skills.filter((skill) => skill.name.toLowerCase() === 'demo')
    assert.equal(demo.length, 1)
    // 参考仓命令查找按列表顺序首胜：用户级先于项目级。
    assert.equal(demo[0].scope, 'user')
    assert.equal(demo[0].description, '用户版')
    assert.equal(demo[0].body, 'USER-BODY')
  } finally {
    rmSync(home, { recursive: true, force: true })
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('SM-02 frontmatter 被剥离，正文可注入；斜杠调用返回 prompt 载荷', async () => {
  const home = mkdtempSync(join(tmpdir(), 'budingx-skill-home-'))
  const workspace = mkdtempSync(join(tmpdir(), 'budingx-skill-work-'))
  const prev = process.cwd()
  try {
    writeSkill(workspace, 'demo', '---\nname: demo\ndescription: 演示\n---\n只输出演示正文')
    process.chdir(workspace)
    assert.equal(loadSkillBody('demo'), '只输出演示正文')
    assert.ok(discoverSkillCommands().some((skill) => skill.name === 'demo'))
    const { runCommand } = await import('../dist/tui/commands.js')
    const result = await runCommand('/demo', {
      session: {},
      configStore: {},
      credentialStore: {},
      getConfig: () => ({}),
      setConfig: () => {},
      exit: () => {}
    })
    assert.deepEqual(result.skillPrompt, { name: 'demo', body: '只输出演示正文' })
  } finally {
    process.chdir(prev)
    rmSync(home, { recursive: true, force: true })
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('SM-03 正文为空 → invalid 且给出原因，不进入命令列表', () => {
  const home = mkdtempSync(join(tmpdir(), 'budingx-skill-home-'))
  const workspace = mkdtempSync(join(tmpdir(), 'budingx-skill-work-'))
  const prev = process.cwd()
  try {
    writeSkill(workspace, 'empty', '---\nname: empty\ndescription: 空\n---\n   \n')
    process.chdir(workspace)
    const entry = findSkill(discoverSkills({ homeDir: home, workspaceDir: workspace }), 'empty')
    assert.equal(entry.valid, false)
    assert.equal(entry.error, '正文为空')
    assert.equal(loadSkillBody('empty'), undefined)
    assert.ok(!discoverSkillCommands().some((skill) => skill.name === 'empty'))
  } finally {
    process.chdir(prev)
    rmSync(home, { recursive: true, force: true })
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('SM-03 缺少 frontmatter → invalid，保留原因', () => {
  const home = mkdtempSync(join(tmpdir(), 'budingx-skill-home-'))
  const workspace = mkdtempSync(join(tmpdir(), 'budingx-skill-work-'))
  try {
    writeSkill(workspace, 'bare', '只有正文没有元数据')
    const entry = findSkill(discoverSkills({ homeDir: home, workspaceDir: workspace }), 'bare')
    assert.equal(entry.valid, false)
    assert.equal(entry.error, '缺少 frontmatter')
  } finally {
    rmSync(home, { recursive: true, force: true })
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('SM-03 兼容 0.5.4 无围栏 name:/description: 头', () => {
  const parsed = parseFrontmatter('name: demo\ndescription: 演示技能\n')
  assert.equal(parsed.present, true)
  assert.equal(parsed.data.name, 'demo')
  assert.equal(parsed.data.description, '演示技能')
  assert.equal(parsed.body, '')
  const withBody = parseFrontmatter('name: demo\ndescription: 演示\n做点事')
  assert.equal(withBody.body, '做点事')
})

test('SM-03 未闭合 frontmatter → invalid 且不注入', () => {
  const parsed = parseFrontmatter('---\nname: broken\ndescription: x\nBODY')
  assert.equal(parsed.error, 'frontmatter 未闭合')
  assert.equal(parsed.body, '')
})
