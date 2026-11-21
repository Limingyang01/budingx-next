import { useEffect, useRef, useState } from 'react'
import {
  buildStatusLineInput,
  renderStatusLine,
  type StatusLineState
} from './render/statusline.js'
import { runStatusLineCommand, type StatusLineCommand } from './statusline-command.js'

/** Trigger sources that force a refresh (design §4.4 rule 5). */
export type StatusLineTrigger = string

export interface StatusLineView {
  /** Text shown in the footer; undefined when there is nothing to show. */
  text?: string
  source: 'external' | 'builtin'
}

const DEBOUNCE_MS = 300

/**
 * Runs the configured external status line command (design §4.4).
 *
 * The command receives the merged JSON payload on stdin and its stdout is the
 * footer text. Failures are silent: the built-in status line stays in place.
 * Only the last scheduled run may update the text, and a 300ms debounce keeps
 * a streaming turn from spawning one process per delta.
 */
export function useStatusLine(options: {
  spec: StatusLineCommand | undefined
  state: StatusLineState
  trigger: StatusLineTrigger
  debounceMs?: number
}): StatusLineView {
  const { spec, state, trigger } = options
  const debounceMs = options.debounceMs ?? DEBOUNCE_MS
  const builtin = renderStatusLine(buildStatusLineInput(state))
  const [external, setExternal] = useState<string | undefined>(undefined)
  const runId = useRef(0)

  useEffect(() => {
    if (!spec || !spec.command.trim()) {
      setExternal(undefined)
      return
    }
    const id = ++runId.current
    const controller = new AbortController()
    const timer = setTimeout(() => {
      void runStatusLineCommand(spec, buildStatusLineInput(state), {
        signal: controller.signal,
        timeoutMs: spec.timeoutMs
      }).then((result) => {
        if (id !== runId.current) return
        setExternal(result.ok ? result.text || undefined : undefined)
      })
    }, debounceMs)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
    // The trigger string is the content hash of the state, so rebuilding the
    // object every render does not restart the command.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec?.command, spec?.args?.join(' '), trigger, debounceMs])

  return external === undefined
    ? { text: builtin, source: 'builtin' }
    : { text: external, source: 'external' }
}
