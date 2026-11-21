// SP007 T11：评估回归测试。
// 验证 scripts/eval/ 管线本身的可信度：任务加载、断言求值、场景执行、报告生成。
// 约定：ESM、2 空格缩进、无分号、node:test。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { loadTasks, validateTasks, BUDGET_PROFILES } from '../../../scripts/eval/lib/tasks.mjs'
import { evaluateCheck, evaluateChecks } from '../../../scripts/eval/lib/checks.mjs'
import { SCENARIOS, scriptedProvider, textEvents, toolCallEvents } from '../../../scripts/eval/lib/scenarios.mjs'
import { runTask, wrapProvider } from '../../../scripts/eval/lib/runner-core.mjs'
import { buildSummary, renderMarkdown, writeReport, UNTESTED_CAPABILITIES } from '../../../scripts/eval/lib/report.mjs'
import { repoRoot, snapshotFiles, diffSnapshots, copyTree } from '../../../scripts/eval/lib/util.mjs'

const ROOT = repoRoot()

describe('SP007 eval harness', () => {
  describe('tasks.json validation', () => {
    it('loads and passes structural validation', () => {
      const tasks = loadTasks(ROOT)
      assert.ok(Array.isArray(tasks), 'tasks must be an array')
      const { errors, summary } = validateTasks(tasks)
      assert.equal(errors.length, 0, 'validation errors: ' + errors.join('; '))
      assert.ok(summary.total >= 15, 'need ≥15 tasks, got ' + summary.total)
      assert.ok(summary.blind >= 3, 'need ≥3 blind tasks, got ' + summary.blind)
      assert.ok(summary.sp007 >= 12, 'need ≥12 SP007 tasks, got ' + summary.sp007)
    })

    it('covers all required groups', () => {
      const tasks = loadTasks(ROOT)
      const { errors } = validateTasks(tasks)
      const groupErrors = errors.filter(e => e.includes('缺少能力分组覆盖'))
      assert.equal(groupErrors.length, 0, groupErrors.join('; '))
    })

    it('every task has at least one check', () => {
      const tasks = loadTasks(ROOT)
      for (const task of tasks) {
        assert.ok(task.checks && task.checks.length > 0, task.id + ' has no checks')
      }
    })

    it('blind tasks are properly marked', () => {
      const tasks = loadTasks(ROOT)
      const blinds = tasks.filter(t => t.blind === true)
      assert.ok(blinds.length >= 3, 'need ≥3 blind, got ' + blinds.length)
      for (const b of blinds) {
        assert.ok(b.id.startsWith('SP007-EVAL-'), 'blind task should be SP007-EVAL-*: ' + b.id)
      }
    })
  })

  describe('checks evaluation', () => {
    it('outcome check matches', () => {
      const ctx = { events: [], toolResults: [], changed: { added: [], modified: [], removed: [] }, workspaceDir: '/tmp', state: {}, result: { outcome: 'completed', requestCount: 1 } }
      const r = evaluateCheck({ kind: 'outcome', outcome: 'completed' }, ctx)
      assert.ok(r.ok)
    })

    it('outcome check fails on mismatch', () => {
      const ctx = { events: [], toolResults: [], changed: { added: [], modified: [], removed: [] }, workspaceDir: '/tmp', state: {}, result: { outcome: 'error', requestCount: 1 } }
      const r = evaluateCheck({ kind: 'outcome', outcome: 'completed' }, ctx)
      assert.ok(!r.ok)
    })

    it('notice check finds matching event', () => {
      const ctx = { events: [{ type: 'notice', code: 'api_retry' }], toolResults: [], changed: { added: [], modified: [], removed: [] }, workspaceDir: '/tmp', state: {}, result: { outcome: 'completed', requestCount: 1 } }
      const r = evaluateCheck({ kind: 'notice', code: 'api_retry' }, ctx)
      assert.ok(r.ok)
    })

    it('tool_result check with contains', () => {
      const ctx = { events: [], toolResults: [{ name: 'Write', isError: true, content: 'File has not been read yet. Read it first.' }], changed: { added: [], modified: [], removed: [] }, workspaceDir: '/tmp', state: {}, result: { outcome: 'completed', requestCount: 1 } }
      const r = evaluateCheck({ kind: 'tool_result', name: 'Write', isError: true, contains: 'has not been read yet' }, ctx)
      assert.ok(r.ok)
    })

    it('denial check matches denial_recorded event', () => {
      const ctx = { events: [{ type: 'denial_recorded', denial: { tool: 'Write', reason: 'read-only' } }], toolResults: [], changed: { added: [], modified: [], removed: [] }, workspaceDir: '/tmp', state: {}, result: { outcome: 'completed', requestCount: 1 } }
      const r = evaluateCheck({ kind: 'denial', tool: 'Write' }, ctx)
      assert.ok(r.ok)
    })

    it('scope check rejects out-of-scope changes', () => {
      const ctx = { events: [], toolResults: [], changed: { added: ['src/calc.js', 'package.json'], modified: [], removed: [] }, workspaceDir: '/tmp', state: {}, result: { outcome: 'completed', requestCount: 1 } }
      const r = evaluateCheck({ kind: 'scope', allow: ['src/**'], deny: ['package.json'] }, ctx)
      assert.ok(!r.ok, 'should reject package.json change')
    })

    it('budget_exceeded check matches resource', () => {
      const ctx = { events: [], toolResults: [], changed: { added: [], modified: [], removed: [] }, workspaceDir: '/tmp', state: {}, result: { outcome: 'error', requestCount: 2, budgetExceeded: 'requests' } }
      const r = evaluateCheck({ kind: 'budget_exceeded', resource: 'requests' }, ctx)
      assert.ok(r.ok)
    })

    it('state check resolves dot paths', () => {
      const ctx = { events: [], toolResults: [], changed: { added: [], modified: [], removed: [] }, workspaceDir: '/tmp', state: { childDenied: true }, result: { outcome: 'completed', requestCount: 1 } }
      const r = evaluateCheck({ kind: 'state', key: 'childDenied', equals: true }, ctx)
      assert.ok(r.ok)
    })

    it('file_content check with equals', () => {
      const dir = mkdtempSync(join(tmpdir(), 'eval-check-'))
      try {
        writeFileSync(join(dir, 'test.txt'), 'hello\n')
        const ctx = { events: [], toolResults: [], changed: { added: [], modified: [], removed: [] }, workspaceDir: dir, state: {}, result: { outcome: 'completed', requestCount: 1 } }
        const r = evaluateCheck({ kind: 'file_content', path: 'test.txt', equals: 'hello\n' }, ctx)
        assert.ok(r.ok)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it('request_tools check excludes hidden tools', () => {
      const ctx = { events: [], toolResults: [], changed: { added: [], modified: [], removed: [] }, workspaceDir: '/tmp', state: { requests: [{ tools: [{ name: 'Read' }, { name: 'ToolSearch' }] }] }, result: { outcome: 'completed', requestCount: 1 } }
      const r = evaluateCheck({ kind: 'request_tools', index: 0, excludes: ['mcp__probe__search'] }, ctx)
      assert.ok(r.ok)
    })

    it('notification check counts input_injected events', () => {
      const ctx = { events: [{ type: 'input_injected', notification: true }], toolResults: [], changed: { added: [], modified: [], removed: [] }, workspaceDir: '/tmp', state: {}, result: { outcome: 'completed', requestCount: 1 } }
      const r = evaluateCheck({ kind: 'notification', min: 1 }, ctx)
      assert.ok(r.ok)
    })
  })

  describe('wrapProvider budget enforcement', () => {
    it('throws when request count exceeds maxRequests', async () => {
      const inner = scriptedProvider([textEvents('a'), textEvents('b')])
      const state = { requestCount: 0, tokens: 0, requests: [] }
      const bucket = []
      const wrapped = wrapProvider(inner, { maxRequests: 1, maxTokens: 999999 }, state, bucket)
      // First request OK
      const gen1 = wrapped.stream({ messages: [], model: 'test' })
      for await (const _ of gen1) {} // consume
      assert.equal(state.requestCount, 1)
      // Second request should throw
      await assert.rejects(async () => {
        const gen2 = wrapped.stream({ messages: [], model: 'test' })
        for await (const _ of gen2) {}
      }, /budget exceeded.*requests/)
    })
  })

  describe('scenario factories', () => {
    it('all scenarios produce valid setup objects', () => {
      const fakeCtx = { workspaceDir: '/tmp/fake', task: { pipeline: { fix: 'write', path: 'x', content: 'y' } }, state: {}, readFile: () => '' }
      for (const [name, factory] of Object.entries(SCENARIOS)) {
        const setup = factory(fakeCtx)
        assert.ok(setup.kind, name + ' missing kind')
        assert.ok(['session', 'module', 'command'].includes(setup.kind), name + ' invalid kind: ' + setup.kind)
      }
    })
  })

  describe('report generation', () => {
    it('buildSummary produces correct totals', () => {
      const results = [
        { id: 'A', version: 'v1', group: 'g1', category: 'LOC5', blind: false, status: 'passed', outcome: 'completed', durationMs: 100, requestCount: 1, tokens: 50 },
        { id: 'B', version: 'v1', group: 'g1', category: 'LOC5', blind: true, status: 'failed', outcome: 'error', durationMs: 200, requestCount: 2, tokens: 100, failureClass: 'provider_error' },
        { id: 'C', version: 'v1', group: 'g2', category: 'ADV1', blind: false, status: 'error', outcome: 'error', durationMs: 50, requestCount: 0, tokens: 0, harnessError: 'boom' }
      ]
      const summary = buildSummary({ runId: 'test-run', mode: 'offline', results, startedAt: '2026-01-01T00:00:00Z', finishedAt: '2026-01-01T00:01:00Z' })
      assert.equal(summary.totals.total, 3)
      assert.equal(summary.totals.passed, 1)
      assert.equal(summary.totals.failed, 1)
      assert.equal(summary.totals.error, 1)
      assert.equal(summary.totals.blind, 1)
      assert.equal(summary.totals.uniqueTasks, 3)
      assert.ok(summary.untested.length >= 5)
    })

    it('renderMarkdown includes all sections', () => {
      const summary = buildSummary({
        runId: 'md-test', mode: 'offline',
        results: [{ id: 'X', version: 'v1', group: 'g', category: 'LOC5', blind: false, status: 'passed', outcome: 'completed', durationMs: 10, requestCount: 1, tokens: 10 }],
        startedAt: '2026-01-01T00:00:00Z', finishedAt: '2026-01-01T00:00:01Z'
      })
      const md = renderMarkdown(summary)
      assert.ok(md.includes('# SP007 Agent 质量评估报告'))
      assert.ok(md.includes('## 分组结果'))
      assert.ok(md.includes('## 失败分类'))
      assert.ok(md.includes('## 未测能力清单'))
      assert.ok(md.includes('## 任务明细'))
    })

    it('writeReport creates summary.json and summary.md', () => {
      const dir = mkdtempSync(join(tmpdir(), 'eval-report-'))
      try {
        const summary = buildSummary({
          runId: 'write-test', mode: 'offline',
          results: [{ id: 'Y', version: 'v1', group: 'g', category: 'LOC5', blind: false, status: 'passed', outcome: 'completed', durationMs: 5, requestCount: 1, tokens: 5 }],
          startedAt: '2026-01-01T00:00:00Z', finishedAt: '2026-01-01T00:00:01Z'
        })
        const { jsonPath, mdPath } = writeReport(summary, dir)
        assert.ok(existsSync(jsonPath))
        assert.ok(existsSync(mdPath))
        const parsed = JSON.parse(readFileSync(jsonPath, 'utf8'))
        assert.equal(parsed.runId, 'write-test')
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it('blind tasks are redacted in report', () => {
      const results = [
        { id: 'BLIND-1', version: 'v1', group: 'g', category: 'ADV1', blind: true, status: 'failed', outcome: 'error', durationMs: 100, requestCount: 2, tokens: 50, failureClass: 'assertion', error: { class: 'bad_request', message: 'secret' }, checks: [{ ok: false, message: 'secret detail' }] }
      ]
      const summary = buildSummary({ runId: 'redact-test', mode: 'offline', results, startedAt: '2026-01-01T00:00:00Z', finishedAt: '2026-01-01T00:00:01Z' })
      const blindTask = summary.tasks[0]
      assert.ok(blindTask.redacted)
      assert.equal(blindTask.error, undefined)
      assert.equal(blindTask.checks, undefined)
    })
  })

  describe('UNTESTED_CAPABILITIES', () => {
    it('lists all five ER-05 items', () => {
      assert.ok(UNTESTED_CAPABILITIES.some(c => c.includes('团队')))
      assert.ok(UNTESTED_CAPABILITIES.some(c => c.includes('浏览器')))
      assert.ok(UNTESTED_CAPABILITIES.some(c => c.includes('CU')))
      assert.ok(UNTESTED_CAPABILITIES.some(c => c.includes('调度')))
      assert.ok(UNTESTED_CAPABILITIES.some(c => c.includes('多端')))
    })
  })
})
