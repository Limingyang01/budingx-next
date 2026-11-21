// SP007 §4.2：ToolSearch 延迟加载（参考 ToolSearchTool 机制，独立实现，D3 客户端发现集）。
// 核心工具恒加载；mcp__* 恒延迟。门控 BUDINGX_TOOL_SEARCH=off|auto|auto:N|standard（默认 auto）。
// 发现集进程内跨压缩存活，并经 tool_result 机器标记 <discovered-tools> 支持 /resume 重建。
import type { ToolHandler } from './tools.js'
import type { Message } from './events.js'
import { estimateText } from './context-budget.js'

const DEFAULT_MAX_RESULTS = 5
const DEFAULT_THRESHOLD_PERCENT = 10
const TOOL_TOKEN_OVERHEAD = 500
const DISCOVERED_MARKER = /<discovered-tools>([^<]*)<\/discovered-tools>/g

export interface ToolSearchOptions {
  /** 活工具表（引用共享）：MCP 断连/连接会即时反映到延迟池与公告。 */
  tools: readonly ToolHandler[]
  contextWindow: number
  env?: Record<string, string | undefined>
  mcpPending?: boolean
}

export interface ToolSearchState {
  discovered: Set<string>
}

export interface ToolSearchController {
  enabled: boolean
  tool?: ToolHandler
  state: ToolSearchState
  filter(tools: readonly ToolHandler[]): ToolHandler[]
  notice(): string | undefined
  scanHistory(messages: readonly Message[]): void
  isDeferred(name: string): boolean
}

function specOf(tool: ToolHandler): { name: string; parameters: unknown; description: string } {
  return {
    name: tool.name,
    parameters: tool.parameters ?? { type: 'object', properties: {} },
    description: tool.summary ?? tool.describe({})
  }
}

function deferredPool(tools: readonly ToolHandler[]): ToolHandler[] {
  return tools.filter((tool) => tool.name.startsWith('mcp__'))
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function nameWords(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .map((word) => word.toLowerCase())
    .filter(Boolean)
}

function wordBoundary(text: string | undefined, word: string): boolean {
  if (!text) return false
  return new RegExp('\\b' + escapeRegExp(word) + '\\b', 'i').test(text)
}

/** 单词对一个延迟工具的计分贡献（权重对照参考：12/10/6/5/4/2）。 */
function scoreWord(tool: ToolHandler, word: string): number {
  const isMcp = tool.name.startsWith('mcp__')
  const lowerName = tool.name.toLowerCase()
  const words = nameWords(tool.name)
  const spec = specOf(tool)
  let score = 0
  if (words.includes(word)) score += isMcp ? 12 : 10
  else if (lowerName.includes(word)) score += isMcp ? 6 : 5
  if (wordBoundary(tool.summary, word)) score += 4
  if (wordBoundary(spec.description, word)) score += 2
  return score
}

interface ScoredTool {
  tool: ToolHandler
  score: number
}

function searchDeferred(
  pool: readonly ToolHandler[],
  query: string,
  maxResults: number
): ToolHandler[] {
  const trimmed = query.trim()
  const lower = trimmed.toLowerCase()
  // select:A,B,C 直选（大小写不敏感）。
  if (lower.startsWith('select:')) {
    const wanted = trimmed.slice('select:'.length).split(',').map((part) => part.trim().toLowerCase()).filter(Boolean)
    return pool.filter((tool) => wanted.includes(tool.name.toLowerCase()))
  }
  // 裸名精确 fast path。
  const exact = pool.find((tool) => tool.name.toLowerCase() === lower)
  if (exact) return [exact]
  // mcp__server 前缀匹配。
  if (lower.startsWith('mcp__')) {
    return pool.filter((tool) => tool.name.toLowerCase().startsWith(lower)).slice(0, maxResults)
  }
  // 关键词：空格分词，+前缀为必需词。
  const tokens = trimmed.split(/\s+/).filter(Boolean)
  const required: string[] = []
  const words: string[] = []
  for (const token of tokens) {
    if (token.startsWith('+') && token.length > 1) {
      required.push(token.slice(1).toLowerCase())
      words.push(token.slice(1).toLowerCase())
    } else {
      words.push(token.toLowerCase())
    }
  }
  const scored: ScoredTool[] = []
  for (const tool of pool) {
    let total = 0
    let requiredOk = true
    for (const word of words) {
      const contribution = scoreWord(tool, word)
      total += contribution
      if (required.includes(word) && contribution === 0) requiredOk = false
    }
    // 全名兜底：仅在没有任何词得分时，整串查询作为名称子串给 3 分。
    if (total === 0 && tool.name.toLowerCase().includes(lower)) total = 3
    if (total > 0 && requiredOk) scored.push({ tool, score: total })
  }
  scored.sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name))
  return scored.slice(0, maxResults).map((entry) => entry.tool)
}

