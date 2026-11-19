// SP004 agent-observability T29：宿主装配、注入与诊断输出。
// 覆盖 OB-06、OB-08、OB-21、OB-22 及 Review Focus 的依赖/边界约束。
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { setupTracing } from '../dist/tui/runtime.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '../../..')

const COMPLETE_ENV = {
  BUDINGX_LANGFUSE_ENABLED: '1',
  LANGFUSE_PUBLIC_KEY: 'pk-lf-abcdefgh12345678',
  LANGFUSE_SECRET_KEY: 'sk-lf-abcdefgh12345678',
  LANGFUSE_BASE_URL: 'http://localhost:3000'
}

test('without enablement the tracer is omitted and diagnostics say disabled', () => {
  const result = setupTracing({ sessionId: 's1', env: {} })
  assert.equal(result.tracer, undefined)
  assert.equal(result.shutdown, undefined)
  assert.ok(result.diagnostics.some((line) => line.includes('disabled')))
})

test('enabled but missing keys degrades to disabled without throwing', () => {
  const result = setupTracing({
    sessionId: 's1',
    env: { BUDINGX_LANGFUSE_ENABLED: '1' }
  })
  assert.equal(result.tracer, undefined)
  assert.ok(result.diagnostics.some((line) => line.includes('disabled')))
})

test('an unreadable env file reports a reason and does not block startup', () => {
  const result = setupTracing({
    sessionId: 's1',
    env: {
      ...COMPLETE_ENV,
      BUDINGX_LANGFUSE_ENV_FILE: path.join(repoRoot, 'definitely-missing-obs.env')
    }
  })
  // 继承环境完整，仍可启用；但必须报告文件读取失败的原因。
  assert.ok(result.diagnostics.some((line) => line.toLowerCase().includes('cannot read')))
  assert.ok(result.tracer, 'inherited complete env still enables tracing')
})

test('diagnostics never contain any part of the project keys', () => {
  const result = setupTracing({ sessionId: 's1', env: COMPLETE_ENV })
  const joined = result.diagnostics.join('\n')
  assert.ok(!joined.includes(COMPLETE_ENV.LANGFUSE_PUBLIC_KEY))
  assert.ok(!joined.includes(COMPLETE_ENV.LANGFUSE_SECRET_KEY))
  // 也不得出现密钥的长片段。
  assert.ok(!joined.includes('abcdefgh12345678'))
  assert.ok(joined.includes('enabled'))
  assert.ok(joined.includes('localhost:3000'))
})

test('content capture state is reported', () => {
  const off = setupTracing({ sessionId: 's1', env: COMPLETE_ENV })
  assert.ok(off.diagnostics.some((line) => line.includes('content capture: off')))
  const on = setupTracing({
    sessionId: 's1',
    env: { ...COMPLETE_ENV, BUDINGX_LANGFUSE_CAPTURE_CONTENT: '1' }
  })
  assert.ok(on.diagnostics.some((line) => line.includes('content capture: on')))
})

test('an invalid base url degrades to disabled', () => {
  const result = setupTracing({
    sessionId: 's1',
    env: { ...COMPLETE_ENV, LANGFUSE_BASE_URL: 'http://example.com' }
  })
  assert.equal(result.tracer, undefined)
  assert.ok(result.diagnostics.some((line) => line.includes('invalid base url')))
})

test('the tui package declares no otel, langfuse sdk or langchain dependencies', () => {
  const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'src/tui/package.json'), 'utf8'))
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }
  for (const name of Object.keys(deps)) {
    assert.ok(!name.startsWith('@opentelemetry/'), `unexpected otel dep ${name}`)
    assert.ok(!name.startsWith('@langfuse/'), `unexpected langfuse dep ${name}`)
    assert.ok(!/^langchain/i.test(name), `unexpected langchain dep ${name}`)
    assert.ok(!/^langgraph/i.test(name), `unexpected langgraph dep ${name}`)
  }
})

test('core never imports the observability transport module', () => {
  const coreDir = path.join(repoRoot, 'src/core')
  for (const file of readdirSync(coreDir)) {
    if (!file.endsWith('.ts')) continue
    const text = readFileSync(path.join(coreDir, file), 'utf8')
    // core/observability.ts 是纯端口，允许；但不得 import ../observability/ 传输层。
    assert.ok(!text.includes('../observability/'), `${file} must not import the transport layer`)
  }
})
