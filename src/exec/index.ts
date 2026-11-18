// Exec module entry (SP004 design §3): 真实进程执行、后台任务、托管编辑与隔离决策。
export { createCommandRunner } from './runner.js'
export type { CommandRunnerOptions } from './runner.js'
export { createExecTools } from './tools.js'
export type { ExecToolName, ExecToolsOptions } from './tools.js'
export { createBackgroundTable } from './background.js'
export type { BackgroundRegistration, BackgroundTable, BackgroundTableOptions } from './background.js'
export { detectDestructiveCommand, destructiveWarningText } from './destructive.js'
export type { DestructiveWarning } from './destructive.js'
export { selectInterpreter } from './interpreter.js'
export type {
  InterpreterChoice,
  InterpreterError,
  InterpreterProbeOptions,
  InterpreterTool
} from './interpreter.js'
export { OutputCollector, capMergedText, formatStream, truncationNotice } from './output.js'
export {
  buildCommandFinishedEvent,
  persistOutput,
  resolveTaskOutputPath
} from './persist.js'
export type { CommandFinishedEvent, CommandFinishedInput } from './persist.js'
export {
  isBlockingWaitCommand,
  isInteractiveCommand,
  isReadOnlyCommand,
  tokenizeCommand
} from './readonly-commands.js'
export { createSandboxPolicy } from './sandbox-policy.js'
export type {
  SandboxBackend,
  SandboxCapabilities,
  SandboxDecision,
  SandboxPolicy,
  SandboxRequest
} from './sandbox-policy.js'
export { applySedEdit, parseSedEdit, validateSedEdit } from './sed-edit.js'
export type { SedApplyResult, SedEditInfo } from './sed-edit.js'
