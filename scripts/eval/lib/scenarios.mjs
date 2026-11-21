// SP007 §4.5：离线评估场景库。
// 每个场景给出一个「可复现的行为脚本」，用脚本化 provider 代替真实模型，
// 让 runner 能在没有网络与凭据的情况下验证产品链路的真实行为。
// 约定：ESM、2 空格缩进、无分号。
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createOpenAiProvider } from '../../../src/tui/dist/provider/openai.js'
import { buildDoctorReport } from '../../../src/tui/dist/tui/diagnostics/doctor.js'

/** 1x1 PNG（base64），用于图片链路评估。 */
export const PNG_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

/** 纯文本回复事件。 */
export function textEvents(text) {
  return [
    { type: 'text_delta', text },
    {
      type: 'message_completed',
      finishReason: 'stop',
      usage: { inputTokens: 24, outputTokens: 9 }
    }
  ]
}

/** 单次工具调用事件。 */
export function toolCallEvents(callId, name, argsJson) {
  return [
    { type: 'tool_call_delta', index: 0, callId, nameDelta: name, argsDelta: argsJson },
    {
      type: 'message_completed',
      finishReason: 'tool_calls',
      usage: { inputTokens: 24, outputTokens: 9 }
    }
  ]
}

/** 供应商失败事件。 */
export function failureEvents(error) {
  return [{ type: 'failed', error }]
}

/**
 * 脚本化 provider：按序消费脚本项；脚本项可以是事件数组，也可以是
 * (request, index) => 事件数组 的函数。脚本用尽后重复最后一项，
 * 真正的终止由 runner 的预算帽兜底（不会无限循环）。
 */
export function scriptedProvider(script) {
  const requests = []
  return {
    requests,
    async *stream(request) {
      requests.push(request)
      const index = requests.length - 1
      const entry = script[Math.min(index, script.length - 1)]
      const events = typeof entry === 'function' ? await entry(request, index) : entry
      for (const event of events ?? []) yield event
    }
  }
}

/** 一直挂起到请求被中止的 provider（验证取消链路）。 */
export function hangingProvider() {
  const requests = []
  return {
    requests,
    async *stream(request) {
      requests.push(request)
      await new Promise((resolve, reject) => {
        const signal = request.signal
        if (!signal) return
        if (signal.aborted) {
          reject(new Error('request aborted'))
          return
        }
        signal.addEventListener(
          'abort',
          () => reject(new Error('request aborted')),
          { once: true }
        )
      })
    }
  }
}

/** 从请求历史里提取子代理 id（Agent 工具结果文本中的 agentId 行）。 */
export function extractAgentId(requests) {
  for (const request of requests) {
    for (const message of request.messages ?? []) {
      if (message.role !== 'tool') continue
      const content = typeof message.content === 'string' ? message.content : ''
      const match = content.match(/agentId:\s*([A-Za-z0-9_-]+)/)
      if (match) return match[1]
    }
  }
  return undefined
}

/** 把请求历史里的工具结果文本摊平，便于断言「子代理是否被拒绝」。 */
export function toolTexts(requests) {
  const out = []
  for (const request of requests) {
    for (const message of request.messages ?? []) {
      if (message.role !== 'tool') continue
      const content = typeof message.content === 'string' ? message.content : ''
      if (content) out.push(content)
    }
  }
  return out
}

/** SSE 帧响应（真实 OpenAI 适配器的重试链路需要真实 HTTP 语义）。 */
function sseResponse(frames) {
  const body = frames.map((frame) => 'data: ' + JSON.stringify(frame) + '\n\n').join('')
  return new Response(body + 'data: [DONE]\n\n', {
    status: 200,
    headers: { 'content-type': 'text/event-stream' }
  })
}

/** 会话工具集里可用的最小工具定义。 */
function brokenMcpTool() {
  return {
    name: 'mcp__broken__search',
    summary: 'Broken MCP search tool used to exercise the failure boundary.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query']
    },
    capability: () => 'read',
    describe: () => 'mcp__broken__search(query)',
    async execute() {
      throw new Error('MCP server broken: connection refused')
    }
  }
}

