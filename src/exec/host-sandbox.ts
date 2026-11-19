import { spawn, spawnSync } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  closeSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path'
import { isCredentialLike } from '../workspace/policy.js'
import type { SandboxBackend, SandboxLaunchRequest, SandboxTestSnapshot } from './sandbox-policy.js'

const BWRAP = '/usr/bin/bwrap'
const ISOLATED_CWD = '/workspace'
const MAX_ENTRIES = 50_000
const MAX_BYTES = 512 * 1024 * 1024
const PRIVATE_NAMES = new Set([
  '.git', '.budingx', '.claude', '.ssh', '.gnupg', '.aws', '.azure',
  '.kube', '.docker', '.config', '.npmrc', '.pypirc', '.netrc', '.git-credentials', '.envrc'
])

// The parent retains stdin only as a lifetime pipe. The actual command gets EOF.
// This works when WSL terminates the Windows client without forwarding signals.
const SUPERVISE = [
  'filter=$1; shift; exec 4<"$filter"',
  'exec 3<&0',
  'parent=$$',
  'worker= watcher=',
  'trap \'if [ -n "$worker" ]; then kill -KILL "$worker" 2>/dev/null || :; wait "$worker" 2>/dev/null || :; fi; exit 130\' USR1 TERM INT HUP',
  '"$@" </dev/null &',
  'worker=$!',
  '(IFS= read -r unused <&3 || :; kill -USR1 "$parent" 2>/dev/null || :) &',
  'watcher=$!',
  'code=0',
  'wait "$worker" || code=$?',
  'kill "$watcher" 2>/dev/null || :',
  'wait "$watcher" 2>/dev/null || :',
  'exit "$code"'
].join('\n')

// Classic BPF uses the kernel seccomp_data ABI. Limit sockets to families
// scoped by the new network namespace; VSOCK remains global on some kernels.
function socketFilter(architecture: string): Buffer | undefined {
  const abi = architecture === 'x86_64' ? { audit: 0xc000003e, socket: 41 }
    : architecture === 'aarch64' ? { audit: 0xc00000b7, socket: 198 } : undefined
  if (!abi) return undefined
  const loadWord = 0x20
  const equals = 0x15
  const hasBits = 0x45
  const ret = 0x06
  const instructions = [
    [loadWord, 0, 0, 4], // seccomp_data.arch
    [equals, 1, 0, abi.audit],
    [ret, 0, 0, 0x80000000], // kill unsupported compat architectures
    [loadWord, 0, 0, 0], // seccomp_data.nr
    [hasBits, 6, 0, 0x40000000], // deny x32 syscall ABI
    [equals, 5, 0, 425], // deny io_uring_setup; it can create sockets indirectly
    [equals, 0, 5, abi.socket],
    [loadWord, 0, 0, 16], // low word of seccomp_data.args[0]
    [equals, 3, 0, 1], // AF_UNIX
    [equals, 2, 0, 2], // AF_INET
    [equals, 1, 0, 10], // AF_INET6
    [ret, 0, 0, 0x00050000 | 97], // errno EAFNOSUPPORT
    [ret, 0, 0, 0x7fff0000] // SECCOMP_RET_ALLOW
  ]
  const filter = Buffer.alloc(instructions.length * 8)
  instructions.forEach(([code, yes, no, value], index) => {
    const offset = index * 8
    filter.writeUInt16LE(code, offset)
    filter.writeUInt8(yes, offset + 2)
    filter.writeUInt8(no, offset + 3)
    filter.writeUInt32LE(value, offset + 4)
  })
  return filter
}

function equalPath(left: string, right: string): boolean {
  return relative(left, right) === ''
}

