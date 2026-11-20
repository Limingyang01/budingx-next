import type { StatusLineConfig } from '../../storage/config-store.js'

/** 所有 hook 处理器共用的基础输入（6 字段）。 */
export interface HookBaseInput {
  session_id: string
  transcript_path: string
  cwd: string
  permission_mode: string
  agent_id: string
  agent_type: string
}

export interface StatusLineUsage {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens: number
  cache_read_input_tokens: number
}

export interface StatusLineFields {
  session_name?: string
  model: { id: string; display_name: string }
  workspace: { current_dir: string; project_dir: string; added_dirs: string[] }
  version: string
  output_style: { name: string }
  cost: {
    total_cost_usd: number
    total_duration_ms: number
    total_api_duration_ms: number
    total_lines_added: number
    total_lines_removed: number
  }
  context_window: {
    total_input_tokens: number
    total_output_tokens: number
    context_window_size: number
    current_usage: StatusLineUsage | null
    used_percentage: number
    remaining_percentage: number
  }
  exceeds_200k_tokens: boolean
  rate_limits?: {
    five_hour?: { used_percentage: number; resets_at: number }
    seven_day?: { used_percentage: number; resets_at: number }
  }
  vim?: { mode: string }
  agent?: { name: string }
  remote?: { session_id: string }
  worktree?: {
    name: string
    path: string
    branch: string
    original_cwd: string
    original_branch: string
  }
}

export type StatusLineInput = HookBaseInput & StatusLineFields

export interface StatusLineState {
  sessionId: string
  transcriptPath: string
  cwd: string
  permissionMode: string
  agentId?: string
  agentType?: string
  sessionName?: string
  model: { id: string; displayName: string }
  workspace: { currentDir: string; projectDir: string; addedDirs?: string[] }
  version: string
  outputStyle?: string
  cost?: {
    totalCostUsd?: number
    totalDurationMs?: number
    totalApiDurationMs?: number
    totalLinesAdded?: number
    totalLinesRemoved?: number
  }
  contextWindow?: {
    usedTokens?: number
    windowSize?: number
    totalInputTokens?: number
    totalOutputTokens?: number
    currentUsage?: {
      inputTokens?: number
      outputTokens?: number
      cacheCreationInputTokens?: number
      cacheReadInputTokens?: number
    }
  }
  rateLimits?: {
    fiveHour?: { usedPercentage: number; resetsAt: number }
    sevenDay?: { usedPercentage: number; resetsAt: number }
  }
  vimMode?: string
  agentName?: string
  remoteSessionId?: string
  worktree?: {
    name: string
    path: string
    branch: string
    originalCwd: string
    originalBranch: string
  }
}

const round1 = (value: number): number => Math.round(value * 10) / 10

export function buildStatusLineInput(state: StatusLineState): StatusLineInput {
  const windowSize = Math.max(0, state.contextWindow?.windowSize ?? 0)
  const usedTokens = Math.max(0, state.contextWindow?.usedTokens ?? 0)
  const usedPercentage = windowSize > 0 ? round1((usedTokens / windowSize) * 100) : 0
  const remainingPercentage = windowSize > 0 ? round1(100 - usedPercentage) : 0
  const currentUsage = state.contextWindow?.currentUsage

  const input: StatusLineInput = {
    session_id: state.sessionId,
    transcript_path: state.transcriptPath,
    cwd: state.cwd,
    permission_mode: state.permissionMode,
    agent_id: state.agentId ?? 'unknown',
    agent_type: state.agentType ?? 'unknown',
    model: { id: state.model.id, display_name: state.model.displayName },
    workspace: {
      current_dir: state.workspace.currentDir,
      project_dir: state.workspace.projectDir,
      added_dirs: state.workspace.addedDirs ?? [],
    },
    version: state.version,
    output_style: { name: state.outputStyle ?? 'default' },
    cost: {
      total_cost_usd: state.cost?.totalCostUsd ?? 0,
      total_duration_ms: state.cost?.totalDurationMs ?? 0,
      total_api_duration_ms: state.cost?.totalApiDurationMs ?? 0,
      total_lines_added: state.cost?.totalLinesAdded ?? 0,
      total_lines_removed: state.cost?.totalLinesRemoved ?? 0,
    },
    context_window: {
      total_input_tokens: state.contextWindow?.totalInputTokens ?? 0,
      total_output_tokens: state.contextWindow?.totalOutputTokens ?? 0,
      context_window_size: windowSize,
      current_usage: currentUsage
        ? {
            input_tokens: currentUsage.inputTokens ?? 0,
            output_tokens: currentUsage.outputTokens ?? 0,
            cache_creation_input_tokens: currentUsage.cacheCreationInputTokens ?? 0,
            cache_read_input_tokens: currentUsage.cacheReadInputTokens ?? 0,
          }
        : null,
      used_percentage: usedPercentage,
      remaining_percentage: remainingPercentage,
    },
    exceeds_200k_tokens: windowSize > 200000,
  }

  // 可选字段缺失即省略，保证「有无」本身可被脚本判定。
  if (state.sessionName) input.session_name = state.sessionName
  if (state.rateLimits) {
    const limits: NonNullable<StatusLineFields['rate_limits']> = {}
    if (state.rateLimits.fiveHour) {
      limits.five_hour = {
        used_percentage: state.rateLimits.fiveHour.usedPercentage,
        resets_at: state.rateLimits.fiveHour.resetsAt,
      }
    }
    if (state.rateLimits.sevenDay) {
      limits.seven_day = {
        used_percentage: state.rateLimits.sevenDay.usedPercentage,
        resets_at: state.rateLimits.sevenDay.resetsAt,
      }
    }
    if (Object.keys(limits).length > 0) input.rate_limits = limits
  }
  if (state.vimMode) input.vim = { mode: state.vimMode }
  if (state.agentName) input.agent = { name: state.agentName }
  if (state.remoteSessionId) input.remote = { session_id: state.remoteSessionId }
  if (state.worktree) {
    input.worktree = {
      name: state.worktree.name,
      path: state.worktree.path,
      branch: state.worktree.branch,
      original_cwd: state.worktree.originalCwd,
      original_branch: state.worktree.originalBranch,
    }
  }
  return input
}

/** 内置回落状态栏（未配置外部命令或外部命令失败时）。 */
export function renderStatusLine(input: StatusLineInput): string {
  const parts = [
    input.model.display_name,
    'v' + input.version,
    'ctx ' + input.context_window.used_percentage.toFixed(1) + '%',
  ]
  if (input.session_name) parts.push(input.session_name)
  return parts.join(' · ')
}

export type { StatusLineConfig }
