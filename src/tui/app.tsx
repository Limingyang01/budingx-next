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
import { existsSync, readFileSync } from 'node:fs'
import type { SessionEvent } from '../core/events.js'
import type { Session } from '../core/session.js'
import type { InkApprovalGateway } from './approval.js'
import { runCommand, type CommandContext } from './commands.js'
import { EditorBuffer } from './editor/buffer.js'
import { applyKey } from './editor/keys.js'
import { reduceFrame, renderTextLines } from './render/reducer.js'
import { renderHeader, setupHint, terminalStrategy } from './render/header.js'
import { initialFrame } from './render/types.js'
import { diffViewLines } from './render/diff-view.js'
import {
  activeToken,
  applyCompletion,
  commandCandidates,
  fileCandidates,
  longestCommonPrefix
} from './render/completion.js'
import { saveProfileKey } from './runtime.js'
import { diffLines, type DiffHunk } from '../workspace/diff.js'
import { MODES_EN, MODES_ZH, nextMode } from '../workspace/policy.js'
import { walkWorkspaceFiles } from '../workspace/search.js'
import type { ChangeRecord } from '../workspace/checkpoint.js'
import { diffStats } from './render/diff-view.js'

export type AppProps = {
  session: Session
  gateway: InkApprovalGateway
  commandContext: Omit<CommandContext, 'session'>
  version: string
  cwd?: string
  onExit: () => void
}

type DiffDialog = {
  view: 'list' | 'detail'
  index: number
  /** 'current' or a turn id; aligned with the reference Current + T1..Tn. */
  source: string
}

