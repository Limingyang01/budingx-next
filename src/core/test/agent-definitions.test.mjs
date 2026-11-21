// SP007 T3 (SA-01/02): pure agent definition parsing, built-ins, serialization.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  AGENT_COLORS,
  BUILT_IN_AGENTS,
  parseAgentFile,
  serializeAgentFile
} from '../../tui/dist/core/agent-definitions.js'

test('built-ins: general-purpose unrestricted, Explore/Plan read-only deny lists', () => {
  const byName = new Map(BUILT_IN_AGENTS.map((a) => [a.name, a]))
  assert.deepEqual([...byName.keys()].sort(), ['Explore', 'Plan', 'general-purpose'])
  const gp = byName.get('general-purpose')
  assert.equal(gp.source, 'built-in')
  assert.equal(gp.tools, undefined)
  assert.ok(gp.description.length > 0)
  const deny = ['Write', 'Edit', 'Bash', 'PowerShell', 'Agent', 'AskUserQuestion', 'EnterPlanMode', 'ExitPlanMode']
  for (const name of ['Explore', 'Plan']) {
    const agent = byName.get(name)
    assert.equal(agent.model, 'inherit')
    for (const tool of deny) assert.ok(agent.disallowedTools.includes(tool), name + ' denies ' + tool)
  }
  assert.match(byName.get('Plan').body, /Critical Files/)
})

test('parse: full frontmatter fields and body', () => {
  const text = [
    '---',
    'name: reviewer',
    'description: "Reviews code: finds bugs"',
    'tools: Read, Grep, Glob',
    'disallowedTools: Write, Edit',
    'model: inherit',
    'effort: high',
    'permissionMode: read_only',
    'color: cyan',
    'maxTurns: 12',
    'initialPrompt: Start by listing changed files.',
    'background: true',
    '---',
    '',
    'You are a code reviewer.',
    ''
  ].join('\n')
  const { definition, warnings } = parseAgentFile(text, { source: 'project', filePath: '/p/reviewer.md' })
  assert.deepEqual(warnings, [])
  assert.equal(definition.name, 'reviewer')
  assert.equal(definition.description, 'Reviews code: finds bugs')
  assert.deepEqual(definition.tools, ['Read', 'Grep', 'Glob'])
  assert.deepEqual(definition.disallowedTools, ['Write', 'Edit'])
  assert.equal(definition.model, 'inherit')
  assert.equal(definition.effort, 'high')
  assert.equal(definition.permissionMode, 'read_only')
  assert.equal(definition.color, 'cyan')
  assert.equal(definition.maxTurns, 12)
  assert.equal(definition.initialPrompt, 'Start by listing changed files.')
  assert.equal(definition.background, true)
  assert.equal(definition.source, 'project')
  assert.equal(definition.filePath, '/p/reviewer.md')
  assert.equal(definition.body, 'You are a code reviewer.')
})

test('parse: tools omitted or star means all tools', () => {
  const base = '---\nname: a\ndescription: d\n---\nbody'
  assert.equal(parseAgentFile(base, { source: 'user' }).definition.tools, undefined)
  const star = '---\nname: a\ndescription: d\ntools: *\n---\nbody'
  assert.equal(parseAgentFile(star, { source: 'user' }).definition.tools, undefined)
  const starList = '---\nname: a\ndescription: d\ntools: ["*"]\n---\nbody'
  assert.equal(parseAgentFile(starList, { source: 'user' }).definition.tools, undefined)
})

test('parse: missing name/description or empty body skips with warning', () => {
  for (const text of [
    '---\ndescription: d\n---\nbody',
    '---\nname: a\n---\nbody',
    '---\nname: a\ndescription: d\n---\n',
    'no frontmatter at all',
    '---\nname: a\ndescription: d\nbody without closing fence'
  ]) {
    const { definition, warnings } = parseAgentFile(text, { source: 'user', filePath: '/x.md' })
    assert.equal(definition, undefined)
    assert.ok(warnings.length > 0)
    assert.ok(warnings.some((w) => w.includes('/x.md')))
  }
})

test('parse: unsupported fields warn but agent still loads', () => {
  const text = '---\nname: a\ndescription: d\nmemory: user\nisolation: worktree\nmcpServers: x\nhooks: y\nskills: z\n---\nbody'
  const { definition, warnings } = parseAgentFile(text, { source: 'project' })
  assert.ok(definition)
  assert.equal(warnings.length, 5)
  for (const key of ['memory', 'isolation', 'mcpServers', 'hooks', 'skills']) {
    assert.ok(warnings.some((w) => w.includes(key)))
  }
})

test('parse: invalid enum/number values warn and are ignored', () => {
  const text = '---\nname: a\ndescription: d\ncolor: magenta\neffort: turbo\npermissionMode: sudo\nmaxTurns: -3\nbackground: false\n---\nbody'
  const { definition, warnings } = parseAgentFile(text, { source: 'user' })
  assert.ok(definition)
  assert.equal(definition.color, undefined)
  assert.equal(definition.effort, undefined)
  assert.equal(definition.permissionMode, undefined)
  assert.equal(definition.maxTurns, undefined)
  assert.equal(definition.background, undefined)
  assert.equal(warnings.length, 4)
})

test('serialize/parse roundtrip: quoted description, tools omission for all', () => {
  const definition = {
    name: 'my-agent',
    description: 'He said "hello: world" \\ fine',
    source: 'project',
    body: 'System prompt line.',
    color: 'orange',
    maxTurns: 5
  }
  const text = serializeAgentFile(definition)
  assert.ok(!/^tools:/m.test(text))
  const back = parseAgentFile(text, { source: 'project' }).definition
  assert.equal(back.description, definition.description)
  assert.equal(back.color, 'orange')
  assert.equal(back.maxTurns, 5)
  assert.equal(back.body, 'System prompt line.')
  const restricted = serializeAgentFile({ ...definition, tools: ['Read', 'Grep'], disallowedTools: ['Bash'] })
  assert.match(restricted, /^tools: Read, Grep$/m)
  const back2 = parseAgentFile(restricted, { source: 'project' }).definition
  assert.deepEqual(back2.tools, ['Read', 'Grep'])
  assert.deepEqual(back2.disallowedTools, ['Bash'])
})

test('color palette is the reference eight colors', () => {
  assert.deepEqual([...AGENT_COLORS].sort(), ['blue', 'cyan', 'green', 'orange', 'pink', 'purple', 'red', 'yellow'])
})
