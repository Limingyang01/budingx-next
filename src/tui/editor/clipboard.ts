import { execFileSync } from 'node:child_process'

/** Fallback for terminals that send Ctrl+V without bracketed paste. */
export function readClipboard(): string {
  let clip = ''
  if (process.platform === 'win32') {
    clip = execFileSync('powershell', ['-NoProfile', '-Command', 'Get-Clipboard -Raw'], {
      encoding: 'utf8',
      timeout: 3000,
      windowsHide: true
    })
  } else if (process.platform === 'darwin') {
    clip = execFileSync('pbpaste', [], { encoding: 'utf8', timeout: 3000 })
  } else {
    // Linux: try xclip then xsel
    try {
      clip = execFileSync('xclip', ['-selection', 'clipboard', '-o'], {
        encoding: 'utf8',
        timeout: 3000
      })
    } catch {
      clip = execFileSync('xsel', ['--clipboard', '--output'], {
        encoding: 'utf8',
        timeout: 3000
      })
    }
  }
  return clip.replace(/\r\n?/g, '\n').replace(/\n$/, '')
}
