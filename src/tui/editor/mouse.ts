import { useEffect, useEffectEvent } from 'react'
import { useStdin, useStdout } from 'ink'

const mouseOn = '\x1b[?1000h\x1b[?1006h'
const mouseOff = '\x1b[?1006l\x1b[?1000l'

// Ink consumes complete SGR mouse packets before key dispatch. Observe the
// bytes it reads without taking ownership of its keyboard or paste parser.
export function useWheel(enabled: boolean, scroll: (lines: number) => void): void {
  const { stdin } = useStdin()
  const { stdout } = useStdout()
  const onWheel = useEffectEvent(scroll)

  useEffect(() => {
    if (!enabled) return
    let tail = ''
    let pasting = false
    const onData = (chunk: Buffer | string) => {
      const data = tail + String(chunk)
      tail = ''
      const packet = /\x1b\[(200~|201~|<(\d{1,3});\d{1,6};\d{1,6}[Mm])/g
      let consumed = 0
      for (const match of data.matchAll(packet)) {
        consumed = match.index + match[0].length
        if (match[1] === '200~') pasting = true
        else if (match[1] === '201~') pasting = false
        else if (!pasting && match[0].endsWith('M')) {
          const button = Number(match[2]) & ~28
          if (button === 64 || button === 65) onWheel(button === 64 ? -3 : 3)
        }
      }
      const lastEscape = data.lastIndexOf('\x1b')
      if (lastEscape >= consumed) {
        const suffix = data.slice(lastEscape)
        if (/^\x1b(?:\[[<0-9;]{0,24})?$/.test(suffix)) tail = suffix
      }
    }
    // useInput already attached Ink's readable listener, which drives reads.
    stdin.on('data', onData)
    stdout.write(mouseOn)
    return () => {
      stdin.off('data', onData)
      stdout.write(mouseOff)
    }
  }, [enabled, stdin, stdout])
}