function removeSnapshot(temp: string, snapshot: string): void {
  if (equalPath(dirname(snapshot), temp) && basename(snapshot).startsWith('budingx-sandbox-')) {
    rmSync(snapshot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
}

function projectWorkspace(request: SandboxLaunchRequest, destination?: string, expectedRoot?: string) {
  const origin = realpathSync(request.cwd)
  if (expectedRoot !== undefined && !equalPath(origin, expectedRoot)) {
    throw new Error('Sandbox project directory changed during verification')
  }
  const fromWorkspaceToHome = relative(origin, homedir())
  if (fromWorkspaceToHome === '' || (!isAbsolute(fromWorkspaceToHome) &&
    fromWorkspaceToHome !== '..' && !fromWorkspaceToHome.startsWith('..' + sep))) {
    throw new Error('Sandbox needs a project directory narrower than the user home')
  }

  let entries = 0
  let bytes = 0
  const digest = request.verifyTestInput === true ? createHash('sha256') : undefined
  function visit(source: string, target?: string): void {
    for (const name of readdirSync(source).sort()) {
      entries += 1
      if (entries > MAX_ENTRIES) throw new Error('Sandbox project snapshot exceeds the entry limit')
      const canonicalName = name.toLowerCase()
      if (PRIVATE_NAMES.has(canonicalName) || isCredentialLike(canonicalName)) continue
      const path = join(source, name)
      const relativePath = relative(origin, path).split(sep).join('/')
      if (request.isWorkspacePathReadable?.(relativePath) === false) continue

      const stat = lstatSync(path, { bigint: true })
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) continue
      if (!equalPath(realpathSync(path), path)) continue
      const copy = target === undefined ? undefined : join(target, name)
      if (stat.isDirectory()) {
        digest?.update(JSON.stringify(['directory', relativePath]) + '\n')
        if (copy !== undefined) mkdirSync(copy)
        visit(path, copy)
        continue
      }

      // A hardlink may be another name for a project credential.
      if (stat.nlink !== 1n) continue
      if (stat.size > BigInt(MAX_BYTES - bytes)) throw new Error('Sandbox project snapshot exceeds 512 MiB')
      const fd = openSync(path, 'r')
      try {
        const opened = fstatSync(fd, { bigint: true })
        if (!opened.isFile() || opened.ino !== stat.ino || opened.dev !== stat.dev ||
          opened.size !== stat.size || opened.nlink !== 1n) {
          throw new Error('Sandbox project entry changed during snapshot')
        }
        const size = Number(stat.size)
        const data = Buffer.alloc(size)
        let copied = 0
        while (copied < size) {
          const chunk = readSync(fd, data, copied, size - copied, null)
          if (chunk === 0) throw new Error('Sandbox project entry changed during snapshot')
          copied += chunk
        }
        const finished = fstatSync(fd, { bigint: true })
        if (finished.mtimeNs !== opened.mtimeNs || finished.ctimeNs !== opened.ctimeNs ||
          !equalPath(realpathSync(path), path)) {
          throw new Error('Sandbox project entry changed during snapshot')
        }
        bytes += size
        const mode = Number(stat.mode & 0o777n)
        digest?.update(JSON.stringify(['file', relativePath, mode, size]) + '\n').update(data)
        if (copy !== undefined) writeFileSync(copy, data, { mode, flag: 'wx' })
      } finally {
        closeSync(fd)
      }
    }
  }
  visit(origin, destination)
  return { root: origin, digest: digest?.digest('hex') }
}

function sandboxArguments(): string[] {
  return [
    '--unshare-user', '--disable-userns', '--unshare-pid', '--unshare-net',
    '--unshare-ipc', '--unshare-uts', '--new-session', '--die-with-parent',
    '--cap-drop', 'ALL', '--clearenv', '--seccomp', '4',
    '--ro-bind', '/usr', '/usr',
    '--ro-bind-try', '/bin', '/bin',
    '--ro-bind-try', '/lib', '/lib',
    '--ro-bind-try', '/lib64', '/lib64',
    '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp',
    '--dir', '/home/budingx',
    '--setenv', 'HOME', '/home/budingx',
    '--setenv', 'PATH', '/usr/bin:/bin',
    '--setenv', 'TMPDIR', '/tmp'
  ]
}

function wslLauncher(environment: NodeJS.ProcessEnv): string[] {
  const distro = environment.BUDINGX_WSL_DISTRO
  const executable = join(environment.SystemRoot ?? 'C:\\Windows', 'System32', 'wsl.exe')
  return [executable, ...(distro ? ['--distribution', distro] : []), '--cd', '/', '--exec']
}

function runCheck(launcher: string[], args: string[]) {
  const [executable, ...prefix] = launcher
  return spawnSync(executable, [...prefix, ...args], { timeout: 20000, encoding: 'utf8', windowsHide: true })
}

/** Opt-in host integration. A genuine namespace probe must pass before registration. */
export function createHostSandboxFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env
): SandboxBackend | undefined {
  if (environment.BUDINGX_SANDBOX !== 'bubblewrap') return undefined
  const windowsHost = process.platform === 'win32'
  if (!windowsHost && process.platform !== 'linux') return undefined
  const launcher = windowsHost ? wslLauncher(environment) : []
  const kernel = runCheck([...launcher, '/bin/uname'], ['-m'])
  const filter = kernel.status === 0 ? socketFilter(kernel.stdout.trim()) : undefined
  if (!filter) return undefined

  function translatePath(path: string): string {
    if (!windowsHost) return path
    const result = runCheck([...launcher, '/usr/bin/wslpath'], ['-a', '-u', path])
    const translated = result.stdout?.trim()
    if (result.status !== 0 || !translated?.startsWith('/') || /[\r\n\0]/.test(translated)) {
      throw new Error('Unable to map sandbox snapshot to WSL')
    }
    return translated
  }

  let temp: string
  let probeRoot: string
  try {
    temp = realpathSync(tmpdir())
    probeRoot = mkdtempSync(join(temp, 'budingx-sandbox-'))
  } catch {
    return undefined
  }
  const probeCommand = [
    'test -x /bin/bash && test -r /proc/self/ns/net && test ! -e /init',
    'test ! -e /mnt/c && test ! -e /run/docker.sock',
    'test "$(/usr/bin/grep -c "^[[:space:]]*lo:" /proc/net/dev)" = 1',
    'test "$(/usr/bin/wc -l </proc/net/dev)" = 3',
    "/usr/bin/grep -q '^Seccomp:[[:space:]]*2$' /proc/self/status",
    'printf budingx-sandbox-verified'
  ].join(' && ')
  try {
    const filterPath = join(probeRoot, 'socket-filter.bpf')
    writeFileSync(filterPath, filter, { flag: 'wx', mode: 0o600 })
    const probe = runCheck([...launcher, '/bin/sh'], [
      '-c', 'filter=$1; shift; exec 4<"$filter"; exec "$@"', 'budingx-sandbox-probe',
      translatePath(filterPath), BWRAP, ...sandboxArguments(), '--', '/bin/sh', '-c', probeCommand
    ])
    if (probe.status !== 0 || probe.stdout.trim() !== 'budingx-sandbox-verified') return undefined
  } catch {
    return undefined
  } finally {
    try { removeSnapshot(temp, probeRoot) } catch { /* A busy temp directory is left to the OS. */ }
  }

  const testSnapshots = new WeakMap<ChildProcess, SandboxTestSnapshot>()
  return {
    id: windowsHost ? 'bubblewrap-wsl' : 'bubblewrap',
    label: windowsHost ? 'Bubblewrap (WSL)' : 'Bubblewrap',
    verified: true,
    keepsSupervisorStdinOpen: true,
    capabilities: {
      allowRead: [],
      denyRead: [],
      allowWrite: [],
      denyWrite: [],
      networkDomains: [],
      canEnforceNetwork: true
    },
    resolveInterpreter(tool) {
      return tool === 'Bash'
        ? { shell: '/bin/bash', args: ['--noprofile', '--norc', '-c'], label: windowsHost ? 'Bash (WSL)' : 'Bash' }
        : { error: '此隔离后端支持 Linux Bash。没有已验证的 Windows PowerShell 隔离后端。' }
    },
    start(request) {
      if (request.executable !== '/bin/bash' || request.args.length !== 4 ||
        request.args[0] !== '--noprofile' || request.args[1] !== '--norc' || request.args[2] !== '-c') {
        throw new Error('Sandbox requires Bash with the fixed non-interactive argument contract')
      }
      const snapshot = mkdtempSync(join(temp, 'budingx-sandbox-'))
      try {
        // Do not start a loop that copies its own snapshot when the workspace contains the temp directory.
        const nestedSnapshot = relative(realpathSync(request.cwd), snapshot)
        if (!isAbsolute(nestedSnapshot) && nestedSnapshot !== '..' && !nestedSnapshot.startsWith('..' + sep)) {
          throw new Error('Sandbox project directory contains the system temporary directory')
        }
        const project = join(snapshot, 'project')
        const filterPath = join(snapshot, 'socket-filter.bpf')
        mkdirSync(project)
        const projection = projectWorkspace(request, project)
        writeFileSync(filterPath, filter, { flag: 'wx', mode: 0o600 })
        const snapshotPath = translatePath(project)
        const [executable, ...prefix] = [...launcher, '/bin/sh']
        const bubblewrapArgs = [
          ...sandboxArguments(),
          request.mode === 'read_only' || request.verifyTestInput ? '--ro-bind' : '--bind', snapshotPath, ISOLATED_CWD,
          '--chdir', ISOLATED_CWD,
          '--', request.executable, ...request.args
        ]
        const child = spawn(executable, [
          ...prefix, '-c', SUPERVISE, 'budingx-sandbox', translatePath(filterPath), BWRAP, ...bubblewrapArgs
        ], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
        if (projection.digest !== undefined) {
          const digest = projection.digest
          testSnapshots.set(child, {
            digest,
            isCurrent() {
              try {
                return projectWorkspace(request, undefined, projection.root).digest === digest
              } catch {
                return false
              }
            }
          })
        }
        child.once('close', () => {
          try { removeSnapshot(temp, snapshot) } catch { /* Leave temp cleanup to the operating system if busy. */ }
        })
        return child
      } catch (error) {
        removeSnapshot(temp, snapshot)
        throw error
      }
    },
    testSnapshot(child) {
      return testSnapshots.get(child)
    },
    terminate(child) {
      if (child.stdin && !child.stdin.destroyed && !child.stdin.writableEnded) child.stdin.end()
    }
  }
}
