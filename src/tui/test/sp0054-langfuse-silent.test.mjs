// 0.5.4：Langfuse 属于开发环境能力，启动告警不再暴露给普通用户。
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ConfigStore } from '../dist/storage/config-store.js'
import { createAgentRuntime } from '../dist/tui/runtime.js'

test('0.5.4 启动告警不包含 Langfuse 内部诊断', () => {
  const dir = mkdtempSync(join(tmpdir(), 'budingx-lf-'))
  try {
    const runtime = createAgentRuntime({
      cwd: dir,
      configStore: new ConfigStore(join(dir, 'config.json')),
      getConfig: () => ({ baseUrl: 'http://127.0.0.1:1/v1', model: 'x', apiKey: '', timeoutMs: 1000, source: 'file' }),
      approval: { request: async () => ({ outcome: 'deny', via: 'user' }) }
    })
    assert.equal(runtime.warnings.some((w) => /Langfuse/i.test(w)), false)
    runtime.session.dispose()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
