// SP008 T8：宿主进程入口（stdio / WebSocket）。stdout 只写协议帧。
import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'
import { ConfigStore } from '../storage/config-store.js'
import { CredentialStore } from '../storage/credentials.js'
import { configPath, credentialsPath } from '../storage/paths.js'
import {
  SessionStore,
  sessionWorkspaceId,
  validSessionId
} from '../storage/session-store.js'
import { startupProfile, mergeSources, profileCredentialRef, profileCredentialBinding } from '../storage/profiles.js'
import { HostServer } from '../host/server.js'
import { claimSessionOwnership, SessionOwnershipRole } from '../host/ownership.js'
import { connectStdio } from '../host/transport/stdio.js'
import { isLoopbackHost, startWsHost } from '../host/transport/ws.js'
import {
  createHostEngine,
  HostApprovalGateway,
  type HostRestoreState
} from './host-engine.js'
import { createAgentRuntime } from './runtime.js'
import { startMcp } from './mcp/index.js'
import { startHooks } from './hooks/index.js'

const USAGE = `Usage: budingx serve [--transport stdio|ws] [--session ID] [--takeover]
                    [--host ADDRESS] [--port N] [--token TOKEN] [--home DIR]

Hosts one session over a newline-delimited JSON protocol on stdin/stdout
(default) or WebSocket. stdout carries protocol frames only.`

export type ServeOptions = {
  transport: 'stdio' | 'ws'
  host: string
  port: number
  sessionId: string
  takeover: boolean
  home?: string
  token?: string
  help: boolean
}

function usageError(message: string): Error {
  return Object.assign(new Error(message), { exitCode: 2 })
}

export function parseServeArgs(args: string[]): ServeOptions {
  const options: ServeOptions = {
    transport: 'stdio',
    host: '127.0.0.1',
    port: 0,
    sessionId: `session-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`,
    takeover: false,
    help: false
  }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    const value = () => {
      const next = args[index + 1]
      if (next === undefined) throw usageError(`${arg} requires a value`)
      index += 1
      return next
    }
    switch (arg) {
      case '--help':
      case '-h':
        options.help = true
        break
      case '--transport': {
        const transport = value()
        if (transport !== 'stdio' && transport !== 'ws') {
          throw usageError('Invalid --transport; expected stdio or ws')
        }
        options.transport = transport
        break
      }
      case '--host':
        options.host = value()
        break
      case '--port': {
        const raw = value()
        const port = Number(raw)
        if (!Number.isInteger(port) || port < 0 || port > 65535) {
          throw usageError('Invalid --port; expected 0-65535')
        }
        options.port = port
        break
      }
      case '--session': {
        const sessionId = value()
        if (!validSessionId(sessionId)) {
          throw usageError('Invalid --session; expected letters, digits, - and _')
        }
        options.sessionId = sessionId
        break
      }
      case '--takeover':
        options.takeover = true
        break
      case '--token':
        options.token = value()
        break
      case '--home':
        options.home = value()
        break
      default:
        throw usageError(`Unknown option: ${arg}`)
    }
  }
  return options
}

