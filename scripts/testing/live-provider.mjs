// Explicit opt-in live checks. Never imported by npm test; no real config is logged.
import assert from 'node:assert/strict'
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { mountTty } from '../../src/tui/test/helpers/mount-tty.mjs'
import { createOpenAiProvider } from '../../src/tui/dist/provider/openai.js'
import { normalizeBaseUrl } from '../../src/tui/dist/storage/profiles.js'
import { diagnosticText } from './diagnostic.mjs'

const root = fileURLToPath(new URL('../..', import.meta.url))
const config = parseEnv(readFileSync(resolve(root, '.env.e2e.local'), 'utf8'))
const key = config.BUDINGX_API_KEY ?? ''
const baseUrl = normalizeBaseUrl(config.BUDINGX_BASE_URL ?? '')
const model = config.BUDINGX_MODEL ?? ''
const budget = Number(config.BUDINGX_E2E_BUDGET_USD)
const capIndex = process.argv.indexOf('--request-cap')
const maxRequests = Number(
  capIndex >= 0 ? process.argv[capIndex + 1] : config.BUDINGX_E2E_MAX_REQUESTS
)
const onlyTools = process.argv.includes('--only-tools')
const emptySchema = process.argv.includes('--empty-schema')
const toolCase = emptySchema ? 'live-tool-empty-schema' : 'live-tool-approval-roundtrip'
const summaryPath = resolve(root, 'artifacts/SP002-e2e/live-summary.json')
const previous =
  process.argv.includes('--resume') && existsSync(summaryPath)
    ? JSON.parse(readFileSync(summaryPath, 'utf8'))
    : undefined
const maxTokens = Number(config.BUDINGX_E2E_MAX_TOKENS)
assert.ok(key && model && budget > 0, 'Complete the local test configuration and budget')
assert.ok(Number.isSafeInteger(maxRequests) && maxRequests >= 1, 'Invalid request cap')
assert.ok(Number.isSafeInteger(maxTokens) && maxTokens >= 1, 'Invalid output cap')
let requests = previous?.requests ?? 0
const summary = {
  date: new Date().toISOString(),
  authorizedBudgetUsd: budget,
  maxRequests,
  maxTokens,
  requests,
  results: previous?.results.filter((r) => !onlyTools || r.name !== toolCase) ?? [],
  previousRuns: previous ? [previous] : [],
  externalProvider: true,
  actualCost: 'UNVERIFIED: consult provider billing'
}
const safe = (text) => String(text).split(key).join('[REDACTED]')
function adapter(apiKey = key) {
  const provider = createOpenAiProvider({
    baseUrl,
    apiKey,
    limits: { maxAttempts: 1, connectTimeoutMs: 20000, idleStreamTimeoutMs: 30000 },
    fetchImpl: async (url, options) => {
      if (requests >= maxRequests) throw new Error('Live request cap reached')
      requests++
      summary.requests = requests
      mkdirSync(resolve(root, 'artifacts/SP002-e2e'), { recursive: true })
      writeFileSync(summaryPath, JSON.stringify(summary, null, 2))
      const response = await fetch(url, options)
      if (!response.ok) {
        const body = diagnosticText(await response.clone().text(), key)
        writeFileSync(
          resolve(root, 'artifacts/SP002-e2e/http-error-' + requests + '.txt'),
          'HTTP ' + response.status + '\n' + body
        )
      }
      return response
    }
  })
  return {
    async *stream(request) {
      yield* provider.stream({ ...request, maxTokens })
    }
  }
}
async function withUi(provider, tools, run) {
  const cleanups = []
  const t = {
    after(fn) {
      cleanups.push(fn)
    }
  }
  try {
    const ui = await mountTty(t, {
      provider,
      tools,
      config: { baseUrl, model, apiKey: key }
    })
    await run(ui)
    assert.equal(ui.raw().includes(key), false, 'UI exposed a secret')
  } finally {
    for (const cleanup of cleanups.reverse()) await cleanup()
  }
}
function finalOf(session) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off()
      reject(new Error('Live turn timed out'))
    }, 45000)
    const off = session.on((event) => {
      if (event.type === 'turn_finalized') {
        clearTimeout(timer)
        off()
        resolve(event)
      }
    })
  })
}
async function check(name, run) {
  const before = requests
  try {
    await run()
    summary.results.push({ name, status: 'PASS', requests: requests - before })
  } catch (error) {
    summary.results.push({
      name,
      status: 'FAIL',
      requests: requests - before,
      message: safe(error.message).slice(0, 500)
    })
  }
  console.log(name + ': ' + summary.results.at(-1).status)
}
if (!onlyTools)
  await check('live-stream-ui', () =>
    withUi(adapter(), [], async (ui) => {
      let chunks = 0
      ui.session.on((e) => {
        if (e.type === 'text_delta') chunks++
      })
      const final = finalOf(ui.session)
      await ui.send('Reply briefly with LIVE_OK.\r')
      const result = await final
      assert.ok(
        ['completed', 'length_capped'].includes(result.outcome),
        'Live stream failed: ' + (result.error?.class ?? result.outcome)
      )
      assert.ok(chunks > 0, 'No text delta received within the configured output cap')
    })
  )
