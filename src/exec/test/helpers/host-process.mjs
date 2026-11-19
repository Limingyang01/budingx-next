import { spawn as spawnChild } from 'node:child_process'

/** Exercises process wiring with test-owned commands. It provides no filesystem or network isolation. */
export function createHostProcessFixture({ spawn = spawnChild } = {}) {
  return {
    id: 'synthetic-backend',
    label: '未隔离的宿主进程测试替身',
    verified: true,
    capabilities: {
      allowWrite: [],
      denyWrite: [],
      allowRead: [],
      denyRead: [],
      networkDomains: [],
      canEnforceNetwork: true
    },
    start({ executable, args, cwd, env }) {
      return spawn(executable, args, {
        cwd,
        env,
        shell: false,
        windowsHide: true,
        detached: process.platform !== 'win32',
        stdio: ['pipe', 'pipe', 'pipe']
      })
    },
    terminate(child) {
      if (child.pid === undefined) return
      if (process.platform === 'win32') {
        const killer = spawnChild('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true })
        killer.once('error', () => child.kill('SIGKILL'))
        killer.once('close', () => child.kill('SIGKILL'))
        return
      }
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch (error) {
        if (error?.code !== 'ESRCH') throw error
        child.kill('SIGKILL')
      }
    }
  }
}
