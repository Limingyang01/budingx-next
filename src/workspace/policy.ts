// Permission policy: three fixed modes, user rules and non-overridable
// floor rules (SP003 design §3.3, AC PC-01 … PC-09).
// The interactive edit fast path allows ordinary workspace writes. Legacy
// non-interactive modes retain their original defaults. All callers apply the
// same floor rules and deny-rule priority.
import { basename, relative } from 'node:path'
import type {
  PermissionMode,
  PermissionPolicy,
  PermissionRequest,
  PermissionVerdict
} from '../core/permissions.js'
import { dataRoot } from '../storage/paths.js'
import { ERROR_CODES } from '../core/constants.js'
import { matchGlob } from './ignore.js'
import { isInsideRoot, WorkspaceError, type Workspace } from './paths.js'

export type PermissionRule = {
  id: string
  action: 'allow' | 'deny'
  /** Tool name or '*'. */
  tool: string
  /** Workspace-relative glob; omitted means any target. */
  path?: string
  note?: string
}

export type ShadowedRule = { ruleId: string; shadowedBy: string }

export type PermissionPolicyOptions = {
  workspace: Workspace
  rules?: PermissionRule[]
  mode?: PermissionMode
  /** Interactive accept-edits mode fast path for ordinary workspace writes. */
  autoAcceptWorkspaceEdits?: boolean
  /** Only for tests: replaces the home-derived user data root. */
  dataRootOverride?: string
  /** Only a worktree registered by the host is a workspace inside the data root. */
  managedWorktree?: () => string | undefined
}

export type BudingPermissionPolicy = PermissionPolicy & {
  listRules(): PermissionRule[]
  setRules(rules: PermissionRule[]): void
  shadowed(): ShadowedRule[]
}

const CREDENTIAL_SUFFIXES = ['.pem', '.key', '.p12', '.pfx']
const OPENSSH_PRIVATE_KEY_NAME =
  /^(?:id_(?:dsa|(?:ecdsa|ed25519)(?:_sk)?)|ssh_host_(?:rsa|dsa|ecdsa|ed25519)_key)$/

export function isCredentialLike(name: string): boolean {
  const lower = name.toLowerCase()
  if (lower === 'credentials.json') return true
  if (lower === '.env' || lower.startsWith('.env.')) return true
  // Keep the existing RSA prefix rule. For the other families, the public
  // key and certificate are separate files and retain their prior access.
  if (lower.startsWith('id_rsa') || OPENSSH_PRIVATE_KEY_NAME.test(lower)) return true
  return CREDENTIAL_SUFFIXES.some((suffix) => lower.endsWith(suffix))
}

export const MODES_ZH: Record<PermissionMode, string> = {
  read_only: '仅可查看',
  workspace_edit: '工作区内修改',
  full_access: '完全权限'
}

export const MODES_EN: Record<PermissionMode, string> = {
  read_only: 'read-only',
  workspace_edit: 'workspace edit',
  full_access: 'full access'
}

/** Cycle used by Shift+Tab (SP003 design §3.8). */
export function nextMode(mode: PermissionMode): PermissionMode {
  return mode === 'workspace_edit' ? 'full_access' : 'workspace_edit'
}

function memoryKey(request: PermissionRequest): string {
  return (
    request.tool.toLowerCase() +
    '|' +
    (request.path === undefined ? '' : normalizeSlashes(request.path).toLowerCase())
  )
}

function isSensitiveWriteTarget(path: string): boolean {
  const parts = normalizeSlashes(path).toLowerCase().split('/')
    .map((part) => part.replace(/[ .]+$/, ''))
  const file = parts.at(-1) ?? ''
  return parts.some((part) => ['.git', '.vscode', '.idea', '.claude', '.codex', '.agents'].includes(part)) ||
    parts.some((part, index) => part === '.github' && parts[index + 1] === 'workflows') ||
    ['.gitconfig', '.gitmodules', '.bashrc', '.bash_profile', '.zshrc',
      '.zprofile', '.profile', '.ripgreprc', '.mcp.json', '.claude.json'].includes(file)
}

function normalizeSlashes(path: string): string {
  return path.split('\\').join('/')
}

