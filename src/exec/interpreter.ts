// SP004 T2 · 解释器选择（设计 §4.2）。
// 表驱动探测真实解释器路径；找不到时返回结构化错误，不猜测、不回退到未知 shell。
import { existsSync } from 'node:fs'

export type InterpreterTool = 'Bash' | 'PowerShell'

export interface InterpreterChoice {
  shell: string
  args: string[]
  label: string
}

export interface InterpreterError {
  error: string
}

export interface InterpreterProbeOptions {
  /** 路径存在性探测注入，默认 fs.existsSync；供跨平台测试使用。 */
  exists?: (path: string) => boolean
}

const WINDOWS_BASH_CANDIDATES = [
  'C:/Program Files/Git/bin/bash.exe',
  'C:/Program Files (x86)/Git/bin/bash.exe'
]

const POSIX_BASH_CANDIDATES = ['/bin/bash', '/usr/bin/bash', '/usr/local/bin/bash']

function windowsPowerShellPath(): string {
  const root = process.env.SystemRoot ?? 'C:/Windows'
  return `${root.replace(/\\/g, '/')}/System32/WindowsPowerShell/v1.0/powershell.exe`
}

export function selectInterpreter(
  tool: InterpreterTool,
  platform: NodeJS.Platform,
  options: InterpreterProbeOptions = {}
): InterpreterChoice | InterpreterError {
  const exists = options.exists ?? existsSync
  if (tool === 'Bash') {
    if (platform === 'win32') {
      for (const candidate of WINDOWS_BASH_CANDIDATES) {
        if (exists(candidate)) return { shell: candidate, args: ['-c'], label: 'Git Bash' }
      }
      return { error: '未找到 Git Bash 解释器（C:/Program Files/Git/bin/bash.exe）。请安装 Git for Windows 后重试。' }
    }
    for (const candidate of POSIX_BASH_CANDIDATES) {
      if (exists(candidate)) return { shell: candidate, args: ['-c'], label: 'Bash' }
    }
    return { error: '未找到 Bash 解释器（/bin/bash 等常见路径均不存在）。' }
  }
  if (platform !== 'win32') {
    return { error: 'PowerShell 工具仅在 Windows 提供；当前平台请使用 Bash。' }
  }
  const shell = windowsPowerShellPath()
  if (!exists(shell)) {
    return { error: `未找到 Windows PowerShell 解释器（${shell}）。` }
  }
  return { shell, args: ['-NoProfile', '-NonInteractive', '-Command'], label: 'Windows PowerShell' }
}