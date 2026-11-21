// SP007 §4.1：子代理派发工具 Agent / TaskOutput / TaskStop（参考 AgentTool 机制，独立实现）。
// Agent 标记 concurrencySafe，dispatchTools 将连续的 Agent 调用并行成组（SA-05/SA-15）；
// 派发本身只读（capability='read'），子代理的工具各自受裁剪后的权限策略约束。
import type { ToolHandler, ToolContext } from './tools.js'
import type { AgentDefinition } from './agent-definitions.js'
import type { AgentRegistry, AgentSpawnResult } from './agent-runtime.js'

const TASK_OUTPUT_MAX_TIMEOUT_MS = 600_000
const TASK_OUTPUT_DEFAULT_TIMEOUT_MS = 30_000

function agentError(message: string, code: string): Error {
  const error = new Error(message) as Error & { code?: string }
  error.code = code
  return error
}

function readString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/** 把注册表终态结果格式化为模型可见的工具结果文本。 */
function formatSpawnResult(result: AgentSpawnResult): string {
  if (result.status === 'async_launched') {
    const lines = [
      'async_launched',
      `agentId: ${result.agentId}`,
      'The agent runs in the background. A task-notification is injected when it finishes;',
      'use TaskOutput to read its result or TaskStop to stop it. Do not mention the agentId to the user.'
    ]
    if (result.outputFile) lines.splice(2, 0, `outputFile: ${result.outputFile}`)
    return lines.join('\n')
  }
  if (result.status === 'failed' || result.status === 'cancelled' || result.status === 'budget') {
    throw agentError(`${result.code}: ${result.text}`, result.code)
  }
  // completed / max_turns：注册表已附 usage 尾注与（max_turns）说明。
  return result.text
}

export function createAgentTools(
  registry: AgentRegistry,
  definitions: readonly AgentDefinition[]
): ToolHandler[] {
  const agent: ToolHandler = {
    name: 'Agent',
    concurrencySafe: true,
    summary: 'Launch a subagent to handle a task autonomously in its own context.',
    parameters: {
      type: 'object',
      properties: {
        description: { type: 'string', description: 'A short (3-5 word) description of the task.' },
        prompt: { type: 'string', description: 'The self-contained task for the subagent to perform.' },
        subagent_type: { type: 'string', description: 'The specialized agent type to use; defaults to general-purpose.' },
        model: { type: 'string', description: 'Optional model override for this subagent.' },
        run_in_background: { type: 'boolean', description: 'Run in the background and notify on completion.' }
      },
      required: ['description', 'prompt']
    },
    capability: () => 'read',
    describe: (input) => {
      const record = input as Record<string, unknown>
      const type = readString(record, 'subagent_type') ?? 'general-purpose'
      const description = readString(record, 'description') ?? 'subagent task'
      return `Agent(${type}): ${description}`
    },
    async execute(input: Record<string, unknown>, context: ToolContext): Promise<string> {
      const description = readString(input, 'description')
      const prompt = readString(input, 'prompt')
      if (!description || !prompt) {
        throw agentError('Agent requires non-empty "description" and "prompt" arguments.', 'AGENT_FAILED')
      }
      const requestedType = readString(input, 'subagent_type') ?? 'general-purpose'
      const definition = definitions.find((candidate) => candidate.name === requestedType)
      if (!definition) {
        const available = definitions.map((candidate) => candidate.name).join(', ')
        throw agentError(
          `Unknown agent type: ${requestedType}. Available types: ${available}`,
          'AGENT_FAILED'
        )
      }
      const runInBackground = input.run_in_background === true || definition.background === true
      const result = await registry.spawn({
        definition,
        prompt,
        description,
        callId: context.callId ?? '',
        turnId: context.turnId ?? '',
        ...(readString(input, 'model') ? { model: readString(input, 'model') } : {}),
        runInBackground,
        parentSignal: context.signal
      })
      return formatSpawnResult(result)
    }
  }

  const taskOutput: ToolHandler = {
    name: 'TaskOutput',
    concurrencySafe: true,
    summary: 'Read the result of a background subagent, optionally blocking until it finishes.',
    parameters: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'The agentId returned by async_launched.' },
        block: { type: 'boolean', description: 'Wait for a terminal state (default true).' },
        timeout: { type: 'number', description: 'Max wait in milliseconds when blocking.', maximum: TASK_OUTPUT_MAX_TIMEOUT_MS }
      },
      required: ['agent_id']
    },
    capability: () => 'read',
    describe: (input) => `TaskOutput(${readString(input as Record<string, unknown>, 'agent_id') ?? '?'})`,
    async execute(input: Record<string, unknown>): Promise<string> {
      const agentId = readString(input, 'agent_id') ?? readString(input, 'agentId')
      if (!agentId) throw agentError('TaskOutput requires "agent_id".', 'AGENT_FAILED')
      const block = input.block !== false
      const rawTimeout = typeof input.timeout === 'number' ? input.timeout : TASK_OUTPUT_DEFAULT_TIMEOUT_MS
      const timeoutMs = Math.max(0, Math.min(TASK_OUTPUT_MAX_TIMEOUT_MS, rawTimeout))
      const result = await registry.taskOutput(agentId, { block, timeoutMs })
      const body = result.text ?? result.message ?? ''
      return `status: ${result.status}${body ? `\n${body}` : ''}`
    }
  }

  const taskStop: ToolHandler = {
    name: 'TaskStop',
    summary: 'Stop a running subagent and suppress its completion notification.',
    parameters: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'The agentId to stop.' }
      },
      required: ['agent_id']
    },
    capability: () => 'read',
    describe: (input) => `TaskStop(${readString(input as Record<string, unknown>, 'agent_id') ?? '?'})`,
    async execute(input: Record<string, unknown>): Promise<string> {
      const agentId = readString(input, 'agent_id') ?? readString(input, 'agentId')
      if (!agentId) throw agentError('TaskStop requires "agent_id".', 'AGENT_FAILED')
      const result = registry.stop(agentId)
      if (!result.ok) throw agentError(`Unknown agent: ${agentId}`, 'AGENT_FAILED')
      return `Stopped agent ${agentId} (state: ${result.state ?? 'cancelled'}). Completion notification suppressed.`
    }
  }

  return [agent, taskOutput, taskStop]
}
