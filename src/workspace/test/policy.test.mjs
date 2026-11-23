// Permission policy tests (SP003 AC PC-01 … PC-09, plan T10).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorkspace } from '../../tui/dist/workspace/paths.js'
import {
  createPermissionPolicy,
  isCredentialLike,
  nextMode
} from '../../tui/dist/workspace/policy.js'

function makeEnv(mode = undefined, rules = undefined) {
  const base = mkdtempSync(join(tmpdir(), 'budingx-policy-'))
  const root = join(base, 'workspace')
  const userRoot = join(base, '.budingx')
  mkdirSync(root)
  mkdirSync(userRoot)
  // 边界判定跟随当前模式：完全权限允许工作区外目标（用户 2026-11-23 缺陷修复）。
  let currentMode = mode
  const workspace = createWorkspace(root, {
    allowOutside: () => currentMode === 'full_access'
  })
  const policy = createPermissionPolicy({
    workspace,
    ...(mode ? { mode } : {}),
    ...(rules ? { rules } : {}),
    dataRootOverride: userRoot
  })
  currentMode = policy.getMode()
  policy.onModeChanged((next) => {
    currentMode = next
  })
  return {
    base,
    workspace,
    userRoot,
    policy,
    read: (path) => policy.decide({ tool: 'Read', capability: 'read', path }),
    write: (path) => policy.decide({ tool: 'Write', capability: 'write', path })
  }
}

test('默认模式是仅可查看：读放行，写直接拒绝且不询问（PC-01/PC-03）', () => {
  const env = makeEnv()
  assert.equal(env.policy.getMode(), 'read_only')
  assert.equal(env.read('src/a.ts').action, 'allow')
  const verdict = env.write('src/a.ts')
  assert.equal(verdict.action, 'deny')
  assert.match(verdict.reason, /read-only/)
  rmSync(env.base, { recursive: true, force: true })
})

test('三模式判定矩阵：读全放行，写分别 deny/ask/allow（PC-03/04/05）', () => {
  const readOnly = makeEnv('read_only')
  assert.equal(readOnly.write('a.ts').action, 'deny')
  const edit = makeEnv('workspace_edit')
  assert.equal(edit.write('a.ts').action, 'ask')
  assert.equal(edit.read('a.ts').action, 'allow')
  const full = makeEnv('full_access')
  assert.equal(full.write('a.ts').action, 'allow')
  for (const env of [readOnly, edit, full]) rmSync(env.base, { recursive: true, force: true })
})

test('完全权限不能越过底线：凭据特征文件在任一模式都拒绝（PC-08）', () => {
  const env = makeEnv('full_access')
  for (const name of [
    '.env',
    '.env.local',
    'config/.env',
    'id_rsa',
    'id_rsa.pub',
    'server.pem',
    'keys/api.key',
    'bundle.p12',
    'credentials.json'
  ]) {
    const verdict = env.write(name)
    assert.equal(verdict.action, 'deny', `${name} must stay off-limits`)
    assert.equal(verdict.ruleId, 'floor:credential')
    assert.equal(env.read(name).action, 'deny')
  }
  rmSync(env.base, { recursive: true, force: true })
})

test('工作区外目标：完全权限放行，另外两档仍拒绝；数据根地板始终生效（用户 2026-11-23 修正）', () => {
  const env = makeEnv('full_access')
  assert.equal(env.read('../outside/a.ts').action, 'allow')
  assert.equal(env.write('../outside/a.ts').action, 'allow')
  assert.equal(env.write('../../secret').action, 'allow')
  const edit = makeEnv('workspace_edit')
  assert.equal(edit.read('../outside/a.ts').ruleId, 'floor:outside')
  const readOnly = makeEnv('read_only')
  assert.equal(readOnly.read('../outside/a.ts').ruleId, 'floor:outside')
  // 一个覆盖 userRoot 的“工作区”：B-1 生效
  const wide = createWorkspace(env.base)
  const widePolicy = createPermissionPolicy({
    workspace: wide,
    mode: 'full_access',
    dataRootOverride: env.userRoot
  })
  const verdict = widePolicy.decide({
    tool: 'Write',
    capability: 'write',
    path: '.budingx/config.json'
  })
  assert.equal(verdict.action, 'deny')
  assert.equal(verdict.ruleId, 'floor:data')
  rmSync(env.base, { recursive: true, force: true })
})

