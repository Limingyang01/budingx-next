// SP004 T20 · 执行隔离门禁与能力声明（设计 §4.7，CE-19）。
// 隔离后端由宿主显式配置并经真实进程验收；模型无法选取、关闭或声明隔离能力。
// 本模块是纯决策层：拒绝路径在 spawn 之前完成，不产生任何进程。
import { ERROR_CODES } from '../core/constants.js'
import type { ChildProcess } from 'node:child_process'
import type { InterpreterChoice, InterpreterError, InterpreterTool } from './interpreter.js'

/** 能力声明层：受控策略覆盖项目读写视图、凭据/用户数据保护与网络目的地。 */
export interface SandboxCapabilities {
  allowWrite: readonly string[]
  denyWrite: readonly string[]
  allowRead: readonly string[]
  denyRead: readonly string[]
  /** 允许的网络域名；空数组 = 默认断网。 */
  networkDomains: readonly string[]
  /** 后端能否强制断网或限制网络目的地。 */
  canEnforceNetwork: boolean
}

export interface SandboxLaunchRequest {
  executable: string
  args: readonly string[]
  cwd: string
  env: NodeJS.ProcessEnv
  /** 只读模式须强制禁写，而不是依赖命令文本的分类。 */
  mode: 'read_only' | 'workspace'
  /** Host policy for paths projected from this launch's working directory. */
  isWorkspacePathReadable?: (relativePath: string) => boolean
}

/** 宿主注入的可信执行后端。verified 为宿主真实进程验收结论。 */
export interface SandboxBackend {
  id: string
  label: string
  verified: boolean
  capabilities: SandboxCapabilities
  resolveInterpreter?(tool: InterpreterTool): InterpreterChoice | InterpreterError
  /** Keep the supervisor's stdin lifecycle pipe open. The command itself gets EOF. */
  keepsSupervisorStdinOpen?: boolean
  /** 在既定文件、Git 和网络隔离策略下启动进程。失败时不得退回宿主执行。 */
  start(request: SandboxLaunchRequest): ChildProcess
  /** 终止本后端启动的完整进程树；可能重复调用。 */
  terminate(child: ChildProcess): void
}

export interface SandboxRequest {
  tool: 'Bash' | 'PowerShell'
  command: string
  /** 模型侧原始字段：用于拒绝隔离控制字段（dangerouslyDisableSandbox 等）。 */
  modelInput?: Record<string, unknown>
}

export type SandboxDecision =
  | { action: 'allow'; backendId: string }
  | { action: 'deny'; code: string; reason: string }

export interface SandboxPolicy {
  decide(request: SandboxRequest): SandboxDecision
  backend(): SandboxBackend | undefined
}

const MODEL_CONTROL_FIELDS = ['dangerouslyDisableSandbox', 'sandbox', 'isolation'] as const

/**
 * 创建受控隔离策略。无后端或未验收 → 普通 Bash/PowerShell 一律拒绝，
 * 只开放宿主托管操作（§4.5）；用户确认与完全权限均不得降级隔离。
 */
export function createSandboxPolicy(options: { backend?: SandboxBackend } = {}): SandboxPolicy {
  const backend = options.backend
  return {
    backend: () => backend,
    decide(request: SandboxRequest): SandboxDecision {
      if (request.modelInput !== undefined) {
        for (const field of MODEL_CONTROL_FIELDS) {
          if (field in request.modelInput) {
            return {
              action: 'deny',
              code: ERROR_CODES.permissionDenied,
              reason: '隔离能力由宿主建立，模型不能选取、关闭或声明隔离（dangerouslyDisableSandbox 已禁用）'
            }
          }
        }
      }
      if (
        backend?.verified !== true ||
        typeof backend.start !== 'function' ||
        typeof backend.terminate !== 'function' ||
        backend.capabilities === undefined
      ) {
        return {
          action: 'deny',
          code: ERROR_CODES.execSandboxUnavailable,
          reason: '无已验证的执行隔离后端：普通 Bash/PowerShell 命令不可用，仅开放宿主托管操作'
        }
      }
      const capabilities = backend.capabilities
      if (!capabilities.canEnforceNetwork) {
        return {
          action: 'deny',
          code: ERROR_CODES.execSandboxUnavailable,
          reason: '隔离后端无法强制断网或限制网络目的地，拒绝执行'
        }
      }
      return { action: 'allow', backendId: backend.id }
    }
  }
}
