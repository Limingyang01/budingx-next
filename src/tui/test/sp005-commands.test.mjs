import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { commandHelp, runCommand } from '../dist/tui/commands.js'
import { ConfigStore } from '../dist/storage/config-store.js'
import { CredentialStore } from '../dist/storage/credentials.js'

function context(overrides = {}) {
  const home = mkdtempSync(join(tmpdir(), 'budingx-sp005-commands-'))
  const configStore = new ConfigStore(join(home, '.budingx', 'config.json'))
  const credentialStore = new CredentialStore(join(home, '.budingx', 'credentials.json'))
  const config = {
    baseUrl: 'https://api.example.test/v1',
    model: 'model-one',
    apiKey: 'sk-secret-value',
    timeoutMs: 120000,
    source: 'env'
  }
  return {
    home,
    config,
    context: {
      session: { clearHistory: () => {}, restoreHistory: () => {} },
      configStore,
      credentialStore,
      getConfig: () => config,
      setConfig: (next) => Object.assign(config, next),
      exit: () => {},
      ...overrides
    }
  }
}

test('/help 列出 SP005 会话与记忆命令', async () => {
  const { context: ctx } = context()
  const zh = await runCommand('/help', ctx)
  assert.match(zh.message, /\/sessions/)
  assert.match(zh.message, /\/resume/)
  assert.match(zh.message, /\/context/)
  assert.match(zh.message, /\/memory/)
  const en = await runCommand('/help', { ...ctx, lang: 'en' })
  assert.match(en.message, /\/sessions/)
  assert.match(en.message, /\/resume <sessionId>/)
})

test('/sessions 未接入存储时明确报错', async () => {
  const { context: ctx } = context()
  const outcome = await runCommand('/sessions', ctx)
  assert.equal(outcome.handled, true)
  assert.match(outcome.error, /not wired/)
})

test('/sessions 列出已保存会话', async () => {
  const listed = [
    { sessionId: 's-1', title: 'first session', updatedAt: '2026-01-01T00:00:00.000Z', turns: 3 }
  ]
  const { context: ctx } = context({ sessions: { list: () => listed, resume: () => ({ ok: false }) } })
  const outcome = await runCommand('/sessions', ctx)
  assert.match(outcome.message, /s-1/)
  assert.match(outcome.message, /first session/)
  assert.match(outcome.message, /turns 3/)
})

test('/sessions 无会话时给出空提示', async () => {
  const { context: ctx } = context({ sessions: { list: () => [], resume: () => ({ ok: false }) } })
  const outcome = await runCommand('/sessions', ctx)
  assert.match(outcome.message, /No saved sessions/)
})

test('/resume 未知会话 id 明确报错而不是空会话', async () => {
  const { context: ctx } = context({
    sessions: {
      list: () => [],
      resume: () => ({ ok: false, message: 'session "missing" was not found' })
    }
  })
  const outcome = await runCommand('/resume missing', ctx)
  assert.equal(outcome.handled, true)
  assert.match(outcome.error, /missing/)
  assert.match(outcome.error, /was not found/)
})

test('/resume 缺少参数时给出用法', async () => {
  const { context: ctx } = context({ sessions: { list: () => [], resume: () => ({ ok: false }) } })
  const outcome = await runCommand('/resume', ctx)
  assert.match(outcome.error, /Usage/)
})

test('/resume 恢复成功时提示未确认的工具调用需核对', async () => {
  let restored = 0
  const { context: ctx } = context({
    sessions: {
      list: () => [],
      resume: () => {
        restored += 1
        return {
          ok: true,
          messages: [{ id: 'm1', role: 'user', blocks: [] }],
          needsReview: [{ name: 'Bash', callId: 'call-1', detail: 'turn ended before the tool result was known' }],
          warnings: ['1 corrupt line could not be read']
        }
      }
    }
  })
  const outcome = await runCommand('/resume s-1', ctx)
  assert.equal(restored, 1)
  assert.match(outcome.message, /Resumed session s-1/)
  assert.match(outcome.message, /Bash \(call-1\)/)
  assert.match(outcome.message, /not replayed/)
  assert.match(outcome.message, /corrupt line/)
})

test('/context 未接入预算时明确报错', async () => {
  const { context: ctx } = context()
  const outcome = await runCommand('/context', ctx)
  assert.match(outcome.error, /not wired/)
})

test('/context 显示预算构成', async () => {
  const { context: ctx } = context({
    context: {
      budget: () => ({
        estimatedTokens: 120,
        maxTokens: 1000,
        reservedOutputTokens: 200,
        triggerTokens: 680,
        messages: 4,
        breakdown: [{ kind: '1.user', tokens: 40 }, { kind: '2.assistant', tokens: 80 }]
      })
    }
  })
  const outcome = await runCommand('/context', ctx)
  assert.match(outcome.message, /120/)
  assert.match(outcome.message, /1000/)
  assert.match(outcome.message, /1\.user/)
})

test('/memory 未接入时明确报错', async () => {
  const { context: ctx } = context()
  const outcome = await runCommand('/memory', ctx)
  assert.match(outcome.error, /not wired/)
})

test('/memory 列出项目与会话记忆', async () => {
  const { context: ctx } = context({
    memory: {
      read: (scope) => ({
        entries: scope === 'project' ? [{ title: 'prefer vitest', text: 'use vitest' }] : []
      }),
      write: () => ({ ok: true })
    }
  })
  const outcome = await runCommand('/memory', ctx)
  assert.match(outcome.message, /project memory/)
  assert.match(outcome.message, /prefer vitest/)
})

test('/memory 写入项目记忆', async () => {
  const written = []
  const { context: ctx } = context({
    memory: {
      read: () => ({ entries: [] }),
      write: (scope, title, text) => {
        written.push({ scope, title, text })
        return { ok: true }
      }
    }
  })
  const outcome = await runCommand('/memory project add 构建约定：使用 pnpm', ctx)
  assert.equal(written.length, 1)
  assert.equal(written[0].scope, 'project')
  assert.equal(written[0].title, '构建约定')
  assert.equal(written[0].text, '使用 pnpm')
  assert.match(outcome.message, /Stored in project memory/)
})

test('/memory 写入失败时返回明确原因', async () => {
  const { context: ctx } = context({
    memory: {
      read: () => ({ entries: [] }),
      write: () => ({ ok: false, message: 'memory entry looks like it contains a credential and was refused' })
    }
  })
  const outcome = await runCommand('/memory session add 密钥：sk-abcdef123456', ctx)
  assert.match(outcome.error, /credential/)
})

test('/memory 参数错误时给出用法', async () => {
  const { context: ctx } = context({
    memory: { read: () => ({ entries: [] }), write: () => ({ ok: true }) }
  })
  const outcome = await runCommand('/memory project', ctx)
  assert.match(outcome.error, /Usage/)
})
