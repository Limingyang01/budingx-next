#!/usr/bin/env node
// budingx entry point (SP002 design §3.1/§3.6).
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { validSessionId } from '../storage/session-store.js'
import { createSessionTranscript } from '../storage/session-transcript.js'
import { createElement } from 'react'
import { render } from 'ink'
import { ConfigStore } from '../storage/config-store.js'
import { CredentialStore } from '../storage/credentials.js'
import { mergeSources, profileCredentialBinding, profileCredentialRef, startupProfile, type ResolvedConfig } from '../storage/profiles.js'
import { MODES_EN, MODES_ZH } from '../workspace/policy.js'
import type { PermissionMode } from '../core/permissions.js'
import { App } from './app.js'
import { createAgentRuntime, workspacePromptOptions, type AgentRuntime } from './runtime.js'
import { startMcp } from './mcp/index.js'
import { createMcpElicitation } from './mcp/elicitation.js'
import { buildDiagnosticsPort } from './diagnostics/port.js'
import { startHooks } from './hooks/index.js'
import type { CommandContext } from './commands.js'
import { InkApprovalGateway } from './approval.js'
import { runCommand } from './commands.js'
import { parseCliArgs, runHeadless, UsageError } from './headless.js'
import { terminalStrategy } from './render/header.js'
import { runServeCommand } from './serve.js'

const MODE_ORDER: PermissionMode[] = ['read_only', 'workspace_edit', 'full_access']

/** 0.5.2：解析推理强度环境变量；非法值忽略。 */
function effortFromEnv(raw: string | undefined): 'low' | 'medium' | 'high' | undefined {
  const value = raw?.trim().toLowerCase()
  return value === 'low' || value === 'medium' || value === 'high' ? value : undefined
}

/** 0.5.2：解析正整数环境变量；非法值忽略而不是崩溃。 */
function positiveInteger(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined
  const value = Number.parseInt(raw.trim(), 10)
  return Number.isFinite(value) && value > 0 ? value : undefined
}

function permissionContext(
  runtime: AgentRuntime
): NonNullable<CommandContext['permission']> {
  return {
    policy: runtime.policy,
    setMode: runtime.setPermissionMode,
    store: runtime.permissionStore,
    workspace: runtime.workspace,
    checkpointChanges: () => runtime.checkpoint.changes(),
    undo: (path?: string) =>
      path
        ? runtime.checkpoint.undoPath(runtime.workspace, path)
        : runtime.checkpoint.undoTurn(runtime.workspace),
    denials: () => runtime.denials,
    modes: { order: MODE_ORDER, zh: MODES_ZH, en: MODES_EN }
  }
}

function readProductVersion(): string {
  let dir = new URL('.', import.meta.url)
  for (let depth = 0; depth < 8; depth++) {
    try {
      const parsed = JSON.parse(readFileSync(new URL('package.json', dir), 'utf8')) as {
        name?: string
        version?: string
      }
      if (parsed.name === 'budingx' && parsed.version) return parsed.version
    } catch {
      // keep walking up
    }
    dir = new URL('../', dir)
  }
  return '0.0.0'
}

const version = readProductVersion()
const help = `budingx ${version} — independent terminal coding agent
Usage: budingx [--model NAME] [--base-url URL] [--timeout MS] [--prompt TEXT]
  budingx --resume ID
  budingx --prompt TEXT [--output-format text|json|stream-json]
          [--input-format text|stream-json] [--input-file PATH] [--session ID] [--verbose]
Environment: BUDINGX_API_KEY, BUDINGX_MODEL, BUDINGX_BASE_URL
Commands: /help /config /models /model NAME
  /permission [read|workspace|full] /rules [add|rm] /diff [path] /undo [path] /denials /clear /exit
Keys: Esc interrupts, Shift+Tab switches Allow edits / Full auto in the TUI,
Enter submits, Ctrl+C interrupts and exits. @path attaches a workspace file, Tab completes.
File tools run under the permission modes; full access never overrides deny rules or credential protection.`

type Stores = {
  configStore: ConfigStore
  credentialStore: CredentialStore
  file: {
    profileId?: string
    baseUrl?: string
    model?: string
    apiKey?: string
  }
}

function loadStores(): Stores {
  const configStore = new ConfigStore()
  const credentialStore = new CredentialStore()
  const stored = configStore.load()
  const orphanCount = credentialStore.orphanIds(stored.models.map(profileCredentialRef)).length
  if (orphanCount)
    process.stderr.write(
      `Orphan credentials: ${orphanCount}; use O in the interactive /models panel\n`
    )
  const profile = startupProfile(stored)
  const file = profile
    ? {
        profileId: profile.id,
        baseUrl: profile.baseUrl,
        model: profile.model,
        apiKey: credentialStore.get(profileCredentialRef(profile), profileCredentialBinding(profile))
      }
    : {}
  return { configStore, credentialStore, file }
}

