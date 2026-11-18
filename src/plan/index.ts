// Plan module entry (SP004 design §3/§6): 计划状态机、持久化、执行前校验与计划模式宿主。
export { createPlanModeHost, planModeFilePath } from './host.js'
export type { PlanModeHostOptions } from './host.js'
export { loadPlanFile, parsePlan, planFilePath, savePlanFile, serializePlan } from './serialize.js'
export {
  createPlanStore,
  createTodoStore,
  planEvidenceOf,
  planFingerprintOf
} from './store.js'
export type { PlanEvidence, PlanSnapshot, PlanStoreOptions } from './store.js'
export { createPlanModeTools } from './tools.js'
export { validateBeforeExecute } from './validate.js'
export type { PlanDrift, PlanValidation } from './validate.js'
