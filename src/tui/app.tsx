import {
  Box,
  Text,
  useApp,
  useInput,
  useStdout,
  usePaste,
  useCursor,
  measureElement,
  type DOMElement
} from 'ink'
import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react'
import stringWidth from 'string-width'
import type { SessionEvent } from '../core/events.js'
import type { Session } from '../core/session.js'
import type { InkApprovalGateway } from './approval.js'
import { runCommand, type CommandContext } from './commands.js'
import { EditorBuffer } from './editor/buffer.js'
import { applyKey } from './editor/keys.js'
import { reduceFrame, renderTextLines } from './render/reducer.js'
import { renderHeader, setupHint, terminalStrategy } from './render/header.js'
import { initialFrame } from './render/types.js'
import { saveProfileKey } from './runtime.js'

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
export function App({
  session,
  gateway,
  commandContext,
  version,
  cwd,
  onExit
}: AppProps) {
  const { exit } = useApp()
  const { stdout } = useStdout()
  const terminal = stdout as NodeJS.WriteStream
  const [width, setWidth] = useState(terminal.columns || 80)
  useEffect(() => {
    const resize = () => setWidth(terminal.columns || 80)
    stdout.on('resize', resize)
    return () => {
      stdout.off('resize', resize)
    }
  }, [stdout])
  const [frame, dispatch] = useReducer(
    (state: ReturnType<typeof initialFrame>, event: SessionEvent) =>
      reduceFrame(state, event, { width }),
    undefined,
    initialFrame
  )
  const [input, setInput] = useState('')
  const [hint, setHint] = useState('')
  const editor = useMemo(() => new EditorBuffer(), [])
  const [, bumpEditor] = useReducer((n: number) => n + 1, 0)
  const ctrlC = useRef(0)
  const strategy = useMemo(() => terminalStrategy(process.env, process.platform), [])
  const zh = strategy === 'pixel'
  const pick = (a: string, b: string) => (zh ? a : b)
  const inputBox = useRef<DOMElement>(null)
  const { setCursorPosition } = useCursor()
  const [cursorPosition, setPosition] = useState<{ x: number; y: number } | undefined>(
    undefined
  )
  setCursorPosition(cursorPosition)
  const commands = useRef<string[]>([])
  const [commandCount, setCommandCount] = useState(0)
  const chain = useRef(Promise.resolve())
  const pendingActions = useRef(0)
  const keyDone = useRef<(() => void) | undefined>(undefined)
  const keyEntry = useRef<{ id: string; host: string; secret: string } | undefined>(
    undefined
  )
  const [enteringKey, setEnteringKey] = useState(false)
  const [typing, setTyping] = useState(false)
  const typingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const mounted = useRef(true)
  const markTyping = () => {
    setTyping(true)
    clearTimeout(typingTimer.current)
    typingTimer.current = setTimeout(() => setTyping(false), 700)
  }
  useEffect(
    () => () => {
      mounted.current = false
      clearTimeout(typingTimer.current)
      keyEntry.current = undefined
      keyDone.current?.()
      gateway.cancelAll()
    },
    [gateway]
  )
  const [, bumpConfig] = useReducer((n: number) => n + 1, 0)
  const context = {
    ...commandContext,
    lang: (zh ? 'zh' : 'en') as 'zh' | 'en',
    setConfig: (next: Parameters<CommandContext['setConfig']>[0]) => {
      commandContext.setConfig(next)
      bumpConfig()
    }
  }
  const leave = () => {
    gateway.cancelAll()
    onExit()
    exit()
  }
  const schedule = (action: () => void | Promise<void>) => {
    pendingActions.current++
    session.setQueuePaused(true)
    chain.current = chain.current
      .then(() => {
        if (mounted.current) return action()
      })
      .catch(() => setHint(pick('命令执行失败', 'Command failed')))
      .finally(() => {
        if (--pendingActions.current === 0 && mounted.current)
          session.setQueuePaused(false)
      })
  }
  const execute = (text: string) => {
    schedule(async () => {
      if (session.isBusy) {
        await new Promise<void>((resolve) => {
          const off = session.on((event) => {
            if (event.type === 'turn_finalized') {
              off()
              resolve()
            }
          })
        })
      }
      if (!mounted.current) return
      const result = await runCommand(text, { ...context, session })
      if (result.exit) {
        leave()
        return
      }
      if (result.keyRequest) {
        keyEntry.current = { ...result.keyRequest, secret: '' }
        setEnteringKey(true)
        setHint(
          pick(
            '请输入 API Key（隐藏输入），Enter 保存，Esc 取消',
            'Enter API key (hidden); Enter saves, Esc cancels'
          )
        )
        await new Promise<void>((resolve) => {
          keyDone.current = resolve
        })
      } else setHint(result.error ?? result.message ?? '')
    })
  }
  const executeRef = useRef(execute)
  executeRef.current = execute
  const submitPrompt = (text: string) => {
    if (!context.getConfig().model.trim()) {
      setHint(pick('请先配置并选择模型', 'Configure and select a model first'))
      return
    }
    session.submit(text)
  }
  useEffect(
    () =>
      session.on((event) => {
        dispatch(event)
        if (event.type === 'turn_finalized') {
          gateway.cancelAll()
          const pending = commands.current.splice(0)
          setCommandCount(0)
          for (const command of pending) executeRef.current(command)
          if (event.restoreText && editor.isEmpty) {
            editor.setText(event.restoreText)
            setInput(editor.text)
          }
        }
      }),
    [session, gateway, editor]
  )
  usePaste((text) => {
    if (keyEntry.current) {
      if (/[\r\n]/.test(text)) {
        setHint(pick('密钥不能包含换行', 'Key must be a single line'))
        return
      }
      keyEntry.current.secret += text
      return
    }
    editor.insert(text.replace(/\r\n?/g, '\n'))
    setInput(editor.text)
    markTyping()
  })
  useLayoutEffect(() => {
    if (!inputBox.current) return
    const box = measureElement(inputBox.current)
    const before = editor.lines
      .slice(0, editor.cursor.line)
      .concat(
        Array.from(editor.lines[editor.cursor.line]).slice(0, editor.cursor.col).join('')
      )
      .join('\n')
    const lines = renderTextLines('> ' + before, width)
    const next = {
      x: box.x + (enteringKey ? 2 : stringWidth(lines.at(-1) ?? '') % width),
      y: box.y + (enteringKey ? 0 : lines.length - 1)
    }
    setPosition((previous) =>
      previous?.x === next.x && previous.y === next.y ? previous : next
    )
  })
  useInput((text, key) => {
    if (keyEntry.current) {
      const entry = keyEntry.current
      if (key.escape || (key.ctrl && text === 'c')) {
        keyDone.current?.()
        keyDone.current = undefined
        entry.secret = ''
        keyEntry.current = undefined
        setEnteringKey(false)
        setHint(pick('已取消密钥录入', 'Key entry cancelled'))
        return
      }
      if (key.return) {
        keyEntry.current = undefined
        setEnteringKey(false)
        try {
          saveProfileKey(
            entry,
            entry.secret,
            context,
            context.getConfig,
            context.setConfig
          )
          setHint(
            pick(
              '密钥已保存；使用 /model 选择档案',
              'Key saved; use /model to select the profile'
            )
          )
        } catch {
          setHint(
            pick(
              '密钥无效或档案已变化，请重新录入',
              'Invalid key or changed profile; restart entry'
            )
          )
        }
        entry.secret = ''
        keyDone.current?.()
        keyDone.current = undefined
        return
      }
      if (key.backspace || key.delete) entry.secret = entry.secret.slice(0, -1)
      else if (!key.ctrl && !key.meta) entry.secret += text
      return
    }
    const approval = frame.approval
    if (approval && !typing && key.escape) {
      gateway.resolve(approval.requestId, 'deny')
      return
    }
    if (approval && !typing && editor.isEmpty && /^[yn]$/i.test(text)) {
      gateway.resolve(approval.requestId, text.toLowerCase() === 'y' ? 'allow' : 'deny')
      return
    }
    const action = applyKey(editor, text, key, { busy: session.isBusy })
    if (!action.handled) return
    bumpEditor()
    if (action.interrupt) {
      session.interrupt('user')
      setHint(pick('已请求打断', 'Interrupt requested'))
      return
    }
    if (action.exit) {
      if (++ctrlC.current >= 2) leave()
      else setHint(pick('再按一次 Ctrl+C 退出', 'Press Ctrl+C again to exit'))
      return
    }
    ctrlC.current = 0
    if (action.escape) {
      const recycled = [...session.recycleQueued(), ...commands.current.splice(0)]
      setCommandCount(0)
      if (recycled.length) {
        editor.setText(recycled.join('\n'))
        setInput(editor.text)
      }
      return
    }
    if (action.submit) {
      const submitted = editor.text.trim()
      if (!submitted) return
      editor.commit(submitted)
      editor.clear()
      setInput('')
      setHint('')
      setTyping(false)
      if (submitted.startsWith('/')) {
        if (!session.isBusy) execute(submitted)
        else {
          commands.current.push(submitted)
          setCommandCount(commands.current.length)
          setHint(
            pick(
              '命令已排队，将在回合结束后执行',
              'Command queued until the turn boundary'
            )
          )
        }
      } else if (pendingActions.current) schedule(() => submitPrompt(submitted))
      else submitPrompt(submitted)
      return
    }
    setInput(editor.text)
    if (text || key.backspace || key.delete) markTyping()
  })
  const config = commandContext.getConfig()
  const historyLines = useMemo(
    () => frame.transcript.flatMap((line) => renderTextLines(line, width)),
    [frame.transcript, width]
  )
  const liveText = [frame.liveThinking ? '· ' + frame.liveThinking : '', frame.liveText]
    .filter(Boolean)
    .join('\n')
  return (
    <Box flexDirection="column">
      <Box flexDirection="column">
        {renderHeader({
          version,
          model: config.model,
          baseUrl: config.baseUrl,
          keyPresent: !!config.apiKey.trim(),
          cwd,
          columns: width,
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
      {historyLines.map((line, i) => (
        <Text key={'history-' + i}>{line}</Text>
      ))}
      {liveText &&
        renderTextLines(liveText, width).map((line, i) => (
          <Text key={'live-' + i}>{line}</Text>
        ))}
      {frame.notices.map((notice, i) => (
        <Text key={'notice-' + i} color={notice.level === 'error' ? 'red' : 'yellow'}>
          {notice.text}
        </Text>
      ))}
      {commandCount > 0 && (
        <Text color="yellow">
          {pick('排队命令：', 'Queued commands: ')}
          {commandCount}
        </Text>
      )}
      {frame.queue.map((item) => (
        <Text key={item.id} color="yellow">
          {pick('⧗ 排队：', '[queued] ')}
          {item.preview}
        </Text>
      ))}
      {frame.approval && !typing && (
        <Box flexDirection="column" borderStyle="round" borderColor="yellow">
          <Text color="yellow">
            {pick('需要审批', 'Approval needed')}: {frame.approval.name}
          </Text>
          <Text>{frame.approval.summary}</Text>
          <Text>
            {pick('y 允许，n 或 Esc 拒绝', 'y allows; n or Esc denies')}
            {!editor.isEmpty
              ? pick(
                  '；先清空或提交输入后再按 y/n',
                  '; clear or submit the draft before y/n'
                )
              : ''}
          </Text>
        </Box>
      )}
      {frame.error && <Text color="red">{frame.error}</Text>}
      <Box flexDirection="column">
        <Box ref={inputBox}>
          <Text>{enteringKey ? '> ' : `> ${input}`}</Text>
        </Box>
        <Text dimColor>
          {zh ? STATUS_ZH[frame.status.state] : frame.status.state}
          {hint ? ` — ${hint}` : ''}
        </Text>
        {setupHint(config, strategy) && (
          <Text color="yellow">{setupHint(config, strategy)}</Text>
        )}
      </Box>
    </Box>
  )
}
