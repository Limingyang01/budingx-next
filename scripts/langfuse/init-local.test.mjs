// SP004 agent-observability T30：本机初始化脚本。
// 覆盖 OB-01、OB-02。用临时根目录，避免污染真实 .runtime。
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import {
  BROAD_PRINCIPAL_SIDS,
  currentUserSid,
  initLocal,
  parseEnvFile,
  readAclSids,
  restrictAndVerify
} from './init-local.mjs'

const isWindows = process.platform === 'win32'

function tempRoot() {
  return mkdtempSync(path.join(tmpdir(), 'langfuse-init-'))
}

test('first run creates the three configuration files under .runtime/langfuse', () => {
  const root = tempRoot()
  const dir = initLocal(root)
  assert.equal(dir, path.join(root, '.runtime', 'langfuse'))
  for (const name of ['local.env', 'agent.env', 'login.json']) {
    assert.ok(existsSync(path.join(dir, name)), `${name} must exist`)
  }
})

test('local.env carries randomly generated secrets and required keys', () => {
  const root = tempRoot()
  const dir = initLocal(root)
  const values = parseEnvFile(readFileSync(path.join(dir, 'local.env'), 'utf8'))
  for (const key of [
    'SALT', 'ENCRYPTION_KEY', 'NEXTAUTH_SECRET', 'POSTGRES_PASSWORD',
    'CLICKHOUSE_PASSWORD', 'REDIS_AUTH', 'MINIO_ROOT_PASSWORD',
    'LANGFUSE_INIT_PROJECT_PUBLIC_KEY', 'LANGFUSE_INIT_PROJECT_SECRET_KEY',
    'LANGFUSE_INIT_USER_EMAIL', 'LANGFUSE_INIT_USER_PASSWORD', 'DATABASE_URL'
  ]) {
    assert.ok(values[key], `${key} must be present`)
  }
  assert.ok(values.LANGFUSE_INIT_PROJECT_PUBLIC_KEY.startsWith('pk-lf-'))
  assert.ok(values.LANGFUSE_INIT_PROJECT_SECRET_KEY.startsWith('sk-lf-'))
  assert.ok(values.DATABASE_URL.startsWith('postgresql://postgres:'))
  // 两个独立初始化的随机值必须不同。
  const other = parseEnvFile(readFileSync(path.join(initLocal(tempRoot()), 'local.env'), 'utf8'))
  assert.notEqual(values.SALT, other.SALT)
  assert.notEqual(values.LANGFUSE_INIT_PROJECT_SECRET_KEY, other.LANGFUSE_INIT_PROJECT_SECRET_KEY)
})

test('agent.env carries the four tracing variables', () => {
  const root = tempRoot()
  const dir = initLocal(root)
  const values = parseEnvFile(readFileSync(path.join(dir, 'agent.env'), 'utf8'))
  assert.equal(values.BUDINGX_LANGFUSE_ENABLED, '1')
  assert.ok(values.LANGFUSE_BASE_URL)
  assert.ok(values.LANGFUSE_PUBLIC_KEY)
  assert.ok(values.LANGFUSE_SECRET_KEY)
})

test('login.json holds the url, email and password', () => {
  const root = tempRoot()
  const dir = initLocal(root)
  const login = JSON.parse(readFileSync(path.join(dir, 'login.json'), 'utf8'))
  assert.ok(login.url)
  assert.ok(login.email)
  assert.ok(login.password)
})

test('e2e credentials are reused so UI login and API keys match .env.e2e.local', () => {
  const root = tempRoot()
  writeFileSync(
    path.join(root, '.env.e2e.local'),
    [
      'BUDINGX_LANGFUSE_EMAIL=e2e@budingx.local',
      'BUDINGX_LANGFUSE_PASSWORD=e2e-password',
      'LANGFUSE_PUBLIC_KEY=pk-lf-e2e',
      'LANGFUSE_SECRET_KEY=sk-lf-e2e'
    ].join('\n') + '\n'
  )
  const dir = initLocal(root)
  const local = parseEnvFile(readFileSync(path.join(dir, 'local.env'), 'utf8'))
  assert.equal(local.LANGFUSE_INIT_USER_EMAIL, 'e2e@budingx.local')
  assert.equal(local.LANGFUSE_INIT_USER_PASSWORD, 'e2e-password')
  assert.equal(local.LANGFUSE_INIT_PROJECT_PUBLIC_KEY, 'pk-lf-e2e')
  assert.equal(local.LANGFUSE_INIT_PROJECT_SECRET_KEY, 'sk-lf-e2e')
  const agent = parseEnvFile(readFileSync(path.join(dir, 'agent.env'), 'utf8'))
  assert.equal(agent.LANGFUSE_PUBLIC_KEY, 'pk-lf-e2e')
  assert.equal(agent.LANGFUSE_SECRET_KEY, 'sk-lf-e2e')
  const login = JSON.parse(readFileSync(path.join(dir, 'login.json'), 'utf8'))
  assert.equal(login.email, 'e2e@budingx.local')
  assert.equal(login.password, 'e2e-password')
})

