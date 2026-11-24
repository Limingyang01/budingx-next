// SP007 §4.5：评估执行核心（离线脚本化与真实模型共用同一条判定链）。
// 评分只依据可自动断言的事实（终态、事件、文件、退出码、请求数），
// 不采信模型自报；失败必须落到 SP007 的失败分类里。
// 约定：ESM、2 空格缩进、无分号。
import { spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Session } from '../../../src/tui/dist/core/session.js'
import { createAgentRegistry } from '../../../src/tui/dist/core/agent-runtime.js'
import { createAgentTools } from '../../../src/tui/dist/core/agent-tools.js'
import { BUILT_IN_AGENTS } from '../../../src/tui/dist/core/agent-definitions.js'
import { createToolSearch } from '../../../src/tui/dist/core/tool-search.js'
import { createCommandRunner } from '../../../src/tui/dist/exec/runner.js'
import { createSandboxPolicy } from '../../../src/tui/dist/exec/sandbox-policy.js'
import { createExecTools } from '../../../src/tui/dist/exec/tools.js'
import { createWorkspace } from '../../../src/tui/dist/workspace/paths.js'
import { createWorkspaceTools } from '../../../src/tui/dist/workspace/tools.js'
import { createPermissionPolicy } from '../../../src/tui/dist/workspace/policy.js'
import { evaluateChecks } from './checks.mjs'
import { SCENARIOS } from './scenarios.mjs'
import {
  copyTree,
  diffSnapshots,
  exists,
  readText,
  removeTree,
  repoRoot,
  snapshotFiles
} from './util.mjs'
import { BUDGET_PROFILES, CHECKPOINT_BUDGET_PROFILES, CHECKPOINT_BUDGET_VERSION } from './tasks.mjs'

const EVAL_MODEL = 'eval-model'

/** 评估快照（与 TUI 运行时同形状）。 */
function evalSnapshot(withTools, override) {
  if (override) return { ...override, capabilities: { tools: withTools, vision: true, ...(override.capabilities ?? {}) } }
  return {
    modelId: EVAL_MODEL,
    model: EVAL_MODEL,
    baseUrlHost: 'eval.invalid',
    capabilities: { tools: withTools, vision: true }
  }
}

/** 审批网关：评估环境一律放行，权限判定仍由策略层负责。 */
const ALWAYS_ALLOW = {
  request: async () => ({ outcome: 'allow', via: 'user' })
}

/**
 * 预算包装层：请求数与 token 累计超限时直接抛错，
 * 让回合以错误终态结束（归类为 budget），而不是悄悄超支。
 */
