// SP009 缺陷回归：全自动档位下内置工具访问工作区外目标（用户 2026-11-23）。
// 边界只有一个判定点（workspace.resolve + 权限地板），这里按工具逐个取证。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorkspace } from '../../tui/dist/workspace/paths.js'
import { createPermissionPolicy } from '../../tui/dist/workspace/policy.js'
import { readWorkspaceFile } from '../../tui/dist/workspace/read.js'
import { globWorkspace, grepWorkspace } from '../../tui/dist/workspace/search.js'
import { editWorkspaceFile } from '../../tui/dist/workspace/edit.js'
import { writeWorkspaceFile } from '../../tui/dist/workspace/write.js'

function setup() {
  const base = mkdtempSync(join(tmpdir(), 'budingx-full-access-'))
  const root = join(base, 'workspace')
  const outside = join(base, 'outside')
  const userRoot = join(base, '.budingx')
  mkdirSync(root)
  mkdirSync(outside)
  mkdirSync(userRoot)
  writeFileSync(join(outside, 'note.txt'), 'outside note\n')
  writeFileSync(join(outside, 'other.ts'), 'export const value = 1\n')
  writeFileSync(join(userRoot, 'config.json'), '{"secret":true}\n')
  let mode = 'read_only'
  const workspace = createWorkspace(root, { allowOutside: () => mode === 'full_access' })
  const policy = createPermissionPolicy({ workspace, mode, dataRootOverride: userRoot })
  mode = policy.getMode()
  policy.onModeChanged((next) => {
    mode = next
  })
  return { base, root, outside, userRoot, workspace, policy }
}

test('全自动档位：Read/Write/Edit/Glob/Grep 都能访问工作区外目标', () => {
  const env = setup()
  try {
    env.policy.setMode('full_access')
    const note = join(env.outside, 'note.txt')
    assert.match(readWorkspaceFile(env.workspace, { path: note }).text, /outside note/)
    const created = join(env.outside, 'created.txt')
    writeWorkspaceFile(env.workspace, { path: created, content: 'created outside\n' })
    assert.equal(readFileSync(created, 'utf8'), 'created outside\n')
    editWorkspaceFile(env.workspace, {
      path: note,
      oldString: 'outside note',
      newString: 'edited outside'
    })
    assert.match(readFileSync(note, 'utf8'), /edited outside/)
    const globbed = globWorkspace(env.workspace, { pattern: '*.ts', path: env.outside })
    assert.match(globbed.text, /other\.ts/)
    const grepped = grepWorkspace(env.workspace, { pattern: 'export const', path: env.outside })
    assert.ok(grepped.total > 0, 'grep 应检索工作区外文件')
  } finally {
    rmSync(env.base, { recursive: true, force: true })
  }
})

test('工作区内修改档位：工作区外目标仍被边界拒绝', () => {
  const env = setup()
  try {
    env.policy.setMode('workspace_edit')
    assert.throws(
      () => readWorkspaceFile(env.workspace, { path: join(env.outside, 'note.txt') }),
      /outside the workspace/i
    )
    assert.throws(
      () => globWorkspace(env.workspace, { pattern: '*.ts', path: env.outside }),
      /outside the workspace/i
    )
  } finally {
    rmSync(env.base, { recursive: true, force: true })
  }
})

test('全自动档位也不能读写用户数据根与凭据型文件', () => {
  const env = setup()
  try {
    env.policy.setMode('full_access')
    const dataVerdict = env.policy.decide({
      tool: 'Read',
      capability: 'read',
      path: realpathSync.native(join(env.userRoot, 'config.json'))
    })
    assert.equal(dataVerdict.action, 'deny')
    assert.equal(dataVerdict.ruleId, 'floor:data')
    const credentialVerdict = env.policy.decide({
      tool: 'Read',
      capability: 'read',
      path: join(env.outside, 'credentials.json')
    })
    assert.equal(credentialVerdict.action, 'deny')
    assert.equal(credentialVerdict.ruleId, 'floor:credential')
  } finally {
    rmSync(env.base, { recursive: true, force: true })
  }
})

test('档位切换立即生效：受限档位回到全自动后工作区外读取恢复', () => {
  const env = setup()
  try {
    const note = join(env.outside, 'note.txt')
    env.policy.setMode('read_only')
    assert.throws(() => readWorkspaceFile(env.workspace, { path: note }), /outside/i)
    env.policy.setMode('full_access')
    assert.match(readWorkspaceFile(env.workspace, { path: note }).text, /outside note/)
  } finally {
    rmSync(env.base, { recursive: true, force: true })
  }
})
