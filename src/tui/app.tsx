// Ink conversation UI (SP002 design §3.6, AC TC-02 … TC-07).
// The app renders events and forwards keys; it holds no business rules.
import { Box, Static, Text, useApp, useInput, useStdout } from 'ink'
import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { SessionEvent } from '../core/events.js'
import type { Session } from '../core/session.js'
import type { InkApprovalGateway } from './approval.js'
import { runCommand, type CommandContext } from './commands.js'
import { EditorBuffer } from './editor/buffer.js'
import { applyKey, type KeyFlags } from './editor/keys.js'
import { reduceFrame } from './render/reducer.js'
import { renderHeader, setupHint, terminalStrategy } from './render/header.js'
import { initialFrame } from './render/types.js'

export type AppProps = {
  session: Session
  gateway: InkApprovalGateway
  commandContext: Omit<CommandContext, 'session'>
  version: string
  cwd?: string
  onExit: () => void
}

const STATUS_ZH: Record<string, string> = {
  idle: '就绪',
  requesting: '请求中…',
  streaming: '流式输出中…',
  awaiting_approval: '等待审批',
  tool_running: '工具执行中…',
  cancelling: '取消中…'
}

const STATUS_EN: Record<string, string> = {
  idle: 'ready',
  requesting: 'requesting…',
  streaming: 'streaming…',
  awaiting_approval: 'waiting for approval',
  tool_running: 'running tool…',
  cancelling: 'cancelling…'
}