export function wrapProvider(provider, budget, state, bucket) {
  return {
    async *stream(request) {
      state.requestCount += 1
      bucket.push(request)
      if (budget.maxRequests && state.requestCount > budget.maxRequests) {
        state.budgetExceeded = 'requests'
        throw new Error(
          'Evaluation budget exceeded: requests (max ' + budget.maxRequests + ')'
        )
      }
      for await (const event of provider.stream(request)) {
        if (event.type === 'message_completed' && event.usage) {
          state.tokens += (event.usage.inputTokens ?? 0) + (event.usage.outputTokens ?? 0)
          if (budget.maxTokens && state.tokens > budget.maxTokens) {
            state.budgetExceeded = 'tokens'
            throw new Error(
              'Evaluation budget exceeded: tokens (max ' + budget.maxTokens + ')'
            )
          }
        }
        yield event
      }
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return true
    await sleep(10)
  }
  return false
}

function hasFinalized(events) {
  return events.some((event) => event.type === 'turn_finalized')
}

function allTurnsFinalized(events) {
  const started = events.filter((event) => event.type === 'turn_started').length
  const finalized = events.filter((event) => event.type === 'turn_finalized').length
  return started > 0 && finalized >= started
}

/** 由可观测事实推断失败分类（ER-01）。 */
function classifyFailure(ctx, timedOut) {
  if (timedOut) return 'timeout'
  if (ctx.result.budgetExceeded) return 'budget'
  if (ctx.result.outcome === 'cancelled') return 'cancelled'
  const errorClass = ctx.result.error?.class
  if (
    errorClass &&
    [
      'auth',
      'rate_limited',
      'overloaded',
      'bad_request',
      'network',
      'timeout',
      'not_found',
      'invalid_stream'
    ].includes(errorClass)
  ) {
    return 'provider_error'
  }
  if (ctx.events.some((event) => event.type === 'denial_recorded')) return 'permission'
  if (ctx.toolResults.some((item) => item.isError)) return 'tool_error'
  return 'assertion'
}

/** 组装评估会话（离线脚本化与真实模型共用）。 */
function buildSession({
  setup,
  task,
  state,
  events,
  workspaceDir,
  budget,
  provider,
  childProvider,
  snapshot
}) {
  const workspace = createWorkspace(workspaceDir)
  const tools = []
  if (setup.tools === 'workspace' || setup.tools === 'agents') {
    const workspaceTools = createWorkspaceTools(workspace, {})
    tools.push(...workspaceTools.tools)
  }
  if (setup.extraTools) tools.push(...setup.extraTools)
  const mode = setup.mode ?? 'read_only'
  const dataRootOverride = join(workspaceDir, '.data-root')
  const policy = createPermissionPolicy({ workspace, mode, dataRootOverride })
  const turnSnapshot = evalSnapshot(tools.length > 0, snapshot)

  const parentProvider = wrapProvider(provider, budget, state, state.requests)
  const childWrapper = childProvider
    ? wrapProvider(childProvider, budget, state, state.childRequests)
    : undefined

  const sessionOptions = {
    provider: parentProvider,
    approval: setup.approval ?? ALWAYS_ALLOW,
    resolveSnapshot: () => turnSnapshot,
    tools,
    permissionPolicy: policy,
    maxIterations: budget.maxTurns ?? 8
  }
  if (setup.toolSearchEnv) {
    sessionOptions.toolSearch = createToolSearch({
      tools,
      contextWindow: 200_000,
      env: setup.toolSearchEnv
    })
  }
  const session = new Session(sessionOptions)

  let registry = null
  if (setup.tools === 'agents') {
    registry = createAgentRegistry({
      parentSession: session,
      tools,
      provider: parentProvider,
      resolveProvider: () => childWrapper ?? parentProvider,
      resolveSnapshot: () => turnSnapshot,
      approval: setup.approval ?? ALWAYS_ALLOW,
      policy,
      createChildPolicy: (childMode) =>
        createPermissionPolicy({ workspace, mode: childMode, dataRootOverride })
    })
    tools.push(...createAgentTools(registry, BUILT_IN_AGENTS))
  }
  const unsubscribe = session.on((event) => {
    events.push(event)
  })
  return { session, registry, unsubscribe, tools }
}

function collectToolResults(events) {
  const names = new Map()
  for (const event of events) {
    if (event.type === 'tool_call_completed') names.set(event.callId, event.name)
  }
  return events
    .filter((event) => event.type === 'tool_result')
    .map((event) => ({
      callId: event.callId,
      name: names.get(event.callId) ?? 'unknown',
      content: event.content,
      isError: event.isError === true
    }))
}

function collectAgents(registry) {
  if (!registry) return []
  return registry.list().map((record) => ({
    agentId: record.agentId,
    agentType: record.agentType,
    description: record.description,
    state: record.state,
    background: record.background,
    toolUses: record.toolUses,
    tokens: record.tokens,
    stopped: record.stopped,
    notified: record.notified
  }))
}

/** 执行任务声明的校验命令（编码回归子集用）。 */
function runVerifyCommands(task, cwd, deadline = Infinity) {
  const commands = task.verify?.commands ?? []
  if (commands.length === 0) return { exitCode: 0, output: '' }
  let output = ''
  let exitCode = 0
  for (const command of commands) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) return { exitCode: 1, output, timedOut: true }
    const run = spawnSync(command[0], command.slice(1), {
      cwd,
      encoding: 'utf8',
      timeout: Math.min(60_000, remaining)
    })
    exitCode = run.status === null ? 1 : run.status
    output += (run.stdout ?? '') + (run.stderr ?? '')
    if (Date.now() >= deadline) return { exitCode, output, timedOut: true }
    if (exitCode !== 0) break
  }
  return { exitCode, output }
}