function ruleMatches(rule: PermissionRule, request: PermissionRequest): boolean {
  if (rule.tool !== '*' && rule.tool.toLowerCase() !== request.tool.toLowerCase())
    return false
  if (rule.path === undefined || rule.path === '') return true
  if (request.path === undefined) return false
  return matchGlob(normalizeSlashes(rule.path), normalizeSlashes(request.path))
}

/** Coarse, decidable glob coverage used for the shadow report only. */
function pathCovers(denyPath: string | undefined, allowPath: string | undefined): boolean {
  if (denyPath === undefined || denyPath === '') return true
  const deny = normalizeSlashes(denyPath)
  if (allowPath === undefined || allowPath === '') return false
  const allow = normalizeSlashes(allowPath)
  if (deny === allow) return true
  if (deny === '**' || deny === '**/*') return true
  if (deny.endsWith('/**') && allow.startsWith(deny.slice(0, -3))) return true
  return false
}

/** 命令执行入口工具：仅可查看模式下连只读白名单命令也不启动（CE-08）。 */
const EXEC_ENTRY_TOOLS = new Set(['Bash', 'PowerShell'])

export function createPermissionPolicy(
  options: PermissionPolicyOptions
): BudingPermissionPolicy {
  const workspace = options.workspace
  const userRoot = options.dataRootOverride ?? dataRoot()
  let rules = options.rules ?? []
  let mode: PermissionMode = options.mode ?? 'read_only'
  const listeners: ((mode: PermissionMode) => void)[] = []
  const memory = new Set<string>()
  const scopedMemoryKey = (request: PermissionRequest) => JSON.stringify([workspace.root, memoryKey(request)])

  function resolveTarget(request: PermissionRequest): { real?: string; denied?: PermissionVerdict } {
    if (!request.path) return {}
    let real: string
    try {
      real = workspace.resolve(request.path).real
    } catch (error) {
      // B-3/B-4/B-5: outside the workspace (including through links).
      if (error instanceof WorkspaceError && error.code === ERROR_CODES.workspacePathOutside) {
        return {
          denied: {
            action: 'deny',
            reason: request.capability === 'read'
              ? 'Reading outside the workspace is not allowed'
              : 'Writing outside the workspace is not allowed',
            ruleId: 'floor:outside'
          }
        }
      }
      return {}
    }
    return { real }
  }

  function floorVerdict(request: PermissionRequest, real: string): PermissionVerdict | undefined {
    // B-1: the product user data root is never a tool target.
    const worktree = options.managedWorktree?.()
    const insideManagedWorktree = worktree === workspace.root && isInsideRoot(worktree, real)
    if (isInsideRoot(userRoot, real) && !insideManagedWorktree) {
      return { action: 'deny', reason: 'The budingx user data directory is off-limits', ruleId: 'floor:data' }
    }
    if (insideManagedWorktree && /(^|[\\/])\.git([\\/]|$)/i.test(relative(worktree, real))) {
      return { action: 'deny', reason: 'Managed worktree Git metadata is off-limits', ruleId: 'floor:git' }
    }
    // B-2: credential-shaped file names.
    if (isCredentialLike(basename(request.path ?? '')) || isCredentialLike(basename(real))) {
      return { action: 'deny', reason: 'Credential files are off-limits', ruleId: 'floor:credential' }
    }
    return undefined
  }

  function mandatoryApprovalReason(request: PermissionRequest, real?: string): string | undefined {
    if (request.capability !== 'write' || !request.path) return undefined
    const targets = [request.path, ...(real ? [relative(workspace.root, real)] : [])]
    if (targets.some((path) => /(^|[\\/])\.git([\\/]|$)/i.test(path))) {
      return `Writing inside .git needs confirmation: ${request.path}`
    }
    if (options.autoAcceptWorkspaceEdits && mode === 'workspace_edit' && targets.some(isSensitiveWriteTarget)) {
      return `Sensitive file needs confirmation: ${request.path}`
    }
    return undefined
  }

  function canRemember(request: PermissionRequest): boolean {
    // SP004: "allow for this session" also covers command execution in the
    // workspace-edit mode; execution has no path, so the key is tool-scoped.
    if (mode === 'workspace_edit' && request.capability === 'execute') return true
    if (mode !== 'workspace_edit' || request.capability !== 'write' || !request.path) return false
    const { real } = resolveTarget(request)
    return !!real && !mandatoryApprovalReason(request, real)
  }

  return {
    decide(request: PermissionRequest): PermissionVerdict {
      // 1. Floor rules: never overridable, in every mode (AC PC-08).
      const { real, denied } = resolveTarget(request)
      if (denied) return denied
      const floor = real && floorVerdict(request, real)
      if (floor) return floor
      // 2. Deny rules.
      for (const rule of rules) {
        if (rule.action === 'deny' && ruleMatches(rule, request)) {
          return {
            action: 'deny',
            reason: rule.note ?? `Denied by rule ${rule.id}`,
            ruleId: rule.id
          }
        }
      }
      // 2.5 Version-control metadata is protected even in full access:
      // forced ask ahead of memory and allow rules (SP003 T18g, aligned
      // with the reference's mandatory safety check before allow rules).
      const reason = mandatoryApprovalReason(request, real)
      if (reason) return { action: 'ask', reason }
      // 3. Allow rules: they relax the mode default but not the floor.
      for (const rule of rules) {
        if (rule.action === 'allow' && ruleMatches(rule, request)) {
          return { action: 'allow', reason: rule.note ?? `Allowed by rule ${rule.id}`, ruleId: rule.id }
        }
      }
      // 5. Mode default (AC PC-01 … PC-05).
      if (request.capability === 'read') {
        // SP004 CE-08：仅可查看模式下命令入口一律拒绝，即便命令在只读白名单内
        // （读取类工具不经过命令入口，因此不受此限制）。
        if (mode === 'read_only' && EXEC_ENTRY_TOOLS.has(request.tool)) {
          return { action: 'deny', reason: 'The read-only mode does not allow running commands' }
        }
        return { action: 'allow', reason: 'Read is allowed in every mode' }
      }
      // 5.5 SP004: command execution (design §4.5). The read-only mode never runs
      // commands (CE-08); whitelisted host-managed read-only commands are classified
      // as 'read' by the execution adapter and stay exempt from approval (CE-09).
      if (request.capability === 'execute') {
        if (mode === 'read_only') {
          return { action: 'deny', reason: 'The read-only mode does not allow running commands' }
        }
        if (mode === 'workspace_edit') {
          if (memory.has(scopedMemoryKey(request))) {
            return { action: 'allow', reason: 'Allowed for this session' }
          }
          return { action: 'ask', reason: `Running ${request.tool} needs confirmation` }
        }
        return { action: 'allow', reason: 'Full access mode: automatic' }
      }
      if (mode === 'read_only') {
        return { action: 'deny', reason: 'The read-only mode does not allow modifying files' }
      }
      if (mode === 'workspace_edit') {
        if (options.autoAcceptWorkspaceEdits && real) {
          return { action: 'allow', reason: 'Ordinary workspace edit' }
        }
        // Session memory from "allow for this session" (AC PC-06) only
        // short-circuits the ask path; it never lifts read_only.
        if (memory.has(scopedMemoryKey(request))) {
          return { action: 'allow', reason: 'Allowed for this session' }
        }
        return { action: 'ask', reason: `Writing ${request.path ?? request.tool} needs confirmation` }
      }
      return { action: 'allow', reason: 'Full access mode: automatic' }
    },
    canRemember,
    remember(request: PermissionRequest): void {
      if (canRemember(request)) memory.add(scopedMemoryKey(request))
    },
    getMode: () => mode,
    setMode(next: PermissionMode): void {
      if (next === mode) return
      mode = next
      for (const listener of [...listeners]) listener(next)
    },
    onModeChanged(listener): void {
      listeners.push(listener)
    },
    listRules: () => [...rules],
    setRules(next: PermissionRule[]): void {
      rules = next.map((rule) => ({ ...rule }))
    },
    shadowed(): ShadowedRule[] {
      const report: ShadowedRule[] = []
      for (const allow of rules.filter((rule) => rule.action === 'allow')) {
        for (const deny of rules.filter((rule) => rule.action === 'deny')) {
          const toolCovered =
            deny.tool === '*' || deny.tool.toLowerCase() === allow.tool.toLowerCase()
          if (toolCovered && pathCovers(deny.path, allow.path)) {
            report.push({ ruleId: allow.id, shadowedBy: deny.id })
            break
          }
        }
      }
      return report
    }
  }
}