test('allow 规则可放宽模式默认，但不能越过底线与 deny 规则（PC-07）', () => {
  const env = makeEnv('read_only', [
    { id: 'r-1', action: 'allow', tool: 'Write', path: 'src/**' }
  ])
  assert.equal(env.write('src/a.ts').action, 'allow')
  assert.equal(env.write('docs/a.ts').action, 'deny')
  assert.equal(env.write('.env').action, 'deny')
  const strict = makeEnv('read_only', [
    { id: 'r-1', action: 'allow', tool: '*', path: 'src/**' },
    { id: 'r-2', action: 'deny', tool: 'Write', path: 'src/generated/**' }
  ])
  assert.equal(strict.write('src/a.ts').action, 'allow')
  assert.equal(strict.write('src/generated/x.ts').action, 'deny')
  assert.equal(strict.write('src/generated/x.ts').ruleId, 'r-2')
  for (const e of [env, strict]) rmSync(e.base, { recursive: true, force: true })
})

test('deny 规则优先于模式：完全权限下命中 deny 仍拒绝（PC-07）', () => {
  const env = makeEnv('full_access', [
    { id: 'd-1', action: 'deny', tool: 'Write', path: '**/*.md' }
  ])
  assert.equal(env.write('notes.md').action, 'deny')
  assert.equal(env.write('src/a.ts').action, 'allow')
  rmSync(env.base, { recursive: true, force: true })
})

test('会话记忆：记住后同目标不再询问；切回仅查看后记忆不放行（PC-06）', () => {
  const env = makeEnv('workspace_edit')
  assert.equal(env.write('src/a.ts').action, 'ask')
  env.policy.remember({ tool: 'Write', capability: 'write', path: 'src/a.ts' })
  const remembered = env.write('src/a.ts')
  assert.equal(remembered.action, 'allow')
  assert.match(remembered.reason, /session/i)
  assert.equal(env.write('src/b.ts').action, 'ask')
  env.policy.setMode('read_only')
  assert.equal(env.write('src/a.ts').action, 'deny')
  rmSync(env.base, { recursive: true, force: true })
})

test('被遮蔽规则可检测：allow 被同范围 deny 覆盖时报告（PC-09）', () => {
  const env = makeEnv('full_access', [
    { id: 'a-1', action: 'allow', tool: 'Write', path: 'src/**' },
    { id: 'd-1', action: 'deny', tool: 'Write', path: '**' },
    { id: 'a-2', action: 'allow', tool: 'Read', path: 'docs/**' }
  ])
  const report = env.policy.shadowed()
  assert.deepEqual(report, [{ ruleId: 'a-1', shadowedBy: 'd-1' }])
  rmSync(env.base, { recursive: true, force: true })
})

test('模式切换事件与轮播顺序', () => {
  const env = makeEnv('read_only')
  const seen = []
  env.policy.onModeChanged((mode) => seen.push(mode))
  env.policy.setMode('workspace_edit')
  env.policy.setMode('workspace_edit')
  assert.deepEqual(seen, ['workspace_edit'])
  // 0.5.4：三档完整轮播，全自动之后回到仅可查看（此前会跳过仅可查看）。
  assert.equal(nextMode('read_only'), 'workspace_edit')
  assert.equal(nextMode('workspace_edit'), 'full_access')
  assert.equal(nextMode('full_access'), 'read_only')
  rmSync(env.base, { recursive: true, force: true })
})

test('版本库元数据强制询问：完全权限下 .git 写入仍 ask（T18g）', () => {
  const env = makeEnv('full_access')
  try {
    const verdict = env.write('.git/config')
    assert.equal(verdict.action, 'ask')
    assert.match(verdict.reason, /\.git/)
    // deny 规则仍然优先于强制询问
    const strict = makeEnv('full_access', [
      { id: 'g-1', action: 'deny', tool: '*', path: '.git/**' }
    ])
    assert.equal(strict.write('.git/config').action, 'deny')
    // 读 .git 不受影响
    assert.equal(env.read('.git/HEAD').action, 'allow')
    for (const e of [env, strict]) rmSync(e.base, { recursive: true, force: true })
  } finally {
    rmSync(env.base, { recursive: true, force: true })
  }
})

test('凭据特征名判定', () => {
  assert.equal(isCredentialLike('.env'), true)
  assert.equal(isCredentialLike('PROD.ENV'), false)
  assert.equal(isCredentialLike('.env.production'), true)
  assert.equal(isCredentialLike('main.ts'), false)
  assert.equal(isCredentialLike('TLS.KEY'), true)
})
