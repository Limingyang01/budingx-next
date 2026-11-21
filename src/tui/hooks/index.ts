import { createHookRunner, type HookRunner, type HookRunnerOptions } from './runner.js'
import { loadHooksConfig } from './config.js'
import type { LoadedHooks } from './types.js'

export * from './types.js'
export { loadHooksConfig } from './config.js'
export { createHookRunner } from './runner.js'
export type { HookRunner, HookRunnerOptions } from './runner.js'

export interface StartedHooks {
  runner: HookRunner
  loaded: LoadedHooks
}

/** 宿主装配：读配置并创建 runner；配置损坏时 runner 为空但 warnings 保留。 */
export function startHooks(
  options: HookRunnerOptions & { homeDir?: string } = {}
): StartedHooks {
  const loaded = loadHooksConfig(options.homeDir)
  const runner = createHookRunner(loaded.config, options)
  return { runner, loaded }
}
