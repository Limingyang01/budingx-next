// Opt-in AC-SUBAGENT-03. Run with the approved isolated provider configuration.
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createAgentRegistry } from '../../src/tui/dist/core/agent-runtime.js'
import { BUILT_IN_AGENTS } from '../../src/tui/dist/core/agent-definitions.js'
import { createAgentTools } from '../../src/tui/dist/core/agent-tools.js'
import { TOOL_OUTPUT_CAP } from '../../src/tui/dist/core/constants.js'
import { Session } from '../../src/tui/dist/core/session.js'
import { createOpenAiProvider } from '../../src/tui/dist/provider/openai.js'
import { createWebFetchTool } from '../../src/tui/dist/provider/web-fetch.js'
import { normalizeBaseUrl } from '../../src/tui/dist/storage/profiles.js'

const env = process.env
const apiKey = env.BUDINGX_API_KEY
const baseUrl = normalizeBaseUrl(env.BUDINGX_BASE_URL ?? '')
const model = env.BUDINGX_MODEL
const authorizedBudgetUsd = Number(env.BUDINGX_E2E_BUDGET_USD)
const maxRequests = Number(env.BUDINGX_E2E_MAX_REQUESTS)
const maxTokens = Number(env.BUDINGX_E2E_MAX_TOKENS)
assert.ok(apiKey && model && authorizedBudgetUsd > 0, 'Isolated provider configuration and budget are required')
assert.ok(Number.isSafeInteger(maxRequests) && maxRequests >= 6, 'Three tasks require at least six authorized requests')
assert.ok(Number.isSafeInteger(maxTokens) && maxTokens > 0, 'An authorized output token limit is required')
assert.match(env.BUDINGX_E2E_SUPPORTS_TOOLS ?? '', /^(?:yes|true|1)$/i)

const receiptDir = new URL('../../artifacts/SP009-0.9.2/', import.meta.url)
const receiptPath = new URL(`live-subagent-${Date.now()}.json`, receiptDir)
const source = 'https://www.rfc-editor.org/rfc/rfc9110.txt'
const report = {
  date: new Date().toISOString(),
  model,
  providerHost: new URL(baseUrl).host,
  source,
  authorizedBudgetUsd,
  maxRequests,
  maxOutputTokensPerRequest: maxTokens,
  requests: 0,
  results: [],
  actualCost: 'UNVERIFIED'
}
function saveReport() {
  mkdirSync(receiptDir, { recursive: true })
  writeFileSync(receiptPath, JSON.stringify(report, null, 2) + '\n')
}

const snapshot = {
  modelId: model,
  model,
  baseUrlHost: report.providerHost,
  capabilities: { tools: true }
}
const questions = [
  { prompt: 'What does this document define?', expected: /HTTP|Hypertext Transfer Protocol/i },
  { prompt: 'What RFC number and title appear in the document?', expected: /(?=.*9110)(?=.*HTTP Semantics)/i },
  { prompt: 'Give the title of section 1 in the table of contents.', expected: /Introduction/i }
]
const approval = {
  request: async () => ({ outcome: 'allow', via: 'policy' })
}
const policy = {
  getMode: () => 'read_only',
  setMode() {},
  decide: ({ tool, path }) => ({
    action: tool === 'WebFetch' && path === source ? 'allow' : 'deny',
    reason: 'Isolated WebFetch validation fixture'
  }),
  remember() {},
  canRemember: () => false
}

for (const [index, question] of questions.entries()) {
  const evidence = { task: index + 1, requests: 0, httpStatuses: [], webFetch: [], childErrors: [] }
  report.results.push(evidence)
  const client = createOpenAiProvider({
    baseUrl,
    apiKey,
    limits: { maxAttempts: 1, connectTimeoutMs: 20_000, idleStreamTimeoutMs: 30_000 },
    async fetchImpl(url, options) {
      if (evidence.requests >= 2 || report.requests >= maxRequests) {
        throw new Error('Authorized live request cap reached')
      }
      evidence.requests++
      report.requests++
      saveReport()
      const response = await fetch(url, options)
      evidence.httpStatuses.push(response.status)
      return response
    }
  })
  const provider = {
    async *stream(request) {
      yield* client.stream({ ...request, maxTokens })
    }
  }
  const resolveSnapshot = () => snapshot
  const parent = new Session({ provider, resolveSnapshot, approval })
  const webFetch = {
    ...createWebFetchTool(),
    target: (input) => ({ path: input?.url, kind: 'none' })
  }
  const registry = createAgentRegistry({
    parentSession: parent, tools: [webFetch], provider, resolveSnapshot,
    approval, policy, createChildPolicy: () => policy
  })
  parent.on((event) => {
    if (event.type !== 'agent_started') return
    registry.get(event.agentId)?.session.on((childEvent) => {
      if (childEvent.type === 'tool_result') {
        evidence.webFetch.push({
          length: childEvent.content.length,
          truncated: childEvent.content.includes('[truncated]'),
          sourceReturned: childEvent.content.startsWith(`[WebFetch] ${source} · HTTP 200`),
          error: childEvent.isError,
          errorCode: childEvent.errorCode
        })
      } else if (childEvent.type === 'turn_finalized' && childEvent.error) {
        evidence.childErrors.push(childEvent.error.code)
      }
    })
  })
  const [agent] = createAgentTools(registry, BUILT_IN_AGENTS)
  try {
    const output = await agent.execute({
      description: 'Read a public RFC',
      prompt: `Call WebFetch once with URL ${source}. Then answer in one short sentence. ${question.prompt}`
    }, { signal: AbortSignal.timeout(80_000), callId: `sp009-live-${index}` })
    const answer = output.split('\n\n<usage>')[0].trim()
    evidence.usableAnswer = question.expected.test(answer)
    evidence.status = evidence.usableAnswer && evidence.childErrors.length === 0 &&
      evidence.webFetch.length === 1 && evidence.webFetch.every((result) =>
        result.sourceReturned && result.truncated && !result.error && result.length <= TOOL_OUTPUT_CAP
      ) && !output.includes('AGENT_FAILED') ? 'PASS' : 'FAIL'
  } catch (error) {
    evidence.status = 'FAIL'
    evidence.errorCode = error.code ?? error.name
  } finally {
    registry.dispose()
    parent.dispose()
    saveReport()
  }
}

console.log(JSON.stringify({
  receipt: receiptPath.pathname,
  requests: report.requests,
  passed: report.results.filter((result) => result.status === 'PASS').length,
  total: report.results.length
}))
if (report.results.some((result) => result.status !== 'PASS')) process.exitCode = 1
