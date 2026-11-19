// SP004 agent-observability T30：本机初始化脚本。
// 覆盖 OB-01、OB-02。用临时根目录，避免污染真实 .runtime。
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { initLocal, parseEnvFile, restrictAndVerify } from './init-local.mjs'

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
    // Windows：核对 DACL 授予当前用户（账户名或 SID）且不含宽泛主体。
    const systemTool = (name) => path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', name)
    const who = execFileSync(systemTool('whoami.exe'), ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8' })
    const account = who.match(/"([^"]+)"/)[1]
    const sid = who.match(/"(S-1-5-[0-9-]+)"/)[1]
    for (const target of [dir, ...['local.env', 'agent.env', 'login.json'].map((n) => path.join(dir, n))]) {
      const acl = execFileSync(systemTool('icacls.exe'), [target], { encoding: 'utf8' })
      const grantsUser = acl.toLowerCase().includes(account.toLowerCase()) || acl.includes(sid)
      assert.ok(grantsUser, `${target} must grant the current user`)
      for (const broad of ['Everyone', 'BUILTIN\\Users', 'Authenticated Users']) {
        assert.ok(!acl.includes(broad), `${target} must not grant ${broad}`)
      }
    }
  }
})

test('restrictAndVerify refuses a path it cannot verify', () => {
  const missing = path.join(tempRoot(), 'does-not-exist')
  assert.throws(() => restrictAndVerify(missing, 'file'))
})

test('parseEnvFile ignores comments and non assignment lines', () => {
  const values = parseEnvFile('# comment\nA=1\nB=two words\nnot-an-assignment\n')
  assert.deepEqual(values, { A: '1', B: 'two words' })
})