function budgetOf(task, profiles = BUDGET_PROFILES) {
  return {
    ...(profiles[task.budget] ?? profiles.B),
    ...(task.budget_overrides ?? {})
  }
}

/**
 * 运行单个任务（离线路径）。
 * options.overrides：可替换 provider/submit/images/checks，用于真实模型或专项复跑。
 */
export async function runTask(task, options = {}) {
  const root = options.root ?? repoRoot()
  const started = Date.now()
  const state = {
    requestCount: 0,
    tokens: 0,
    budgetExceeded: undefined,
    requests: [],
    childRequests: []
  }
  const events = []
  const workspaceDir = mkdtempSync(join(tmpdir(), 'budingx-eval-'))
  const budget = { ...budgetOf(task), ...(options.budget ?? {}) }
  let result = { outcome: 'unknown', error: undefined, requestCount: 0 }
  let changed = { added: [], modified: [], removed: [] }
  let toolResults = []
  let timedOut = false
  let failureClass = undefined
  let thrown = null
  let effectiveTask = task
  try {
    const fixtureDir = join(root, 'scripts', 'eval', 'fixtures', task.fixture ?? task.id)
    if (exists(fixtureDir)) copyTree(fixtureDir, workspaceDir)
    const before = snapshotFiles(workspaceDir)
    const factory = SCENARIOS[task.scenario]
    if (!factory) throw new Error('未知场景：' + task.scenario)
    let setup = factory({ workspaceDir, task, state, root })
    if (options.overrides) {
      setup = { ...setup, ...options.overrides }
      if (options.overrides.checks) {
        effectiveTask = { ...task, checks: options.overrides.checks }
      }
    }
    if (setup.kind === 'module') {
      await setup.run({ workspaceDir, task, state, readFile: (p) => readText(p) })
      result = { outcome: 'completed', error: undefined, requestCount: state.requestCount }
    } else if (setup.kind === 'command') {
      await setup.run({ workspaceDir, task, state, readFile: (p) => readText(p) })
      const verification = runVerifyCommands(task, workspaceDir)
      result = {
        outcome: verification.exitCode === 0 ? 'completed' : 'error',
        error:
          verification.exitCode === 0
            ? undefined
            : {
                class: 'unknown',
                code: 'EVAL_VERIFY_FAILED',
                message: verification.output.slice(0, 2000)
              },
        requestCount: state.requestCount,
        commandExitCode: verification.exitCode,
        commandOutput: verification.output
      }
    } else {
      const sessionResult = await runSession({
        setup,
        task,
        state,
        events,
        workspaceDir,
        budget
      })
      result = sessionResult.result
      toolResults = sessionResult.toolResults
      timedOut = sessionResult.timedOut
    }
    changed = diffSnapshots(before, snapshotFiles(workspaceDir))
  } catch (error) {
    thrown = error
    result = {
      outcome: 'error',
      error: {
        class: 'unknown',
        code: 'EVAL_HARNESS_ERROR',
        message: error instanceof Error ? error.message : String(error)
      },
      requestCount: state.requestCount
    }
  }
  let checks = []
  let passed = false
  let ctx = { events, toolResults, changed, workspaceDir, state, result }
  try {
    checks = thrown ? [] : evaluateChecks(effectiveTask.checks ?? [], ctx)
    passed = !thrown && checks.length > 0 && checks.every((check) => check.ok)
    if (!passed) failureClass = classifyFailure(ctx, timedOut)
  } finally {
    removeTree(workspaceDir)
  }
  return {
    id: task.id,
    version: task.version,
    group: task.group,
    category: task.category,
    blind: task.blind === true,
    status: thrown ? 'error' : passed ? 'passed' : 'failed',
    durationMs: Date.now() - started,
    outcome: result.outcome,
    error: result.error,
    requestCount: result.requestCount,
    tokens: state.tokens,
    budgetExceeded: state.budgetExceeded,
    changed,
    checks,
    failureClass,
    harnessError: thrown ? (thrown instanceof Error ? thrown.message : String(thrown)) : undefined
  }
}

