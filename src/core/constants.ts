// Frozen constants and stable machine readable error codes (SP002 design §3.2/§3.3).

export const CANCEL_BUDGET_MS = 5000
export const QUEUE_AUTOSTART_MS = 400
export const TOOL_OUTPUT_CAP = 32768
export const MAX_ITERATIONS = 32

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
  storageConfigCorrupt: 'BUDINGX_STORAGE_001',
  storageSchemaUnsupported: 'BUDINGX_STORAGE_002',
  storageInvalidProfile: 'BUDINGX_STORAGE_003',
  storageCredentialMissing: 'BUDINGX_STORAGE_004',
  workspacePathOutside: 'BUDINGX_WORKSPACE_001',
  workspaceNotFound: 'BUDINGX_WORKSPACE_002',
  workspaceNotAFile: 'BUDINGX_WORKSPACE_003',
  workspaceEncodingUnsupported: 'BUDINGX_WORKSPACE_004',
  workspaceTooLarge: 'BUDINGX_WORKSPACE_005',
  workspaceEditNoMatch: 'BUDINGX_WORKSPACE_006',
  workspaceEditAmbiguous: 'BUDINGX_WORKSPACE_007',
  workspaceEditConflict: 'BUDINGX_WORKSPACE_008',
  workspaceTruncated: 'BUDINGX_WORKSPACE_009',
  permissionDenied: 'BUDINGX_PERMISSION_001',
  permissionDeniedByRule: 'BUDINGX_PERMISSION_002',
  permissionOutsideWorkspace: 'BUDINGX_PERMISSION_003'
} as const

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES]