export function createToolSearch(options: ToolSearchOptions): ToolSearchController {
  const mode = (options.env?.BUDINGX_TOOL_SEARCH ?? 'auto').trim()
  const state: ToolSearchState = { discovered: new Set<string>() }
  let enabled = false
  if (mode !== 'off' && mode !== 'standard') {
    let threshold = DEFAULT_THRESHOLD_PERCENT
    if (mode.startsWith('auto:')) {
      const parsed = Number.parseFloat(mode.slice('auto:'.length))
      if (Number.isFinite(parsed) && parsed >= 0) threshold = parsed
    }
    const pool = deferredPool(options.tools)
    if (pool.length > 0) {
      const tokens = pool.reduce((sum, tool) => sum + estimateText(JSON.stringify(specOf(tool))) + TOOL_TOKEN_OVERHEAD, 0)
      enabled = tokens >= (options.contextWindow * threshold) / 100
    }
  }

  const renderResult = (names: string[], pending: boolean): string => {
    const pool = deferredPool(options.tools)
    const lines: string[] = []
    if (names.length === 0) lines.push('No matching deferred tools found')
    else lines.push(...names)
    lines.push('total_deferred_tools: ' + pool.length)
    if (pending) lines.push('Some MCP servers are still connecting…try searching again.')
    if (names.length > 0) lines.push('<discovered-tools>' + names.join(',') + '</discovered-tools>')
    return lines.join('\n')
  }

  const tool: ToolHandler | undefined = enabled
    ? {
        name: 'ToolSearch',
        concurrencySafe: true,
        summary: 'Search deferred (lazy-loaded) tools by name or keyword and load them for use.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'select:A,B,C to load exact names; a bare name; mcp__server prefix; or keywords (+word = required).' },
            max_results: { type: 'number', description: 'Maximum matches to return.', default: DEFAULT_MAX_RESULTS }
          },
          required: ['query']
        },
        capability: () => 'read',
        describe: (input) => 'ToolSearch(' + String((input as Record<string, unknown>).query ?? '') + ')',
        async execute(input: Record<string, unknown>): Promise<string> {
          const query = typeof input.query === 'string' ? input.query : ''
          const maxResults = typeof input.max_results === 'number' && input.max_results > 0
            ? Math.floor(input.max_results)
            : DEFAULT_MAX_RESULTS
          const pool = deferredPool(options.tools)
          const matches = searchDeferred(pool, query, maxResults)
          const names = matches.map((match) => match.name)
          for (const name of names) state.discovered.add(name)
          return renderResult(names, options.mcpPending === true)
        }
      }
    : undefined

  return {
    enabled,
    tool,
    state,
    filter(tools: readonly ToolHandler[]): ToolHandler[] {
      if (!enabled) return [...tools]
      const deferred = new Set(deferredPool(tools).map((tool) => tool.name))
      const result = tools.filter((tool) => !deferred.has(tool.name) || state.discovered.has(tool.name))
      if (tool && !result.some((entry) => entry.name === 'ToolSearch')) result.push(tool)
      return result
    },
    notice(): string | undefined {
      if (!enabled) return undefined
      const names = deferredPool(options.tools).map((tool) => tool.name).sort()
      let text = '<available-deferred-tools>\n' + names.join('\n') + '\n</available-deferred-tools>'
      if (options.mcpPending) text += '\nSome MCP servers are still connecting…try searching again.'
      return text
    },
    scanHistory(messages: readonly Message[]): void {
      for (const message of messages) {
        for (const block of message.blocks) {
          if (block.type !== 'tool_result') continue
          DISCOVERED_MARKER.lastIndex = 0
          let match: RegExpExecArray | null
          while ((match = DISCOVERED_MARKER.exec(block.content)) !== null) {
            for (const name of match[1].split(',')) {
              const trimmed = name.trim()
              if (trimmed) state.discovered.add(trimmed)
            }
          }
        }
      }
    },
    isDeferred(name: string): boolean {
      return enabled && name.startsWith('mcp__')
    }
  }
}