/** 跑一遍会话型场景。 */
async function runSession({ setup, task, state, events, workspaceDir, budget }) {
  const { session, registry, unsubscribe } = buildSession({
    setup,
    task,
    state,
    events,
    workspaceDir,
    budget,
    provider: setup.provider,
    childProvider: setup.childProvider
  })
  let timedOut = false
  try {
    session.submit(setup.submit, setup.images ? { images: setup.images } : undefined)
    const finalized = await waitFor(() => hasFinalized(events), budget.timeoutMs)
    timedOut = !finalized
    if (setup.awaitExtra) {
      await waitFor(
        () => Boolean(setup.awaitExtra({ events, state, registry, workspaceDir })),
        Math.min(budget.timeoutMs, 30_000)
      )
    }
    await waitFor(() => allTurnsFinalized(events), Math.min(budget.timeoutMs, 15_000))
  } finally {
    unsubscribe()
    try {
      registry?.dispose()
    } catch {
      // 注册表释放失败不影响断言结论。
    }
    session.dispose()
  }
  state.agents = collectAgents(registry)
  const toolResults = collectToolResults(events)
  const finalized = events.filter((event) => event.type === 'turn_finalized').pop()
  return {
    toolResults,
    timedOut,
    result: {
      outcome: finalized?.outcome ?? (timedOut ? 'timeout' : 'unknown'),
      error: finalized?.error,
      requestCount: state.requestCount,
      budgetExceeded: state.budgetExceeded
    }
  }
}

/**
 * 真实模型任务（live 路径）：模型自己改代码，再用命令断言结果。
 * 与离线路径共用同一套断言求值与失败分类。
 */