const COMMAND_NAMES = [
  'help',
  'config',
  'models',
  'model',
  'provider',
  'permission',
  'rules',
  'diff',
  'undo',
  'denials',
  'clear',
  'exit',
  'quit'
]
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
    commandContext.permission?.policy.getMode(),
    (mode) => initialFrame(mode ?? 'read_only')
  )
  const [input, setInput] = useState('')
  const [hint, setHint] = useState('')
  const [dialog, setDialog] = useState<DiffDialog | null>(null)
  const [detailScroll, setDetailScroll] = useState(0)
  const [overlayDismissed, setOverlayDismissed] = useState(false)
  const [completionIndex, setCompletionIndex] = useState(0)
  const fileCache = useRef<string[] | null>(null)
  // SP003 T18c: rejection may carry feedback back to the model, like the
  // reference's "and tell budingx what to do differently" path.
  const [rejectEntry, setRejectEntry] = useState<{ requestId: string; text: string } | null>(null)
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
    fileCache.current = null
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
  // SP003: diff dialog and @ / completion overlay data (design §3.6/§3.7).
  const permissionHandles = commandContext.permission
  const turnIds = useMemo(() => {
    const ids: string[] = []
    for (const record of permissionHandles?.checkpointChanges() ?? []) {
      if (record.turnId && !ids.includes(record.turnId)) ids.push(record.turnId)
    }
    return ids
  }, [frame.changes.length, permissionHandles])
  const sourceList = useMemo(() => ['current', ...turnIds], [turnIds])
  const sourceLabel = (source: string) =>
    source === 'current'
      ? pick('当前差异', 'Current')
      : pick(`第 ${sourceList.indexOf(source)} 回合差异`, `turn ${sourceList.indexOf(source)} diff`)
  const cycleSource = (current: string, delta: number): string => {
    const list = sourceList.length > 0 ? sourceList : ['current']
    const index = Math.max(0, list.indexOf(current))
    return list[(index + delta + list.length) % list.length]
  }
  const dialogEntries = useMemo(() => {
    const changes = permissionHandles?.checkpointChanges() ?? []
    const baselineFor = new Map<string, ChangeRecord>()
    for (const record of changes) {
      if (!baselineFor.has(record.path)) baselineFor.set(record.path, record)
    }
    const active =
      dialog && dialog.source !== 'current'
        ? changes.filter((record) => record.turnId === dialog.source)
        : changes
    const byPath = new Map<string, { record: ChangeRecord; baseline: ChangeRecord }>()
    for (const record of active) {
      const existing = byPath.get(record.path)
      if (existing) existing.record = record
      else byPath.set(record.path, { record, baseline: baselineFor.get(record.path) as ChangeRecord })
    }
    return [...byPath.values()]
  }, [dialog, permissionHandles, frame.changes.length])
  const detailHunks = (
    entry: { record: ChangeRecord; baseline: ChangeRecord } | undefined,
    source: string
  ): DiffHunk[] => {
    if (!entry) return []
    if (source !== 'current') return entry.record.diff
    if (!permissionHandles) return []
    try {
      const resolved = permissionHandles.workspace.resolve(entry.record.path)
      const current =
        resolved.existed && !resolved.isDirectory
          ? readFileSync(resolved.real, 'utf8')
          : ''
      return diffLines(entry.baseline.before ?? '', current)
    } catch {
      return []
    }
  }
  const completion = useMemo(() => {
    if (dialog || frame.approval || overlayDismissed || enteringKey) return null
    const lineText = editor.lines[editor.cursor.line] ?? ''
    const token = activeToken(lineText, editor.cursor.col, COMMAND_NAMES)
    if (!token) return null
    if (token.kind === 'command') {
      const candidates = commandCandidates(token.token, COMMAND_NAMES)
      return candidates.length > 0 ? { token, candidates } : null
    }
    if (!permissionHandles) return null
    if (!fileCache.current) {
      fileCache.current = walkWorkspaceFiles(
        permissionHandles.workspace,
        permissionHandles.workspace.root
      ).relative
    }
    const candidates = fileCandidates(token.token, fileCache.current)
    return candidates.length > 0 ? { token, candidates } : null
  }, [
    input,
    editor.cursor.line,
    editor.cursor.col,
    dialog,
    frame.approval,
    overlayDismissed,
    enteringKey,
    editor,
    permissionHandles
  ])
  const completionIndexSafe = Math.min(
    completionIndex,
    Math.max(0, (completion?.candidates.length ?? 1) - 1)
  )
  useEffect(() => {
    setCompletionIndex(0)
  }, [completion?.token.token, completion?.token.kind])
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
        if (event.type === 'turn_finalized' || event.type === 'change_set') {
          // Files may have appeared or disappeared; refresh completion.
          fileCache.current = null
        }
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
    if (rejectEntry) {
      if (key.escape) {
        gateway.resolve(rejectEntry.requestId, 'deny')
        setRejectEntry(null)
        setHint(pick('已拒绝', 'Denied'))
        return
      }
      if (key.return) {
        gateway.resolve(
          rejectEntry.requestId,
          'deny',
          'user',
          rejectEntry.text.trim() || undefined
        )
        setRejectEntry(null)
        setHint(
          rejectEntry.text.trim()
            ? pick('已拒绝并附上反馈', 'Denied with feedback')
            : pick('已拒绝', 'Denied')
        )
        return
      }
      if (key.backspace) {
        setRejectEntry({ ...rejectEntry, text: rejectEntry.text.slice(0, -1) })
        return
      }
      if (!key.ctrl && !key.meta && text) {
        setRejectEntry({ ...rejectEntry, text: rejectEntry.text + text })
      }
      return
    }
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
    if (dialog && permissionHandles) {
      // The dialog owns the keyboard while open (SP003 AC CP-07).
      if (key.escape || (key.ctrl && text === 'c')) {
        setDialog(null)
        return
      }
      if (dialog.view === 'list') {
        if (key.upArrow)
          setDialog({ ...dialog, index: Math.max(0, dialog.index - 1) })
        else if (key.downArrow)
          setDialog({
            ...dialog,
            index: Math.min(dialogEntries.length - 1, dialog.index + 1)
          })
        else if (key.return && dialogEntries[dialog.index]) {
          setDialog({ view: 'detail', index: dialog.index, source: dialog.source })
          setDetailScroll(0)
        } else if (key.rightArrow || key.leftArrow) {
          setDialog({
            ...dialog,
            source: cycleSource(dialog.source, key.rightArrow ? 1 : -1)
          })
        }
        return
      }
      if (key.return) {
        setDialog({ view: 'list', index: dialog.index, source: dialog.source })
      } else if (key.rightArrow || key.leftArrow) {
        setDialog({
          ...dialog,
          source: cycleSource(dialog.source, key.rightArrow ? 1 : -1)
        })
      } else if (key.upArrow) {
        setDetailScroll((s) => Math.max(0, s - 1))
      } else if (key.downArrow) {
        setDetailScroll((s) => s + 1)
      }
      return
    }
    const approval = frame.approval
    if (completion && !approval) {
      // @ / overlay keys (SP003 AC FC-01…03).
      if (key.upArrow) {
        setCompletionIndex(Math.max(0, completionIndexSafe - 1))
        return
      }
      if (key.downArrow) {
        setCompletionIndex(
          Math.min(completion.candidates.length - 1, completionIndexSafe + 1)
        )
        return
      }
      if (key.tab && !key.shift) {
        // SP003 T18e: Tab first extends to the longest common prefix,
        // like the reference typeahead; only exhausted picks apply fully.
        const lineText = editor.lines[editor.cursor.line] ?? ''
        const values = completion.candidates.map((candidate) => candidate.value)
        const prefix = longestCommonPrefix(values)
        const usePrefix =
          completion.candidates.length > 1 &&
          prefix.length > completion.token.token.length
        const chosen = usePrefix
          ? {
              value: prefix,
              kind: completion.token.kind,
              directory: !/[.]/.test(prefix.split('/').at(-1) ?? '')
            }
          : completion.candidates[completionIndexSafe]
        if (chosen) {
          editor.lines[editor.cursor.line] = applyCompletion(
            lineText,
            completion.token,
            chosen
          )
          editor.cursor.col =
            completion.token.start + 1 + Array.from(chosen.value).length
          setInput(editor.text)
          bumpEditor()
        }
        return
      }
      if (key.escape) {
        setOverlayDismissed(true)
        return
      }
    }
    if (approval && !typing && key.escape) {
      gateway.resolve(approval.requestId, 'deny')
      return
    }
    if (approval && !typing && editor.isEmpty && /^[123]$/.test(text)) {
      // SP003 AC PC-06: 1 allow once, 2 allow for session, 3 deny (+feedback).
      if (text === '3') {
        setRejectEntry({ requestId: approval.requestId, text: '' })
        return
      }
      gateway.resolve(approval.requestId, text === '1' ? 'allow' : 'allow_session')
      return
    }
    if (approval && !typing && editor.isEmpty && /^[yn]$/i.test(text)) {
      if (text.toLowerCase() === 'n') {
        setRejectEntry({ requestId: approval.requestId, text: '' })
        return
      }
      gateway.resolve(approval.requestId, 'allow')
      return
    }
    if (key.shift && key.tab && permissionHandles) {
      // SP003 design §3.8: cycle the three fixed modes.
      const next = nextMode(permissionHandles.policy.getMode())
      permissionHandles.policy.setMode(next)
      setHint(
        pick(`权限模式：${MODES_ZH[next]}`, `Permission mode: ${MODES_EN[next]}`)
      )
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
        // Interactive /diff opens the two-level dialog (SP003 AC CP-07);
        // pipe and non-workspace hosts keep the text output.
        if (permissionHandles && /^\/diff(\s|$)/.test(submitted)) {
          const arg = submitted.slice(5).trim()
          let index = 0
          if (arg) {
            const found = dialogEntries.findIndex(
              (entry) => entry.record.path === arg
            )
            if (found < 0) {
              // Unknown path: fall back to the text command error.
              if (!session.isBusy) execute(submitted)
              else {
                commands.current.push(submitted)
                setCommandCount(commands.current.length)
              }
              return
            }
            index = found
          }
          // Open on the newest turn diff, fall back to Current.
          setDialog({
            view: arg ? 'detail' : 'list',
            index,
            source: turnIds.at(-1) ?? 'current'
          })
          setDetailScroll(0)
          fileCache.current = null
          return
        }
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
    if (overlayDismissed && (text || key.backspace)) setOverlayDismissed(false)
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
  if (dialog && permissionHandles) {
    // SP003 AC CP-07/CP-08: two-level dialog, source switch, single column
    // in every width (a split column would cut hunks on narrow terminals).
    const entry = dialogEntries[dialog.index]
    if (dialog.view === 'list') {
      return (
        <Box flexDirection="column" borderStyle="round" borderColor="gray">
          <Text bold>
            {pick('本会话改动', 'Session changes')} · {sourceLabel(dialog.source)}
          </Text>
          {dialogEntries.length === 0 && (
            <Text dimColor>{pick('无改动', 'no changes')}</Text>
          )}
          {dialogEntries.map((item, index) => {
            const stat = diffStats(item.record.diff)
            return (
              <Text key={item.record.path} inverse={index === dialog.index}>
                {' '}
                {item.record.path} {`+${stat.additions}/-${stat.removals}`}
              </Text>
            )
          })}
          <Text dimColor>
            {pick(
              '↑↓ 选择 · Enter 详情 · ←/→ 切源 · Esc 关闭',
              'up/down select · enter detail · left/right source · esc close'
            )}
          </Text>
        </Box>
      )
    }
    const hunks = detailHunks(entry, dialog.source)
    const lines = diffViewLines(hunks, width)
    const visible = lines.slice(detailScroll, detailScroll + 24)
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="gray">
        <Text bold>
          ── {entry?.record.path ?? ''} · {sourceLabel(dialog.source)} ──
        </Text>
        {visible.map((line, index) => (
          <Text key={detailScroll + index}>
            {line.spans.map((span, j) => (
              <Text
                key={j}
                color={
                  span.kind === 'add'
                    ? 'green'
                    : span.kind === 'remove'
                      ? 'red'
                      : span.kind === 'header'
                        ? 'cyan'
                        : undefined
                }
                dimColor={span.kind === 'gutter' || span.kind === 'context'}
              >
                {span.text}
              </Text>
            ))}
          </Text>
        ))}
        {visible.length === 0 && (
          <Text dimColor>{pick('（无差异）', '(no differences)')}</Text>
        )}
        <Text dimColor>
          {pick(
            '↑↓ 滚动 · Enter 列表 · ←/→ 切源 · Esc 关闭',
            'up/down scroll · enter list · left/right source · esc close'
          )}
        </Text>
      </Box>
    )
  }
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
      {rejectEntry && (
        <Box flexDirection="column" borderStyle="round" borderColor="yellow">
          <Text color="yellow">
            {pick('拒绝反馈（可选，将随拒绝发回模型）', 'Rejection feedback (optional, sent back to the model)')}
          </Text>
          <Text> &gt; {rejectEntry.text}</Text>
          <Text dimColor>
            {pick(
              'Enter 提交拒绝与反馈 · Esc 仅拒绝',
              'Enter denies with feedback · Esc denies silently'
            )}
          </Text>
        </Box>
      )}
      {frame.approval && !typing && !rejectEntry && (
        <Box flexDirection="column" borderStyle="round" borderColor="yellow">
          <Text color="yellow">
            {pick('需要审批', 'Approval needed')}: {frame.approval.name}
          </Text>
          <Text>{frame.approval.summary}</Text>
          <Text>
            {permissionHandles
              ? pick(
                  '1 允许一次 · 2 本会话记住 · 3 拒绝（或 Esc）',
                  '1 allow once · 2 allow for session · 3 deny (or Esc)'
                )
              : pick('y 允许，n 或 Esc 拒绝', 'y allows; n or Esc denies')}
            {!editor.isEmpty
              ? pick(
                  '；先清空或提交输入后再按键',
                  '; clear or submit the draft before pressing keys'
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
        {completion && (
          <Box flexDirection="column">
            {completion.candidates.map((candidate, index) => (
              <Text key={candidate.value} inverse={index === completionIndexSafe}>
                {(completion.token.kind === 'command' ? '/' : '@') + candidate.value}
                {candidate.directory
                  ? pick('  [目录]', '  [dir]')
                  : candidate.kind === 'command'
                    ? pick('  [命令]', '  [cmd]')
                    : ''}
              </Text>
            ))}
            <Text dimColor>
              {pick('↑↓ 选择 · Tab 插入 · Esc 关闭', 'up/down select · tab insert · esc dismiss')}
            </Text>
          </Box>
        )}
        <Text dimColor>
          {zh ? STATUS_ZH[frame.status.state] : frame.status.state}
          {permissionHandles
            ? ` · ${pick(
                MODES_ZH[frame.permissionMode],
                MODES_EN[frame.permissionMode]
              )}`
            : ''}
          {hint ? ` — ${hint}` : ''}
        </Text>
        {setupHint(config, strategy) && (
          <Text color="yellow">{setupHint(config, strategy)}</Text>
        )}
      </Box>
    </Box>
  )
}