if (config.BUDINGX_E2E_SUPPORTS_TOOLS === 'yes') {
  await check(toolCase, async () => {
    let executions = 0
    await withUi(
      adapter(),
      [
        {
          name: 'echo',
          parameters: emptySchema
            ? undefined
            : {
                type: 'object',
                properties: { text: { type: 'string' } },
                required: ['text']
              },
          summary: 'Call once with text ok to receive ok.',
          describe: () => 'Live fixture echo',
          requiresApproval: () => true,
          execute: async () => {
            executions++
            return 'ok'
          }
        }
      ],
      async (ui) => {
        const final = finalOf(ui.session)
        const observed = final.then((result) => ({ result }))
        await ui.send(
          (emptySchema
            ? 'Call the echo tool exactly once with no arguments.'
            : 'Call the echo tool exactly once with text set to ok.') +
            ' After its result, reply LIVE_TOOL_OK.\r'
        )
        const boundary = await Promise.race([
          observed,
          ui
            .waitFor((frame) => frame.includes('需要审批'), 30000)
            .then(() => ({ approval: true }))
        ])
        assert.ok(
          boundary.approval,
          'Model did not request the echo tool: ' +
            (boundary.result?.error?.class ?? boundary.result?.outcome)
        )
        await ui.send('y')
        const result = await final
        assert.ok(
          ['completed', 'length_capped'].includes(result.outcome),
          'Tool continuation failed: ' + (result.error?.class ?? result.outcome)
        )
        assert.equal(executions, 1)
        assert.equal(ui.gateway.pendingRequests.length, 0)
      }
    )
  })
} else
  summary.results.push({
    name: 'live-tool-approval-roundtrip',
    status: 'UNVERIFIED',
    reason: 'Configured model does not support tools'
  })
if (!onlyTools)
  await check('live-stream-cancel', () =>
    withUi(adapter(), [], async (ui) => {
      let interrupted = false
      ui.session.on((e) => {
        if (!interrupted && (e.type === 'text_delta' || e.type === 'thinking_delta')) {
          interrupted = true
          ui.session.interrupt('user')
        }
      })
      const final = finalOf(ui.session)
      await ui.send('Write a long numbered list of testing tips.\r')
      const result = await final
      assert.ok(interrupted, 'No streaming event received before cancellation')
      assert.equal(result.outcome, 'cancelled')
      assert.equal(ui.session.isBusy, false)
    })
  )
if (!onlyTools)
  await check('live-invalid-key', () =>
    withUi(adapter('invalid-test-key-no-secret'), [], async (ui) => {
      const final = finalOf(ui.session)
      await ui.send('Reply ok.\r')
      const result = await final
      assert.equal(result.outcome, 'error')
      assert.equal(
        result.error?.class,
        'auth',
        'Provider did not reject the intentionally invalid key with an auth error'
      )
    })
  )
summary.requests = requests
mkdirSync(resolve(root, 'artifacts/SP002-e2e'), { recursive: true })
writeFileSync(
  resolve(root, 'artifacts/SP002-e2e/live-summary.json'),
  JSON.stringify(summary, null, 2) + '\n'
)
console.log('Live requests used: ' + requests + '/' + maxRequests)
if (summary.results.some((r) => r.status === 'FAIL')) process.exitCode = 1