export async function runLiveTask(task, options = {}) {
  const root = options.root ?? repoRoot()
  const started = Date.now()
  const state = {
    requestCount: 0,
    tokens: 0,
    budgetExceeded: undefined,
    requests: [],
    childRequests: []
  }
  const events = []
  const workspaceDir = mkdtempSync(join(tmpdir(), 'budingx-live-'))
  const budget = { ...budgetOf(task, CHECKPOINT_BUDGET_PROFILES), ...(options.budget ?? {}) }
  const deadline = started + budget.timeoutMs
  let result = { outcome: 'unknown', error: undefined, requestCount: 0 }
  let changed = { added: [], modified: [], removed: [] }
  let toolResults = []
  let checks = []
  let thrown = null
  let timedOut = false
  let commandRunner
  try {
    const fixtureDir = join(root, 'scripts', 'eval', 'fixtures', task.fixture ?? task.id)
    if (exists(fixtureDir)) copyTree(fixtureDir, workspaceDir)
    const before = snapshotFiles(workspaceDir)
    const mode = task.permissionMode ?? 'workspace_edit'
    const approvalStrategy = task.approval ?? 'allow'
    if (!['read_only', 'workspace_edit', 'full_access'].includes(mode)) {
      throw new Error('Unsupported evaluation permission mode: ' + mode)
    }
    if (!['allow', 'deny', 'deny_then_allow'].includes(approvalStrategy)) {
      throw new Error('Unsupported evaluation approval strategy: ' + approvalStrategy)
    }
    const sandboxPolicy = createSandboxPolicy({ hostTrusted: true })
    if (task.permissionMode !== undefined) {
      commandRunner = createCommandRunner({ defaultCwd: workspaceDir, sandboxPolicy })
    }
    let approvalRequests = 0
    const setup = {
      kind: 'session',
      tools: 'workspace',
      mode,
      extraTools: commandRunner
        ? createExecTools({ runner: commandRunner, defaultCwd: workspaceDir, sandboxPolicy })
        : undefined,
      approval: {
        async request() {
          approvalRequests++
          const deny = approvalStrategy === 'deny' || (approvalStrategy === 'deny_then_allow' && approvalRequests === 1)
          return { outcome: deny ? 'deny' : 'allow', via: 'user' }
        }
      },
      provider: options.provider,
      submit: task.instruction
    }
    const { session, registry, unsubscribe } = buildSession({
      setup,
      task,
      state,
      events,
      workspaceDir,
      budget,
      provider: options.provider,
      snapshot: options.snapshot
    })
    try {
      session.submit(task.instruction)
      timedOut = !await waitFor(() => allTurnsFinalized(events), deadline - Date.now())
      if (timedOut) session.interrupt('user')
    } finally {
      unsubscribe()
      try {
        registry?.dispose()
      } catch {
        // 忽略释放失败。
      }
      session.dispose()
    }
    toolResults = collectToolResults(events)
    const verification = timedOut ? undefined : runVerifyCommands(task, workspaceDir, deadline)
    const finalized = events.filter((event) => event.type === 'turn_finalized').pop()
    timedOut ||= verification?.timedOut === true
    state.budgetExceeded ??= timedOut ? 'wall-clock' : finalized?.outcome === 'max_turns' ? 'turns' : undefined
    result = {
      outcome: finalized?.outcome ?? (timedOut ? 'timeout' : 'unknown'),
      error: finalized?.error,
      requestCount: state.requestCount,
      budgetExceeded: state.budgetExceeded,
      commandExitCode: verification?.exitCode,
      commandOutput: verification?.output
    }
    changed = diffSnapshots(before, snapshotFiles(workspaceDir))
    checks = evaluateChecks(task.live_checks ?? task.checks ?? [], {
      events, toolResults, changed, workspaceDir, state, result
    })
  } catch (error) {
    thrown = error
    result = {
      outcome: 'error',
      error: {
        class: 'unknown',
        code: 'EVAL_HARNESS_ERROR',
        message: error instanceof Error ? error.message : String(error)
      },
      requestCount: state.requestCount
    }
  } finally {
    commandRunner?.dispose()
    removeTree(workspaceDir)
  }
  const passed = !thrown && !timedOut && !result.budgetExceeded &&
    result.outcome === 'completed' && result.commandExitCode === 0 &&
    checks.length > 0 && checks.every((check) => check.ok)
  const failureClass = passed
    ? undefined
    : result.budgetExceeded
      ? 'BUDGET'
      : classifyFailure({ events, toolResults, result }, timedOut)
  return {
    id: task.id,
    version: task.version,
    group: task.group,
    category: task.category,
    blind: task.blind === true,
    status: thrown ? 'error' : passed ? 'passed' : 'failed',
    durationMs: Date.now() - started,
    outcome: result.outcome,
    error: result.error,
    commandExitCode: result.commandExitCode,
    requestCount: result.requestCount,
    tokens: state.tokens,
    budgetExceeded: state.budgetExceeded,
    budgetVersion: CHECKPOINT_BUDGET_VERSION,
    changed,
    checks,
    failureClass,
    harnessError: thrown ? (thrown instanceof Error ? thrown.message : String(thrown)) : undefined
  }
}

/**
 * 运行一组任务。
 * repeats：同一任务重复次数（SP001 §9 波动区间；默认 1）。
 */
export async function runTasks(tasks, options = {}) {
  const repeats = options.repeats ?? 1
  const results = []
  for (const task of tasks) {
    for (let index = 0; index < repeats; index += 1) {
      const result = await runTask(task, options)
      result.repeat = index + 1
      results.push(result)
    }
  }
  return results
}