/** Run one turn and stream the answer as plain text. */
function runTurn({ session, workspace, policy }: AgentRuntime, text: string): Promise<number> {
  return new Promise<number>((resolve) => {
    const off = session.on((event) => {
      if (event.type === 'text_delta') process.stdout.write(event.text)
      if (event.type === 'notice' && event.code === 'file_context') process.stderr.write(event.text + '\n')
      if (event.type === 'turn_finalized') {
        off()
        if (event.outcome === 'error' && event.error) {
          process.stderr.write(`Error: ${event.error.message}\n`)
          resolve(1)
          return
        }
        resolve(0)
      }
    })
    session.submit(text, workspacePromptOptions(text, workspace, policy))
  })
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

async function runPipe(config: ResolvedConfig, stores: Stores): Promise<number> {
  let current = config
  // Non-interactive runs keep the conservative default: read_only mode
  // answers reads and refuses writes before any approval could be asked.
  const promptEffort = effortFromEnv(process.env.BUDINGX_REASONING_EFFORT)
  const runtime = createAgentRuntime({
    cwd: process.cwd(),
    getConfig: () => current,
    approval: {
      async request() {
        return { outcome: 'deny', via: 'policy' }
      }
    },
    configStore: stores.configStore,
    mode: 'read_only',
    ...(promptEffort === undefined ? {} : { reasoningEffort: promptEffort })
  })
  const session = runtime.session
  const input = await readStdin()
  let code = 0
  for (const rawLine of input.split('\n')) {
    const text = rawLine.trim()
    if (!text) continue
    if (text === '/exit' || text === '/quit') break
    if (text.startsWith('/')) {
      const outcome = await runCommand(text, {
        session,
        configStore: stores.configStore,
        credentialStore: stores.credentialStore,
        getConfig: () => current,
        setConfig: (next) => {
          current = next
        },
        exit: () => {},
        permission: permissionContext(runtime)
      })
      if (outcome.error) {
        code = 1
        process.stderr.write(`Error: ${outcome.error}\n`)
      } else if (outcome.message) process.stdout.write(`${outcome.message}\n`)
      continue
    }
    if (!current.model.trim()) {
      process.stderr.write(
        'Error: Set BUDINGX_MODEL or use /model <name> before sending a prompt\n'
      )
      code = 1
      break
    }
    const turnCode = await runTurn(runtime, text)
    process.stdout.write('\n')
    if (turnCode !== 0) code = turnCode
  }
  session.dispose()
  await runtime.shutdownTracing?.()
  return code
}

async function runInteractive(config: ResolvedConfig, stores: Stores, resume?: string): Promise<void> {
  const gateway = new InkApprovalGateway()
  let current = config
  // 0.5.2：交互式 TUI 打开会话持久化与上下文预算，/sessions /resume
  // /context /memory 与上下文用量显示才有数据源。窗口默认不猜：
  // 只有显式配置 BUDINGX_CONTEXT_WINDOW 才显示百分比。
  const contextWindow = positiveInteger(process.env.BUDINGX_CONTEXT_WINDOW)
  const mcpElicitation = createMcpElicitation()
  const mcp = await startMcp({ clientOptions: { onElicitation: mcpElicitation.request } })
  for (const warning of mcp.warnings) {
    process.stderr.write(`Warning: ${warning}\n`)
  }
  const hooks = startHooks()
  for (const warning of hooks.loaded.warnings) {
    process.stderr.write(`Warning: ${warning}\n`)
  }
  const runtime = createAgentRuntime({
    cwd: process.cwd(),
    getConfig: () => current,
    approval: gateway,
    configStore: stores.configStore,
    persistPermissionMode: true,
    persistence: true,
    mcp,
    hooks: hooks.runner,
    ...(contextWindow === undefined ? {} : { contextBudget: { maxTokens: contextWindow } }),
    ...(effortFromEnv(process.env.BUDINGX_REASONING_EFFORT) === undefined
      ? {}
      : { reasoningEffort: effortFromEnv(process.env.BUDINGX_REASONING_EFFORT)! })
  })
  for (const warning of runtime.warnings) {
    process.stderr.write(`Warning: ${warning}\n`)
  }
  const session = runtime.session
  const shutdown = async () => {
    session.dispose()
    await runtime.shutdownTracing?.()
    await mcp.close()
  }
  if (resume !== undefined) {
    const result = runtime.sessions?.resume(resume)
    if (!result?.ok) {
      await shutdown()
      process.stderr.write('无法恢复此会话：' + (result?.message ?? '未找到会话') + '\n')
      process.exitCode = 1
      return
    }
  }

  const fullScreen = process.env.TERM !== 'dumb' &&
    terminalStrategy(process.env, process.platform) === 'pixel'
  const instance = render(
    createElement(App, {
      session,
      gateway,
      commandContext: {
        configStore: stores.configStore,
        credentialStore: stores.credentialStore,
        getConfig: () => current,
        setConfig: (next: ResolvedConfig) => {
          current = next
        },
        exit: () => {
          instance.unmount()
        },
        permission: permissionContext(runtime),
        cwd: process.cwd(),
        home: homedir(),
        ...(runtime.tasks ? { tasks: runtime.tasks } : {}),
        ...(runtime.taskPanel ? { taskPanel: runtime.taskPanel } : {}),
        ...(runtime.skillCatalog ? { skillCatalog: runtime.skillCatalog } : {}),
        ...(runtime.worktree ? { worktree: runtime.worktree } : {}),
        ...(runtime.mcp ? { mcp: runtime.mcp, mcpElicitation } : {}),
        ...(runtime.contextUsage ? { contextUsage: runtime.contextUsage } : {}),
        ...(runtime.sessions ? { sessions: runtime.sessions } : {}),
        ...(runtime.context ? { context: runtime.context } : {}),
        ...(runtime.memory ? { memory: runtime.memory } : {}),
        ...(runtime.effort ? { effort: runtime.effort } : {}),
        // SP007 T9：子代理登记表（/tasks Agents 分组、ctrl+b 后台化、停止）。
        ...(runtime.agents
          ? {
              agents: {
                list: () => runtime.agents!.list(),
                stop: (agentId: string) => runtime.agents!.stop(agentId),
                background: (callId: string) => runtime.agents!.background(callId)
              }
            }
          : {}),
        // SP007 T10：诊断端口（/status /stats /doctor）。
        diagnostics: buildDiagnosticsPort({
          runtime,
          configStore: stores.configStore,
          getConfig: () => current,
          mcpStatuses: mcp.statuses,
          mcpTools: mcp.tools,
          version,
          cwd: process.cwd(),
          home: homedir()
        })
      },
      ...(runtime.imageCache ? { imageCache: runtime.imageCache } : {}),
      version,
      cwd: process.cwd(),
      fullScreen,
      // SP006 波次 G：输入框下一句建议复用同一 provider；未启用时不注入。
      ...(runtime.suggestions ? { suggestNextPrompt: runtime.suggestions.generate } : {}),
      onExit: () => {
        instance.unmount()
      }
    }),
    { exitOnCtrlC: false, alternateScreen: fullScreen }
  )
  try {
    await instance.waitUntilExit()
  } finally {
    await shutdown()
  }
  const saved = createSessionTranscript({ sessionId: session.id }).read()
  if (!saved.unsupported && saved.records.some((record) => record.type === 'message')) {
    process.stdout.write(`\n使用以下命令恢复此会话：\nbudingx --resume ${session.id}\n`)
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (args.length === 1 && ['--version', '-v'].includes(args[0])) {
    process.stdout.write(`${version}\n`)
    return
  }
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    process.stdout.write(`${help}\n`)
    return
  }
  if (args[0] === 'serve') {
    process.exitCode = await runServeCommand(args.slice(1))
    return
  }

  let parsed: ReturnType<typeof parseCliArgs>
  try {
    parsed = parseCliArgs(args)
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write('Error: ' + error.message + '\n')
      process.exitCode = 2
      return
    }
    throw error
  }

  if (parsed.resume !== undefined && (!validSessionId(parsed.resume) || !process.stdin.isTTY || !process.stdout.isTTY)) {
    process.stderr.write('用法：在交互式终端运行 budingx --resume <会话 ID>\n')
    process.exitCode = 2
    return
  }

  let stores: Stores
  try {
    stores = loadStores()
  } catch (error) {
    process.stderr.write(
      `Error: ${error instanceof Error ? error.message : 'configuration unreadable'}\n`
    )
    process.exitCode = 1
    return
  }

  let config: ResolvedConfig
  try {
    config = mergeSources({ args: parsed.passthrough, env: process.env, file: stores.file })
  } catch (error) {
    process.stderr.write(
      `Error: ${error instanceof Error ? error.message : 'invalid configuration'}\n`
    )
    process.exitCode = 1
    return
  }

  if (config.prompt !== undefined || parsed.explicit) {
    process.exitCode = await runHeadless(
      config,
      { configStore: stores.configStore, credentialStore: stores.credentialStore },
      { stdout: process.stdout, stderr: process.stderr, env: process.env },
      parsed.options
    )
    return
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.exitCode = await runPipe(config, stores)
    return
  }

  await runInteractive(config, stores, parsed.resume)
}

main().catch((error) => {
  process.stderr.write(
    `Error: ${error instanceof Error ? error.message : 'budingx failed'}\n`
  )
  process.exitCode = 1
})
