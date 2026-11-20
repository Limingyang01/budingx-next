// SP004 T20 · 执行隔离门禁与能力声明（设计 §4.7，CE-19）。
// 隔离后端由宿主显式配置并经真实进程验收；模型无法选取、关闭或声明隔离能力。
// 本模块是纯决策层：拒绝路径在 spawn 之前完成，不产生任何进程。
import { ERROR_CODES } from '../core/constants.js'

/** 能力声明层：受控策略覆盖项目读写视图、凭据/用户数据保护与网络目的地。 */
export interface SandboxCapabilities {
  allowWrite: readonly string[]
  denyWrite: readonly string[]
  allowRead: readonly string[]
  denyRead: readonly string[]
  /** 允许的网络域名；空数组 = 默认断网。 */
  networkDomains: readonly string[]
  /** 后端能否强制执行网络域名策略；不能则配置域名时拒绝执行。 */
  canEnforceNetwork: boolean
}

/** 宿主注入的可信执行后端。verified 为宿主真实进程验收结论。 */
export interface SandboxBackend {
  id: string
  label: string
  verified: boolean
  capabilities: SandboxCapabilities
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
 * 创建执行策略。两种信任模式（0.5.4，对齐参考实现的「权限审批为主、沙箱可选」）：
 *
 * - 配置了已验收隔离后端 → 走隔离判定（网络域名策略等），模型不能降级隔离。
 * - hostTrusted=true 且无隔离后端 → 「宿主信任执行」：命令交由 SP003 权限档位
 *   审批（只读免审、工作区修改逐次确认、完全权限自动），不做 OS 级隔离。
 *   这与参考实现一致——权限提示才是安全控制，沙箱是可选加固层。
 * - 其余（无后端且未开宿主信任）→ 维持严格 fail-closed，spawn 前拒绝。
 *
 * 无论哪种模式，模型侧隔离控制字段（dangerouslyDisableSandbox 等）一律拒绝。
 */
export function createSandboxPolicy(
  options: { backend?: SandboxBackend; hostTrusted?: boolean } = {}
): SandboxPolicy {
  const backend = options.backend
  const hostTrusted = options.hostTrusted === true
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
      if (backend !== undefined) {
        if (!backend.verified) {
          return {
            action: 'deny',
            code: ERROR_CODES.execSandboxUnavailable,
            reason: '隔离后端未经真实进程验收，拒绝执行'
          }
        }
        const capabilities = backend.capabilities
        if (capabilities.networkDomains.length > 0 && !capabilities.canEnforceNetwork) {
          return {
            action: 'deny',
            code: ERROR_CODES.execSandboxUnavailable,
            reason: '隔离后端无法强制执行网络域名策略，拒绝该执行请求（网络默认关闭）'
          }
        }
        return { action: 'allow', backendId: backend.id }
      }
      if (hostTrusted) {
        // 无 OS 隔离；是否执行由权限档位审批决定（Session 在调用工具前已判定）。
        return { action: 'allow', backendId: 'host-trusted' }
      }
      return {
        action: 'deny',
        code: ERROR_CODES.execSandboxUnavailable,
        reason: '无已验证的执行隔离后端：普通 Bash/PowerShell 命令不可用，仅开放宿主托管操作'
      }
    }
  }
}