function probeMcpTool() {
  return {
    name: 'mcp__probe__search',
    summary: 'Deferred MCP tool used to exercise ToolSearch.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query']
    },
    capability: () => 'read',
    describe: () => 'mcp__probe__search(query)',
    async execute(input) {
      return 'probe result: ' + String(input?.query ?? '')
    }
  }
}

/**
 * 场景表：task.scenario → 场景工厂。
 * 工厂返回 setup：
 *   kind: 'session' | 'module' | 'command'
 *   provider/childProvider/tools/mode/submit/images/budget/awaitExtra（session）
 *   run(ctx)（module / command）
 */
export const SCENARIOS = {
  // 供应商错误恢复：连续两次 503 后第三次成功，回合应完成并留下 api_retry 记录。
  provider_recovery() {
    const attempts = []
    const provider = createOpenAiProvider({
      baseUrl: 'https://eval.invalid/v1',
      apiKey: 'eval-key',
      fetchImpl: async (_url, init) => {
        attempts.push(init)
        if (attempts.length <= 2) {
          return new Response(
            JSON.stringify({ error: { message: 'upstream overloaded', type: 'server_error' } }),
            { status: 503, headers: { 'content-type': 'application/json' } }
          )
        }
        return sseResponse([
          { choices: [{ delta: { content: '已恢复。' } }] },
          { choices: [{ delta: {}, finish_reason: 'stop' }] },
          { usage: { prompt_tokens: 12, completion_tokens: 5 } }
        ])
      },
      sleep: async () => {},
      limits: { maxAttempts: 3 }
    })
    return {
      kind: 'session',
      provider,
      tools: 'none',
      mode: 'read_only',
      submit: '服务刚才不稳定，请重试并给出结果。',
      requestCounter: () => attempts.length
    }
  },

  // 供应商错误边界：不可重试的 bad_request 应直接落到 error 终态，不做无谓重试。
  provider_error_boundary() {
    return {
      kind: 'session',
      provider: scriptedProvider([
        failureEvents({
          class: 'bad_request',
          code: 'BUDINGX_PROVIDER_016',
          message: 'Invalid request: unsupported parameter',
          retryable: false
        })
      ]),
      tools: 'none',
      mode: 'read_only',
      submit: '触发一次不可恢复的供应商错误。'
    }
  },

  // 工具错误：未先 Read 就 Write，应返回稳定错误码且不落盘。
  tool_error_read_first() {
    return {
      kind: 'session',
      provider: scriptedProvider([
        toolCallEvents(
          'call-write-1',
          'Write',
          JSON.stringify({ file_path: 'notes/target.md', content: 'hello\n' })
        ),
        textEvents('已停止写入。')
      ]),
      tools: 'workspace',
      mode: 'read_only',
      submit: '把内容写入 notes/target.md。'
    }
  },

  // 工具错误：参数不是合法 JSON，工具不应执行，应把可自纠的错误回灌给模型。
  tool_error_invalid_args() {
    return {
      kind: 'session',
      provider: scriptedProvider([
        toolCallEvents('call-bad', 'Write', '{"file_path": "notes/out.md", "content":'),
        toolCallEvents(
          'call-good',
          'Write',
          JSON.stringify({ file_path: 'notes/out.md', content: 'ok\n' })
        ),
        textEvents('已用合法参数重试。')
      ]),
      tools: 'workspace',
      mode: 'workspace_edit',
      submit: '把内容写入 notes/out.md。'
    }
  },

  // 图片降级：供应商不支持图片时，应剥离图片重试一次并公告。
  image_downgrade() {
    return {
      kind: 'session',
      provider: scriptedProvider([
        failureEvents({
          class: 'bad_request',
          code: 'BUDINGX_PROVIDER_016',
          message: 'This model does not support image input',
          retryable: false
        }),
        textEvents('已在无图模式下继续。')
      ]),
      tools: 'none',
      mode: 'read_only',
      submit: '看看这张图。',
      images: [{ id: 'img-eval-1', mediaType: 'image/png', data: PNG_1X1 }]
    }
  },

  // 子代理权限：父会话只读，子代理的写操作必须被拒绝。
  subagent_permission() {
    const child = scriptedProvider([
      toolCallEvents(
        'call-child-write',
        'Write',
        JSON.stringify({ file_path: 'notes/child.md', content: 'child\n' })
      ),
      textEvents('写入被拒绝。')
    ])
    return {
      kind: 'session',
      provider: scriptedProvider([
        toolCallEvents(
          'call-agent-1',
          'Agent',
          JSON.stringify({
            description: '写入说明文件',
            prompt: '请创建 notes/child.md 并写入内容。',
            subagent_type: 'general-purpose'
          })
        ),
        textEvents('子代理已完成。')
      ]),
      childProvider: child,
      tools: 'agents',
      mode: 'read_only',
      submit: '让子代理写一个说明文件。',
      awaitExtra: async ({ state }) => {
        state.childToolTexts = toolTexts(child.requests)
        state.childDenied = state.childToolTexts.some((text) => text.includes('Denied:'))
        return state.childDenied
      }
    }
  },

  // 子代理取消：后台子代理挂起，父代理用 TaskStop 停止它。
  subagent_cancel() {
    const child = hangingProvider()
    return {
      kind: 'session',
      provider: scriptedProvider([
        toolCallEvents(
          'call-agent-bg',
          'Agent',
          JSON.stringify({
            description: '长任务',
            prompt: '持续工作直到被取消。',
            subagent_type: 'general-purpose',
            run_in_background: true
          })
        ),
        (request) => {
          const agentId = extractAgentId(request.messages ? [request] : [])
          return toolCallEvents('call-stop', 'TaskStop', JSON.stringify({ agent_id: agentId ?? '' }))
        },
        textEvents('已停止子代理。')
      ]),
      childProvider: child,
      tools: 'agents',
      mode: 'workspace_edit',
      submit: '启动一个后台子代理然后停止它。',
      awaitExtra: async ({ state, registry }) => {
        const agents = registry ? registry.list() : []
        state.agents = agents
        const agent = agents.find((item) => item.agentId)
        return Boolean(agent && (agent.state === 'cancelled' || agent.state === 'failed'))
      }
    }
  },

  // 子代理冲突：父代理读过的文件被外部改写后，Write 必须被指纹检查拦下。
  subagent_conflict(ctx) {
    return {
      kind: 'session',
      provider: scriptedProvider([
        toolCallEvents('call-read', 'Read', JSON.stringify({ file_path: 'notes/target.md' })),
        () => {
          writeFileSync(join(ctx.workspaceDir, 'notes', 'target.md'), '外部写者改写\n')
          return toolCallEvents(
            'call-write',
            'Write',
            JSON.stringify({ file_path: 'notes/target.md', content: '代理新内容\n' })
          )
        },
        textEvents('写入被阻止。')
      ]),
      tools: 'workspace',
      mode: 'workspace_edit',
      submit: '读取 notes/target.md 然后写回新内容。'
    }
  },

  // MCP 失败边界：MCP 工具抛错不得让回合崩溃。
  mcp_failure() {
    return {
      kind: 'session',
      provider: scriptedProvider([
        toolCallEvents('call-mcp', 'mcp__broken__search', JSON.stringify({ query: 'anything' })),
        textEvents('已处理工具失败。')
      ]),
      tools: 'workspace',
      extraTools: [brokenMcpTool()],
      mode: 'read_only',
      submit: '用 MCP 工具搜索一下。'
    }
  },

  // 诊断准确性：坏掉的 MCP 必须出现在 doctor 报告里并给出修复建议。
  diagnostics() {
    return {
      kind: 'module',
      async run(ctx) {
        const report = buildDoctorReport({
          runtime: {
            kind: 'npm-global',
            version: '0.6.0',
            nodeVersion: process.version,
            entryPath: '/usr/local/bin/budingx',
            searchAvailable: true
          },
          installations: [],
          configCorrupt: false,
          mcpFailed: [{ name: 'broken', error: 'connection refused' }],
          keybindingWarnings: [],
          envIssues: [],
          agentParseErrors: [],
          contextWarnings: []
        })
        const lines = report.sections.flatMap((section) => section.lines)
        ctx.state.diagnosticWarningCount = report.warningCount
        ctx.state.diagnosticHasMcpWarning = lines.some(
          (line) => line.startsWith('Warning:') && line.includes('broken')
        )
        ctx.state.diagnosticHasFix = lines.some((line) => line.startsWith('Fix:'))
      }
    }
  },

  // ToolSearch 延迟加载：首请求不得暴露 mcp__ 工具，发现之后才可见。
  tool_search() {
    return {
      kind: 'session',
      provider: scriptedProvider([
        toolCallEvents(
          'call-toolsearch',
          'ToolSearch',
          JSON.stringify({ query: 'select:mcp__probe__search' })
        ),
        textEvents('已加载延迟工具。')
      ]),
      tools: 'workspace',
      extraTools: [probeMcpTool()],
      toolSearchEnv: { BUDINGX_TOOL_SEARCH: 'auto:0' },
      mode: 'read_only',
      submit: '找出延迟工具并使用它。'
    }
  },

  // 后台子代理：完成后必须向父会话注入通知。
  subagent_background() {
    const child = scriptedProvider([textEvents('后台子代理完成。')])
    return {
      kind: 'session',
      provider: scriptedProvider([
        toolCallEvents(
          'call-agent-bg2',
          'Agent',
          JSON.stringify({
            description: '后台调研',
            prompt: '读取 notes/target.md 并汇报。',
            subagent_type: 'general-purpose',
            run_in_background: true
          })
        ),
        textEvents('已派发后台子代理。'),
        textEvents('已收到后台通知。')
      ]),
      childProvider: child,
      tools: 'agents',
      mode: 'workspace_edit',
      submit: '启动一个后台子代理。',
      awaitExtra: async ({ state, events, registry }) => {
        state.agents = registry ? registry.list() : (state.agents ?? [])
        state.notificationSeen = events.some(
          (event) => event.type === 'input_injected' && event.notification
        )
        return state.notificationSeen
      }
    }
  },

  // 预算帽：请求数超限必须被拦下并归类为预算失败。
  budget_enforced() {
    return {
      kind: 'session',
      provider: scriptedProvider([
        toolCallEvents('call-read', 'Read', JSON.stringify({ file_path: 'notes/target.md' })),
        textEvents('继续。')
      ]),
      tools: 'workspace',
      mode: 'workspace_edit',
      submit: '读取 notes/target.md。',
      budget: { maxRequests: 1 }
    }
  },

  // 权限边界：只读模式下写文件必须被拒绝，且磁盘无变化。
  permission_scope() {
    return {
      kind: 'session',
      provider: scriptedProvider([
        toolCallEvents(
          'call-write-denied',
          'Write',
          JSON.stringify({ file_path: 'notes/forbidden.md', content: 'x\n' })
        ),
        textEvents('未写入。')
      ]),
      tools: 'workspace',
      mode: 'read_only',
      submit: '把内容写入 notes/forbidden.md。'
    }
  },

  // 编码回归子集：脚本化「模型修复」，验证 runner 的命令型管线。
  coding_regression(ctx) {
    return {
      kind: 'command',
      async run(runCtx) {
        const task = ctx.task
        const plan = task.pipeline ?? {}
        if (plan.fix === 'write') {
          writeFileSync(join(runCtx.workspaceDir, plan.path), plan.content)
        }
        if (plan.fix === 'strip_crlf') {
          const target = join(runCtx.workspaceDir, plan.path)
          const current = runCtx.readFile(target)
          writeFileSync(target, current.replace(/\r\n/g, '\n'))
        }
      }
    }
  }
}