export async function runServeCommand(args: string[]): Promise<number> {
  let options: ServeOptions
  try {
    options = parseServeArgs(args)
  } catch (error) {
    process.stderr.write(`Error: ${(error as Error).message}\n`)
    return 2
  }
  if (options.help) {
    process.stdout.write(USAGE + '\n')
    return 0
  }

  const home = options.home
  const configStore = new ConfigStore(configPath(home))
  const credentialStore = new CredentialStore(credentialsPath(home))
  const stored = configStore.load()
  const profile = startupProfile(stored)
  const file = profile
    ? {
        profileId: profile.id,
        baseUrl: profile.baseUrl,
        model: profile.model,
        apiKey: credentialStore.get(
          profileCredentialRef(profile),
          profileCredentialBinding(profile)
        )
      }
    : {}
  const config = mergeSources({ args: [], env: process.env, file })

  const claim = claimSessionOwnership({
    sessionId: options.sessionId,
    ...(home ? { home } : {}),
    ...(options.takeover ? { force: true } : {})
  })
  if (options.takeover && claim.role !== 'owner') {
    process.stderr.write(
      `Error: cannot take over session ${options.sessionId}; another process is still writing\n`
    )
    return 1
  }

  const gateway = new HostApprovalGateway()
  const ownership = new SessionOwnershipRole(claim)
  const sessionStore = new SessionStore({
    ...(home ? { home } : {}),
    workspaceRoot: process.cwd()
  })
  let runtime: ReturnType<typeof createAgentRuntime> | undefined
  let mcp: Awaited<ReturnType<typeof startMcp>> | undefined
  if (claim.role === 'owner') {
    // 与交互入口一致：owner 进程装配同一 home 下的 MCP 与 hooks；
    // observer 只读历史，不启动任何扩展子进程。
    try {
      mcp = await startMcp({ ...(home ? { homeDir: home } : {}) })
      for (const warning of mcp.warnings) process.stderr.write(`Warning: ${warning}\n`)
      const hooks = startHooks({ ...(home ? { homeDir: home } : {}) })
      for (const warning of hooks.loaded.warnings) process.stderr.write(`Warning: ${warning}\n`)
      runtime = createAgentRuntime({
        cwd: process.cwd(),
        ...(home ? { home } : {}),
        getConfig: () => config,
        approval: gateway,
        configStore,
        sessionId: options.sessionId,
        persistence: true,
        persistPermissionMode: true,
        mode: 'workspace_edit',
        mcp: { tools: mcp.tools, statuses: mcp.statuses },
        hooks: hooks.runner
      })
    } catch (error) {
      if (mcp) await mcp.close()
      ownership.release()
      process.stderr.write(`Error: ${(error as Error).message}\n`)
      return 1
    }
    for (const warning of runtime.warnings) process.stderr.write(`Warning: ${warning}\n`)
  } else {
    process.stderr.write(
      `Notice: session ${options.sessionId} is owned by another process; serving read-only history\n`
    )
  }

  // SH-05：已有 transcript 时先恢复历史与需复核步骤。恢复只装载消息，
  // 绝不重放工具；没有 transcript 的新会话保持空历史。
  let restore: HostRestoreState | undefined
  if (runtime && sessionStore.summary(options.sessionId)) {
    const resumed = runtime.sessions?.resume(options.sessionId)
    if (resumed?.ok) {
      restore = {
        needsReview: resumed.needsReview ?? [],
        warnings: resumed.warnings ?? []
      }
      for (const warning of restore.warnings ?? []) {
        process.stderr.write('Warning: ' + warning + '\n')
      }
    } else if (resumed) {
      process.stderr.write(
        'Warning: session ' + options.sessionId + ' could not be restored: ' + resumed.message + '\n'
      )
    }
  }

  const engine = runtime
    ? createHostEngine({
        runtime,
        workspaceId: sessionWorkspaceId(process.cwd()),
        gateway,
        ...(restore ? { restore } : {})
      })
    : undefined

  let resolveStopped: (code: number) => void = () => {}
  const stopped = new Promise<number>((resolveStop) => {
    resolveStopped = resolveStop
  })
  const server = new HostServer({
    sessionId: options.sessionId,
    workspaceId: sessionWorkspaceId(process.cwd()),
    ownership,
    ...(engine ? { engine } : {}),
    sessionStore,
    onShutdown: () => resolveStopped(0)
  })

  const signals = ['SIGINT', 'SIGTERM'] as const
  const onSignal = () => {
    void server.shutdown()
  }
  for (const signal of signals) process.once(signal, onSignal)

  try {
    if (options.transport === 'stdio') {
      const stdio = connectStdio(server)
      void stdio.eof.then(() => server.shutdown())
      process.stderr.write('budingx host ready on stdio\n')
      return await stopped
    }
    const token = options.token ?? process.env.BUDINGX_HOST_TOKEN ?? ''
    if (token.length === 0) {
      process.stderr.write(
        'Error: --transport ws requires --token or BUDINGX_HOST_TOKEN\n'
      )
      await server.shutdown()
      return 2
    }
    if (!isLoopbackHost(options.host)) {
      process.stderr.write(
        'Error: HOST_AUTH_004: --transport ws must bind a loopback host (127.0.0.1, localhost or ::1)\n'
      )
      await server.shutdown()
      return 2
    }
    let wsHost
    try {
      wsHost = await startWsHost({
        host: options.host,
        port: options.port,
        token,
        onConnection: (connection) => server.attach(connection)
      })
    } catch (error) {
      process.stderr.write('Error: ' + (error as Error).message + '\n')
      await server.shutdown()
      return 2
    }
    process.stderr.write('budingx host listening on ' + wsHost.url + '\n')
    try {
      return await stopped
    } finally {
      await wsHost.close()
    }
  } finally {
    for (const signal of signals) process.removeListener(signal, onSignal)
    // 关闭顺序：先停会话（engine.dispose），再收 MCP 子进程，避免孤儿进程。
    if (mcp) await mcp.close()
  }
}