export function App({ session, gateway, commandContext, version, cwd, onExit }: AppProps) {
  const { exit } = useApp()
  const [frame, dispatch] = useReducer(
    (state: ReturnType<typeof initialFrame>, event: SessionEvent) =>
      reduceFrame(state, event, { width: process.stdout.columns ?? 80 }),
    undefined,
    initialFrame
  )
  const [input, setInput] = useState('')
  const [hint, setHint] = useState('')
  const editor = useMemo(() => new EditorBuffer(), [])
  const ctrlC = useRef(0)
  const strategy = useMemo(
    () => terminalStrategy(process.env, process.platform),
    []
  )
  const zh = strategy === 'pixel'
  const pick = (zhText: string, enText: string) => (zh ? zhText : enText)
  const STATUS_LABEL = zh ? STATUS_ZH : STATUS_EN

  // The header follows the active model, so /model must re-render it.
  // A version counter is enough: the config object itself may carry the API
  // key and must not be retained in UI state.
  const [, bumpConfigVersion] = useReducer((n: number) => n + 1, 0)
  const context = useMemo(
    () => ({
      ...commandContext,
      lang: (zh ? 'zh' : 'en') as 'zh' | 'en',
      setConfig: (next: Parameters<CommandContext['setConfig']>[0]) => {
        commandContext.setConfig(next)
        bumpConfigVersion()
      }
    }),
    [commandContext, zh]
  )

  useEffect(() => {
    const off = session.on((event) => {
      dispatch(event)
      if (event.type === 'turn_finalized' && event.restoreText) {
        editor.setText(event.restoreText)
        setInput(event.restoreText)
        setHint(pick('被取消的请求已退回输入框', 'The cancelled request was returned to the prompt'))
      }
    })
    return off
  }, [session, editor])

  const busy = session.isBusy
  const approval = frame.approval
  const typing = editor.text.trim() !== ''

  useInput((inputText, inkKey) => {
    const key: KeyFlags = {
      upArrow: inkKey.upArrow,
      downArrow: inkKey.downArrow,
      leftArrow: inkKey.leftArrow,
      rightArrow: inkKey.rightArrow,
      pageDown: inkKey.pageDown,
      pageUp: inkKey.pageUp,
      return: inkKey.return,
      escape: inkKey.escape,
      ctrl: inkKey.ctrl,
      shift: inkKey.shift,
      tab: inkKey.tab,
      backspace: inkKey.backspace,
      delete: inkKey.delete,
      meta: inkKey.meta
    }

    // Approval decisions are claimed once and never leave a residue.
    if (approval && !typing) {
      if (inputText === 'y' || inputText === 'Y') {
        gateway.resolve(approval.requestId, 'allow')
        return
      }
      if (inputText === 'n' || inputText === 'N') {
        gateway.resolve(approval.requestId, 'deny')
        return
      }
    }

    const action = applyKey(editor, inputText, key, { busy })
    if (!action.handled) return

    if (action.interrupt) {
      session.interrupt('user')
      setHint(pick('已请求打断', 'Interrupt requested'))
      setInput(editor.text)
      return
    }
    if (action.exit) {
      ctrlC.current += 1
      if (ctrlC.current >= 2) {
        onExit()
        exit()
        return
      }
      setHint(pick('再按一次 Ctrl+C 退出', 'Press Ctrl+C again to exit'))
      return
    }
    if (action.escape) {
      const recycled = session.recycleQueued()
      if (recycled.length > 0) {
        editor.setText(recycled.join('\n'))
        setInput(editor.text)
        setHint(pick('排队内容已退回输入框', 'Queued input returned to the prompt'))
      } else {
        setHint('')
      }
      return
    }
    if (action.submit) {
      const text = editor.text.trim()
      if (!text) return
      editor.commit(text)
      editor.clear()
      setInput('')
      setHint('')
      if (text.startsWith('/')) {
        if (!busy) {
          void runCommand(text, { ...context, session }).then((outcome) => {
            if (outcome.exit) {
              onExit()
              exit()
              return
            }
            if (outcome.error) setHint(outcome.error)
            else if (outcome.message) setHint(outcome.message)
          })
        } else {
          setHint(pick('命令在回合间隙执行；该输入已排队', 'Commands run between turns; the input was queued'))
        }
        return
      }
      session.submit(text)
      return
    }
    setInput(editor.text)
  })

  const config = commandContext.getConfig()

  return (
    <Box flexDirection="column">
      <Box flexDirection="column">
        {renderHeader({
          version,
          model: config.model,
          baseUrl: config.baseUrl,
          keyPresent: !!config.apiKey.trim(),
          cwd,
          columns: process.stdout.columns ?? 80,
          strategy
        }).map((line, i) => (
          <Text key={i}>
            {line.map((span, j) => (
              <Text
                key={j}
                color={span.color}
                dimColor={span.dim}
                bold={span.bold}
                italic={span.italic}
              >
                {span.text}
              </Text>
            ))}
          </Text>
        ))}
      </Box>

      <Static items={frame.staticLines}>
        {(line, index) => (
          <Text key={`${index}-${line}`}>{line}</Text>
        )}
      </Static>

      {frame.liveLines.map((line, index) => (
        <Text key={`live-${index}`}>{line}</Text>
      ))}

      {frame.queue.length > 0 && (
        <Box flexDirection="column">
          {frame.queue.map((item) => (
            <Text key={item.id} color="yellow">
              {pick('⧗ 排队：', '[queued] ')}{item.preview}
            </Text>
          ))}
        </Box>
      )}

      {approval && !typing && (
        <Box flexDirection="column" borderStyle="round" borderColor="yellow">
          <Text color="yellow">{pick('需要审批', 'Approval needed')}: {approval.name}</Text>
          <Text>{approval.summary}</Text>
          <Text color="yellow">{pick('y 允许，n 拒绝', 'y to allow, n to deny')}</Text>
        </Box>
      )}

      {frame.error && (
        <Text color="red">{frame.error}</Text>
      )}

      <Box flexDirection="column">
        <Text>{`> ${input}`}</Text>
        <Text dimColor>
          {STATUS_LABEL[frame.status.state] ?? frame.status.state}
          {hint ? ` — ${hint}` : ''}
        </Text>
        {setupHint(config, strategy) && <Text color="yellow">{setupHint(config, strategy)}</Text>}
      </Box>
    </Box>
  )
}