test('a repeat run preserves existing credentials and succeeds', () => {
  const root = tempRoot()
  const dir = initLocal(root)
  const before = readFileSync(path.join(dir, 'local.env'), 'utf8')
  const agentBefore = readFileSync(path.join(dir, 'agent.env'), 'utf8')
  initLocal(root)
  assert.equal(readFileSync(path.join(dir, 'local.env'), 'utf8'), before)
  assert.equal(readFileSync(path.join(dir, 'agent.env'), 'utf8'), agentBefore)
})

test('an incomplete existing local.env raises and is preserved', () => {
  const root = tempRoot()
  const dir = path.join(root, '.runtime', 'langfuse')
  mkdirSync(dir, { recursive: true })
  const partial = 'NEXTAUTH_URL=http://localhost:3000\n'
  writeFileSync(path.join(dir, 'local.env'), partial)
  assert.throws(() => initLocal(root), /missing/)
  assert.equal(readFileSync(path.join(dir, 'local.env'), 'utf8'), partial)
})

test('configuration files are restricted to the current user', () => {
  const root = tempRoot()
  const dir = initLocal(root)
  if (!isWindows) {
    assert.equal(statSync(dir).mode & 0o777, 0o700)
    for (const name of ['local.env', 'agent.env', 'login.json']) {
      assert.equal(statSync(path.join(dir, name)).mode & 0o777, 0o600)
    }
  } else {
    const sid = currentUserSid()
    assert.ok(sid, 'must resolve the current user SID')
    for (const target of [dir, ...['local.env', 'agent.env', 'login.json'].map((n) => path.join(dir, n))]) {
      const sids = readAclSids(target)
      assert.ok(sids.includes(sid), `${target} must grant the current user (${sid})`)
      for (const broad of BROAD_PRINCIPAL_SIDS) {
        assert.ok(!sids.includes(broad), `${target} must not grant ${broad}`)
      }
    }
  }
})

test('restrictAndVerify refuses a path it cannot verify', () => {
  const missing = path.join(tempRoot(), 'does-not-exist')
  assert.throws(() => restrictAndVerify(missing, 'file'))
})

test('Windows DACL reads a local Administrator (LA) grant as its numeric SID', { skip: !isWindows }, (t) => {
  const root = tempRoot()
  t.after(() => rmSync(root, { recursive: true }))
  const target = path.join(root, "admin [fixture]'s file.txt")
  writeFileSync(target, 'fixture')
  const sid = execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "(Get-LocalUser | Where-Object { $_.SID.Value -like '*-500' }).SID.Value"
    ],
    { encoding: 'utf8' }
  ).trim()
  assert.match(sid, /^S-1-5-21-(?:\d+-){3}500$/)
  execFileSync('icacls.exe', [target, '/grant:r', `*${sid}:F`])
  assert.ok(readAclSids(target).includes(sid), 'must resolve the local Administrator grant')
})

test('Windows DACL rejects an explicit Authenticated Users (AU) grant', { skip: !isWindows }, (t) => {
  const root = tempRoot()
  t.after(() => rmSync(root, { recursive: true }))
  const target = path.join(root, 'fixture.txt')
  writeFileSync(target, 'fixture')
  execFileSync('icacls.exe', [target, '/grant:r', '*S-1-5-11:R'])
  assert.throws(() => restrictAndVerify(target, 'file'), /broad principal \(S-1-5-11\)/)
})

test('parseEnvFile ignores comments and non assignment lines', () => {
  const values = parseEnvFile('# comment\nA=1\nB=two words\nnot-an-assignment\n')
  assert.deepEqual(values, { A: '1', B: 'two words' })
})
