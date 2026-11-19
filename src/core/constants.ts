// Frozen constants and stable machine readable error codes (SP002 design §3.2/§3.3).

export const CANCEL_BUDGET_MS = 5000
export const QUEUE_AUTOSTART_MS = 400
export const TOOL_OUTPUT_CAP = 32768
export const MAX_ITERATIONS = 32

/**
 * SP005 FR-05：同一个工具以相同参数连续失败达到该次数后停止再试。
 * 模型反复重试同一个失败调用不会带来新信息，只会让长任务空转，
 * 因此必须显式熔断并给出明确失败原因。
 */
export const MAX_REPEATED_TOOL_FAILURES = 3

/**
 * SP005 FR-05：同一工具以同一错误码连续失败达到该次数后停止再试。
 * 模型常会换参数反复试同一个工具（例如换路径找同一个不存在的文件），
 * 参数签名因此不同，但错误类型相同 —— 同样属于空转，也要熔断。
 */
export const MAX_TOOL_FAILURE_STREAK = 5

export const ERROR_CODES = {
  providerAuth: 'BUDINGX_PROVIDER_001',
  providerNotFound: 'BUDINGX_PROVIDER_002',
  providerRateLimited: 'BUDINGX_PROVIDER_003',
  providerOverloaded: 'BUDINGX_PROVIDER_004',
  providerNetwork: 'BUDINGX_PROVIDER_005',
  providerTimeout: 'BUDINGX_PROVIDER_006',
  providerAborted: 'BUDINGX_PROVIDER_007',
  providerInvalidStream: 'BUDINGX_PROVIDER_008',
  providerContextOverflow: 'BUDINGX_PROVIDER_009',
  providerToolUnsupported: 'BUDINGX_PROVIDER_010',
  providerBadRequest: 'BUDINGX_PROVIDER_011',
  providerUnknown: 'BUDINGX_PROVIDER_012',
  providerEventTooLarge: 'BUDINGX_PROVIDER_013',
  providerResponseTooLong: 'BUDINGX_PROVIDER_014',
  providerIdleTimeout: 'BUDINGX_PROVIDER_015',
  providerToolArgumentsInvalid: 'BUDINGX_PROVIDER_016',
  providerToolCallIncomplete: 'BUDINGX_PROVIDER_017',
  coreToolUnknown: 'BUDINGX_CORE_001',
  coreToolFailed: 'BUDINGX_CORE_002',
  coreToolOutputTooLong: 'BUDINGX_CORE_003',
  coreApprovalCancelled: 'BUDINGX_CORE_004',
  coreLateEvent: 'BUDINGX_CORE_005',
  coreMaxIterations: 'BUDINGX_CORE_006',
  // SP005 §4：上下文预算与压缩。
  coreContextOverflow: 'BUDINGX_CORE_007',
  coreCompactionCircuitOpen: 'BUDINGX_CORE_008',
  // SP005 §5/§6：会话持久化与失败恢复。
  coreRecoveryNeedsReview: 'BUDINGX_CORE_009',
  coreToolLoopDetected: 'BUDINGX_CORE_010',
  storageConfigCorrupt: 'BUDINGX_STORAGE_001',
  storageSchemaUnsupported: 'BUDINGX_STORAGE_002',
  storageInvalidProfile: 'BUDINGX_STORAGE_003',
  storageCredentialMissing: 'BUDINGX_STORAGE_004',
  // SP005 §5：转录/索引写入失败（业务结果不丢失，单独上报）。
  storageWriteFailed: 'BUDINGX_STORAGE_005',
  // SP005 §5：会话锁被占用。
  storageSessionLocked: 'BUDINGX_STORAGE_006',
  workspacePathOutside: 'BUDINGX_WORKSPACE_001',
  workspaceNotFound: 'BUDINGX_WORKSPACE_002',
  workspaceNotAFile: 'BUDINGX_WORKSPACE_003',
  workspaceEncodingUnsupported: 'BUDINGX_WORKSPACE_004',
  workspaceTooLarge: 'BUDINGX_WORKSPACE_005',
  workspaceEditNoMatch: 'BUDINGX_WORKSPACE_006',
  workspaceEditAmbiguous: 'BUDINGX_WORKSPACE_007',
  workspaceEditConflict: 'BUDINGX_WORKSPACE_008',
  workspaceTruncated: 'BUDINGX_WORKSPACE_009',
  workspaceNotReadYet: 'BUDINGX_WORKSPACE_010',
  workspaceStaleRead: 'BUDINGX_WORKSPACE_011',
  permissionDenied: 'BUDINGX_PERMISSION_001',
  permissionDeniedByRule: 'BUDINGX_PERMISSION_002',
  permissionOutsideWorkspace: 'BUDINGX_PERMISSION_003',
  execInterpreterUnavailable: 'BUDINGX_EXEC_001',
  execTimeout: 'BUDINGX_EXEC_002',
  execInteractiveUnsupported: 'BUDINGX_EXEC_003',
  execBlockingCommand: 'BUDINGX_EXEC_004',
  execSandboxUnavailable: 'BUDINGX_EXEC_005',
  execHardTimeoutExceeded: 'BUDINGX_EXEC_006',
  execCancelled: 'BUDINGX_EXEC_007'
} as const

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES]
