// SP004 agent-observability T30：Compose 结构与控制脚本约束。
// 覆盖 OB-03、OB-05。结构按公开规范独立编写，这里只做静态断言。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import YAML from 'yaml'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '../..')
const compose = YAML.parse(readFileSync(path.join(repoRoot, 'ops/langfuse/compose.yaml'), 'utf8'), {
  merge: true
})
const controlRaw = readFileSync(path.join(repoRoot, 'scripts/langfuse/control.ps1'), 'utf8')
// 剥离注释行，只对实际命令逻辑做断言。
const control = controlRaw
  .split(/\r?\n/)
  .filter((line) => !line.trim().startsWith('#'))
  .join('\n')

const SERVICES = ['langfuse-web', 'langfuse-worker', 'postgres', 'clickhouse', 'redis', 'minio']

test('the compose file declares exactly the six required services', () => {
  assert.deepEqual(Object.keys(compose.services).sort(), [...SERVICES].sort())
})

test('only the web and minio ports are published, and only on loopback', () => {
  const published = []
  for (const [name, service] of Object.entries(compose.services)) {
    for (const mapping of service.ports ?? []) {
      published.push({ name, mapping })
    }
  }
  assert.equal(published.length, 2)
  const web = published.find((p) => p.name === 'langfuse-web')
  const minio = published.find((p) => p.name === 'minio')
  assert.equal(web.mapping, '127.0.0.1:3000:3000')
  assert.equal(minio.mapping, '127.0.0.1:9090:9000')
})

test('the data stores do not publish any host port', () => {
  for (const name of ['postgres', 'clickhouse', 'redis']) {
    assert.equal(compose.services[name].ports, undefined, `${name} must not publish ports`)
  }
})

test('the four infrastructure services each have a healthcheck', () => {
  for (const name of ['postgres', 'clickhouse', 'redis', 'minio']) {
    assert.ok(compose.services[name].healthcheck, `${name} needs a healthcheck`)
    assert.ok(compose.services[name].healthcheck.test, `${name} healthcheck needs a test`)
  }
})

test('web and worker wait for the four infrastructure services to be healthy', () => {
  for (const name of ['langfuse-web', 'langfuse-worker']) {
    const depends = compose.services[name].depends_on
    for (const infra of ['postgres', 'clickhouse', 'redis', 'minio']) {
      assert.equal(depends[infra].condition, 'service_healthy', `${name} must wait for ${infra}`)
    }
  }
})

test('five named volumes are declared and referenced by the services', () => {
  const declared = Object.keys(compose.volumes).sort()
  assert.deepEqual(declared, [
    'langfuse_clickhouse_data',
    'langfuse_clickhouse_logs',
    'langfuse_minio_data',
    'langfuse_postgres_data',
    'langfuse_redis_data'
  ])
  const referenced = new Set()
  for (const service of Object.values(compose.services)) {
    for (const volume of service.volumes ?? []) {
      referenced.add(volume.split(':')[0])
    }
  }
  for (const name of declared) {
    assert.ok(referenced.has(name), `${name} must be referenced by a service`)
  }
})

test('logging is bounded for every service', () => {
  for (const name of SERVICES) {
    const logging = compose.services[name].logging
    assert.equal(logging.driver, 'json-file')
    assert.equal(logging.options['max-size'], '10m')
    assert.equal(logging.options['max-file'], '3')
  }
})

test('the stop action never removes volumes', () => {
  assert.ok(!/\bdown\b/.test(control), 'control.ps1 must not use docker compose down')
  assert.ok(!/-v\b/.test(control), 'control.ps1 must not pass -v')
  assert.ok(/'stop'\s*\{\s*\$composeArgs \+= @\('stop'\)\s*\}/.test(control), 'stop must map to compose stop')
})

test('the start action initializes credentials before bringing services up', () => {
  const initIndex = control.indexOf('init-local.mjs')
  const upIndex = control.indexOf("'up', '-d'")
  assert.ok(initIndex >= 0, 'start must call init-local.mjs')
  assert.ok(upIndex > initIndex, 'initialization must precede compose up')
})
